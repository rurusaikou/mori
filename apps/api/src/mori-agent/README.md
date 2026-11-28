# Mori Agent 模块说明

Mori 的产品智能由 Conversation Intelligence、Music Intelligence 和 Personal Intelligence 组成；本目录再按 Perception、Brain、Expression、Action 四个工程主体组织实现。产品智能回答“用户为什么觉得 Mori 聪明”，工程分层回答“代码职责放在哪里”，两者不是同一套分类。完整定义见 [实现说明](../../../../docs/02_SYSTEM_ARCHITECTURE.md)，四层架构见 [系统架构](../../../../docs/02_SYSTEM_ARCHITECTURE.md)，物理目录见 [代码结构](../../../../docs/04_CODE_REFERENCE.md)。

| 产品智能 | 主要工程落点 |
|---|---|
| Conversation Intelligence | `perception/conversation-understanding`、Runtime Context、Decision、Expression |
| Music Intelligence | `perception/song-understanding`、音乐 Action Tools、Spotify 客户端执行 |
| Personal Intelligence | `brain/memory`、Conversation/Listening 事实、Preference 与 Graph |

## 目录边界

```text
mori-agent/
├── perception/                 # 感知：当前消息、上下文、播放事实、歌曲证据
│   ├── state.mjs
│   ├── conversation-understanding.mjs
│   └── song-understanding/
├── brain/                      # 认知：专项 Capability 与 Memory
│   ├── capability-registry.mjs
│   ├── capabilities/
│   └── memory/
├── expression/                 # 表达：Prompt 与发出前质量检查
│   ├── prompts.mjs
│   └── response-quality.mjs
├── action/                     # 行动：受控 Tool；不直接拥有产品状态
│   └── tools/
├── runtime/                    # 四层编排，不承载任何一层的业务判断
│   ├── index.mjs               # 默认 Unified / Graph 与 Legacy 显式回退
│   ├── graph-state.mjs         # MoriGraphState
│   ├── graph-nodes.mjs         # 现有领域函数的 Node Wrapper
│   ├── mori-graph-runtime.mjs  # LangGraph Edge 与执行
│   ├── mori-runtime.mjs        # 迁移期 Legacy Runtime
│   ├── unified-runtime.mjs     # 原生 Tool Calling + Streaming 实验 Runtime
│   └── runtime-support.mjs     # 三种 Runtime 的共享领域契约
├── shared/                     # LLM、Schema、Logger 等无主体语义基础设施
├── lab/                        # Capability 开发调试页，不进入正式产品
└── playground/                 # Agent 开发调试页，不进入正式产品
```

`runtime`、`shared`、`lab` 和 `playground` 是工程支撑，不是 Mori 的第五种能力。自动化测试位于 `apps/api/test/`，不会与正式运行代码混放。

## 依赖规则

```text
Route → Runtime
Runtime → Perception Understanding → Model Decision → Expression / Action
Brain Capability → Shared
Action Tool → 显式注入的 Repository 或 Song Understanding
```

- Perception 只建立事实和证据，不选择 Tool。
- Brain 形成理解、意图和认知结果，不直接执行外部副作用。
- Expression 只组织或检查面向用户的语言。
- Action 只执行已授权能力。服务端 Action 对客户端音乐操作只返回 `PENDING` 计划；Extension 读取真实 Playback State 后，通过动作结果回写接口更新最终回复与长期归档。
- Runtime 只编排顺序、Trace 和错误边界，不复制四层内部判断。
- Capability 之间禁止互相 import；Memory Capability 与 Memory Repository 是不同职责。
- Moment 不是 Tool，Agent 不能主动创建 Moment。

## 正式执行链路

```text
State validation
→ Perception: Structured Conversation Understanding / Playback facts
→ Brain: Model decision（消费唯一 Understanding 结果）
→ Action: optional Tool call
→ Expression: final response / quality gate
→ Runtime result and trace
```

每轮最多执行一个 Tool。模型不能直接操作 Spotify；Action 返回客户端动作后，Extension 仍需校验 URI、执行播放并以真实 Playback State 确认结果。

正式 `/agent/run` 默认使用 Unified Runtime。`MORI_AGENT_RUNTIME=graph` 和 `MORI_AGENT_RUNTIME=legacy` 仅用于显式人工回退。Unified 的客户端动作分支只调用一次 Conversation Model：Tool 返回 `PENDING` 后直接流式输出确定性 planned response，不再调用无真实观察可总结的 Final Response Model；读取型 Tool 仍会把真实观察返回 Agent 继续回答。明确当前句动作使用代码授权，依赖上轮提议的含糊确认仍使用语义授权。

Mori 主动建议音乐时必须使用无副作用的 `propose_music`，并写入 `conversationState.pendingProposal`。该提议只对紧邻的下一条用户回复有效：接受后转为动作，拒绝、转移话题、读取其他信息或 Tool 校验失败后均清除。`propose_music.response` 必须是等待确认的问句，不得声称已经播放。

三种 Runtime 不会在单次失败后互相自动重跑，以免重复执行播放计划。`npm run test:api` 会把完整 API 测试分别跑在 Legacy 和 Graph 上，并额外覆盖默认 Unified 的 Tool 授权、`pendingProposal`、单次模型动作分支与流式契约。`npm run eval:unified` 执行来自真实 bad case 的主链评测；模型端点不可用时会中止，不会把基础设施失败记成模型 0 分。如需紧急回退，显式设置 `MORI_AGENT_RUNTIME=graph`。

## 专项文档

| 主题 | 文档 |
|---|---|
| 主链全部问题、根因、方案和状态 | [主链问题与改进总账](../../../../docs/08_ISSUES_AND_RETROSPECTIVES.md) |
| 三个用户场景与唯一主流程 | [三场景主流程](../../../../docs/01_PRODUCT_DESIGN.md) |
| 四层模块完成度、证据与验收标准 | [模块成熟度](../../../../docs/03_MODULE_ARCHITECTURE.md) |
| Memory 契约、存储与评判标准 | [Memory V0.1](../../../../docs/03_MODULE_ARCHITECTURE.md) |
| P0–P3 实施与缺陷复盘 | [Memory 演进记录](../../../../docs/03_MODULE_ARCHITECTURE.md) |
| Post-turn 与 Recall 闭环复盘 | [Memory 闭环补全](../../../../docs/03_MODULE_ARCHITECTURE.md) |
| 歌曲四层证据与协作边界 | [Song Understanding V0.1](../../../../docs/03_MODULE_ARCHITECTURE.md) |
| 日志来源与排查方式 | [日志说明](../../../../docs/07_OPERATIONS_TROUBLESHOOTING.md) |
| LangGraph 迁移范围与回退策略 | [迁移记录](../../../../docs/09_TECHNICAL_GOVERNANCE.md) |
| 每个 Tool 的实现、流程图与副作用边界 | [Tool 实现说明](../../../../docs/03_MODULE_ARCHITECTURE.md) |

## 开发入口

- Capability Lab：`http://127.0.0.1:3211/capability-lab`
- Agent Playground：`http://127.0.0.1:3211/agent-playground`
- API 测试：`npm run test:api`
- 全项目检查：`npm run check`

调整某层逻辑时，应在同层修改并补充 `apps/api/test/` 中的回归用例；不要把 Bad Case 文案不断追加到通用 Prompt。
