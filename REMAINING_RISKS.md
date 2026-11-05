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

## 2. `ADMIN_UIDS` 配置提醒
- `ADMIN_UIDS` 必须是 Firebase Authentication 生成的真实 UID（通常 28 位），不能填写邮箱或邮箱前缀。服务端不会内置任何硬编码管理员 UID。
- 若填写了邮箱前缀或过短的条目，这些条目会被拒绝，并可在管理员鉴权接口 `GET /api/admin/diagnostics` 的 `diagnostics.adminAuth.warnings` 中看到提示；未配置时 `configuredCount` 为 `0`。请使用 `/#admin` 页面 Google 登录后回显的真实 UID 更新配置。

---

## 3. 凭证轮换幂等（版本绑定轮换记录）的剩余限制
- **测试驱动的是隔离仓储实现**：`[Rotation]` 回归测试通过 `IsolatedTestOrderRepository.rotateQueryTokenAtomic` 执行，其并发保护来自单进程互斥锁 + 同步事务体，**不能等价证明 Firestore 的乐观并发行为**。`FirestoreAdminOrderRepository.rotateQueryTokenAtomic` 依赖 `runTransaction` 对“事务内已读文档被他人改写”的冲突检测（ABORT 后自动重试）来获得同样的性质；该代码路径已通过类型检查、构建与逐行审查，但本地缺少可用的 Java/Firestore Emulator，未做真实事务并发执行验证（CI 亦仅覆盖安全规则，不覆盖该事务逻辑）。
- **轮换记录 30 天 TTL 与工单持久化已消费键**：`/tokenRotations` 集合配置 30 天 TTL 清理以降低存储成本。为防止 TTL 清除且旧哈希挤出 12 条历史后重试旧键复活旧凭证，工单文档自身在事务内同时持久化维护 `consumedRotationKeys: Record<string, number>`（无 TTL），且凭证派生协议引入轮换版本后缀（`v${rotationVersion}`）。即使 `/tokenRotations` 记录已随 TTL 消失，服务端仍能通过工单自身记录辨识出已被取代的旧键并返回 `409 ROTATION_SUPERSEDED`，既不改写当前版本也不签发任何凭证。
- **历史工单没有 `rotationVersion`**：迁移或旧版本创建的工单缺少轮换版本与历史字段，服务端按版本 `0` 处理，仅在其当前哈希匹配时允许重放；首次轮换后即写入完整字段。
- **轮换密钥（pepper）变更后旧记录不可重放**：`QUERY_TOKEN_PEPPER` 一旦轮换，`/tokenRotations` 中记录的哈希与新的派生结果不一致，服务端返回 `503 ROTATION_RECORD_MISMATCH` 且不交付任何凭证（失败关闭）。同时所有既有查询凭证都会失效，必须通知客户由管理员重新签发。
- **轮换记录文档 ID 为 `sha256(orderNumber|rotationKey)` 前 40 位**：仅用于寻址，原始幂等键不落库；该集合已在 `firestore.rules` 中 `allow read, write: if false`，客户端不可读写，服务端身份需 `roles/datastore.user`。
