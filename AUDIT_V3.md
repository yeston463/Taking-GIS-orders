# GeoSpatial Studio — 第三轮代码审计与构建修复报告 (AUDIT_V3)

- **目标仓库**: `https://github.com/yeston463/Taking-GIS-orders`
- **审查参考版本**: `2b6f20b4e4d05ab9146958af05fa66b6a8b8e994`
- **当前 AI Studio 容器 Git 状态**: 容器工作区 `/app/applet` 不包含 `.git` 目录（`git rev-parse HEAD` 返回 `fatal: not a git repository`），本轮直接针对工作区对应参考版本 `2b6f20b4e4d05ab9146958af05fa66b6a8b8e994` 的完整源码进行核实、修复与干净工作树（Clean Clone）复现验证。

---

## 一、问题复核矩阵 (CONFIRMED / FIXED / NOT REPRODUCED)

| 编号 | 审计项 | 复核结论 | 修复后状态 | 具体代码证据与修复位置 |
| :--- | :--- | :--- | :--- | :--- |
| **P0-A** | 全新克隆后缺少被 `.gitignore` 忽略的 `firebase-applet-config.json` 导致构建与测试失败 | **CONFIRMED** | **FIXED** | 原 `src/lib/firebase.ts`、`src/server/api.ts`、`src/server/order-service.ts`、`src/tests/api-and-security.test.ts` 均存在静态 `import ... from '../../firebase-applet-config.json'`。现已拆分为 `src/config/firebase-client.ts` 与 `src/config/firebase-server.ts`，彻底移除对未跟踪 JSON 的静态导入，并通过无 `firebase-applet-config.json` 的干净目录复现验证（Exit Code `0`）。 |
| **P0-B** | 自动化测试未与正式 Firestore 隔离（`src/tests/api-and-security.test.ts` 直接用客户端 SDK 访问真实项目 `/orders` 与 `/admins`） | **CONFIRMED** | **FIXED** | 已从默认 `npm test`（`src/tests/api-and-security.test.ts`）中彻底移除连接正式项目的客户端 SDK 测试，并强制注入 `FIREBASE_PROJECT_ID=demo-geospatial-studio-test` 保护断言。独立新增 `src/tests/firestore-rules.emulator.test.ts`（`npm run test:rules`），当 `FIRESTORE_EMULATOR_HOST` 未运行时显式标记 `BLOCKED`，绝不回退连接生产项目 `gen-lang-client-0041017161`。 |
| **P1-A** | 重复提交时返回 HTTP 201 及假查询凭证提示文字（`“重复提交请求已拦截，请使用首次返回的查询凭证”`），导致网络中断重试时客户丢失凭证 | **CONFIRMED** | **FIXED** | 重构 `src/server/order-service.ts`、`src/server/api.ts` 与 `src/pages/InquiryPage.tsx`：<br>1. 数据库绝不保存明文 `queryToken`（仅存 `queryTokenHash`）。<br>2. 客户端每次提交会话生成 128-bit CSPRNG 幂等键（`X-Idempotency-Key`），服务端基于 `HMAC-SHA256(pepper, orderNumber \| idempotencyKey \| contactValue)` 派生会话初始口令并与 `queryTokenHash` 比对；同一会话网络中断重试返回 `HTTP 200 OK`（`submissionStatus: 'IDEMPOTENT_REPLAY'`）并安全恢复真实有效的 `QK-...` 凭证。<br>3. 若无原会话密钥（如关闭标签页重开后 60 秒内提交相同内容）或管理员已重置凭证，无法安全恢复原凭证时返回 `HTTP 409 Conflict`（`queryToken: null`），绝不返回 201 或假字符串，并提供人工核验重发指引及“确认创建新工单（`forceNewOrder`）”入口。<br>4. 幂等键计算绑定 `contactMethod + contactValue + contentDigest`，不同客户提交相同描述绝不合并工单。 |
| **P1-B** | `FirestoreAdminOrderRepository.checkRateLimit()` 在 Firestore 抛错时直接静默回退到本地内存限流 `checkLocalFallbackRateLimit` | **CONFIRMED** | **FIXED** | 重构 `src/server/order-service.ts` 与 `src/server/api.ts`：<br>1. 删除静默内存回退 `checkLocalFallbackRateLimit`。<br>2. 对 Firestore 事务冲突（`ABORTED` code 10）自动指数退避重试最多 3 次；对超时（`TIMEOUT`）、权限不足（`PERMISSION_DENIED`）、网络不可达（`NETWORK_UNAVAILABLE`）显式分类并抛出 `RateLimitServiceUnavailableError`（`HTTP 503 Service Unavailable`，`code: 'RATE_LIMIT_BACKEND_UNAVAILABLE'`，`retryable: true`），执行失败关闭（Fail-Closed）。<br>3. 引入轻量进程内 L1 仅拒绝预检（Reject-Only Pre-check）拦截单实例明显洪泛以节约 Firestore 读写成本，但任何放行必须经权威存储事务确认，绝不以单机内存冒充跨实例限流。 |
| **P1-C** | 公开 `GET /api/health` 暴露 Firebase 项目 ID、数据库 ID、仓储驱动、代理配置、服务账号邮箱及管理员配置诊断 | **CONFIRMED** | **FIXED** | 重构 `src/server/api.ts` 与 `src/server/order-service.ts`：<br>1. 公开 `GET /api/health` 仅返回 `{ status: 'ok', service: 'geospatial-studio', serverTime }`。<br>2. 详细诊断迁移至受 `requireAdminAuth` 保护的 `GET /api/admin/diagnostics`，且剔除服务账号邮箱与白名单明文。<br>3. 公开 API 错误响应（含 503 数据库错误）仅返回安全提示与追踪号 `requestId`（`X-Request-Id`），绝不向普通访客暴露服务账号邮箱、项目 ID、数据库 ID 或内部集合名。 |
| **P1-D** | `src/utils/order-utils.ts` 在 Web Crypto 不可用时回退到 `Math.random()`，且 `arr[0] % max` 未做拒绝采样；`api.ts` 演示种子使用了 `Math.random()` | **CONFIRMED** | **FIXED** | 重构 `src/utils/order-utils.ts`：<br>1. 彻底移除 `Math.random()` 回退；当 CSPRNG 不可用时显式抛出 `CryptoUnavailableError`（`CSPRNG_UNAVAILABLE`）。<br>2. 实现基于拒绝采样（`rejectionLimit = 256 - (256 % max)`）的 `getSecureRandomIndex`，消除取模偏差。<br>3. `src/server/api.ts` 中的演示工单幂等键改用 `generateClientIdempotencyKey()`。 |
| **P2** | 仓库缺少 GitHub Actions CI 工作流及干净克隆可复现验证 | **CONFIRMED** | **FIXED** | 新增 `.github/workflows/ci.yml` 与 `scripts/check-secrets.ts`（`npm run check:secrets`），覆盖依赖安装、敏感文件与未跟踪配置引用检查、TypeScript 类型检查、单元/集成测试、安全规则检查及生产构建验证。 |

---

## 二、本轮修改与新增文件清单

### 新增文件
1. `src/config/firebase-client.ts` — 浏览器端 Firebase 配置读取与校验模块（支持 `VITE_FIREBASE_*`，兼容 AI Studio 本地可选文件，无静态未跟踪文件依赖）。
2. `src/config/firebase-server.ts` — 服务端 Firebase Admin SDK 与 ADC 初始化及一致性校验模块（支持 `FIREBASE_PROJECT_ID` / `FIRESTORE_DATABASE_ID` 环境变量）。
3. `src/tests/firestore-rules.emulator.test.ts` — 独立 Firestore 安全规则静态策略与 Emulator 隔离测试套件（`npm run test:rules`）。
4. `scripts/check-secrets.ts` — 源码密钥泄露、构建产物服务端密钥泄露及未跟踪配置静态引用扫描脚本（`npm run check:secrets`）。
5. `.github/workflows/ci.yml` — GitHub Actions 最小 CI 工作流（无需生产数据库写权限）。
6. `firebase.json` — Firestore 规则与本地 Emulator（`127.0.0.1:8080`）配置文件。
7. `.env.test.example` — 隔离测试环境配置模板。
8. `AUDIT_V3.md`、`FIREBASE_CONFIG_GUIDE.md`、`TEST_REPORT_V3.md`、`RELEASE_READINESS_V3.md` — 第三轮审计与上线前验收交付文档。

### 修改文件
1. `src/lib/firebase.ts` — 改为使用 `src/config/firebase-client.ts`，移除对 `../../firebase-applet-config.json` 的直接导入。
2. `src/utils/order-utils.ts` — 移除 `Math.random()` 回退，实现无偏差拒绝采样 CSPRNG 与 `CryptoUnavailableError`，新增 `generateClientIdempotencyKey()`。
3. `src/utils/order-utils.test.ts` — 补充 P1-D 随机数格式、500 次唯一性、拒绝采样边界及 CSPRNG 不可用显式失败测试。
4. `src/server/order-service.ts` — 接入 `src/config/firebase-server.ts`；实现 P1-A 会话幂等口令派生恢复与 409 冲突处理；实现 P1-B 限流故障分类与 Fail-Closed 503；实现 P1-C 错误脱敏。
5. `src/server/api.ts` — 缩减公开 `GET /api/health`，新增管理员鉴权接口 `GET /api/admin/diagnostics`；实现 `POST /api/orders` 的 201 / 200（幂等重放）/ 409（重复冲突）/ 503（限流或数据库故障关闭）语义及 `requestId` 追踪。
6. `src/pages/InquiryPage.tsx` — 客户端会话级 `X-Idempotency-Key` 管理、新订单创建 vs 重复提交幂等恢复差异化 UI，以及 409 重复冲突人工恢复/强制新建工单交互。
7. `src/tests/api-and-security.test.ts` — 彻底隔离正式 Firestore，覆盖 P0-A、P0-B、P1-A（6 大场景）、P1-B（4 类限流故障注入 + 跨实例限流）、P1-C、P3（15 步全链路）。
8. `vite.config.ts` — 将 `__dirname` 替换为 `import.meta.dirname`，消除 Vite 8 原生配置加载器警告。
9. `package.json` — 新增 `test:rules` 与 `check:secrets` 脚本。
10. `.env.example` 与 `README.md` — 更新公开客户端配置 vs 服务端 Secret 区分说明、API Key 限制清单与测试启动指南。
