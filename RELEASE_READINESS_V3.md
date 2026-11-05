# GeoSpatial Studio — 第三轮上线前准入评估报告 (RELEASE_READINESS_V3)

## 一、最终准入判定

> **当前准入状态：`READY FOR STAGING`（2026-11-02 本地 P0/P1 修复验证通过：npm ci、lint、34 项测试、check:secrets、build 均通过；推送后需 GitHub CI 绿灯，Firestore 规则动态测试需要 Emulator）**

### 判定依据对照
- 为什么不是 `NOT READY`？
  - P0-A（干净克隆缺少 `firebase-applet-config.json` 导致构建失败）、P0-B（测试污染生产 Firestore）、P1-A（重复提交丢失查询凭证）、P1-B（限流失败静默退回单机内存）、P1-C（公开 `/api/health` 泄露内部配置）、P1-D（`Math.random()` 回退与取模偏差）、P2（缺少 CI 与密钥扫描）均已全部在代码中实质修复，并通过 `npm ci`、`check:secrets`、`lint`、`test`、`build` 验证；`test:rules` 在本地无 Emulator 时明确标记 skipped，CI 通过 `firebase emulators:exec` 强制执行。
- 为什么当前是 `READY FOR STAGING` 而非直接宣称生产环境已全量就绪？
  - 在 AI Studio 预览沙箱中，容器宿主 ADC 服务账号（`ais-sandbox@...`）因跨项目隔离限制无法直接读写用户项目 `gen-lang-client-0041017161` 的正式 Firestore 数据库（系统已按设计安全返回 `503`，不伪造成功）；同时真实 Google 登录与正式 Cloud Run 实例下的全链路验收需在用户部署至 Cloud Run Staging/生产环境并完成环境变量配置后进行最终人工确认。

---

## 二、仍需用户手动完成的配置清单（不输出任何真实密钥）

在将仓库推送到 GitHub 并部署至 Google Cloud Run（项目 `gen-lang-client-0041017161`）时，请按顺序完成以下 4 项配置：

### 1. 在 Google Cloud Console 轮换并限制 Firebase Web API Key
1. 打开 [Google Cloud Console — API 凭据页面](https://console.cloud.google.com/apis/credentials?project=gen-lang-client-0041017161)。
2. 对旧曾暴露在历史 Commit 中的 Browser API Key 执行 **“重新生成密钥 (Regenerate key)”**。
3. 配置 **网站限制 (HTTP referrers)**：仅允许您的 Cloud Run 域名（`https://*.run.app/*`）、自定义域名及必要的本地调试域名。
4. 配置 **API 限制 (API restrictions)**：仅勾选 `Identity Toolkit API` 与 `Token Service API`。

### 2. 配置 Cloud Run 运行服务账号最小 IAM 权限（启用无私钥 ADC）
在 [Google Cloud IAM 页面](https://console.cloud.google.com/iam-admin/iam?project=gen-lang-client-0041017161) 确保 Cloud Run 服务所使用的运行时服务账号具备以下两个最小角色（无需生成或上传 JSON 私钥文件）：
- `roles/datastore.user`（读写 Firestore 数据库 `ai-studio-cb63a7bd-f74c-4c79-9ba8-1cb9e33b42e9`）
- `roles/firebaseauth.viewer`（验证管理员 Google 登录 ID Token）

### 3. 配置环境变量与服务端 Secret
在 Cloud Run（或 AI Studio Secrets 面板）中配置以下变量：

```bash
# 1. 前端构建/运行公开 Firebase 项目标识（用于 /#admin Google 登录）
VITE_FIREBASE_API_KEY="<您在步骤 1 重新生成并限制后的 AIza... Web API Key>"
VITE_FIREBASE_PROJECT_ID="gen-lang-client-0041017161"
VITE_FIREBASE_AUTH_DOMAIN="gen-lang-client-0041017161.firebaseapp.com"
VITE_FIREBASE_APP_ID="1:124300086595:web:983b89a94a048ee267b3f6"
VITE_FIREBASE_DATABASE_ID="ai-studio-cb63a7bd-f74c-4c79-9ba8-1cb9e33b42e9"

# 2. 服务端 Firebase 与 Firestore 权威库标识
FIREBASE_PROJECT_ID="gen-lang-client-0041017161"
FIRESTORE_DATABASE_ID="ai-studio-cb63a7bd-f74c-4c79-9ba8-1cb9e33b42e9"

# 3. 服务端高敏 Secret：客户查询凭证 HMAC-SHA256 Pepper（请用下方命令生成 64 位随机 hex）
# 生成命令：node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
QUERY_TOKEN_PEPPER="<您的 64 位随机十六进制字符串>"

# 4. 服务端管理员 Firebase Auth UID 白名单（28 位 UID，非邮箱）
# 获取方式：访问 /#admin 点击 Google 登录，复制 403 提示框显示的已验签 UID
ADMIN_UIDS="<您的 28 位 Firebase Auth UID>"
```

### 4. Staging 验收步骤（晋升至 `READY FOR HUMAN REVIEW` / 正式运营）
完成上述配置并部署 Cloud Run 后，按顺序验证：
1. 访问 `GET /api/health`，确认返回 `{"status":"ok","service":"geospatial-studio","serverTime":"..."}` 且无敏感字段泄露。
2. 在 `/#inquiry` 提交一笔测试工单，确认返回 `201 Created`、工单号 `GEO-...` 与一次性查询凭证 `QK-...`。
3. 在 `/#lookup` 输入工单号与查询凭证，确认返回脱敏联系方式与待确认状态。
4. 在 `/#admin` 使用白名单 Google 账号登录，核验 `/api/admin/diagnostics` 状态、录入人工报价并流转状态，确认客户侧实时可见更新后的报价与进度。
