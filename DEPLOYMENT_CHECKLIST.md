# GeoSpatial Studio — 生产环境部署与配置核对清单 (DEPLOYMENT_CHECKLIST)

## 一、环境变量与 Secret 配置分类表

本项目优先采用 **Google Cloud Application Default Credentials (ADC)**，**不要求也不建议创建和上传高权限 Firebase 服务账号私钥 JSON**。

### 1. 需手动配置的环境变量 / Secret（仅 2 项业务与安全配置）

| 变量名 | 类型 | 格式要求 | 用途与获取方式 |
| :--- | :---: | :--- | :--- |
| `QUERY_TOKEN_PEPPER` | **必填 Secret** | 长度至少 16 字符（推荐 64 位十六进制字符串 / 32 字节随机值） | 用于对客户工单查询凭证计算 `HMAC-SHA256` 哈希（`queryTokenHash`）。已彻底移除代码中的默认硬编码值，未配置时接口会明确返回 `503 CONFIG_MISSING_QUERY_TOKEN_PEPPER`。<br>**生成方式**（在本地终端执行）：<br>`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `ADMIN_UIDS` | **必填配置** | 逗号分隔的 28 位 Firebase Auth `UID` 字符串（**严禁填写邮箱或邮箱前缀**） | 用于服务端校验管理员权限。<br>**获取方式**：打开网站 `/#admin` 页面，点击「使用 Google 账号安全登录」完成登录；当尚未配置白名单时，页面红框下方会直接回显 `您的真实 UID: <28位UID>` 并支持一键复制，将其填入 `ADMIN_UIDS` 即可。 |

### 2. 自动托管或按拓扑可选的变量（无需在 AI Studio Secrets 手动填写）

| 变量名 | 默认行为 | 说明 |
| :--- | :--- | :--- |
| **Google Cloud ADC (默认凭证)** | **自动启用 (`applicationDefault()`)** | 在同项目 (`gen-lang-client-0041017161`) 的 Cloud Run 中自动通过元数据服务器获取短期令牌，**无需配置 `FIREBASE_SERVICE_ACCOUNT_JSON`**。 |
| `TRUST_PROXY` | **按环境自动识别** | 当检测到 Cloud Run 环境（`K_SERVICE` 存在）时自动设为 `1` 跳（从 `X-Forwarded-For` 最右侧读取 GFE 附加的真实客户端 IP，忽略左侧客户端伪造值）；在本地或直连环境默认设为 `0`（完全忽略 `X-Forwarded-For`）。已从 `.env.example` 必填项中移除。 |
| `GEMINI_API_KEY` / `APP_URL` | **平台自动注入** | 由 Google AI Studio / Cloud Run 运行时自动注入。 |

---

## 二、Cloud Run 部署时的 ADC 最小 IAM 权限要求

当将本项目部署至目标 GCP 项目 `gen-lang-client-0041017161` 的 Cloud Run 时，`firebase-admin` 通过 `applicationDefault()` 自动完成鉴权。请确保 Cloud Run 服务关联的运行服务账号（Runtime Service Account）仅授予以下 **最小 IAM 角色（Least Privilege）**：

1. **`roles/datastore.user`（Cloud Datastore User）**：
   - 允许服务端对 Firestore 数据库 `ai-studio-cb63a7bd-f74c-4c79-9ba8-1cb9e33b42e9` 执行工单文档读写与原子事务（`runTransaction`）。
2. **`roles/firebaseauth.viewer`（Firebase Authentication Viewer）**：
   - 允许服务端验证管理员 Firebase ID Token 与读取必要的认证元数据（无需授予 `roles/owner` 或 `roles/editor` 等高危宽泛权限）。

### Firestore TTL 清理（控制存储成本）

服务端会在 `/rateLimits/{key}`、`/idempotencyKeys/{key}` 与 `/tokenRotations/{key}` 写入 `ttlAt`（Firestore Timestamp）字段。请在 Firestore 控制台为这三个集合启用 TTL 策略，字段选择 `ttlAt`，使过期限流/幂等/凭证轮换记录自动删除，避免公开接口被随机 key 长期占用存储。限流与幂等业务逻辑仍读取数值型 `expiresAt`，TTL 只负责清理。

`/tokenRotations` 的 TTL 为 30 天（`ROTATION_RECORD_TTL_MS`）。为防止记录随 TTL 清除且旧哈希挤出历史窗口后重试旧键导致旧凭证复活，工单自身持久化保存 `consumedRotationKeys`（已消费键 ID 到版本的映射，永不随 TTL 删除），且凭证派生绑定所属轮换版本。即使 `/tokenRotations` 记录被 TTL 删除，重试已消费旧键仍会被直接判定为 `409 ROTATION_SUPERSEDED`，最新凭证与工单状态保持完好。

---

## 三、Firebase 初始化与配置一致性核查结果

服务端启动时不会暴露配置细节；使用管理员 Firebase ID Token 访问 `GET /api/admin/diagnostics` 时才会执行 `verifyFirebaseConfigConsistency()` 并返回诊断，确保以下项目严格一致：
- **Client SDK `projectId`**：`gen-lang-client-0041017161`
- **Admin SDK `projectId`**：`gen-lang-client-0041017161`
- **Auth Domain 所属项目**：`gen-lang-client-0041017161`（`gen-lang-client-0041017161.firebaseapp.com`；自定义 Auth 域名也被视为合法）
- **Firestore 命名数据库 ID**：`ai-studio-cb63a7bd-f74c-4c79-9ba8-1cb9e33b42e9`

> 生产环境必须显式配置 `FIRESTORE_DATABASE_ID`（或 `VITE_FIREBASE_DATABASE_ID`）；若确实使用默认库请填写 `(default)`，否则服务端会拒绝启动 API 数据库操作并返回 `503 CONFIG_MISSING_FIRESTORE_DATABASE_ID`，避免静默写入错误的数据库。
