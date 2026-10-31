# GeoSpatial Studio — 数据库收敛与历史数据迁移方案 (DATABASE_MIGRATION_PLAN)

## 一、存储架构收敛说明（消除四重数据源脑裂）

| 原存储介质 / 路径 | 第一轮状态 | 第二轮处置结果 | 说明 |
| :--- | :--- | :--- | :--- |
| 服务端 `firebase-admin/firestore` (`FirestoreAdminOrderRepository`) | 未使用 | **唯一生产权威数据源** | 通过事务 (`runTransaction`) 原子读写 `/orders/{orderNumber}`、`/idempotencyKeys` 与 `/rateLimits` |
| 服务端内存数组 `ordersStore` | 读写主存 | **已彻底删除** | 消除容器重启丢失与多实例不一致 |
| 本地文件 `.data/orders.json` | 自动落盘与启动加载 | **已切断运行时读写** | 保留原文件供迁移工具只读检查，服务端不再自动读取或写入 |
| 服务端客户端 SDK (`firebase/firestore`) | 未认证弱写入 | **已彻底删除** | 消除静默忽略写入失败 (`firestorePersisted: false`) 的假成功漏洞 |
| 浏览器端 `fetchOrdersFromFirestore` + `/api/admin/sync` + `slice(0, 15)` | 管理员打开页面时双向覆盖 | **已彻底删除** | 客户端不再直连 Firestore 读写订单，杜绝前后端互踩与 15 条截断 |

---

## 二、现有 `.data/orders.json` 盘点与冲突检查结果

已通过自动化迁移检查脚本 `scripts/migrate-orders.ts`（命令：`npm run migrate:check`）对工作区 `.data/orders.json` 进行只读扫描：

- **源文件位置**：`/app/applet/.data/orders.json`
- **扫描总记录数**：`3` 条
- **分类结果**：
  1. `GEO-20261029-M4P9` (`id: demo-order-2`, `contactValue: spatial_analyst_wu`, `status: pending_quote`) —— **分类：`DEMO_SEED`（演示种子数据，默认跳过不迁移）**
  2. `GEO-20261029-T8R1` (`id: demo-order-3`, `contactValue: academic_geo@edu.cn`, `status: pending_payment`) —— **分类：`DEMO_SEED`（演示种子数据，默认跳过不迁移）**
  3. `GEO-20261028-H7K2` (`id: demo-order-1`, `contactValue: client_gis@163.com`, `status: in_progress`) —— **分类：`DEMO_SEED`（演示种子数据，默认跳过不迁移）**
- **真实客户工单数量**：`0` 条
- **源文件内重复 `orderNumber` 冲突**：`无`

> **重要合规说明**：遵循审计原则第 7 条与 P0-B.12，本次审计修复**未自动将任何 Demo 种子订单写入生产 Firestore**，也**未删除 `.data/orders.json` 原始文件**。

---

## 三、真实历史订单迁移执行规程（供未来或外部环境存在真实记录时使用）

若在外部运行环境中 `.data/orders.json` 含有非 Demo 的真实客户订单（`classification === 'REAL_CUSTOMER'`），请按以下步骤执行安全迁移：

### 步骤 1：备份原始文件
```bash
cp .data/orders.json .data/orders.backup.$(date +%Y%m%d_%H%M%S).json
```

### 步骤 2：运行 Dry-Run 迁移预览检查
```bash
npm run migrate:check
```
核对输出的表格中每条记录的 `type`（确认 `DEMO_SEED` 被标记为 `SKIP_DEMO`）以及 `action`：
- `READY_TO_MIGRATE`：目标 Firestore 中尚无该 `orderNumber`，可安全导入。
- `CONFLICT_OLDER_OR_EQUAL`：目标 Firestore 中已存在相同或更新的 `updatedAt` 记录，跳过以防覆盖新状态。
- `CONFLICT_NEWER`：本地记录的 `updatedAt` 比云端更新，需人工复核字段差异。

### 步骤 3：历史工单的 `queryTokenHash` 补齐策略
由于旧版工单未生成 `queryTokenHash`（`hasTokenHash: false`），迁移后客户无法使用旧版“邮箱/微信号”直查。标准处置流程为：
1. 管理员登录后台，在工单详情弹窗中点击 **「重置并签发新查询凭证」**（调用 `POST /api/admin/orders/:id/rotate-token`）。
2. 系统通过 CSPRNG 生成新的 `QK-XXXX-XXXX-XXXX` 凭证并将 HMAC-SHA256 哈希写入 Firestore。
3. 管理员将新凭证通过客户预留邮箱或微信点对点告知客户。

---

## 四、回滚方案

1. 迁移脚本采用只读扫描与非破坏性事务写入，原始 `.data/orders.json` 始终完整保留。
2. 如需回滚单笔迁移记录，管理员可依据备份文件中的 `orderNumber` 清单在受控维护窗口中核对时间戳并恢复文档版本。
