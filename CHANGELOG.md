# Changelog

## 2026-11-09 — Panel rendering stability

- 移除 Full/Mini Panel 外框上的 `backdrop-filter`，避免 Chrome 在旋转封面和播放进度更新时反复重绘圆角模糊层造成边框闪烁；保留原背景、描边和阴影，并使用独立合成隔离稳定绘制。
- 将正式对话从重复的本地模板回复切换到 Mori Agent V0.1 `/agent/run`：仅传递当前歌曲基本信息、最近对话和用户已保存 Moment 摘要，LLM Key 保持在 API；服务不可用时显示明确降级提示。
- 清理旧版本遗留的空对话消息，取消只截取最后四条造成的跳变，并让对话区域稳定自动滚动到最新消息。
- 隔离正式 Agent 与 Playground Tool 集合：Mock 音乐搜索不再进入产品回复；在没有播放 Tool 时禁止声称可控制播放器，并限制回复长度。聊天滚动改为同一布局帧直接定位到底部，避免旧长气泡被裁成空紫块。
- 修复吉祥物按钮与 Mori 对话消息共用 `.mori` 类名导致的样式串扰；按钮尺寸规则限定到根节点直属元素，对话气泡恢复按文字内容自适应高度。
- 为正式 Agent 增加真实曲库搜索与受约束播放动作：Agent 只能选择 Extension 提供的可播放候选，Extension 校验 URI 后复用 Spotify 播放控制；Playground Mock 搜索继续保持隔离。
- 梳理 Agent/Capability 文档与代码职责：架构、代码结构和实现说明更新为真实聊天链路；Capability 与 Agent 详细文档去除重复；统一路由命名为 `agent.mjs`，音乐搜索配置收敛为互斥的 `mock / library / none` 模式。
- LLM transport 同时支持 Responses API 与 Chat Completions；本地基础地址可自动补全 `/v1/chat/completions`，API Key 可选，并提供 `json_schema / json_object / prompt_only` 三种结构化输出兼容模式。音乐画像移除重复 HTTP 实现，改为复用统一 transport。
- 统一 Mori 关闭语义：Panel 关闭按钮与浏览器工具栏关闭均进入后台 `MORI_CLOSE`，暂停当前 Spotify 播放、持久化全局 Presence 并广播全部页面；关闭时同步重置各页 Panel 状态。
- 修复选歌后顶部仍显示上一首的问题：播放请求携带目标歌曲 metadata，Controller 在设备转移期间忽略旧曲暂停快照并即时展示目标；复用存活的嵌入式 Spotify Device，减少重复初始化等待。
- 改善本地慢模型下的聊天发送体验：用户消息即时进入时间线，输入框立即清空并保持焦点，Mori 显示思考状态；请求失败时恢复草稿，单请求串行避免回复乱序。
- 修复本地 qwen thinking 模型耗尽输出预算导致的伪“连接失败”：Chat Completions 支持配置 `reasoning_effort=none`，并区分输出截断与网络故障的用户提示。
- 修复 Saved Tracks 点击目标歌曲后数秒自动跳到另一首：用户选歌只提交单个 Spotify URI，不再把整份收藏列表作为临时 `uris` 队列；普通歌单继续使用原生 context。

## 2026-11-03 — Music profile resilience

- MeloData 网络错误与服务端错误增加退避重试；单曲重试耗尽后跳过，避免大型曲库因一次瞬时故障丢失整次分析结果。
- API 与 Extension 转发日志改为 `xxx_YYYY-MM-DD.log` 日文件；当天首次写入自动创建，后续事件继续追加。
- 日志落盘格式由纯 JSON 调整为带稳定事件标识的中文说明，音乐画像进度、播放、用户操作和错误可直接阅读。
- 音乐画像从每批两首加固定等待调整为五首并发，并按实际 MeloData HTTP 请求执行每秒 4 次、每分钟 90 次的统一限速；缓存命中不再等待。
- “我的音乐偏好”改为先展示自然语言音乐画像与五项可读听歌偏好；原始 BPM 和特征百分比降级到可展开的详细数据，并明确不从音乐特征推断人格。
- 音乐偏好页在与全局一致的面板尺寸内采用紧凑横向语义刻度，画像、五项偏好、详情入口与重新分析按钮无需页面滚动即可完整显示。
- 音乐偏好页进一步移除画像卡、指标容器和五个装饰 icon，以留白、弱分隔线和低权重结果标签重建信息层级，保持原尺寸和全部交互不变。
- 音乐偏好详情从原地展开重构为独立 Detail View，并增加“音乐数据 / 听歌特征 / AI 解读”三个共享分析结果的 Tab；Overview 保持单屏，Detail 内容区独立滚动且支持返回。
- 将音乐画像叙事抽为独立 LLM 服务：只发送节奏、能量、律动、情绪四项标准化分数，按 Schema 生成综合摘要、三项特征、听歌方式和关键词；五项偏好刻度继续由本地规则稳定计算。
- MeloData 服务地址改为必填的 `MELODATA_BASE_URL` 注入，业务服务不再保留默认绝对地址，便于切换环境或代理。
- LLM 画像生成从 Chat Completions 切换到 Responses API `json_schema` Structured Outputs，以完整 Schema 约束画像叙事结构。

## 2026-11-02 — Music preference profile

- 从旧版 Mori 迁移音乐偏好画像的数据模型、Spotify 曲库采样策略和指标 UI。
- 音乐偏好分析改为后台启动并通过短请求轮询状态，避免长任务被 Chrome 消息通道中断并显示内部英文错误。
- 音乐画像样本上限调整为完整曲库全局去重后的 20%；样本内我收藏的歌曲占 50%，其余 50% 在所有可读取歌单间平均分配。
- 新增本地 Mori API，通过 MeloData 聚合节奏、能量、律动、明亮度与原声感；第三方密钥不进入 Extension。
- Mori API 按 ISRC 持久化歌曲特征，重新分析只请求缓存缺失项，并在每个请求批次后原子写盘。
- 在应用设置中增加音乐品味入口、首次分析、重新分析和本地画像持久化。
- 没有现有播放上下文时，中央播放键会从收藏歌曲和可读取歌单中随机选择可播放歌曲；Saved Tracks 保留可连续切歌的队列。
- 增加 Extension 与 Mori API 结构化日志，覆盖 Spotify ready、当前歌曲、用户操作、音乐偏好批次进度、瞬间和对话，并排除 Token 与 API Key。
- Extension 更新或开发模式重新加载后自动向已打开网页重新注入 Content Script，清除失效上下文；残余错误转换为可执行的刷新提示。
- 完成 Runtime/依赖/播放状态架构审计；保持 Spotify 播放链路不动，将 Mori API 渐进拆分为 HTTP、Route、Music Profile 与 Feature Store 模块。
- 收紧本地 API 边界：普通网页 Origin 返回 403，Extension Origin 按请求回显，JSON Body 限制为 2 MiB。
- `dev:api` 改为 Node watch 模式，后端代码变化后自动重启，避免旧进程继续运行旧路由。
- 播放日志忽略 Spotify SDK 初始化时的暂停旧曲目快照，只在歌曲真实开始播放后记录 `track_changed`。
- 新增本地 `docs/LOGGING.md`，集中说明日志位置、输出前缀、事件、参数、隐私边界和常见排查方式。
- 正常日志从终端迁移到按日期拆分的单行日志文件：API 写入 `apps/api/logs/api_YYYY-MM-DD.log`，Extension 转发日志写入 `backend_YYYY-MM-DD.log`；日志目录不上传 Git。

## 2026-11-01 — Anchored adaptive panel

- 将 Mori 固定为 viewport 拖拽锚点，Panel 改为不影响锚点布局的绝对定位层。
- 根据锚点象限自动选择展开方向，并增加 16px viewport 边界碰撞检测。
- 增加 Mori → Mini Player → Full Panel 三级渐进交互和逐级收回行为。
- 修复 closed Shadow DOM 下内部按钮被误判为外部点击的问题，并移除 Mini Player 右上角收藏按钮。
- 将 Full Panel 调整为“标题 → 当前歌曲 → Tab → 内容”，保留 Mini 播放状态；面板约 400px 高，歌单内容内部滚动。
- 明确 `✦` 为「记录这一瞬间」入口，并移除 Full Panel 的心形收藏语义。
- 删除独立的瞬间大按钮，将 `✦` 移到控制栏左侧，并把随机/循环模式移到下一首右侧。
- 将 Panel 与 Mori 的锚点间距缩短为 6px；Spotify 开始播放后显式恢复 Host 本地音量，修复状态正常但没有声音的问题。
- 清理未消费的 Provider capability、播放设备快照、对话/token 元数据、Panel 方向属性和重复 CSS；合并重复的生命周期及后端文档。
- 在 Mini Player 与 Full Panel 右上角增加应用内设置入口，并将日常设置与 OAuth/Host 技术 Options 分离。

## 2026-10-31 — Playback consistency and implementation guide

- 删除未被消费的记忆 UI 状态和已失去用途的 Playback Host 控制命令。
- 统一 Mori 设备与 Spotify Connect 回退设备的 Web API 播放控制路径。
- 修复 Host 初始化失败后的重试、切歌后的状态刷新和设备 ID 同步。
- 收紧 offscreen 播放事件来源与跨 Origin payload 边界。
- 补齐 Playback Host 的 `'self'`/本地连接与 `sdk.scdn.co/embedded` iframe CSP 权限，修复被策略阻断的设备初始化链路。
- 将 Playback Host 内联样式迁移到独立 CSS，消除 CSP inline-style 错误。
- 按歌单、对话、瞬间三页与固定底部播放条重构 Mori 展开界面。
- 切歌改为控制当前 active Spotify 设备，并将真实成功或失败反馈给 UI。
- 将主面板压缩为 mini 尺寸，并增加跨页面复用的 60 分钟 Spotify 曲库缓存与后台刷新。
- 兼容 Spotify 写操作的空或非 JSON 成功响应，避免把底层 JSON 解析异常显示给用户。
- 修正对话页签图标；不可播放歌曲置灰禁用；底部圆形歌曲封面随播放状态旋转。
- 歌曲播放保留 playlist context 与 track offset，修复单曲队列导致上一首/下一首无效。
- 播放栏增加随机、歌单循环和单曲循环状态，单击循环切换并同步 Spotify active device；增加本地推进的歌曲进度条。
- 增加 Saved Tracks“我收藏的歌曲”；读取内容被 Spotify 拒绝的歌单会缓存为置灰禁用状态。
- 首次加载歌单列表时并发预检内容访问权限，使 Forbidden 歌单首次展示即置灰。
- 根据真实缓存状态显示歌单同步提示，缓存命中时不再出现 Spotify 加载文案。
- 启用 TypeScript 未使用代码检查，并增加代码实现说明。

## 2026-10-30 — Extension-only architecture

- 移除 Electron、Desktop UI、Soloist、Next.js、桌面素材和专属依赖。
- 保留并重构 Manifest V3 Browser Extension 产品线。
- 将 Spotify Web Playback SDK 从 Next/Extension sandbox 迁移到独立静态 Playback Host。
- 新增独立 Extension/Host 构建、开发服务器和部署边界。
- 完整更新 README、架构、代码结构、生命周期和 Spotify SDK 文档。
- 保留 Shadow DOM Presence、Spotify PKCE、MusicProvider、歌单、聊天、记忆和跨页面播放能力。
- 集中 Extension/Playback Host 协议，内聚 Spotify OAuth，并拆分 Host 协议层与 SDK 设备层。
- 按 `apps/extension`、`apps/player-host`、`apps/api`、`packages/domain` 和 `packages/contracts` 完成前后端分类。
- Extension UI 进一步拆分为 `content`、`mori`、`player` 与 `chat` 产品模块。
