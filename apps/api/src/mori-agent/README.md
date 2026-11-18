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
│   └── mori-runtime.mjs
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

## 专项文档

| 主题 | 文档 |
|---|---|
| Memory 契约、存储与评判标准 | [Memory V0.1](../../../../docs/MORI_AGENT_MEMORY_V0.1_2026-11-12.md) |
| 歌曲四层证据与协作边界 | [Song Understanding V0.1](../../../../docs/MORI_SONG_UNDERSTANDING_AGENT_V0.1_2026-11-15.md) |
| Conversation Agent 回归与改进 | [测试复盘](../../../../docs/MORI_AGENT_TEST_REVIEW_2026-11-16.md) |
| 对话、推荐与播放闭环问题 | [2026-11-18 复盘](../../../../docs/MORI_AGENT_CONVERSATION_RECOMMENDATION_REVIEW_2026-11-18.md) |
| 日志来源与排查方式 | [日志说明](../../../../docs/LOGGING.md) |

## 开发入口

- Capability Lab：`http://127.0.0.1:3211/capability-lab`
- Agent Playground：`http://127.0.0.1:3211/agent-playground`
- API 测试：`npm run test:api`
- 全项目检查：`npm run check`

调整某层逻辑时，应在同层修改并补充 `apps/api/test/` 中的回归用例；不要把 Bad Case 文案不断追加到通用 Prompt。
