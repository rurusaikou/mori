# Mori Agent V0 基础能力框架实现

日期：2026-11-08

## 1. 目标与边界

本阶段建立 Memory、Understanding、Connection、Reflection、Companionship 五个可独立运行、调试、替换 Prompt 和扩展测试的 Capability。V0 不实现 Orchestrator、Multi-Agent、自动串联、Vector DB、RAG、自动记忆保存或后台自主任务。

统一工程流：

```text
Input → Capability.execute → 独立 Prompt + 独立 Schema → Structured Output
```

统一接口不代表统一业务 Schema。Capability 不知道 Orchestrator 的存在，也不能直接调用其他 Capability。

## 2. 实现环境

### 当前技术栈

- Chrome Extension Manifest V3、React 19、TypeScript、esbuild；
- Node.js ESM 本地 API，无 Web Framework；
- LLM 使用 Responses API `text.format.type=json_schema`；
- API 与 Capability 测试使用 `node:test`；
- Extension 数据保存在 `chrome.storage.local/session`；
- API 日志按日期落盘。

Capability 位于 `apps/api/src/mori-agent/capabilities/`，只通过 Registry 和开发期路由独立运行。正式 Agent 与聊天链路见 [MORI_AGENT_PLAYGROUND_V0.1_2026-11-09.md](MORI_AGENT_PLAYGROUND_V0.1_2026-11-09.md)，本文件不重复描述。

## 3. 最终目录

```text
apps/api/src/mori-agent/
├── index.mjs                         # Registry 与 Lab examples
├── shared/
│   ├── executor.mjs                  # 统一 execute 结果和阶段日志
│   ├── llm.mjs                       # Responses Structured Outputs transport
│   └── logger.mjs                    # 独立中文可读阶段日志与内存 Debug Store
├── capabilities/
│   ├── memory/
│   │   ├── memory.prompt.mjs
│   │   ├── memory.types.mjs
│   │   ├── memory.service.mjs
│   │   └── memory.test.mjs
│   ├── understanding/                # 同样四类文件
│   ├── connection/
│   ├── reflection/
│   └── companionship/
└── lab/
    ├── index.html
    ├── lab.css
    └── lab.js
```

路由位于 `apps/api/src/routes/capabilities.mjs`。

## 4. 统一执行协议

成功：

```json
{
  "success": true,
  "data": {},
  "meta": {
    "runId": "uuid",
    "capability": "memory",
    "promptVersion": "memory-v0.1",
    "model": "configured-model",
    "latency": 123,
    "tokenUsage": {}
  }
}
```

失败返回 `success=false`、可读 `error` 和同结构 meta。业务错误不会伪装成成功 Structured Output。

## 5. Capability Schema 与 Prompt V0.1

### Memory

Input：`userMessage`，可选 `conversationContext/currentTrack`。

Output：`shouldCreate`；为真时包含 `candidate.content/type/confidence/evidence`。type 仅允许 experience、preference、person、music、interaction_preference、other。

Prompt `memory-v0.1`：只检测长期记忆候选；长期经历、稳定偏好、重要人物、音乐记忆和互动偏好可创建；临时状态、寒暄、播放命令不得创建；不保存记忆、不推断人格。

### Understanding

Input：`userMessage`，可选 `conversationContext/currentTrack`。

Output：`facts[]`、`interpretations[]`、`unsupportedInferences[]`。事实/解释包含 content、confidence、evidence；不支持的推断包含 content、reason。

Prompt `understanding-v0.1`：区分明确表达、可能理解与越界推断；不保存 Memory、不搜索历史、不修改画像、不生成最终回复。

### Connection

Input：`current.message` 与调用方显式提供的 `candidates[]`。

Output：`shouldConnect`；为真时包含 pastEvidence、currentEvidence、observation、confidence。

Prompt `connection-v0.1`：只发现有证据的延续、变化或对比；禁止自行访问记忆、关键词碰瓷和人生解释。

### Reflection

Input：`previousBelief.content/confidence/evidence?` 与 `newEvidence.content/source?`。

Output：KEEP、UPDATE、WEAKEN、REPLACE、CONTEXTUALIZE；非 KEEP 时包含 updatedBelief，始终包含 reason。

Prompt `reflection-v0.1`：比较旧理解与新证据；临时状态不得覆盖长期偏好；场景限制优先 CONTEXTUALIZE；只给建议、不修改数据库。

### Companionship

Input：`userMessage`，可选 understanding、relevantMemories、connection、interactionPreference、currentTrack。

Output：SILENT、ACKNOWLEDGE、RESPOND、ASK、CONNECT、RECOMMEND，另有 reason 与可选 responseGuidance。

Prompt `companionship-v0.1`：只做行动决策和语言指导，不生成最终回复；尊重明确互动偏好；用户要求安静时禁止 ASK。

完整 JSON Schema 与 Prompt 源码分别位于各模块 `*.types.mjs`、`*.prompt.mjs`，修改单个模块不会影响其他模块。

## 6. Capability Lab

开发启动：

```bash
pnpm dev:api
```

访问：`http://127.0.0.1:3211/capability-lab`

Lab 支持五个 Tab、编辑 Input JSON、Load Example、Run、Structured Output、Error、Prompt Version、Model 和 Latency。`NODE_ENV=production` 时 Lab 和 Capability Debug API 不注册。

## 7. 单独运行 Capability

示例：

```bash
curl -X POST http://127.0.0.1:3211/agent/capabilities/memory \
  -H 'Content-Type: application/json' \
  --data '{"userMessage":"我第一次听这首歌是在毕业旅行。"}'
```

将路径末尾替换为 understanding、connection、reflection、companionship 即可独立运行。每次调用只执行一个模块。

## 8. 阶段日志

每次 Run 依次记录：

1. `received`：生成 runId 并记录输入；
2. `input_validated`：输入 Schema/边界通过；
3. `llm_started`：准备调用模型；
4. `llm_completed`：模型返回并记录 tokenUsage；
5. `output_validated`：业务 Schema 与防越界规则通过；
6. `completed` 或 `failed`：记录输出、延迟或错误。

日志写入 `apps/api/logs/capability_YYYY-MM-DD.log`，格式与其他 Mori 日志一致：`本地时间 [信息/错误] [mori_agent/模块/阶段] 中文说明`。说明中保留 runId、Prompt 版本、模型、input/output、latency、tokenUsage 或 error，但避免整行裸 JSON 难以阅读。它不写入 `chrome.storage` Memory，也不进入对话。

## 9. 测试

```bash
pnpm test:api
```

每个 Capability 各有 3 正常、2 Bad、1 Boundary，共 30 个 Capability Case。边界覆盖：无依据心理推断、关键词强连、临时状态覆盖长期偏好、安静请求下 ASK 等。

## 10. 当前限制

- V0 Prompt 只追求跑通和边界清晰，尚未建立 Eval Dataset；
- Lab 是本地开发工具，没有用户认证，生产环境强制关闭；
- Debug Log 包含开发者提交的输入/输出，只适用于本地调试；
- 没有 Orchestrator，五个模块不会自动串联；
- 没有 Memory DB、Retrieval、RAG 或自动保存；
- Companionship 只给 Decision/Guidance，不生成聊天回复；
- 没有重试、Provider failover 或按 Capability 独立模型配置。

## 11. 后续优化入口

- Prompt：对应模块的 `*.prompt.mjs`；
- Schema/边界：对应模块的 `*.types.mjs`；
- 执行特例：对应模块的 `*.service.mjs`；
- Evaluation/Bad Case：对应模块的 `*.test.mjs`，未来可增加 `eval/`；
- 模型 transport：`shared/llm.mjs`；
- 统一 meta 与阶段：`shared/executor.mjs`；
- Lab 展示：`lab/`。

未来 Orchestrator 只能负责选择 Capability、准备输入和传递 Structured Output；本阶段不实现。
