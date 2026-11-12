# Mori Agent V0 模块说明

AI Agent 通用能力与当前代码的逐项映射、正式链路接入状态及缺口，见 [Mori Agent 模块映射说明](../../../../docs/MORI_AGENT_MODULE_MAPPING_2026-11-12.md)。

当前优先建设的 Memory 模块，其职责、数据契约、阶段计划及评判标准见 [Mori Agent Memory V0.1](../../../../docs/MORI_AGENT_MEMORY_V0.1_2026-11-12.md)。

## 职责与边界

该目录包含两套复用同一 LLM transport 和日志设施、但不互相调用的运行单元：

- Agent：`Context → Decision → Optional Tool → Final Response`，服务正式聊天和 Playground；
- Capability：五个独立 `Input → Structured Output` 模块，仅供 Lab/单独 API 调试，尚未编排进 Agent。

```text
index.mjs          Registry 与 Lab 默认示例
shared/executor    统一 execute 返回、错误和阶段生命周期
shared/llm         Responses API Structured Outputs transport
shared/logger      中文可读阶段日志与 Lab 内存 Debug Store
capabilities/*     各模块独立 Prompt、Schema、Service、Test
lab/*              非生产环境调试页面
agent/*            Agent V0.1 单次 Tool 闭环与状态
tools/*            Memory、当前歌曲和按模式装配的音乐搜索 Tool
memory/*           每次 Run 隔离的请求内 Repository
playground/*       独立 Agent Playground
```

依赖方向必须保持：

```text
API Route ──→ Agent ──→ Tool
    │            └────→ Shared LLM / Logger
    └──────→ Capability Registry → Capability Service
                                      ├── 自己的 Prompt
                                      ├── 自己的 Types/Schema
                                      └── Shared Executor / LLM / Logger
```

Capability 之间禁止直接 import，Agent 也不直接调用 Capability。未来编排层只能通过公开执行接口组合它们。

## 单模块修改

- 调整模型指令：修改对应 `*.prompt.mjs` 并提升 Prompt Version；
- 调整输入输出：修改对应 `*.types.mjs`；
- 调整模块装配：修改对应 `*.service.mjs`；
- 添加行为边界：修改对应 `*.test.mjs`；
- 不要把某个 Capability 的特例写入 shared。

## 日志

每次执行依次产生：`received → input_validated → llm_started → llm_completed → output_validated → completed/failed`。

文件：`apps/api/logs/capability_YYYY-MM-DD.log`

格式：

```text
2026-11-09 12:30:00 [信息] [mori_agent/memory/completed] Run ...：Capability 执行成功，耗时 238ms。输出：...
```

Debug Log 可能包含 Lab 输入，只能用于本地开发，不得作为用户 Memory 或生产审计日志。

## 开发验证

```bash
pnpm test:api
pnpm dev:api
```

Lab：`http://127.0.0.1:3211/capability-lab`

Agent Playground：`http://127.0.0.1:3211/agent-playground`

V0.1 Agent 最多调用一次 `search_memory`、`get_music_context` 或 `search_music`。Moment 没有注册为 Tool，Agent 无法主动创建 Moment。`search_music` 通过单一 `musicSearchMode` 装配：Playground=`mock`、正式聊天=`library`、禁用=`none`；正式模式由 composition root 注入 ISRC Feature Store 读取器，支持歌名/歌手匹配和已有逐曲特征的听感排序，但 Tool 本身不执行播放。Playground 使用 `/agent/playground/run`；Extension 使用经过 Origin 校验的 `/agent/run`。
