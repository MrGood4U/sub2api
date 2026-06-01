---
created: 2026-05-31
tags:
  - architecture
  - gateway
  - routing
---

# 模型选择与转发通路 — 全链路分析

> 相关文档：[[admin-account-pool-guide|管理员账号池配置指南]]

## 概述

用户发起一个 AI 请求，经过以下链路：

```
Admin 创建 Group(platform) → Admin 创建 Account(platform, credentials) → Account 关联到 Group
→ User 获取 API Key(绑定 Group) → User 发起请求 → 中间件认证 → 路由分发
→ 账号选择调度 → 模型验证 → 请求转发 → 计费 → 返回响应
```

---

## 链路各层详解

### Layer 1: 前端 — Group 创建（平台分配）

**文件**: `frontend/src/views/admin/GroupsView.vue`

| 位置 | 说明 |
|------|------|
| Lines 2921-2934 | `platformOptions` 计算属性：**硬编码** 平台列表 |
| Lines 385-394 | 平台选择 Radio Buttons UI |
| Lines 3689-3751 | `handleCreateGroup()` → POST `/api/v1/admin/groups` |

**⚠️ 改动点**：要增加 DeepSeek/Qwen/GLM，需在 `platformOptions` 中添加。要隐藏 Gemini/Claude 也在这里控制。

---

### Layer 2: 前端 — Account 创建（账号配置）

**文件**: `frontend/src/components/account/CreateAccountModal.vue`

| 位置 | 说明 |
|------|------|
| Lines 72-181 | 平台选择 Segmented Control（已改为 DS/Qwen/GLM 主推） |
| Lines 184+ | 根据 `form.platform` 条件展示不同账号类型选项 |
| 表单收集 | 根据 platform + type 收集 credentials（api_key, base_url 等） |
| 提交 | POST `/api/v1/admin/accounts` with `{platform, type, credentials}` |

**⚠️ 改动点**：已完成。

---

### Layer 3: 前端 — 首页模型展示

**文件**: `frontend/src/views/HomeView.vue`

| 位置 | 说明 |
|------|------|
| Lines 295-400 | Provider 卡片：**完全硬编码 HTML**，无动态 API |

**⚠️ 改动点**：已添加 DeepSeek/Qwen/GLM。要隐藏 Claude/Gemini 需直接注释/删除对应 HTML 块。

---

### Layer 4: 后端 — 数据库关系

| 表 | 字段 | 说明 |
|---|------|------|
| `groups` | `platform VARCHAR(50)` | 分组所属平台，默认 "anthropic" |
| `accounts` | `platform VARCHAR(50)` | 账号所属平台 |
| `accounts` | `type VARCHAR(20)` | 账号类型：oauth/apikey/upstream/bedrock/service_account |
| `account_groups` | `(account_id, group_id)` | M2M 关联 + `priority` 字段 |

**关系**：Account ←M2M→ Group（通过 `account_groups` junction 表，带优先级）

---

### Layer 5: 后端 — API Key 认证

**文件**: `backend/internal/server/middleware/api_key_auth.go`

```
1. 从 Header 提取 key：Authorization: Bearer / x-api-key / x-goog-api-key
2. 数据库查询：apiKeyService.GetByKey(key) → 返回 APIKey + 嵌套 Group
3. 存入 Context：ContextKeyAPIKey, ContextKeyUser, ContextKeyGroup
```

**⚠️ 改动点**：无需修改。对新平台透明。

---

### Layer 6: 后端 — 路由分发（平台判断）

**文件**: `backend/internal/server/routes/gateway.go`

```go
// Line 45-50: 根据 group.platform 决定走哪个 Handler
if domain.IsOpenAICompatiblePlatform(getGroupPlatform(c)) {
    h.OpenAIGateway.Messages(c)   // OpenAI/DeepSeek/Qwen/GLM
} else {
    h.Gateway.Messages(c)         // Anthropic/Gemini
}
```

**⚠️ 改动点**：已完成。`IsOpenAICompatiblePlatform()` 包含了 deepseek/qwen/glm。

---

### Layer 7: 后端 — 账号选择调度

**文件**: `backend/internal/service/gateway_service.go`

```
SelectAccountForModel(groupID, model)
  → resolveGatewayGroup(groupID) → 获取 Group.Platform
  → listSchedulableAccounts(groupID, platform) → 按 platform 过滤
  → 检查 model_routing（如果启用）
  → 检查 session 粘性
  → 获取并发锁
  → 返回选中的 Account
```

**关键**：过滤条件是 `account.platform == group.platform`。新平台只要 group 和 account 平台一致即可。

**⚠️ 改动点**：无需额外修改。新平台自动走 OpenAI 兼容路径。

---

### Layer 8: 后端 — 模型验证

**文件**: `backend/internal/service/gateway_service.go` (Lines 6498-6507)

- Account 可配置 `allowed_models`（白名单）
- Group 可配置 `model_routing`（模型→账号映射）
- 匹配方式：精确匹配 + 通配符后缀 `*`

**⚠️ 改动点**：无需修改。国产模型走 OpenAI 兼容路径，模型验证逻辑通用。

---

### Layer 9: 后端 — 请求转发

**文件**: `backend/internal/service/account.go` → `GetOpenAIBaseURL()`

```go
// 根据 platform 决定默认 Base URL
case PlatformDeepSeek: return "https://api.deepseek.com"
case PlatformQwen:     return "https://dashscope.aliyuncs.com/compatible-mode"
case PlatformGLM:      return "https://open.bigmodel.cn/api/paas"
default:               return "https://api.openai.com"
```

转发时：`POST {baseURL}/v1/chat/completions`，使用 Account 的 `api_key` 作为 Bearer Token。

**⚠️ 改动点**：已完成。

---

## 要隐藏 Claude/Gemini 需改动的文件清单

| # | 文件 | 改动 | 类型 |
|---|------|------|------|
| 1 | `frontend/src/views/HomeView.vue` | 注释/隐藏 Claude + Gemini 卡片 | 前端 |
| 2 | `frontend/src/views/admin/GroupsView.vue` | `platformOptions` 中移除/隐藏 anthropic + gemini | 前端 |
| 3 | `frontend/src/components/account/CreateAccountModal.vue` | "Other" 区域可直接不展示或默认收起（已收起） | 前端 |
| 4 | `frontend/src/i18n/locales/zh.ts` + `en.ts` | 如需完全隐藏，移除相关 i18n key 的展示引用 | 前端 |

**后端不需要改动** — Claude/Gemini 的代码保留，只是前端不再展示入口。这样万一以后要恢复只需改前端。

---

## 关键架构事实

1. **平台列表全部硬编码**在前端，没有动态发现 API
2. **Group.platform 创建后不可变**（逻辑约束，非 DB 约束）
3. **Account 和 Group 各自有 platform 字段**，需一致才能被调度选中
4. **计费**：最终成本 = 上游 token 成本 × account.rate_multiplier × group.rate_multiplier
5. **混合调度**：仅 Anthropic/Gemini 分组可混入 Antigravity 账号做 fallback
6. **国产模型**：走 OpenAI 兼容协议，无需任何协议翻译层
