---
created: 2026-05-31
tags:
  - changelog
  - feature
  - cn-platform
  - deepseek
  - qwen
  - glm
  - i18n
---

# 2026-05-31 — 新增国产大模型平台 (DeepSeek/Qwen/GLM)

> 相关架构：[[architecture/model-routing-full-path|模型路由全链路]]、[[architecture/admin-account-pool-guide|管理员配置指南]]

## 需求背景

项目 fork 自 Sub2API，原版仅支持 Anthropic/OpenAI/Gemini/Antigravity 四个平台。需要：
1. 引入国产大模型 (DeepSeek/Qwen/GLM) 作为一级 Platform
2. 首页主推国产模型，Claude/GPT/Gemini 标记为"即将支持"
3. 新增 es/ja/de/fr 四种多语言

## 方案选择

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| 复用 upstream 类型 | 零后端改动 | 无专属 UI/图标/模型列表，体验差 | ❌ |
| 统一 "cn-llm" Platform | 少一个 tab | 混杂不同厂商，模型列表混乱 | ❌ |
| **新增独立 Platform** | 专属 UI/图标/默认 URL | 改动多一点 | ✅ 选用 |

**关键设计决策**：
- 三个国产模型均使用 OpenAI 兼容 API，网关层通过 `IsOpenAICompatiblePlatform()` 统一路由到 OpenAI 转发管线
- 仅支持 `apikey` 类型（无 OAuth）
- 默认 Base URL 内置，用户只需填 API Key

## 改动文件清单

### 后端

| 文件 | 改动 |
|------|------|
| `backend/internal/domain/constants.go` | +3 platform 常量 + `IsOpenAICompatiblePlatform()` |
| `backend/internal/server/routes/gateway.go` | 路由判断 `== PlatformOpenAI` → `IsOpenAICompatiblePlatform()` |
| `backend/internal/service/account.go` | +`IsDeepSeek/IsQwen/IsGLM/IsOpenAICompatible()` + `GetOpenAIBaseURL()` 多平台支持 |
| `backend/internal/handler/admin/channel_handler.go` | pricing 映射追加 3 平台 |
| `backend/internal/model/error_passthrough_rule.go` | `AllPlatforms()` 追加 |

### 前端

| 文件 | 改动 |
|------|------|
| `frontend/src/types/index.ts` | `GroupPlatform`/`AccountPlatform` 类型扩展 |
| `frontend/src/components/account/CreateAccountModal.vue` | 默认 Tab=DS/Qwen/GLM，原有平台→"其他"折叠 |
| `frontend/src/components/common/PlatformIcon.vue` | +3 图标 |
| `frontend/src/components/common/PlatformTypeBadge.vue` | +3 颜色（红/琥珀/靛蓝） |
| `frontend/src/composables/useModelWhitelist.ts` | `'glm'` → zhipuModels 别名 |
| `frontend/src/views/HomeView.vue` | 首页卡片：DS/Qwen/GLM 已支持 + Claude/GPT/Gemini 即将支持 |
| `frontend/src/i18n/index.ts` | 注册 ja/es/de/fr，浏览器自动匹配 |
| `frontend/src/i18n/locales/zh.ts` + `en.ts` | +`otherPlatforms` / `cnPlatformApiKeyOnly` |
| **新增** `ja.ts` / `es.ts` / `de.ts` / `fr.ts` | 四语言基础翻译 |

## 验证方式

1. `pnpm dev` → 浏览器查看首页卡片排列
2. 管理后台创建账号 → 确认 DS/Qwen/GLM Tab 默认展示
3. 后端编译 `go build ./cmd/server/` 无报错
4. `pnpm run typecheck` 无类型错误（已修复 Icon name 问题）
