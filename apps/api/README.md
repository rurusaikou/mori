# Mori API

Mori 的服务端边界。当前包含音乐特征代理、画像生成、正式 Agent API、隔离 Capability 和开发调试页面；第三方密钥始终留在 Extension 之外。它仍是本地开发服务，不提供生产身份、数据库或跨设备同步，也不持久化用户画像与对话。

```bash
pnpm dev:api
```

启动脚本从仓库根目录的 `.env.local` 读取配置，并使用 Node watch 模式在 API 源码变化后自动重启。`MELODATA_API_KEY` 和 `MELODATA_BASE_URL` 是音乐特征分析必填项；LLM 配置仅在画像叙事、Agent 或 Capability 运行时需要。服务代码不内置 MeloData 地址，缺少 Base URL 时相关服务启动失败并给出配置错误。API 默认监听 `http://127.0.0.1:3211`。Extension 负责采样 Spotify 曲库和本地保存最终画像；服务按 ISRC 将歌曲特征持久化到忽略上传的 `apps/api/data/music-features.json`。重新分析时只请求缓存中不存在的歌曲，每批并发处理五首，并将实际第三方请求限制在每秒 4 次、每分钟 90 次。每完成一个小批次就原子写盘，避免重启或中途限流浪费已经消耗的查询次数。

```dotenv
MELODATA_BASE_URL=https://melodata.voltenworks.com/api/v1
MELODATA_API_KEY=your-server-side-key
```

音乐画像、Agent 与 Capability 共用同一个 Structured LLM transport。默认使用 Responses API；也可以连接仅支持 Chat Completions 的本地服务。

Responses API：

```dotenv
MORI_LLM_ENDPOINT=https://api.deepseek.com/responses
MORI_LLM_API_KEY=your-server-side-key
MORI_LLM_MODEL=your-model-name
```

本机 `127.0.0.1:11434` Chat Completions（当前检测到模型 `qwen3.5:4b`）：

```dotenv
MORI_LLM_API_STYLE=chat_completions
MORI_LLM_ENDPOINT=http://127.0.0.1:11434
MORI_LLM_MODEL=qwen3.5:4b
MORI_LLM_JSON_MODE=json_schema
MORI_LLM_SEND_API_KEY=false
MORI_LLM_TIMEOUT_MS=120000
MORI_LLM_REASONING_EFFORT=none
```

基础地址会自动补成 `/v1/chat/completions`。本地服务不要求鉴权时可省略 `MORI_LLM_API_KEY`；如果同一 `.env.local` 还保留远程 Key，设置 `MORI_LLM_SEND_API_KEY=false` 可确保它不会发往本地服务。本地 thinking 模型通常比远程服务慢，可用 `MORI_LLM_TIMEOUT_MS` 覆盖默认 30 秒；兼容服务支持时，`MORI_LLM_REASONING_EFFORT=none` 可避免结构化任务把输出额度消耗在隐藏推理。若服务不支持 `response_format.json_schema`，将 JSON 模式改为 `json_object`；连 `response_format` 也不支持时使用 `prompt_only`。

音乐画像只向模型发送四项标准化维度，不发送歌曲列表、Spotify 标识或用户身份；Agent 则按其最小上下文边界调用同一 transport。无论使用哪种协议，解析后仍执行现有 Schema/业务校验。页面确定性指标不受 LLM transport 影响；LLM 未配置、超时或格式不合法时继续使用现有降级逻辑。密钥只允许存在于 API 进程，不能放入 Extension。

API 自身的音乐分析日志按日期写入 `apps/api/logs/api_YYYY-MM-DD.log`；`POST /logs` 接收的 Extension 业务日志按日期写入 `apps/api/logs/backend_YYYY-MM-DD.log`。当天文件不存在时自动创建，存在时继续追加。文件使用“时间 + 级别 + category/event + 中文说明”的单行格式并被 Git 忽略。正常日志不再刷终端，只有文件写入失败才输出 stderr。日志不包含 `MELODATA_API_KEY`、OAuth Token 或 Authorization Header。

## Mori Agent V0 Capability Lab

非生产环境启动 API 后访问 `http://127.0.0.1:3211/capability-lab`。Lab 可分别编辑并运行 Memory、Understanding、Connection、Reflection、Companionship；每个模块使用自己的 Prompt、JSON Schema 和 `execute(input)`，不会自动串联。生产环境（`NODE_ENV=production`）不注册 Lab 与 Capability Debug 路由。

独立 API：

```text
POST /agent/capabilities/memory
POST /agent/capabilities/understanding
POST /agent/capabilities/connection
POST /agent/capabilities/reflection
POST /agent/capabilities/companionship
GET  /agent/capability-logs
```

Capability Run 的每个阶段写入 `apps/api/logs/capability_YYYY-MM-DD.log`，使用与其他 Mori 日志一致的“本地时间 + 级别 + 事件 + 中文说明”格式。内容保留 runId、模块、Prompt 版本、模型、输入/输出、延迟、Token 或错误，但不再以整行裸 JSON 展示。该 Debug Log 与用户 Memory、对话存储完全隔离。

## Mori Agent V0.1

正式产品与调试页面复用 Agent 执行器，但使用不同 Tool 配置：

| 场景 | 入口 | `search_music` | 生产环境 |
|---|---|---|---|
| Extension 聊天 | `POST /agent/run` | Extension 真实曲库候选 | 保留，需 Extension Origin |
| Agent Playground | `/agent-playground`、`POST /agent/playground/run` | Mock | 关闭 |

Agent 一次最多执行一个 Tool；Moment 始终是用户操作，不是 Tool。正式上下文、播放动作校验、Trace 与限制统一记录在 [`docs/MORI_AGENT_PLAYGROUND_V0.1_2026-11-09.md`](../../docs/MORI_AGENT_PLAYGROUND_V0.1_2026-11-09.md)，本 README 只保留 API 运维入口。

## 结构

```text
apps/api/
├── server.mjs                    # 稳定启动入口
└── src/
    ├── server.mjs                # HTTP composition 与路由分发
    ├── http.mjs                  # Origin、Body Size 与 JSON 边界
    ├── logging.mjs               # 结构化日志
    ├── routes/
    │   ├── logs.mjs
    │   ├── music-profile.mjs
    │   ├── capabilities.mjs
    │   └── agent.mjs
    ├── mori-agent/
    │   ├── capabilities/            # 五个物理隔离的 V0 Capability
    │   ├── agent/、tools/、memory/   # Agent 闭环与显式 Tool
    │   ├── shared/                   # execute、LLM transport、Debug logger
    │   ├── lab/                      # Capability 调试页面
    │   └── playground/               # Agent 调试页面
    └── services/
        ├── feature-store.mjs
        ├── music-portrait.mjs
        └── music-profile.mjs
```

浏览器请求只接受 `chrome-extension://` Origin；无 Origin 请求仅用于本机 CLI 诊断。JSON Body 上限为 2 MiB，避免异常网页占用本地 API 内存。生产环境仍必须增加身份认证，不能把 Origin 校验视为用户授权。

查看日志：

```bash
tail -f apps/api/logs/api_$(date +%F).log
tail -f apps/api/logs/backend_$(date +%F).log
tail -f apps/api/logs/capability_$(date +%F).log
```

未来后端负责：

- Mori 用户身份与会话；
- Spotify OAuth 回调、Refresh Token 加密存储和短期 Token 签发；
- AI Provider 调用与限流；
- 对话、音乐记忆和跨设备同步；
- 隐私授权、审计日志和数据删除。

Extension UI、Chrome Service Worker 和 Player Host 都不属于后端。新增后端实现时应按 `auth/`、`spotify/`、`companion/`、`memory/`、`users/`、`database/` 分类，并通过 `packages/contracts/` 暴露前后端契约。
