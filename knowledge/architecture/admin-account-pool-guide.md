---
created: 2026-06-02
tags:
  - architecture
  - admin
  - account-pool
  - model-config
---

# 管理员操作指南 — 账号池与模型配置

> 相关文档：[[model-routing-full-path|模型路由全链路]]

## 核心概念

```
Platform（平台）        ← deepseek / qwen / glm / openai / ...
  └── Group（分组）     ← 一个服务套餐，绑定一个 Platform
        ├── Account 1   ← 一个上游 API Key（带并发/优先级）
        ├── Account 2
        └── Account 3
              ↑
        API Key         ← 分发给最终用户的密钥，绑定到 Group
```

### 概念速查

| 概念 | 是什么 | 类比 |
|------|--------|------|
| **Platform** | 上游 AI 服务商标识 | "哪家的模型" |
| **Group（分组）** | 一个服务套餐 | "VIP通道" / "免费通道" |
| **Account（账号）** | 一个上游 API Key | "你在 DeepSeek 官网买的一个 key" |
| **Account → Group** | 把账号放进分组池 | "把多张卡放进同一个钱包" |
| **API Key（用户密钥）** | 分发给最终用户的 key | "用户拿到的门禁卡" |
| **Rate Multiplier** | 加价/折扣系数 | Group × Account 两层叠加 |
| **Concurrency** | 单账号同时处理请求数 | "同时能接几个电话" |
| **Priority** | 调度选择偏好 | 数字越小越优先 |

---

## 配置流程（以 DeepSeek 为例）

### Step 1: 创建 Group

```
名称:        "DeepSeek-标准"
Platform:    deepseek
费率倍数:    1.5（加价50%收费）
订阅类型:    standard（按余额扣费）
```

### Step 2: 创建 Account

```
平台:        deepseek
类型:        apikey
API Key:     sk-xxx（从 DeepSeek 官网获取）
Base URL:    留空（使用默认 https://api.deepseek.com）
并发数:      10
优先级:      10
```

### Step 3: 关联 Account → Group

将 Account 加入 "DeepSeek-标准" 分组。可以加多个 Account 形成池子。

### Step 4: 分发 API Key 给用户

生成一个 API Key → 绑定到 "DeepSeek-标准" → 给用户。

### 用户调用

```bash
curl -X POST https://your-proxy/v1/chat/completions \
  -H "Authorization: Bearer sk-用户的key" \
  -d '{"model": "deepseek-r1", "messages": [{"role":"user","content":"hello"}]}'
```

---

## 模型区分机制

用户通过请求 body 中的 `model` 字段选择模型：

```json
{"model": "deepseek-chat", ...}      // 普通对话
{"model": "deepseek-r1", ...}        // 推理模型
{"model": "deepseek-reasoner", ...}  // 推理模型（别名）
```

系统内部处理流程：

```
用户请求 {"model": "deepseek-r1"}
         ↓
Account 是否配置了 model_mapping？
         ↓
┌─── 没配置 ───┐    ┌─── 有配置 ───────────────────┐
│ 允许所有模型  │    │ 只允许白名单内的模型          │
│ model 原样    │    │ 可做名称映射 (a→b)           │
│ 透传给上游    │    │ 不在白名单内 → 拒绝请求       │
└──────────────┘    └──────────────────────────────┘
         ↓
POST https://api.deepseek.com/v1/chat/completions
body: {"model": "deepseek-r1", ...}
```

---

## 三种模型控制方式

### 方式 1: 不限制（默认）

Account 不配置 `model_mapping`。

**效果**：用户可调用该平台所有模型，model 名直接透传上游。

**适合**：单 Key 支持全部模型，不需限制。

---

### 方式 2: Account 级白名单 + 映射（model_mapping）

在 Account 的 credentials 中配置：

```json
{
  "api_key": "sk-xxx",
  "model_mapping": {
    "deepseek-chat": "deepseek-chat",
    "deepseek-r1": "deepseek-r1",
    "deepseek-reasoner": "deepseek-reasoner"
  }
}
```

**效果**：
- 用户只能调用这 3 个模型（其他返回错误）
- 左边 = 用户传的名字，右边 = 实际发给上游的名字
- 支持通配符：`"deepseek-*": "deepseek-chat"` → 所有 deepseek- 开头的请求统一走 chat

**适合**：
- 只暴露部分模型给用户
- 做模型名映射（用户说 A，实际用 B）
- 不同 Account 支持不同模型

---

### 方式 3: Group 级模型路由（model_routing）

在 Group 上配置，将不同模型路由到不同账号：

```json
{
  "model_routing_enabled": true,
  "model_routing": {
    "deepseek-r1": [1, 2],
    "deepseek-chat": [3],
    "deepseek-reasoner": [1, 2, 3]
  }
}
```

（数字为 Account ID）

**效果**：
- `deepseek-r1` 请求只会从 Account 1 或 2 中选
- `deepseek-chat` 只走 Account 3
- 未匹配的模型走全部可用账号

**适合**：
- 不同 Key 有不同模型权限
- 隔离高价模型和低价模型的用量
- 为特定模型预留专属容量

---

## 多账号池调度逻辑

一个 Group 下有多个 Account 时的选择策略：

```
请求进来
  ↓
1. 按 priority 排序（数字小 = 优先）
  ↓
2. 检查 model_mapping（该账号是否支持此模型）
  ↓ 不支持 → 跳过
3. 检查并发锁（是否还有空闲 slot）
  ↓ 已满 → 跳过
4. 检查粘性会话（同用户优先复用之前的账号）
  ↓
5. 获取锁 → 转发请求 → 释放锁
```

**失败处理**：
- 上游返回 429（限流）→ 标记账号临时不可用，重试下一个
- 上游返回 403/401 → 标记账号错误，通知管理员
- 所有账号不可用 → 返回 503 给用户

---

## 计费公式

```
用户实际扣费 = 上游 token 成本 × Account.rate_multiplier × Group.rate_multiplier
```

示例：
- 上游消耗 $0.10
- Account 倍率 1.0（原价转发）
- Group 倍率 1.5（加价 50%）
- 用户扣费 = 0.10 × 1.0 × 1.5 = **$0.15**

---

## 常见配置场景

### 场景 A: 一个 Key 全部模型

```
Group: "DS全模型" (platform=deepseek)
  └── Account: api_key=sk-xxx, 无 model_mapping
```

用户可以用 deepseek-chat / deepseek-r1 / 任意模型。

### 场景 B: 分离推理和普通对话

```
Group: "DS分流" (platform=deepseek, model_routing_enabled=true)
  ├── Account 1: api_key=sk-aaa（贵的 Key，性能好）
  ├── Account 2: api_key=sk-bbb（便宜的 Key）
  └── model_routing:
        "deepseek-r1": [1]         ← 推理走贵的
        "deepseek-chat": [2]       ← 聊天走便宜的
```

### 场景 C: 多 Key 负载均衡

```
Group: "DS高并发" (platform=deepseek)
  ├── Account 1: api_key=sk-aaa, concurrency=5, priority=10
  ├── Account 2: api_key=sk-bbb, concurrency=5, priority=10
  └── Account 3: api_key=sk-ccc, concurrency=5, priority=20（备用）
```

3 个 Key 共同承担流量，Account 1/2 优先，3 作为溢出备用。

### 场景 D: 对外只暴露特定模型

```
Group: "DS-VIP" (platform=deepseek)
  └── Account: api_key=sk-xxx
       model_mapping: {
         "ds-pro": "deepseek-r1",       ← 用户说 ds-pro，实际用 r1
         "ds-lite": "deepseek-chat"     ← 用户说 ds-lite，实际用 chat
       }
```

用户只看到 `ds-pro` 和 `ds-lite` 两个模型名，不知道背后是什么。
