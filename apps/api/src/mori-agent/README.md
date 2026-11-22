# Mori Agent 模块说明

本目录按 Mori 的四个主体能力组织。四层定义见 [系统架构](../../../../docs/ARCHITECTURE.md)，物理目录见 [代码结构](../../../../docs/CODE_STRUCTURE.md)，一次对话的执行顺序见 [实现说明](../../../../docs/IMPLEMENTATION.md)。

## 目录边界

```text
mori-agent/
├── perception/                 # 感知：当前消息、上下文、播放事实、歌曲证据
│   ├── state.mjs
│   ├── conversation-rules.mjs
│   ├── conversation-understanding.mjs
│   └── song-understanding/
├── brain/                      # 认知：意图、五项 Capability、Memory
│   ├── intent-router.mjs
│   ├── capability-registry.mjs
│   ├── capabilities/
│   └── memory/
├── expression/                 # 表达：Prompt 与发出前质量检查
│   ├── prompts.mjs
│   └── response-quality.mjs
├── action/                     # 行动：受控 Tool；不直接拥有产品状态
│   └── tools/
├── runtime/                    # 四层编排，不承载任何一层的业务判断
│   ├── index.mjs               # 默认 Graph / 人工 Legacy 回退
│   ├── graph-state.mjs         # MoriGraphState
│   ├── graph-nodes.mjs         # 现有领域函数的 Node Wrapper
│   ├── mori-graph-runtime.mjs  # LangGraph Edge 与执行
│   ├── mori-runtime.mjs        # 迁移期 Legacy Runtime
│   └── runtime-support.mjs     # 两种 Runtime 的共享契约
├── shared/                     # LLM、Schema、Logger 等无主体语义基础设施
├── lab/                        # Capability 开发调试页，不进入正式产品
└── playground/                 # Agent 开发调试页，不进入正式产品
```

`runtime`、`shared`、`lab` 和 `playground` 是工程支撑，不是 Mori 的第五种能力。自动化测试位于 `apps/api/test/`，不会与正式运行代码混放。

## 依赖规则

```text
Route → Runtime
Runtime → Perception → Brain → Expression / Action
Brain Capability → Shared
Action Tool → 显式注入的 Repository 或 Song Understanding
```

- Perception 只建立事实和证据，不选择 Tool。
- Brain 形成理解、意图和认知结果，不直接执行外部副作用。
- Expression 只组织或检查面向用户的语言。
- Action 只执行已授权能力，并将真实结果返回 Runtime。
- Runtime 只编排顺序、Trace 和错误边界，不复制四层内部判断。
- Capability 之间禁止互相 import；Memory Capability 与 Memory Repository 是不同职责。
- Moment 不是 Tool，Agent 不能主动创建 Moment。

## 正式执行链路

```text
State validation
→ Perception: Scene / Context / Playback facts
→ Brain: Intent routing / Model decision
→ Action: optional Tool call
→ Expression: final response / quality gate
→ Runtime result and trace
```

每轮最多执行一个 Tool。模型不能直接操作 Spotify；Action 返回客户端动作后，Extension 仍需校验 URI、执行播放并以真实 Playback State 确认结果。

正式 `/agent/run` 默认使用 LangGraph Runtime。`MORI_AGENT_RUNTIME=legacy` 只用于迁移期人工回退；禁止失败后自动重跑，以免重复执行播放计划。`npm run test:api` 会把完整 API 测试分别跑在 Legacy 和 Graph 上，并额外比较 Intent、Tool、参数、回复和 Action 契约。

## 专项文档

| 主题 | 文档 |
|---|---|
| 规则理解迁移到 LLM Understanding 的设计与评估 | [LLM 对话理解](../../../../docs/MORI_CONVERSATION_UNDERSTANDING_LLM_2026-11-22.md) |
| 三个用户场景与唯一主流程 | [三场景主流程](../../../../docs/MORI_THREE_SCENES_2026-11-21.md) |
| 四层模块完成度、证据与验收标准 | [模块成熟度](../../../../docs/MORI_MODULE_MATURITY_2026-11-19.md) |
| Memory 契约、存储与评判标准 | [Memory V0.1](../../../../docs/MORI_AGENT_MEMORY_V0.1_2026-11-12.md) |
| 歌曲四层证据与协作边界 | [Song Understanding V0.1](../../../../docs/MORI_SONG_UNDERSTANDING_AGENT_V0.1_2026-11-15.md) |
| Conversation Agent 回归与改进 | [测试复盘](../../../../docs/MORI_AGENT_TEST_REVIEW_2026-11-16.md) |
| 对话、推荐与播放闭环问题 | [2026-11-18 复盘](../../../../docs/MORI_AGENT_CONVERSATION_RECOMMENDATION_REVIEW_2026-11-18.md) |
| 日志来源与排查方式 | [日志说明](../../../../docs/LOGGING.md) |
| LangGraph 迁移范围与回退策略 | [迁移记录](../../../../docs/MORI_LANGGRAPH_MIGRATION_2026-11-19.md) |
| 每个 Tool 的实现、流程图与副作用边界 | [Tool 实现说明](../../../../docs/MORI_AGENT_TOOLS_2026-11-21.md) |

## 开发入口

- Capability Lab：`http://127.0.0.1:3211/capability-lab`
- Agent Playground：`http://127.0.0.1:3211/agent-playground`
- API 测试：`npm run test:api`
- 全项目检查：`npm run check`

调整某层逻辑时，应在同层修改并补充 `apps/api/test/` 中的回归用例；不要把 Bad Case 文案不断追加到通用 Prompt。
