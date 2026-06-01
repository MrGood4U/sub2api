# CLAUDE.md — UltraCnAPI

## 行动准则

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

## 项目概述

AI API 网关平台，管理上游 AI 服务的订阅配额分发。用户通过平台生成的 API Key 调用上游 AI 服务，平台负责鉴权、计费、负载均衡和请求转发。

## 技术栈

| 层 | 技术 |
|---|------|
| 后端 | Go 1.25+ / Gin / Ent ORM / Wire (DI) |
| 前端 | Vue 3 / TypeScript / Vite / TailwindCSS / pnpm |
| 数据库 | PostgreSQL 15+ / Redis 7+ |
| 部署 | Docker / Docker Compose |

## 项目结构

```
AI-Proxy/
├── backend/
│   ├── cmd/server/            # 程序入口，版本号在 cmd/server/VERSION
│   ├── ent/schema/            # 数据库 Schema 定义（Ent ORM）
│   ├── internal/
│   │   ├── config/            # 配置加载（Viper）
│   │   ├── handler/           # HTTP 处理器（Gin）
│   │   ├── handler/admin/     # 管理后台接口
│   │   ├── service/           # 业务逻辑层
│   │   ├── repository/        # 数据访问层
│   │   ├── middleware/        # 中间件（限流等）
│   │   ├── domain/            # 领域模型
│   │   ├── model/             # 数据模型
│   │   ├── payment/           # 支付模块
│   │   ├── server/            # 服务器启动
│   │   ├── web/               # 前端静态文件（构建产物）
│   │   └── pkg/               # 内部公共包
│   └── migrations/            # 数据库迁移脚本
├── frontend/
│   ├── src/
│   │   ├── api/               # Axios API 封装
│   │   ├── views/             # 页面组件
│   │   ├── components/        # 通用/业务组件
│   │   ├── stores/            # Pinia 状态管理
│   │   ├── router/            # Vue Router
│   │   ├── i18n/              # 国际化
│   │   ├── composables/       # 组合式函数
│   │   └── types/             # TypeScript 类型
│   └── pnpm-lock.yaml         # 必须提交
├── deploy/
│   └── docker-compose.yml     # 生产部署配置
└── Makefile                   # 顶层构建入口
```

## 常用命令

### 构建

```bash
# 全量构建（前端+后端）
make build

# 仅后端
make build-backend
# 或: cd backend && go build -o bin/server ./cmd/server

# 仅前端（产物输出到 backend/internal/web/dist）
make build-frontend
# 或: cd frontend && pnpm build
```

### 开发

```bash
# 后端启动
cd backend && go run ./cmd/server/

# 前端开发（默认 :3000，代理后端 :8080）
cd frontend && pnpm dev

# 生成 Ent ORM 代码（修改 schema 后必须执行）
cd backend && go generate ./ent
```

### 测试

```bash
# 全量测试
make test

# 后端
cd backend && go test -tags=unit ./...        # 单元测试
cd backend && go test -tags=integration ./... # 集成测试
cd backend && golangci-lint run ./...         # lint

# 前端
cd frontend && pnpm run lint:check           # ESLint
cd frontend && pnpm run typecheck            # TypeScript 检查
cd frontend && pnpm run test:run             # Vitest
```

### Docker 部署

```bash
cd deploy
cp .env.example .env  # 编辑配置
docker-compose up -d
# 访问 http://localhost:8080
```

## 开发注意事项

1. **前端包管理用 pnpm**，不是 npm。修改依赖后必须提交 `pnpm-lock.yaml`。
2. **Ent Schema 修改后**必须运行 `go generate ./ent`，生成代码要提交。
3. **前端构建产物**输出到 `backend/internal/web/dist/`，后端内嵌前端静态文件。
4. **配置管理**：支持 `config.yaml` 文件 + 环境变量，环境变量优先级更高。
5. **golangci-lint** 使用 v2.7 版本。
6. **测试标签**：后端测试分 `unit` / `integration` / `e2e` 三级。

## 架构要点

- **请求流**：Client → Gin Router → Middleware (Auth/RateLimit) → Handler → Service → Repository/Upstream
- **网关代理**：`/v1/*` 路径转发到上游 AI 服务，支持 SSE 流式响应
- **账号调度**：Service 层实现智能账号选择（负载均衡、粘性会话、并发控制）
- **计费**：Token 级用量追踪，通过 usage log 异步记录
- **DI**：使用 Google Wire 进行依赖注入，生成代码在 `cmd/server/wire_gen.go`

## 知识库维护（knowledge/）

项目根目录下 `knowledge/` 文件夹为 Obsidian 知识库，**开发过程中必须自动维护**：

```
knowledge/
├── architecture/       # 架构通路文档（数据流、模块交互、影响清单）
├── changelog/          # 改动记录（思路、方案、文件清单）
└── README.md           # 索引页（含所有文档的 [[链接]]）
```

### Obsidian 规范

1. **YAML frontmatter 必填**：每个 .md 文件必须有 `created` 和 `tags`
2. **文档间用 `[[wikilink]]` 互相关联**，不复制内容
3. **README.md 作为索引**：新增文档后同步更新 README 中的链接列表

### 维护规则

1. **新增/修改功能时**：在 `knowledge/changelog/YYYY-MM-DD-<slug>.md` 记录：
   - 需求背景（为什么做）
   - 方案选择（对比了什么，为什么选这个）
   - 改动文件清单
   - 验证方式

2. **涉及系统通路变更时**：更新 `knowledge/architecture/` 中相关文档：
   - 新增通路 → 创建新文件
   - 修改已有通路 → 更新对应文件中的文件路径/函数名/行号

3. **命名规范**：
   - 架构文档：`<通路名>.md`（如 `model-routing-full-path.md`）
   - 改动记录：`YYYY-MM-DD-<功能简述>.md`（如 `2026-05-31-add-cn-platforms.md`）

4. **触发时机**：每次 commit 前检查是否需要更新知识库。不需要用户显式要求。
