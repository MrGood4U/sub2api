---
created: 2026-05-31
tags:
  - knowledge-base
  - index
---

# 知识库

本目录为项目开发知识库，用 Obsidian 管理。

## 目录结构

- [[architecture/model-routing-full-path|模型路由全链路]]
- [[architecture/admin-account-pool-guide|管理员账号池配置指南]]
- [[changelog/2026-05-31-add-cn-platforms|国产大模型平台接入]]

## 分类

### architecture/ — 架构通路

系统中关键数据流和模块交互关系，改动时用于追溯影响范围。

命名：`<通路名>.md`

### changelog/ — 改动记录

每次功能开发/重构的决策过程：思路、方案选择、最终实现。

命名：`YYYY-MM-DD-<功能简述>.md`

## 自动维护规则

1. 新增功能涉及架构通路变更 → 更新 `architecture/` 相关文档
2. 每次功能开发完成 → 在 `changelog/` 中记录改动
3. 每个文件都需要 YAML frontmatter（`created` + `tags`）
