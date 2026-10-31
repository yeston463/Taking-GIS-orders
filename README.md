# GeoSpatial Studio — 专业 GIS 技术服务在线接单平台

GeoSpatial Studio 是一个面向真实客户的个人地理空间工程技术服务与在线委托接单系统，使用 **React 19 + TypeScript + Tailwind CSS + Leaflet + Express + Firebase Authentication + Firebase Admin SDK (Firestore)** 构建，支持一键容器化部署至 Google Cloud Run。

---

## 一、核心业务范围与参考起价

1. **QGIS / ArcGIS 专题地图制作** —— **¥49 起**
2. **GIS 空间数据处理与自动化** —— **¥99 起**
3. **Python / PyQGIS / GDAL 脚本开发** —— **¥99 起**
4. **WebGIS 可视化与轻量系统开发** —— **¥99 起**
5. **遥感影像与植被变化分析** —— **¥199 起**

> **业务准则**：所有标价均为单项任务参考起价，不设自动扣款或自动成交承诺；所有委托工单必须经过工程师人工评估并确认报价后，方可进入「待付款」及后续研发阶段。第一版不开放公开网页文件上传，原始空间数据于初审后通过点对点加密渠道交接。

---

## 二、第二轮生产级安全架构（Round 2 Hardened Architecture）

1. **零信任服务端管理员鉴权 (`P0-A`)**
   - 管理员在前端通过 Firebase Google OAuth 登录后获取 `ID Token (JWT)`，通过 `Authorization: Bearer <idToken>` 发送至后端。
   - 后端使用 `firebase-admin/auth` (`verifyIdToken`) 验证签名、有效期、签发者与项目 ID，并严格依据 Token 内的真实 `uid` 校验服务端 `ADMIN_UIDS` 白名单或可信 Custom Claims (`admin === true`)。
   - 彻底剔除对 `x-admin-uid`、`x-admin-email`、Query 参数、Body 字段及任何前端邮箱字符串的信任。

2. **单一权威订单数据库与事务一致性 (`P0-B` & `P0-C`)**
   - 彻底移除服务端内存数组 `ordersStore`、`.data/orders.json` 自动读写、服务端未认证客户端 SDK 以及浏览器端 `/api/admin/sync` 双向同步。
   - 生产环境唯一权威数据源为基于 `firebase-admin/firestore` 的 `FirestoreAdminOrderRepository`，所有工单创建、幂等去重与状态流转均在 Firestore 事务 (`runTransaction`) 中原子完成。
   - 当数据库不可用或 IAM 凭据缺失时，显式返回 `HTTP 503 Service Unavailable`，绝不静默吞掉错误或返回虚假 `201 Created`。
   - `firestore.rules` 已锁定 `/orders`、`/rateLimits`、`/idempotencyKeys` 为 `allow read, write: if false;`，并锁定 `/admins` 为 `allow create, update, delete: if false;`。

3. **高熵查询凭证与客户隐私脱敏 (`P0-D`)**
   - 提交工单时通过 CSPRNG 生成 6 位后缀工单号 (`GEO-YYYYMMDD-XXXXXX`) 与一次性 12 位 Base32 专属查询凭证 (`QK-XXXX-XXXX-XXXX`)。
   - 数据库仅存储加盐 `HMAC-SHA256` 哈希 (`queryTokenHash`)，公开查询采用 `crypto.timingSafeEqual` 恒定时间比对。
   - 公开查询结果 (`PublicOrderView`) 强制脱敏客户联系方式（如 `c***s@163.com`）并严格剥离 `contactValue`、`adminNotes` 与 `queryTokenHash`。
   - 管理后台支持人工核实客户身份后一键「重置并签发新查询凭证」(`POST /api/admin/orders/:id/rotate-token`)。

4. **受控状态机、报价护栏与 CSV 公式注入防护 (`P1`)**
   - 强制执行订单状态机 (`ALLOWED_STATUS_TRANSITIONS`) 与人工报价校验（拦截 `NaN`、`Infinity`、`<= 0`、`> 1,000,000` 及进行中锁定报价篡改）。
   - CSV 导出自动对 `=`、`+`、`-`、`@`、`\t`、`\r` 开头的单元格前置 `'`，防止 Excel / WPS 公式注入攻击。

---

## 三、常用开发与验证命令

```bash
# 1. 启动开发服务器 (端口 3000)
npm run dev

# 2. 运行 TypeScript 静态类型检查
npm run lint

# 3. 运行全量单元测试与 16 项安全对抗集成测试
npm test

# 4. 运行本地历史数据 (.data/orders.json) 迁移预览检查 (Dry-Run)
npm run migrate:check

# 5. 构建生产环境前端静态资源并启动生产服务
npm run build
npm start
```

更多审计、迁移、测试、部署与剩余风险细节请参阅根目录下的专项文档：
- [`SECURITY_AUDIT_V2.md`](./SECURITY_AUDIT_V2.md)
- [`DATABASE_MIGRATION_PLAN.md`](./DATABASE_MIGRATION_PLAN.md)
- [`TEST_REPORT_V2.md`](./TEST_REPORT_V2.md)
- [`DEPLOYMENT_CHECKLIST.md`](./DEPLOYMENT_CHECKLIST.md)
- [`REMAINING_RISKS.md`](./REMAINING_RISKS.md)
