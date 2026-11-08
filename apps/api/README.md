# Mori API

Mori 的服务端边界。当前包含本地开发使用的音乐特征代理；它让 `MELODATA_API_KEY` 保持在 Extension 之外。该服务不是生产后端，也不持久化用户画像。

```bash
pnpm dev:api
```

启动脚本会从仓库根目录的 `.env.local` 读取必填的 `MELODATA_API_KEY` 和 `MELODATA_BASE_URL`，并使用 Node watch 模式在 API 源码变化时自动重启。服务代码不内置 MeloData 地址；缺少 Base URL 时启动直接失败并给出配置错误。API 默认监听 `http://127.0.0.1:3211`，提供 `POST /music-profile`。Extension 负责采样 Spotify 曲库和本地保存最终画像；服务按 ISRC 将歌曲特征持久化到忽略上传的 `apps/api/data/music-features.json`。重新分析时只请求缓存中不存在的歌曲，每批并发处理五首，并将实际第三方请求限制在每秒 4 次、每分钟 90 次。每完成一个小批次就原子写盘，避免重启或中途限流浪费已经消耗的查询次数。

```dotenv
MELODATA_BASE_URL=https://melodata.voltenworks.com/api/v1
MELODATA_API_KEY=your-server-side-key
```

音乐指标聚合完成后，API 可调用兼容 Responses API Structured Outputs 的 LLM 生成自然语言音乐画像。服务使用 `text.format.type=json_schema` 提交完整 Schema，不使用 Chat Completions。在 `.env.local` 配置完整 Responses Endpoint：

```dotenv
MORI_LLM_ENDPOINT=https://api.deepseek.com/responses
MORI_LLM_API_KEY=your-server-side-key
MORI_LLM_MODEL=your-model-name
```

只会向模型发送由 BPM、Energy、Danceability、Valence 得到的四项 0～100 标准化维度，不发送歌曲列表、Spotify 标识或用户身份。Schema 固定返回 `summary`、三项 `traits`、`listeningStyle` 和三个 `keywords`，服务端还会校验数量与中文文案长度。页面五项偏好状态和刻度仍由本地规则确定；LLM 未配置、超时或格式不合法时只回退顶部画像文案，不影响音乐特征分析结果。密钥只允许存在于 API 进程，不能放入 Extension。

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
    │   └── capabilities.mjs
    ├── mori-agent/
    │   ├── capabilities/            # 五个物理隔离的 V0 Capability
    │   ├── shared/                  # execute、LLM transport、Debug logger
    │   └── lab/                     # 仅开发环境的调试页面
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
