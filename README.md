# GeoSpatial Studio — 专业地理空间技术服务在线接单平台

GeoSpatial Studio 是一个面向科研团队、规划设计院与政企客户的中文 GIS 技术服务在线委托与工单管理平台，涵盖 **QGIS/ArcGIS 专题地图制作、GIS 空间数据处理与自动化、Python/PyQGIS/GDAL 脚本开发、WebGIS 可视化开发、遥感影像与植被变化分析** 五大核心业务（所有标价均为参考起价，最终由工程师人工评估确认报价后才进入待付款阶段，绝不自动扣款）。

---

## 一、核心架构与第三轮安全加固特性 (V3)

1. **干净克隆可复现构建 (P0-A)**：
   - 客户端配置模块 `src/config/firebase-client.ts` 与服务端配置模块 `src/config/firebase-server.ts` 彻底解耦了对未跟踪文件 `firebase-applet-config.json` 的静态依赖。
   - 从 GitHub 全新克隆仓库后，无需任何私有本地文件即可通过 `npm ci`、`npm run check:secrets`、`npm run lint`、`npm test` 与 `npm run build`；`npm run test:rules` 在未启动 Firestore Emulator 时会明确标记为 skipped，CI 中则启动 Emulator 强制执行。
2. **真实管理员鉴权 (Firebase Admin SDK + Bearer JWT)**：
   - 管理后台 `/#admin` 强制要求真实 Google 登录并通过 `Authorization: Bearer <ID_TOKEN>` 发送至后端。
   - 服务端 `requireAdminAuth` 使用 `firebase-admin/auth` 验证 JWT 签名，并核对服务端环境变量 `ADMIN_UIDS` 白名单或 `admin === true` Custom Claim，彻底忽略任何客户端传入的 Header/Query/Body 身份字段。
3. **高熵查询凭证与会话幂等恢复 (P1-A)**：
   - 工单号（`GEO-YYYYMMDD-XXXXXX`）与专属查询凭证（`QK-XXXX-XXXX-XXXX`）在创建时生成；无幂等键的请求使用 60-bit CSPRNG 拒绝采样生成凭证，浏览器会话请求则由服务端以 `HMAC-SHA256(pepper, orderNumber | idempotencyKey | contactValue)` 派生同一凭证。数据库仅存储 `HMAC-SHA256(pepper, orderNumber:queryToken)` 哈希（`queryTokenHash`），绝不存储明文凭证；凭证在管理员重置前有效，并非只能用一次。
   - 客户端提交时生成会话级 128-bit 幂等键（`X-Idempotency-Key`）。若首次提交因网络中断未收到响应，客户在同一会话内重试时服务端可安全校验并恢复原有效查询凭证（返回 `HTTP 200 OK`，`IDEMPOTENT_REPLAY`），前端明确区分“新订单创建成功”与“重复提交已识别”。
   - 若客户关闭标签页重开后在短期内重复提交相同内容（无原会话密钥），服务端返回 `HTTP 409 Conflict`（绝不返回 201 或假查询凭证），并提供联系工程师人工核验重置凭证（`POST /api/admin/orders/:id/rotate-token`）或确认强制新建独立工单（`forceNewOrder`）的清晰流程。
4. **限流故障关闭 (Fail-Closed, P1-B) 与零信任安全规则 (P0-B)**：
   - 服务端限流采用进程内 L1 仅拒绝预检（防钱包耗尽攻击）+ Firestore 权威固定窗口事务计数；当限流后端发生超时、权限不足或网络故障时，公开建单与查询接口严格执行失败关闭（返回 `HTTP 503 RATE_LIMIT_BACKEND_UNAVAILABLE`），绝不静默降级为单机内存限流。
   - `firestore.rules` 对 `/orders`、`/rateLimits`、`/idempotencyKeys` 实施 `allow read, write: if false;`，所有读写均通过服务端 Admin SDK 受控接口执行。
5. **最小化公开健康检查与错误脱敏 (P1-C)**：
   - 公开 `GET /api/health` 仅返回基本服务状态与时间戳；详细配置一致性诊断收敛至管理员鉴权接口 `GET /api/admin/diagnostics`。

---

## 二、快速开始（从干净 Git 克隆构建与测试）

要求 Node.js `>=22.12.0`。

```bash
# 1. 安装依赖（使用已提交的 package-lock.json）
npm ci

# 2. 运行密钥与未跟踪文件依赖检查
npm run check:secrets

# 3. 运行 TypeScript 严格类型检查
npm run lint

# 4. 运行纯单元测试与隔离 API/安全集成测试（默认 NODE_ENV=test，绝不访问正式 Firestore）
npm test

# 5. 运行 Firestore 安全规则检查（未启动 Emulator 时显示 skipped；CI 中强制执行）
npm run test:rules

# 6. 执行前端生产构建
npm run build
```

---

## 三、环境变量与部署指南

关于 `VITE_FIREBASE_*` 公开客户端配置与服务端 Secret（`QUERY_TOKEN_PEPPER`、`ADMIN_UIDS`）的详细区分、Google Cloud API Key 限制以及 Cloud Run ADC 最小权限配置，请查阅：

- [`FIREBASE_CONFIG_GUIDE.md`](./FIREBASE_CONFIG_GUIDE.md)
- [`AUDIT_V3.md`](./AUDIT_V3.md)
- [`TEST_REPORT_V3.md`](./TEST_REPORT_V3.md)
- [`RELEASE_READINESS_V3.md`](./RELEASE_READINESS_V3.md)

可选：配置 `ORDER_NOTIFICATION_WEBHOOK_URL` 后，新工单创建会向该 HTTP 端点发送一条仅含工单号、服务类型、标题、预算和脱敏联系方式的 JSON 通知（最多等待 3 秒，失败只记录日志，不影响建单）；适用于 Slack/飞书/企业微信机器人或自建通知服务。
