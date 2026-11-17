# Mori Agent V0 模块说明

AI Agent 通用能力与当前代码的逐项映射、正式链路接入状态及缺口，见 [Mori Agent 模块映射说明](../../../../docs/MORI_AGENT_MODULE_MAPPING_2026-11-12.md)。

当前优先建设的 Memory 模块，其职责、数据契约、阶段计划及评判标准见 [Mori Agent Memory V0.1](../../../../docs/MORI_AGENT_MEMORY_V0.1_2026-11-12.md)。

歌曲四层理解与 Conversation Agent 的协作契约见 [Mori Song Understanding Agent V0.1](../../../../docs/MORI_SONG_UNDERSTANDING_AGENT_V0.1_2026-11-15.md)。
Conversation、Song Understanding 与 Memory 的全部已知不足统一记录在该文档“缺口台账”，不要在代码注释或新文档中重复维护 TODO 清单。

## 文档入口

| 内容 | 唯一入口 |
|---|---|
| 目录、依赖方向、运行单元职责 | 本文 |
| Agent 与产品功能映射、当前缺口 | [模块映射说明](../../../../docs/MORI_AGENT_MODULE_MAPPING_2026-11-12.md) |
| Memory 契约、阶段与评判标准 | [Memory V0.1](../../../../docs/MORI_AGENT_MEMORY_V0.1_2026-11-12.md) |
| 歌曲四层理解与协作边界 | [Song Understanding V0.1](../../../../docs/MORI_SONG_UNDERSTANDING_AGENT_V0.1_2026-11-15.md) |
| Conversation Agent 测试复盘 | [测试复盘](../../../../docs/MORI_AGENT_TEST_REVIEW_2026-11-16.md) |
| 日志文件、来源和排查方式 | [日志说明](../../../../docs/LOGGING.md) |

本文不重复维护其他文档的详细 Schema、缺口或日志事件表。

## 职责与边界

该目录包含三类复用同一 LLM transport、但职责不同的运行单元：

- Conversation Agent：`Context → Decision → Optional Tool → Final Response`，服务正式聊天和 Playground；
- Song Understanding Agent：由 `get_track_insight` 受控委派，输出歌曲四层公共知识，不直接面向用户；
- Capability：五个独立 `Input → Structured Output` 模块，仅供 Lab/单独 API 调试，尚未编排进 Agent。

```text
index.mjs          Registry 与 Lab 默认示例
shared/executor    统一 execute 返回、错误和阶段生命周期
shared/llm         Responses API Structured Outputs transport
shared/logger      中文可读阶段日志与 Lab 内存 Debug Store
capabilities/*     各模块正式 Prompt、Schema 与 Service
lab/*              非生产环境调试页面
agent/mori-agent   只负责运行编排、Tool 执行、Trace 和最终返回
agent/conversation-rules          Scene 与 Router 共用的无状态语言信号规则
agent/conversation-understanding  Scene、语义主题、指代、Context Assembly 与回复去重
agent/intent-router               本轮 Intent、语义边界及 Intent 到 Tool 动作的规范化
agent/state                       输入校验及 World/Playback State 标准化
agent/system-prompt               Decision 与 Final Response 的模型行为约束
tools/*            Agent 间边界、Memory、当前歌曲和音乐搜索 Tool
song-understanding 独立歌曲理解 Agent、四层 Schema、Provider 与缓存
memory/*           Mock 与 PostgreSQL/pgvector Repository、Embedding Provider、Memory Graph
playground/*       独立 Agent Playground
```

自动化测试不放在 `src/`。它们统一位于 `apps/api/test/`，并镜像正式源码的领域目录：

```text
apps/api/
├── src/                         正式运行代码与开发调试页面
│   └── mori-agent/
│       ├── agent/
│       ├── capabilities/
│       ├── memory/
│       ├── shared/
│       └── song-understanding/
└── test/                        不参与正式运行的自动化测试
    ├── services/
    └── mori-agent/
        ├── agent/
        ├── capabilities/
        ├── memory/
        ├── shared/
        └── song-understanding/
```

Playground 和 Capability Lab 虽然位于 `src/mori-agent/`，但它们是由开发路由显式暴露的调试页面，不是自动化测试，也不进入产品 Extension UI。

依赖方向必须保持：

```text
API Route ──→ Conversation Agent ──→ Tool ──→ Song Understanding Agent
    │                    └─────────→ Shared LLM / Logger
    └──────→ Capability Registry → Capability Service
                                      ├── 自己的 Prompt
                                      ├── 自己的 Types/Schema
                                      └── Shared Executor / LLM / Logger
```

Capability 之间禁止直接 import。Conversation Agent 只能通过 Tool 使用其他运行单元，不能 import Song Understanding 内部 Provider；这样 Trace、超时、证据边界和替换实现都有统一入口。

Conversation Agent 内部保持单向职责：`state + conversation-rules → conversation-understanding → intent-router → mori-agent`。主编排器不得重新实现 Scene、查询抽取或回复去重规则；共同语言信号只在 `conversation-rules` 维护；Scene 层不得决定 Tool；Router 不执行 Tool。这样新增规则时只修改一个语义归属明确的位置。

## 单模块修改

- 调整模型指令：修改对应 `*.prompt.mjs` 并提升 Prompt Version；
- 调整输入输出：修改对应 `*.types.mjs`；
- 调整模块装配：修改对应 `*.service.mjs`；
- 添加行为边界：修改 `apps/api/test/` 中镜像目录下的 `*.test.mjs`；
- 不要把某个 Capability 的特例写入 shared。

## 日志

每次执行依次产生：`received → input_validated → llm_started → llm_completed → output_validated → completed/failed`。

- 真实运行：`apps/api/logs/capability_YYYY-MM-DD.log`
- 自动化测试：`apps/api/logs/capability_test_YYYY-MM-DD.log`
- Playground / Lab：`apps/api/logs/capability_debug_YYYY-MM-DD.log`

格式：

```text
2026-11-17 12:30:00 [真实] [信息] [mori_agent/memory/completed] Run ...：Capability 执行成功，耗时 238ms。输出：...
```

每行都有 `[真实]` 或 `[测试]`。详细来源规则只在 [LOGGING.md](../../../../docs/LOGGING.md) 维护。Debug Log 可能包含 Lab 输入，只能用于本地开发，不得作为用户 Memory 或生产审计日志。

## 开发验证

```bash
npm run test:api
npm run dev:api
```

Lab：`http://127.0.0.1:3211/capability-lab`

Agent Playground：`http://127.0.0.1:3211/agent-playground`

Conversation Agent 每次最多调用一次 `search_memory`、`get_music_context`、`get_track_insight`、`search_music` 或 `recommend_music`。`search_music` 只处理明确歌名/歌手查找；`recommend_music` 处理听感选择、换歌和推荐，并默认排除当前歌曲。决策前记录 `CHAT / SEARCH / RECOMMEND / CONTROL / FEEDBACK` Intent，以及独立的 World State 与 Playback State。Moment 没有注册为 Tool，Agent 无法主动创建 Moment。`get_track_insight` 只在正式 composition root 注入；Playground 不连接外部歌曲证据源。音乐 Tool 通过 `musicSearchMode` 装配：Playground 只提供 Mock Search、正式聊天提供 Search + Recommend、禁用模式不提供音乐 Tool。Playground 使用 `/agent/playground/run`；Extension 使用经过 Origin 校验的 `/agent/run`。

Intent 只由 Router 判断一次，Decision 不得重新分类。对话 Context 使用 `latestMessage > conversationFocus > recentHistory`：当前消息独立置顶，Focus 保存上一轮局部指代，History 只保留最近六条去重内容。回复同时选择 Conversation Move（回答、追问、接话、澄清、关联或轻松回应）。只有当前消息明确表达情绪时才产生带证据的 `emotionSignal`；“下班”、省略号和旧回复不能作为情绪事实。

Intent Routing 前先执行 `conversation-understanding.mjs`，输出 `SOCIAL_CHAT / MUSIC_CHAT / MUSIC_REQUEST / COMPANION` Scene、当前话题、评价对象、指代关系和音乐证据。音乐解释必须有明确请求、当前歌曲直接指代或最近真实音乐话题之一；没有证据时，音乐产品先验不能把普通聊天改写成找歌或推荐。

`currentTopic` 是语义主题，不保存 latestMessage 副本；“一般、还行、对啊、不知道、嗯、没有”等短回答会结合上一条 assistant 问句判断承接。Intent Router 仍以 latestMessage 的明确意图为最高优先级，因此口语化的“随便推一首、找点晚上听的、想听点开心的”不会被旧 Social Scene 阻断。Decision 在最近三条 assistant 回复中检查重复道歉或解释，用户切换到新具体话题后不得继续旧反馈。

正式选歌遵循固定顺序：Extension 先遍历并缓存用户收藏与可读歌单，歌名/歌手命中时只把个人曲库结果交给 Agent；本地没有文字命中时才调用 Spotify Search，并为每个候选标记 `user_library` 或 `spotify_search` 来源。Agent 只能播放这批可信候选中的 URI，不能执行模型自行生成的 URI。

## 正式 Memory Repository

正式链路在配置数据库后使用 PostgreSQL 保存事实、pgvector 进行语义检索，并用 `memory_nodes / memory_edges` 保存可追溯关系。未配置时 API 仍可启动，Playground 继续使用 Mock，正式 Agent 保持原有的请求内本地 Moment 摘要回退，但不会把这些摘要冒充已写入服务端的长期 Memory。

```bash
MORI_MEMORY_DATABASE_URL=postgresql://mori:password@127.0.0.1:5432/mori
MORI_MEMORY_USER_ID=local-development-user

# 可选：本地 Ollama Embedding。维度必须与模型真实输出一致。
MORI_EMBEDDING_ENDPOINT=http://127.0.0.1:11434
MORI_EMBEDDING_API_STYLE=ollama
MORI_EMBEDDING_MODEL=nomic-embed-text
MORI_EMBEDDING_DIMENSIONS=768
```

首次连接会执行 `memory/schema.sql`，数据库账号需要创建 `vector`、`pg_trgm` 扩展和表的权限。向量维度属于数据库 Schema，已有数据后不可只改环境变量；更换维度必须走显式迁移。

服务端接口：

- `GET /memory/health`：查看仓储与 pgvector 状态；
- `POST /memory/moments`：接收用户主动保存的瞬间；
- `POST /memory/events/listening`：接收播放开始、暂停、跳过和完成事实；
- `GET /memory/memories`：列出当前用户尚未删除的长期记忆；
- `DELETE /memory/memories/:id`：按用户边界软删除记忆并移出向量检索；
- `POST /agent/run`：对话消息会在调用 LLM 前归档，成功后归档 Mori 回复并异步提炼候选记忆。

`MORI_MEMORY_USER_ID` 是 V0.1 本地开发身份，只能由服务端环境变量提供。请求体中的 `userId` 会被忽略；正式多用户部署前必须替换为真实认证结果。
