# GeoSpatial Studio — 第二轮独立安全审计与生产级修复报告 (SECURITY_AUDIT_V2)

- **审计项目**：GeoSpatial Studio（GIS 地理空间技术服务在线接单平台）
- **基准参考提交**：`d9b0c6aa77e96f1d78f4dab7305c50dc8858acff`（注：当前 Google AI Studio 容器工作区不包含 `.git` 目录，已按当前工作区全量代码逐行复核与重构）
- **目标 Firebase 项目 ID**：`gen-lang-client-0041017161`
- **目标 Firestore 数据库 ID**：`ai-studio-cb63a7bd-f74c-4c79-9ba8-1cb9e33b42e9`

---

## 一、第一轮遗留核心漏洞复核与根因定位

### 1. P0-A：管理员鉴权形同虚设（伪造 Header / Query / Body 与硬编码 UID 绕过）
- **原问题代码位置**：
  - 原 `src/server/api.ts` 中的 `isAuthorizedAdmin(req, bodyEmail, bodyUid)`、`verifiedAdminUids`（硬编码 `'admin-bootstrap-uid'`）、`getAdminEmails()`。
  - 原 `src/pages/AdminPage.tsx` 中的 `handleQuickDemoAdminLogin()` 快捷演示按钮及所有通过 `x-admin-email`、`x-admin-uid` 请求头和 `?email=...&uid=...` 发送身份的逻辑。
- **核心风险**：
  - 服务端直接信任客户端可控的 `x-admin-email`、`x-admin-uid`、Query 参数与 Body 字段，未做任何密码学签名校验。
  - 更严重的是，原 `isAuthorizedAdmin` 中当 `x-admin-email` 匹配 `yeston463@gmail.com` 时，会自动执行 `verifiedAdminUids.add(uidHeader)`，允许攻击者用任意自定义字符串污染服务端内存中的 UID 白名单集合。
- **本轮彻底修复方案**：
  - **代码位置**：`src/server/api.ts` (`extractBearerToken`, `getServerAdminUidWhitelist`, `requireAdminAuth`)、`src/lib/firebase.ts` (`getAdminBearerToken`)、`src/pages/AdminPage.tsx`。
  - 彻底删除 `isAuthorizedAdmin`、`x-admin-email`、`x-admin-uid`、查询参数和请求体 UID 信任逻辑；彻底删除 `'admin-bootstrap-uid'` 与前端快捷登录按钮 `handleQuickDemoAdminLogin`。
  - 引入 `firebase-admin/auth` 的 `getAuth(adminApp).verifyIdToken(idToken, false)`：
    1. 仅从 `Authorization: Bearer <idToken>` 提取 JWT。
    2. 后端验证 Google 签名、有效期 (`exp`)、签发者 (`iss`) 与项目受众 (`aud === 'gen-lang-client-0041017161'`)。
    3. 仅从验证通过的 `decodedToken.uid` 读取真实 UID。
    4. 仅当 `decodedToken.admin === true`（可信 Custom Claim）或 `uid` 存在于服务端 `ADMIN_UIDS` 环境变量白名单时放行；前端邮箱字符串不再作为授权依据。
    5. 缺少/无效 Token 一律返回 `401 Unauthorized`；有效 Token 但 UID 未加入白名单一律返回 `403 Forbidden`（并回显该账号的真实 `uid` 以便管理员配置 `ADMIN_UIDS`）。

---

### 2. P0-B：四重数据源脑裂（Split-Brain）与静默假成功
- **原问题代码位置**：
  - 原 `src/server/api.ts` 同时维护内存数组 `ordersStore`、本地文件 `.data/orders.json`、服务端未认证客户端 SDK (`firebase/firestore` `setDoc`)，以及 `/api/admin/sync` 接口。
  - 原 `src/pages/AdminPage.tsx` 在管理员打开后台时拉取 Firestore 与后端内存做双向合并，且仅同步 `serverOrders.slice(0, 15)`。
- **核心风险**：
  - `POST /api/orders` 在 Firestore 写入抛错时仅 `console.warn` 并照常返回 `201 Created`（`firestorePersisted: false`），在 Cloud Run 无状态容器重启或缩容后导致真实客户订单永久丢失。
  - 多个容器实例各自读写本地 `.data/orders.json`，产生严重的数据不一致与状态回退。
- **本轮彻底修复方案**：
  - **代码位置**：`src/server/order-service.ts` (`FirestoreAdminOrderRepository`, `OrderService`)、`src/server/api.ts`。
  - 彻底删除 `ordersStore`、`.data/orders.json` 自动读写、服务端 `firebase/firestore` 客户端 SDK、`/api/admin/sync` 接口，以及前端 `AdminPage.tsx` 中的 `syncOrderToFirestore` / `fetchOrdersFromFirestore` / `slice(0, 15)`。
  - 生产与默认运行环境唯一权威数据源收敛为基于 `firebase-admin/firestore` 的 `FirestoreAdminOrderRepository`：
    - 订单创建 (`createOrderAtomic`) 与状态更新 (`updateOrderAtomic`) 全部在 Firestore 事务 (`db.runTransaction`) 内原子执行。
    - 严禁静默降级：当 Firestore 不可用或权限缺失时，显式抛出 `DatabaseUnavailableError` 并返回 HTTP `503 Service Unavailable`，绝不返回虚假 `201 Created`。
    - 生产环境禁用自动注入 `SEED_ORDERS`，并对 `/api/admin/seed-demo` 在 `NODE_ENV === 'production'` 下直接返回 `403`。

---

### 3. P0-C：Firestore Security Rules 过度开放与客户端自提权隐患
- **原问题代码位置**：
  - 原 `firestore.rules` 与原 `src/lib/firebase.ts` (`ensureAdminDocInFirestore`, `syncOrderToFirestore`, `fetchOrdersFromFirestore`)。
- **核心风险**：
  - 任何客户端直连 Firestore 若被允许读取或写入 `/orders` 或 `/admins/{uid}`，将导致客户隐私泄露、订单状态篡改或管理员自提权。
- **本轮彻底修复方案**：
  - **代码位置**：`/firestore.rules`（已通过 `DeployRules` 部署至云端 `ai-studio-cb63a7bd-f74c-4c79-9ba8-1cb9e33b42e9`）。
  - `/orders/{orderId}`、`/rateLimits/{limitKey}`、`/idempotencyKeys/{idemKey}` 设置为 `allow read, write: if false;`，强制所有订单读写仅能通过服务端 `firebase-admin` 受控 API 执行。
  - `/admins/{uid}` 设置为 `allow create, update, delete: if false;`，彻底封堵客户端写入 `/admins` 自提权路径。

---

### 4. P0-D：公开工单查询枚举与客户联系方式暴露
- **原问题代码位置**：
  - 原 `src/server/api.ts` (`POST /api/orders/lookup`) 与 `src/pages/LookupPage.tsx`。
- **核心风险**：
  - 原工单号仅 4 位随机字符，且凭“工单号 + 邮箱/微信号”即可查询，攻击者若已知某客户常用邮箱/微信号，可暴力枚举工单并获取完整订单详情。
  - 查询接口原样返回完整 `contactValue`。
- **本轮彻底修复方案**：
  - **代码位置**：`src/utils/order-utils.ts` (`generateOrderNumber`, `generateQueryToken`, `maskContactValue`, `toPublicOrderView`)、`src/server/order-service.ts` (`hashQueryToken`, `verifyQueryToken`, `lookupCustomerOrder`, `rotateOrderQueryTokenByAdmin`)。
  - 工单号升级为 CSPRNG 生成的 6 位高熵后缀（`GEO-YYYYMMDD-XXXXXX`），内部 ID 升级为 `crypto.randomUUID()`。
  - 创建工单时额外生成 12 位 Base32 高熵一次性查询凭证 `queryToken`（格式 `QK-XXXX-XXXX-XXXX`，约 60 bits 熵）。
  - 服务端数据库仅存储加盐 HMAC-SHA256 哈希 `queryTokenHash`，绝不存储明文 `queryToken`；验证时采用 `crypto.timingSafeEqual` 恒定时间比对，并在工单不存在时同样执行伪哈希比对以消除时序侧信道，失败统一返回相同错误文案。
  - 公开查询返回结构 `PublicOrderView` 强制对联系方式脱敏（如 `c***s@163.com`、`sp***wu`），且物理剥离 `contactValue`、`adminNotes`、`queryTokenHash` 与内部 `id`。
  - 管理后台新增 `POST /api/admin/orders/:id/rotate-token`（“重置并签发新查询凭证”），当客户遗失凭证并经人工核实身份后，管理员可一键重置哈希并签发新凭证（旧凭证立即失效）。

---

### 5. P1：状态机流转、报价校验、CSV 公式注入与反滥用加固
- **修复清单与代码位置**：
  1. **显式订单状态机 (`ALLOWED_STATUS_TRANSITIONS`)**：在 `src/utils/order-utils.ts` 中定义合法流转表，严禁从 `pending_review` 直接跳至 `completed` 或从 `completed` 回退。
  2. **人工报价强校验 (`validateAdminOrderUpdate`)**：拒绝 `NaN`、`Infinity`、`<= 0`、`> 1,000,000`、布尔值、数组、对象及格式非法字符串；未设置有效正数报价严禁进入 `pending_payment`、`in_progress`、`pending_acceptance`、`completed`；处于 `in_progress / pending_acceptance / completed` 锁定阶段严禁直接篡改已约定报价。
  3. **CSV 公式注入防护 (`sanitizeCSVField`)**：对所有以 `=`、`+`、` - `、`@`、`\t`、`\r`（含前导空白控制字符）开头的单元格自动前置单引号 `'` 并遵循 RFC 4180 双引号转义。
  4. **请求体大小限制與可信代理 IP 解析**：在 `src/server/api.ts` 强制限制请求体最大 `32KB`（超限返回 `413 Payload Too Large`）；仅在 `TRUST_PROXY=true` 或 Cloud Run (`K_SERVICE`) 环境下解析 `X-Forwarded-For`，防止客户端伪造请求头绕过限流。
  5. **防重复提交幂等保护 (`computeSubmissionIdempotencyKey`)**：在事务内基于 IP + 时间窗口 + 载荷摘要（或 `X-Idempotency-Key`）记录幂等键，拦截短时重复点击。
