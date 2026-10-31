# GeoSpatial Studio — 剩余风险与开发预览环境限制披露 (REMAINING_RISKS)

## 1. AI Studio 开发预览容器的跨项目 ADC 限制与安全方案（Requirement 4）

### 具体技术限制原因
- 在 Google AI Studio 的在线开发预览容器中，容器底层挂载的 Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS=/var/run/secrets/ais-shim/adc.json`) 属于 AI Studio 平台宿主沙箱项目的服务账号：
  `ais-sandbox@ais-asia-east1-2be79ceeac35465.iam.gserviceaccount.com`
- 而您的 Firestore 数据库（`ai-studio-cb63a7bd-f74c-4c79-9ba8-1cb9e33b42e9`）创建在您的个人 GCP 项目 `gen-lang-client-0041017161` 下。
- 由于跨 GCP 项目默认隔离：
  1. **`firebase-admin/auth` (`verifyIdToken`) 在预览容器中可正常运作**：因为 ID Token 验签使用的是 Google 公开 OIDC 证书与 `projectId: "gen-lang-client-0041017161"` 声明校验。
  2. **`firebase-admin/firestore` 在预览容器中直连跨项目数据库会收到 `7 PERMISSION_DENIED`**：因为宿主沙箱账号 `ais-sandbox@...` 默认没有您个人项目 `gen-lang-client-0041017161` 的 `roles/datastore.user` 权限。此时服务端会诚实返回 `HTTP 503 (FIRESTORE_IAM_PERMISSION_DENIED)`，绝不静默伪造下单成功。

### 安全的开发与部署凭证方案（无需上传私钥 JSON）
1. **方案 A（推荐：Cloud Run 同项目原生 ADC）**：
   - 将应用直接部署至 `gen-lang-client-0041017161` 项目下的 Cloud Run。同项目下的 Cloud Run 服务账号通过内置元数据服务器原生支持 ADC，无需导出或上传任何私钥文件。
2. **方案 B（AI Studio 在线预览环境免密钥跨项目授权）**：
   - 若希望在 AI Studio 在线预览窗口中直接由后端通过 ADC 读写 `gen-lang-client-0041017161` 的 Firestore，无需创建私钥 JSON，只需在 Google Cloud Console (`gen-lang-client-0041017161` -> IAM) 中为预览容器身份 `ais-sandbox@ais-asia-east1-2be79ceeac35465.iam.gserviceaccount.com` 授予最小角色 `roles/datastore.user`（预览测试结束后可随时移除该 IAM 绑定）。
3. **方案 C（本地工作站开发 `gcloud auth application-default login`）**：
   - 在开发者本地电脑运行 `npm run dev` 时，执行 `gcloud auth application-default login` 登录拥有该项目权限的个人 Google 账号，即可在本地通过 ADC 安全连接云端 Firestore，全程无需生成服务账号私钥文件。

---

## 2. 当前环境中 `ADMIN_UIDS` 的配置提醒
- 经实时诊断（`GET /api/health`），当前容器环境变量中的 `ADMIN_UIDS` 值为 `"yeston463"`（长度为 9 字符，系邮箱前缀，而非 Firebase Authentication 生成的 28 位真实 `UID`）。
- 服务端已拒绝将邮箱或邮箱前缀作为授权依据，并在 `/api/health` 的 `diagnostics.adminAuth.warnings` 中给出了明确诊断提示。请在 `/#admin` 页面使用 Google 账号登录一次，复制界面回显的 28 位真实 Firebase UID 并更新至 `ADMIN_UIDS`。
