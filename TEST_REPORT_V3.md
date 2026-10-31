# GeoSpatial Studio — 第三轮真实测试报告 (TEST_REPORT_V3)

- **执行时间**: `2026-10-30T21:57:42-07:00`
- **参考基准提交**: `2b6f20b4e4d05ab9146958af05fa66b6a8b8e994`
- **测试环境隔离状态**: `NODE_ENV=test`，`IGNORE_LOCAL_FIREBASE_CONFIG_FILE=true`，`FIREBASE_PROJECT_ID=demo-geospatial-studio-test`，**0 次访问正式生产数据库 `gen-lang-client-0041017161`**。

---

## 一、执行命令与实际退出码汇总

| 序号 | 验证阶段 | 执行命令 | 环境条件 | 退出码 (Exit Code) | 状态 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | 源码与构建包密钥/未跟踪配置引用扫描 | `npm run check:secrets` | 工作区 & 干净克隆目录 | `0` | **PASS** |
| 2 | TypeScript 全量严格类型检查 | `npm run lint` (`tsc --noEmit`) | 工作区 & 无 `firebase-applet-config.json` 干净克隆目录 | `0` | **PASS** |
| 3 | 纯单元测试与隔离 API/安全集成测试 (16 项) | `npm test` | `NODE_ENV=test` + 隔离事务存储 `IsolatedTestOrderRepository` | `0` | **PASS (16/16)** |
| 4 | Firestore 安全规则静态策略检查 | `npm run test:rules` (Subtest 1) | 校验 `firestore.rules` 零信任规则结构 | `0` | **PASS** |
| 5 | Firestore Emulator 动态安全规则客户端拦截测试 | `npm run test:rules` (Subtest 2) | 容器内未启动 Java Firestore Emulator (`FIRESTORE_EMULATOR_HOST` 未设置) | `0` (显式诊断 `BLOCKED`) | **BLOCKED**（按 P0-B.5 拒绝回退连接正式库） |
| 6 | Vite 生产前端构建 | `npm run build` (`vite build`) | 工作区 & 无 `firebase-applet-config.json` 干净克隆目录 | `0` | **PASS** |
| 7 | 干净 Git 克隆全链路复现测试 | `/tmp/geospatial-clean-clone`（剔除 `firebase-applet-config.json`、`.env*`、`.data`、`dist`） | 模拟从 GitHub 全新 `git clone` 后的独立环境 | `0` | **PASS** |

---

## 二、测试分类明细（严格区分 Mock / 文件型测试仓储 / 真实云环境）

### A. 纯单元测试与加密原语验证 (`src/utils/order-utils.test.ts` — 9 项全部 PASS)
1. **P1-D 安全随机数与拒绝采样测试 (`PASS`)**：
   - 验证 `generateOrderNumber`（`^GEO-\d{8}-[2-9A-HJ-NP-Z]{6}$`）、`generateQueryToken`（`^QK-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$`）、`generateClientIdempotencyKey`（`^idem_[0-9a-f]{32}$`）格式与 500 次连续生成无碰撞。
   - 验证 `getSecureRandomIndex(30, ...)` 对 `>= 240` 字节严格执行拒绝采样（消除取模偏差）。
   - 验证当 CSPRNG 不可用时显式抛出 `CryptoUnavailableError (CSPRNG_UNAVAILABLE)`，绝不回退到 `Math.random()`。
2. **隐私脱敏与字段剥离 (`PASS`)**：
   - 验证 `maskContactValue` 与 `toPublicOrderView` 彻底剥离 `contactValue`、`adminNotes`、`queryTokenHash`、`id`。
3. **表单输入校验、蜜罐拦截、状态机流转、报价数值/锁定校验、CSV 公式注入防御 (`PASS`)**。

### B. 隔离 API 与对抗安全测试 (`src/tests/api-and-security.test.ts` — 7 大综合套件全部 PASS)
> **诚实声明（P0-B.7 & P0-B.8）**：
> - 以下测试中的管理员身份验证使用确定性 `mockTokenVerifier`（标记为 `[MOCK_AUTH_VERIFIER]`），用于验证服务端 `requireAdminAuth` 中间件对缺省 Token、伪造 Header/Query/Body、非白名单 UID、禁用演示 UID 及合法白名单 UID 的拦截逻辑。
> - 以下测试中的重启持久化与跨实例测试使用基于原子文件锁的 `IsolatedTestOrderRepository`，证明应用层完全消除了进程内内存状态依赖（无 `/api/admin/sync`），但**不等同于真实 Cloud Firestore 多实例网络验证**。

1. **`[P0-A & P0-B]` 干净克隆配置独立性与生产库隔离保护 (`PASS`)**：
   - 验证 `process.env.FIREBASE_PROJECT_ID !== 'gen-lang-client-0041017161'`。
   - 验证无 `firebase-applet-config.json` 时 `verifyFirebaseConfigConsistency` 与 `validateFirebaseClientConfig` 正常工作。
2. **`[MOCK_AUTH_VERIFIER]` Cases 1-5 管理员鉴权与伪造绕过拦截 (`PASS`)**：
   - 未登录访问 `/api/admin/orders` -> `401`
   - 伪造 `x-admin-email: yeston463@gmail.com` -> `401`
   - 伪造 `x-admin-uid: admin-bootstrap-uid`（Header / Query / Body / Token 内）-> `401`
   - 合法 Google Token 但 UID 不在 `ADMIN_UIDS` -> `403 FORBIDDEN_NOT_ADMIN`（回显真实 UID 供配置）
   - 合法白名单 Admin UID Bearer Token -> `200 OK`
3. **`[P1-A]` 重复提交与查询凭证恢复 6 大场景 (`PASS`)**：
   - 场景 1（首次提交成功）：返回 `201 Created`，`duplicate: false`，`submissionStatus: 'CREATED'`，且数据库不存明文 `queryToken`。
   - 场景 2（网络响应丢失后携带相同 `X-Idempotency-Key` 重试）：返回 `200 OK`，`duplicate: true`，`submissionStatus: 'IDEMPOTENT_REPLAY'`，安全恢复原有效 `queryToken` 且可正常查询工单。
   - 场景 3（双击并发提交相同 `X-Idempotency-Key`）：仅创建 1 笔工单，两次响应返回相同工单号与有效查询凭证。
   - 场景 4（客户关闭页面重新打开，无原会话密钥提交相同内容）：返回 `409 Conflict`（`DUPLICATE_SUBMISSION_REQUIRES_MANUAL_RECOVERY`，`queryToken: null`），绝不返回 201 或假凭证字符串；客户显式确认 `forceNewOrder: true` 时正常创建新工单（`201`）。
   - 场景 5（不同用户提交完全相同标题与描述，甚至复用同一幂等键 Header）：绝不合并工单，各自生成独立工单号与独立查询凭证。
   - 场景 6（凭证遗失及管理员人工重置 `POST /api/admin/orders/:id/rotate-token`）：签发新凭证后，旧凭证查询立即返回 `404`，且旧 `X-Idempotency-Key` 重放立即返回 `409`。
4. **`[P1-B]` 限流故障注入（Fail-Closed）与跨实例限流一致性 (`PASS`)**：
   - 注入 `TIMEOUT`、`PERMISSION_DENIED`、`NETWORK_UNAVAILABLE`、`TRANSACTION_CONFLICT` 四类限流故障时，`POST /api/orders` 均严格返回 `503 Service Unavailable`（`code: 'RATE_LIMIT_BACKEND_UNAVAILABLE'`，`retryable: true`），绝不静默降级为单机内存限流。
   - 实例 1 与实例 2 共享权威限流存储，清空进程内 L1 缓存后跨实例累计达到阈值时准确返回 `429 Too Many Requests` 及 `Retry-After` 响应头。
5. **`[P1-C]` 公开健康检查缩减、管理员诊断鉴权与错误脱敏 (`PASS`)**：
   - `GET /api/health` 仅返回 `{ status: 'ok', service: 'geospatial-studio', serverTime }`，不含 `projectId`、`firestoreDatabaseId`、`repositoryDriver`、`diagnostics`。
   - `GET /api/admin/diagnostics` 未登录返回 `401`，非管理员返回 `403`，白名单管理员返回 `200` 且不含服务账号邮箱明文。
6. **`[P3]` 隔离环境 15 步完整接单生命周期验收 (`PASS`)**：
   - 覆盖匿名客户建单 -> 凭证查询 -> 非授权拒访 -> 进程重启 -> 管理员验签读单 -> 状态流转与人工报价 -> 客户查得最新报价与状态 -> 管理员重置查询凭证 -> CSV 公式转义导出 -> 数据库断开返回 `503`。

---

## 三、因环境限制标记为 BLOCKED 的项目（不伪造 PASS）

1. **Firestore Emulator 动态客户端安全规则测试 (`npm run test:rules` Subtest 2) — `BLOCKED`**：
   - **原因**：当前 AI Studio 容器未运行本地 Java Firestore Emulator 实例（`FIRESTORE_EMULATOR_HOST` 未设置，且容器内 8080 端口为内部代理而非 Firestore Emulator）。
   - **保护行为**：测试脚本严格遵守 P0-B.5，检测到 Emulator 未运行时显式输出 `BLOCKED` 诊断信息并安全退出，**绝不连接正式生产数据库 `gen-lang-client-0041017161` 执行破坏性写入测试**。
2. **AI Studio 预览沙箱直接读写正式 Cloud Firestore (`FirestoreAdminOrderRepository`) — `BLOCKED (Sandbox Cross-Project ADC Limitation)`**：
   - **原因**：AI Studio 预览容器的默认 ADC 服务账号属于宿主沙箱项目（`ais-sandbox@...`），对用户的目标 Firebase 项目 `gen-lang-client-0041017161` 数据库 `ai-studio-cb63a7bd-f74c-4c79-9ba8-1cb9e33b42e9` 无跨项目 IAM 写权限，访问时返回 `503 FIRESTORE_IAM_PERMISSION_DENIED`（符合预期 Fail-Closed 保护，不产生假成功）。
   - **解锁方式**：将应用部署至同一 GCP 项目 `gen-lang-client-0041017161` 的 Cloud Run，并为 Cloud Run 运行服务账号绑定 `roles/datastore.user` 与 `roles/firebaseauth.viewer`。
