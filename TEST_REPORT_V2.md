# GeoSpatial Studio — 第二轮独立安全审计测试报告 (TEST_REPORT_V2)

## 一、构建与静态类型检查结果

| 检查项 | 执行命令 | 退出码 | 结果状态 | 证据摘要 |
| :--- | :--- | :---: | :---: | :--- |
| TypeScript 全量类型检查 | `npm run lint` (`tsc --noEmit`) | `0` | **PASS** | 零类型错误，前后端类型定义完全对齐 |
| 生产环境前端打包构建 | `npm run build` (`vite build`) | `0` | **PASS** | 成功生成 `dist/` 生产静态产物 |
| 自动化单元与对抗集成测试 | `npm test` | `0` | **PASS** | 15 个测试子集全部通过（覆盖下方 16 项对抗矩阵） |
| 历史数据迁移预览检查 | `npm run migrate:check` | `0` | **PASS** | 准确识别 3 条 `DEMO_SEED` 并跳过，0 条真实记录冲突 |

---

## 二、16 项安全与业务对抗测试结果矩阵（Section 9 标准表）

| 编号 | 测试项 | 预期结果 | 实际结果 | 状态 (`PASS` / `FAIL` / `BLOCKED`) | 证据（测试文件 / 命令 / 响应） |
| :---: | :--- | :--- | :--- | :---: | :--- |
| 1 | 未登录访问 `/api/admin/orders` | `401` | `HTTP 401` (`code: "UNAUTHENTICATED"`) | **PASS** | `src/tests/api-and-security.test.ts` (Case 1) & 实测 `curl http://localhost:3000/api/admin/orders` 返回 `401` |
| 2 | 伪造 `x-admin-email: yeston463@gmail.com` 请求头访问管理员接口 | `401` / `403` | `HTTP 401` (`code: "UNAUTHENTICATED"`) | **PASS** | `src/tests/api-and-security.test.ts` (Case 2) & 实测 `curl -H "x-admin-email: yeston463@gmail.com"` 返回 `401` |
| 3 | 伪造 `x-admin-uid: admin-bootstrap-uid` 请求头/参数/请求体或 Token | `401` / `403` | `HTTP 401` | **PASS** | `src/tests/api-and-security.test.ts` (Case 3)：请求头、Query、Body 及含 `admin-bootstrap-uid` 的 Token 全部返回 `401` |
| 4 | 普通已登录 Google 用户（非白名单 UID，即使邮箱相同）访问管理员接口 | `403` | `HTTP 403` (`code: "FORBIDDEN_NOT_ADMIN"`) | **PASS** | `src/tests/api-and-security.test.ts` (Case 4)：有效 Token 但 UID 不在 `ADMIN_UIDS` 中返回 `403` |
| 5 | 合法管理员 Token（UID 在服务端 `ADMIN_UIDS` 白名单内）访问管理员接口 | `200` | `HTTP 200` (`isAdmin: true`) | **PASS** | `src/tests/api-and-security.test.ts` (Case 5) |
| 6 | 匿名用户直读云端 Firestore `/orders` 集合 | 被规则拒绝 | `PERMISSION_DENIED` (`code: 7`) | **PASS** | `src/tests/api-and-security.test.ts` (Case 6)：对真实云端 `ai-studio-cb63a7bd-f74c-4c79-9ba8-1cb9e33b42e9` 发起 `getDocs(collection(db, 'orders'))` 被 `firestore.rules` 实时拒绝 |
| 7 | 匿名用户直写云端 Firestore `/orders` 与 `/admins` 集合 | 被规则拒绝 | `PERMISSION_DENIED` (`code: 7`) | **PASS** | `src/tests/api-and-security.test.ts` (Case 7)：对真实云端发起 `setDoc` 写入 `/orders` 与 `/admins` 均被 `firestore.rules` 实时拒绝 |
| 8 | 合法创建工单并通过 `orderNumber + queryToken` 查询（含管理员重置凭证） | `201` + `200` | 创建返回 `201`（含 `orderNumber` 与 `QK-XXXX-XXXX-XXXX`），查询返回 `200`，旧方式/错凭证返回 `400`/`404` | **PASS** | `src/tests/api-and-security.test.ts` (Case 8)：同时验证管理员调用 `/rotate-token` 后旧凭证立即 `404`、新凭证 `200` |
| 9 | 模拟 Firestore 写入失败及未配置跨项目 IAM 凭据时提交工单 | `500` / `503`，不伪造成功 | `HTTP 503` (`SIMULATED_DB_FAILURE` / `FIRESTORE_IAM_PERMISSION_DENIED`) | **PASS** | `src/tests/api-and-security.test.ts` (Case 9) & 实测 `curl -X POST http://localhost:3000/api/orders` 返回 `503`，零假成功、零残留文件 |
| 10 | 服务重启后订单持久化验证 | 数据仍在 | 实例 A 创建后完全关闭，新启动实例 B 仍可完整查询到该工单 | **PASS** | `src/tests/api-and-security.test.ts` (Case 10) |
| 11 | 多实例读写一致性验证（无 `/api/admin/sync`） | 状态一致 | 实例 B 更新状态为 `pending_payment` 与报价 `680`，实例 C 立即读取完全一致 | **PASS** | `src/tests/api-and-security.test.ts` (Case 11) |
| 12 | 未报价进入 `pending_payment` | `400` | `HTTP 400` | **PASS** | `src/tests/api-and-security.test.ts` (Case 12) & `src/utils/order-utils.test.ts` |
| 13 | 输入 `NaN` / `Infinity` / 负数 / `0` / 超上限 `1500000` / 布尔值报价 | `400` | 全部返回 `HTTP 400` | **PASS** | `src/tests/api-and-security.test.ts` (Case 13) & `src/utils/order-utils.test.ts` |
| 14 | CSV 导出含 `=1+1`、`@SUM`、`+`、`-` 公式注入字段 | 安全转义 | 导出单元格自动前置单引号 `'`（如 `"'=HYPERLINK(...)"`、`"\'+长三角测试区"`） | **PASS** | `src/tests/api-and-security.test.ts` (Case 14) & `src/utils/order-utils.test.ts` |
| 15 | 非管理员尝试获取完整客户联系方式 `contactValue` | 被拒绝 / 仅脱敏 | 管理接口返回 `401/403`；公开查询接口剥离 `contactValue` 与 `adminNotes`，仅返回 `maskedContact` (`p***r@university.edu.cn`) | **PASS** | `src/tests/api-and-security.test.ts` (Case 15) |
| 16 | 批量并发提交 20 笔工单 | 无重复工单号 | 20 笔并发请求全部返回 `201`，生成的 20 个 `GEO-YYYYMMDD-XXXXXX` 工单号 100% 唯一（集合大小 = 20） | **PASS** | `src/tests/api-and-security.test.ts` (Case 16) |

---

## 三、受运行容器环境限制的测试项说明（诚实披露 `BLOCKED` 项）

遵循审计原则第 5、8、9 条（对受环境限制无法在容器内直接完成的操作明确报告原因，绝不伪造完成状态）：

| 专项验证子项 | 状态 | 阻塞原因与技术替代验证情况 |
| :--- | :---: | :--- |
| 本地 JVM Firebase Emulator (`firebase emulators:exec`) 离线规则仿真 | **BLOCKED** | 当前 Linux 容器环境未安装 Java Runtime (`/usr/bin/java` 不存在)，无法在本地拉起基于 JVM 的 Firestore Emulator 进程。**已执行的真实替代验证**：已通过 `DeployRules` 将最新 `/firestore.rules` 部署至真实云端 Firestore (`ai-studio-cb63a7bd-f74c-4c79-9ba8-1cb9e33b42e9`)，并在 `src/tests/api-and-security.test.ts` (Cases 6-7) 中使用真实客户端 SDK 对云端数据库发起匿名读写测试，实测云端返回 `code=7 PERMISSION_DENIED`。 |
| AI Studio 预览容器内免密钥直写目标用户项目 `gen-lang-client-0041017161` 的 Firestore Admin SDK | **BLOCKED (需配置服务账号密钥或跨项目 IAM)** | AI Studio 预览容器的默认 ADC 身份为宿主平台账号 `ais-sandbox@ais-asia-east1-2be79ceeac35465.iam.gserviceaccount.com`，默认不具备用户个人项目 `gen-lang-client-0041017161` 的 `roles/datastore.user` 权限。因此未注入 `FIREBASE_SERVICE_ACCOUNT_JSON` 时，实时请求 `/api/orders` 会按 P0-B.9 设计诚实返回 `HTTP 503 (FIRESTORE_IAM_PERMISSION_DENIED)`。自动化集成测试已通过受控事务测试仓储 (`IsolatedTestOrderRepository`) 完整验证全链路 API 逻辑。 |

---

## 四、真实执行命令与输出摘录

### 1. `npm test` 实测输出
```text
> npx --yes tsx --test src/utils/order-utils.test.ts src/tests/api-and-security.test.ts
TAP version 13
ok 1 - Cases 1-5: P0-A Admin Authentication & Adversarial Bypass Rejection
ok 2 - Cases 6-7: P0-C Live Firestore Security Rules block anonymous client direct read/write on /orders and /admins
ok 3 - Cases 8 & 15: Valid Order Creation, QueryToken Lookup, Contact Masking, and Admin Token Rotation
ok 4 - Case 9: Simulated Database Write Failure & Uncredentialed Firestore Admin Failure -> Explicit HTTP 503 (Zero Silent Fallback)
ok 5 - Cases 10 & 11: Server Restart Persistence & Multi-Instance Consistency without /api/admin/sync
ok 6 - Cases 12, 13, 14, 16: Quote Validation, State Machine, CSV Formula Neutralization, and 20-Order Concurrent Submission
ok 7 - generateOrderNumber and generateQueryToken use CSPRNG with high-entropy formats
ok 8 - maskContactValue masks emails and WeChat IDs to protect customer privacy
ok 9 - toPublicOrderView strips contactValue, adminNotes, and queryTokenHash
ok 10 - validateOrderInput rejects invalid, non-object, or honeypot-triggered inputs
ok 11 - validateOrderInput accepts complete valid input with email or wechat
ok 12 - Order state machine enforces valid transitions and blocks illegal jumps
ok 13 - validateAdminOrderUpdate blocks invalid quotes, NaN, Infinity, >1M, state jumps, and locked quote tampering
ok 14 - sanitizeCSVField and exportOrdersToCSV neutralize formula injection (=, +, -, @, tab, CR)
ok 15 - formatRMB, getStatusStepIndex, filterAndSortOrders, and cleanOrderForFirestore work accurately
1..15
# tests 15
# pass 15
# fail 0
```

### 2. Playwright 真实浏览器端到端检查 (`http://localhost:3000`)
- 访问 `http://localhost:3000/#admin`：确认已彻底移除“以白名单管理员身份进入后台”快捷伪造按钮，仅保留 Google OAuth 安全登录入口。
- 访问 `http://localhost:3000/#lookup`：确认已切换为「工单编号 (Order Number) + 专属查询凭证 (Query Token, QK-XXXX-XXXX-XXXX)」双因子核验表单，并展示凭证遗失人工核实补发说明。
- 浏览器控制台错误检查 (`playwright-cli console error`)：`Total messages: 3 (Errors: 0, Warnings: 0)`。
