# Mori Agent V0.1 实现说明

本文是 Agent 闭环、Playground 和正式聊天接入的唯一详细说明。五个独立 Capability 的 Schema 与边界见 [MORI_AGENT_V0_IMPLEMENTATION_2026-11-08.md](MORI_AGENT_V0_IMPLEMENTATION_2026-11-08.md)。

## 1. 目标

在不修改 Mori 正式 Extension UI 的前提下，建立一个可独立运行的最小 Agent 闭环：

```text
User Input
  → Context Assembly
  → Model Decision
  → Optional Tool Call
  → Tool Result
  → Final Model Call
  → Final Response
```

V0.1 最多执行一次 Tool，不实现自主循环或 Multi-Agent。2026-11-09 起，同一执行器通过独立的正式接口接入 Extension 对话；Playground 仍用于调试，不与正式 UI 混合。

## 2. 目录

```text
apps/api/src/mori-agent/
├── agent/
│   ├── mori-agent.mjs
│   ├── mori-agent.test.mjs
│   ├── system-prompt.mjs
│   └── state.mjs
├── tools/
│   ├── search-memory.mjs
│   ├── get-music-context.mjs
│   └── search-music.mjs
├── memory/
│   ├── mock-repository.mjs
│   └── mock-repository.test.mjs
├── shared/
│   └── agent-types.mjs
└── playground/
    ├── index.html
    ├── playground.css
    └── playground.js
```

HTTP 路由统一位于 `apps/api/src/routes/agent.mjs`；正式与 Playground Agent 由 `server.mjs` 分别注入。

## 3. Context 与状态

Agent Run Input：

```json
{
  "userMessage": "这首歌让我想起什么来着？",
  "currentTrack": { "title": "歌曲", "artist": "歌手", "album": "专辑" },
  "conversationHistory": [{ "role": "user", "content": "..." }],
  "fakeMemory": [{ "id": "m1", "content": "...", "context": "..." }],
  "musicCatalog": [{ "uri": "spotify:track:...", "title": "歌曲", "artist": "歌手" }]
}
```

`state.mjs` 负责校验并冻结本次上下文。Tool 只能读取显式传入的 State，不能直接访问 Spotify、Chrome Storage 或真实数据库。正式 Extension 发送当前歌曲标题/歌手、最近 12 条有效对话、最多 50 条用户主动保存的 Moment 摘要；仅在播放意图下附带最多 500 首曲库候选。Spotify Token、封面、音频和 LLM Key 不进入请求。

## 4. Tools

### search_memory

输入 `query`，在本次 Run 的 Fake Memory 中进行简单相关度搜索，最多返回五条。不会创建或修改 Memory。

V0.1 使用词项匹配而非向量语义检索，因此默认示例会在 Memory 中保留明确歌曲名，确保开发者可以稳定观察 Tool 命中；真实同义表达和模糊语义召回不属于本阶段。

### get_music_context

返回 Playground 手动填写的 Current Track。没有歌曲时返回 `available=false`，不连接 Spotify。

### search_music

Tool 按运行模式装配：

- Playground：`musicSearchMode=mock`，返回稳定 Mock Result，只用于 Trace 调试；
- 正式聊天：`musicSearchMode=library`，只搜索 Extension 提供的真实候选；
- 测试或禁用：`musicSearchMode=none`，不注册该 Tool。

正式命中时 Agent 返回 `play_track` 动作。Extension 必须在本次候选中重新解析 URI，校验通过后才调用 `MusicController.playUri`。

Moment 没有 Tool Interface，也不在 Tool Registry 中，因此 Agent 无法主动创建 Moment。

## 5. Model 调用

第一轮通过 `AGENT_DECISION_SCHEMA` 返回：

- `action=respond`：信息足够，直接返回 response；
- `action=tool`：返回一个已注册 Tool 及 arguments。

Tool 执行后，第二轮使用 `FINAL_RESPONSE_SCHEMA`，将 Context、Decision 和真实 Tool Result 一起交给模型生成最终回复。任何未注册 Tool、坏参数或非法模型输出都会进入 ERROR Step。

## 6. Agent Trace

所有步骤统一为：

```json
{
  "id": "runId:type:stepId",
  "type": "TOOL_RESULT",
  "timestamp": "ISO-8601",
  "data": {}
}
```

支持的 Step：INPUT、CONTEXT_ASSEMBLY、MODEL_DECISION、TOOL_CALL、TOOL_ARGUMENTS、TOOL_RESULT、FINAL_MODEL_CALL、FINAL_RESPONSE、ERROR。

每个 Step 同时写入 `apps/api/logs/capability_YYYY-MM-DD.log`，使用中文可读说明。

## 7. Playground

启动：

```bash
pnpm dev:api
```

访问：`http://127.0.0.1:3211/agent-playground`

调试接口：`POST /agent/playground/run`

正式聊天接口：`POST /agent/run`

页面展示 Current Track、Conversation History、User Message、Fake Memory、Agent Trace、Final Response 和运行 Meta。生产环境不注册 Playground 页面及调试接口；正式 `/agent/run` 保留，并经过 Extension Origin 校验。

## 8. 正式聊天接入

```text
ChatPanel
  → MORI_SEND_MESSAGE
  → CompanionService 组装最小上下文
  → POST /agent/run
  → Mori Agent 决策 / 可选 Tool / 最终回复
  → chrome.storage.local conversation
  → ChatPanel
```

- Agent 与 Capability 共用服务端 Responses API transport 和按阶段日志，但正式聊天不直接串联五个 Capability。
- `search_memory` 只搜索本次请求携带的用户既有 Moment 摘要；Moment 仍只能由用户点击保存。
- Mock `search_music` 只在 Playground 注册；正式聊天的同名 Tool 只检索 Extension 提供的、最多 500 首真实可播放曲库候选。
- 正式 Tool 命中后只返回候选中的首个 URI。Extension 会再次校验 URI 必须来自本次候选集，然后调用现有 Spotify 播放链路；模型不能生成并执行任意 URI。
- API 或模型不可用时，Extension 明确提示理解服务暂不可用，不再伪装成正常智能回复。
- 读取历史数据时一次性清除旧版本遗留的空消息；ChatPanel 保留完整有界历史并自动滚动到最新消息。

## 9. 测试与限制

```bash
pnpm test:api
```

已覆盖直接回复、三个 Tool、两次模型调用、Trace 顺序、坏输入和坏 Tool 参数。

当前限制：一次最多调用一个 Tool；Memory 检索仍是请求内词项匹配；正式音乐搜索只覆盖用户已加载或采样到的曲库候选，不是 Spotify 全站搜索；不持久化 Agent State；没有自主循环或 Orchestrator。
