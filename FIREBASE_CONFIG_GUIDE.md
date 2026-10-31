# GeoSpatial Studio — Firebase 配置简化与安全指南 (FIREBASE_CONFIG_GUIDE)

本指南说明 GeoSpatial Studio 经过专项简化后的 **单一数据源 Firebase 配置架构**，适用于 **Google AI Studio 预览环境**、**GitHub 全新克隆（CI / 本地开发）** 与 **Google Cloud Run 生产部署**。

---

## 一、最小必需环境变量清单（共 6 项，零重复输入）

本项目仅实际使用 **Firebase Authentication（管理后台 Google 登录）** 与 **Cloud Firestore（服务端 Admin SDK 读写）**，已移除未使用的 Storage、Messaging、Analytics 等冗余配置，且客户端与服务端共享 `VITE_FIREBASE_PROJECT_ID` 与 `VITE_FIREBASE_DATABASE_ID`，无需重复填写：

| 变量名 | 作用域 | 是否必填 | 说明与当前值/获取位置 |
| :--- | :--- | :--- | :--- |
| **`VITE_FIREBASE_PROJECT_ID`** | 客户端 + 服务端共享 | **必填** | Firebase / GCP 项目 ID。当前项目已固定为：`gen-lang-client-0041017161`（服务端 `firebase-admin` 自动复用该值，无需再填 `FIREBASE_PROJECT_ID`） |
| **`VITE_FIREBASE_DATABASE_ID`** | 客户端 + 服务端共享 | **必填** | Firestore 命名数据库 ID。当前数据库已固定为：`ai-studio-cb63a7bd-f74c-4c79-9ba8-1cb9e33b42e9`（服务端自动复用，无需再填 `FIRESTORE_DATABASE_ID`） |
| **`VITE_FIREBASE_API_KEY`** | 客户端公开配置 | **必填** | Firebase Web App 公开 API Key（浏览器构建可见，非服务端密钥）。在 Firebase Console -> Project settings -> General -> Your apps (Web app) 获取 |
| **`VITE_FIREBASE_APP_ID`** | 客户端公开配置 | **必填** | Firebase Web App ID（形如 `1:...:web:...`）。在 Firebase Console -> Project settings -> General -> Your apps (Web app) 获取 |
| **`QUERY_TOKEN_PEPPER`** | **服务端专用 Secret** | **必填** | 用于对客户查询凭证计算 HMAC-SHA256 的服务端高敏密钥（至少 16 字符，推荐 64 位 hex），严禁暴露给前端 |
| **`ADMIN_UIDS`** | **服务端专用授权配置** | **必填** | 逗号分隔的管理员 Firebase Auth UID 白名单（28 位字符，禁止填邮箱）。可在 `/#admin` 登录页或 Firebase Console -> Authentication -> Users 获取 |

> **自动推导与免填项说明**：
> - **`Auth Domain`**：自动根据 `VITE_FIREBASE_PROJECT_ID` 推导为 `${projectId}.firebaseapp.com`（即 `gen-lang-client-0041017161.firebaseapp.com`），除非绑定了自定义认证域名，否则无需填写 `VITE_FIREBASE_AUTH_DOMAIN`。
> - **服务端凭证（ADC）**：Cloud Run 默认使用 Google Cloud Application Default Credentials (`applicationDefault()`)，无需填写 `FIREBASE_SERVICE_ACCOUNT_JSON`。
> - **反向代理（`TRUST_PROXY`）**：Cloud Run 环境检测到 `K_SERVICE` 时自动启用 1 跳可信代理解析，直连环境默认 `0`，无需手动填写。

---

## 二、客户端与服务端两个独立配置模块

1. **客户端配置模块 (`src/config/firebase-client.ts`)**：
   - 仅读取公开 Web App 标识（`VITE_FIREBASE_PROJECT_ID`、`VITE_FIREBASE_API_KEY`、`VITE_FIREBASE_APP_ID` 及自动推导的 `authDomain`）。
   - 明确声明 `VITE_FIREBASE_*` 在前端构建产物（`dist/`）中对浏览器可见，不是不可泄露的密钥；系统安全由 **API Key 域名/API 范围限制 + 服务端 Admin SDK 验签 + `firestore.rules` 零信任规则** 保障。
   - 当公开配置缺失时，`/src/lib/firebase.ts` 不会崩溃，仅在管理员点击 `/#admin` Google 登录按钮时精确提示缺失的变量名，不影响首页、地图、需求提交和工单查询。

2. **服务端配置模块 (`src/config/firebase-server.ts`)**：
   - 统一收口服务端 Project ID、Database ID、Auth Domain、ADC 凭证初始化、`QUERY_TOKEN_PEPPER` 校验、`ADMIN_UIDS` 白名单校验与 `TRUST_PROXY` 解析，消除多文件重复读取 `process.env`。
   - 优先读取环境变量（支持直接复用 `VITE_FIREBASE_PROJECT_ID` 与 `VITE_FIREBASE_DATABASE_ID`）；在 AI Studio 本地存在未跟踪的 `firebase-applet-config.json` 时动态兜底读取，而在 GitHub 全新克隆（无该文件）时完全不依赖该文件即可通过类型检查、测试与构建。
