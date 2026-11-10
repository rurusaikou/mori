# Mori 代码实现说明

本文解释当前代码如何协作，重点记录状态归属、消息路径和第三方限制。目录职责请先看 [CODE_STRUCTURE.md](CODE_STRUCTURE.md)，产品及系统边界请看 [ARCHITECTURE.md](ARCHITECTURE.md)，Spotify SDK 专属约束请看 [SPOTIFY_WEB_PLAYBACK_SDK.md](SPOTIFY_WEB_PLAYBACK_SDK.md)。

日志查看位置、事件名称和字段解释见 [LOGGING.md](LOGGING.md)。

## 1. 启动与常驻

Chrome 从 `apps/extension/manifest.json` 启动 Manifest V3 Service Worker，并在普通 HTTP(S) 页面预注入 content bundle。Content Script 只创建 Shadow DOM 容器；是否渲染 Mori 由后台保存的全局 Presence 开关决定。

用户点击工具栏图标后：

1. `service-worker.ts` 等待 storage 恢复；
2. `PresenceController` 切换全局可见状态；
3. 后台向所有已打开标签广播 `MORI_SET_VISIBILITY`；
4. 新页面或刷新后的 content script 通过 `MORI_GET_PRESENCE_STATE` 恢复 Mori；
5. 拖动位置以归一化坐标保存，避免窗口尺寸变化后角色移出视口。

Panel 定位不使用普通文档流。渲染后读取 Mori、Root 和 Panel 的 viewport rect：锚点在右半区时优先向左展开，在左半区时向右；下半区优先向上，上半区向下。首选坐标再 clamp 到 `[16px, viewport - panelSize - 16px]`，最后转换成相对 Root 的 absolute offset。拖动或窗口 resize 时重新计算，但从不修改 Mori 的位置状态。

Presence UI 有 `closed → mini → full` 三个层级。单击 Mori 只打开 Mini Player；Mini 的播放控件不会触发升级，点击其空白区域或更多按钮才进入 Full Panel。点击外部区域和 Full Panel 关闭按钮按层级逐步收回。Mini 与 Full 共用同一个定位容器，因此切换尺寸时重新碰撞计算但不改变锚点。

Mini Player 与 Full Panel 右上角共用设置入口。Mini 中点击齿轮会原地升级为 Full Panel 的设置视图；Full Panel 中点击齿轮直接切换视图。设置页属于 Mori 内部 UI，不打开 Chrome Options 页面。未来的数据管理、音乐品味等日常设置继续扩展 `settings/`；`options/` 只保留 Spotify OAuth 与 Playback Host 等技术配置。

网页切换只会销毁该页的 Content Script，不会销毁后台维护的播放链路。

Extension 更新或开发模式重新加载会使已打开页面中的旧 isolated world 失效。Service Worker 的 `runtime.onInstalled` 会遍历普通 HTTP(S) 标签并重新注入 content bundle；`content/index.tsx` 随后移除带标记的旧 Shadow DOM，再挂载连接新 runtime 的 Mori。若 Chrome 阻止自动注入，`runtime-client.ts` 会把 `Extension context invalidated` 转换为“刷新当前网页”的可执行提示。

## 2. 运行时分层

| 层 | 主要文件 | 责任 | 不负责 |
|---|---|---|---|
| 页面 UI | `content/`、`mori/`、`player/`、`chat/`、`companion/MomentPanel` | 展示状态、手势、发送用户意图 | Token、Spotify API、播放真值 |
| 后台编排 | `background/` | Presence、唯一播放状态、消息路由与广播 | 音频输出、React UI |
| Provider | `providers/spotify/` | OAuth、Web API、设备选择、MusicProvider 实现 | 页面布局 |
| 播放桥 | `offscreen/` | 保持 iframe 生命周期、校验 Origin、转发协议 | 业务状态与 Token 持久化 |
| 播放宿主 | `apps/player-host/` | 加载官方 SDK、创建 Connect 设备、输出音频 | Chrome API、业务数据存储 |
| 共享包 | `packages/` | 纯领域类型与跨应用协议 | 浏览器或 Provider 实现 |

依赖方向必须保持为 UI → Background → Provider；Content Script 不得绕过后台读取凭据或调用 Spotify。

## 3. 消息路由

`shared/messages.ts` 是 Extension 内消息入口。主要请求如下：

| 请求 | 业务路径 | 结果传播方式 |
|---|---|---|
| `MORI_GET_STATE` | `MusicController` | 直接返回快照 |
| `MORI_GET_PRESENCE_STATE` / `MORI_SAVE_POSITION` | `PresenceController` / `ExtensionStorage` | 返回可见性与位置，或确认位置已保存 |
| `MORI_CLOSE` | `MusicController → PresenceController` | 暂停活动播放、持久化全局关闭并广播全部标签页 |
| `MORI_CONNECT_SPOTIFY` / `MORI_DISCONNECT_SPOTIFY` | `MusicController → MusicProvider` | 等待授权或断开完成后返回连接状态 |
| `MORI_TOGGLE_PLAYBACK` | `MusicController → MusicProvider` | 立即确认，完成后广播 PlaybackState |
| `MORI_PLAYBACK_COMMAND` | `MusicController → MusicProvider` | 等待 active device 切歌结果，再延迟刷新并广播 |
| `MORI_SET_PLAYBACK_MODE` | `MusicController → MusicProvider` | 等待模式写入，再延迟刷新并广播 |
| `MORI_PLAY_URI` | `MusicController → MusicProvider` | 立即确认，完成后广播 |
| `MORI_GET_PLAYLISTS` / `MORI_GET_PLAYLIST_TRACKS` | `MusicController → MusicProvider` | 直接返回缓存或 Spotify 数据 |
| `MORI_GET_LIBRARY_CACHE_STATUS` | `MusicController → MusicProvider` | 返回 session 缓存是否存在 |
| `MORI_REFRESH_LIBRARY` | `MusicController → MusicProvider` | 清除曲库缓存并重新获取歌单 |
| `MORI_GET_COMPANION_DATA` | `CompanionService` | 直接返回本地对话与记忆 |
| `MORI_SEND_MESSAGE` | `CompanionService → /agent/run` | Agent 回复及可选播放动作完成后持久化并广播 |
| `MORI_SAVE_MEMORY` | `CompanionService` | 仅响应用户操作，持久化 Moment 后广播 |
| `MORI_GET_MUSIC_PREFERENCE` | `MusicPreferenceService` | 返回画像及后台分析任务状态 |
| `MORI_ANALYZE_MUSIC_PREFERENCE` | `MusicPreferenceService → Mori API` | 复用现有任务，完成后本地保存画像 |
| `PLAYBACK_EVENT` | `MusicController` | 仅接受 offscreen document 来源 |

后台播放状态、Presence 和 Companion 数据分别通过 `MORI_PLAYBACK_STATE`、`MORI_SET_VISIBILITY` 与 `MORI_COMPANION_DATA` 广播。广播使用 `Promise.allSettled`，因此 Chrome 内置页、未注入页面或更新前已打开的页面不会阻断其他标签同步。

关闭 Mori 是全局产品动作，不等同于收起面板。Full Panel 右上角关闭按钮和浏览器工具栏的关闭操作都进入 `MORI_CLOSE`：后台先尝试暂停当前 Spotify 播放，再把 Presence 写为关闭并向所有 HTTP(S) 标签广播。即使暂停因网络或设备失败，所有页面仍会关闭，并记录 `close_pause_failed`；下次重新开启从 closed Panel 状态开始。

初始化 DRM、创建设备和转移播放可能超过普通消息通道的稳定等待时间。因此播放写操作先返回 `{ accepted: true }`，最终成功或失败通过统一 PlaybackState 到达 UI，而不是让页面一直等待原请求。

## 4. Spotify 授权与存储

`spotify-auth.ts` 使用 Authorization Code + PKCE，因此 Extension 中不存在 Client Secret。公开 Client ID、access token 和 refresh token 当前存于 `chrome.storage.local`，但 Service Worker 启动时会把 storage access level 限制为 `TRUSTED_CONTEXTS`，Content Script 无法直接读取。

每次 Web API 请求前通过 `getValidAccessToken()` 检查有效期，并在不足一分钟时刷新。生产后端完成后，refresh token 应迁移到服务端加密保存；未来边界记录在 [`apps/api/README.md`](../apps/api/README.md)。

歌单和歌曲 metadata 由 Provider 缓存在 `chrome.storage.session`，TTL 为 60 分钟。存在缓存时立即返回；超过 TTL 仍先返回旧数据，并在后台刷新（stale-while-revalidate）；没有缓存时才等待 Spotify。同一资源的并发请求复用一个 Promise。明确刷新、重新授权、账号变化或断开 Spotify 时清空缓存；浏览器关闭后由 session storage 自动清除。

歌单 UI 在请求前显式查询后台 session 缓存状态。有缓存（包括 stale-while-revalidate 的过期缓存）就直接展示，不出现 Spotify 加载文案；只有没有缓存、确实需要等待网络时才显示“正在从 Spotify 同步”。

歌曲 metadata 同时保存 Spotify 的可播放状态。本地歌曲、`is_playable=false` 或带 restrictions 的条目仍显示在歌单中，但 UI 置灰并禁用，避免用户点击后才收到失败。缓存 schema 变更时通过版本号自动忽略旧 session 数据。

曲库缓存 v4 保存完整分页结果。升级时会忽略只包含前 50 首歌曲的旧缓存，避免音乐偏好样本上限低估实际去重曲库规模。

Spotify 的歌单列表不提供内容端点是否可读的字段。首次建立歌单缓存时，Mori 会对每个普通歌单读取一条内容进行权限预检；使用最多四个并发 worker，403/404 的歌单在首次展示时就置灰禁用。网络或限流错误不判定为不可用。后台 revalidate 保留不可用标记，只有明确刷新才重新尝试。`/me/playlists` 不包含用户的 Saved Tracks，因此 Provider 额外通过 `/me/tracks` 合成“我收藏的歌曲”入口。

## 5. 播放设备与控制路径

点击播放时，`SpotifyMusicProvider` 按以下顺序解析设备：

```text
Provider
  → 创建或恢复 offscreen document
  → offscreen 加载配置的 Playback Host
  → Host 加载 Spotify Web Playback SDK
  → SDK 注册 Mori Connect device
  → 返回 device_id
  → 若 Host 失败，查询已有非受限 Connect device
```

SDK Host 只负责创建 Mori 设备、激活浏览器音频元素、恢复本地音量和上报 `player_state_changed`。音量恢复发生在 Spotify 设备转移与播放命令完成之后，避免 Spotify 重新应用设备音量后出现“状态在播放但没有声音”。播放、暂停、上一首、下一首、播放 URI 都由 Spotify Web API 按最终 `device_id` 执行。统一控制路径是为了保证 Mori 自建设备和 Connect 回退设备行为一致。

歌单歌曲播放使用 `{ context_uri: playlist.uri, offset: { uri: track.uri } }` 建立完整播放上下文，而不是 `{ uris: [track.uri] }` 的单曲队列。这样控制栏的上一首/下一首才能沿当前歌单移动。

选歌消息同时携带目标歌曲 metadata。`MusicController` 在命令开始时先发布目标歌曲的 pending 快照，让顶部播放器立即与用户点击一致；设备转移期间 SDK 可能上报上一首歌的暂停快照，Controller 在目标 URI 确认前会忽略该旧快照。命令失败则恢复之前的真实播放快照并附带错误。offscreen document 存活期间复用已初始化的 Mori Spotify Device ID，避免每次点歌重复初始化 SDK；offscreen 被 Chrome 回收时自动清除缓存并重建。

Spotify 官方播放接口只接受 album、artist、playlist 作为 `context_uri`；Saved Tracks 不是合法 context。Mori 对“我收藏的歌曲”只提交用户明确选择的单个 URI，避免整列 `uris` 在设备同步或可播放性变化时自动跳到下一首。普通歌单仍使用原生 context，因此保留完整上一首/下一首能力。

角色或中央播放键会优先恢复 Spotify 当前播放上下文。若账号当前没有歌曲上下文，Provider 会随机排列可读取歌单，跳过空歌单或不可播放歌曲，再从首个有效歌单随机选歌。普通歌单使用原生 `context_uri`；Saved Tracks 将可播放 URI 从随机歌曲处旋转成队列，保证下一首/上一首仍有内容。只有曲库无法提供歌曲时才回退到 Options 测试 URI；测试 URI 仍只是本地技术验证机制。

首次播放前调用 `activateElement()` 是浏览器 autoplay policy 的要求。页面切换后音频仍由 offscreen 中的 Host iframe 输出；Chrome 回收 offscreen document 后，下一次用户操作会重建它。

播放错误统一映射为 `PlaybackState.availability`：未授权为 `needs-auth`，Premium 不可用为 `needs-premium`，没有设备为 `needs-device`，自动播放被拦截为 `autoplay-blocked`，其余网络、Host、SDK 或 DRM 问题为 `provider-unavailable`。原始 Chrome 消息通道错误会转换成用户可以执行的重试提示。

## 6. 播放状态真值

`MusicController` 是 Extension 内 PlaybackState 的唯一写入者：

- SDK 事件进入 `handleHostEvent()`；
- Web API 查询进入 `refreshFromProvider()`；
- 错误统一转换为用户可理解的 availability 与提示；
- 每次更新写入 `chrome.storage.session` 并广播到所有标签。

切歌或转移设备后，Spotify Web API 可能稍后才返回新状态，因此 Controller 延迟刷新。Host 的 SDK 事件与 Web API 刷新都必须先进入 Controller，不能由 UI 直接覆盖播放快照。

UI 只根据广播状态渲染 `idle`、`listening`、错误和当前歌曲，不自行假设命令已经成功。

Full Panel 按“标题 → 当前歌曲播放器 → Tab → 内容”排列。顶部播放器与 Mini Player 读取同一个 `PlaybackState`，所以升级为 Full Panel 只改变表现层，不重新初始化播放状态。上一首/下一首请求会等待 Spotify Web API 的真实结果；Provider 查询当前 active Connect device，而不是为切歌新建一个尚未激活的 Mori 设备。

Full Panel 使用 78px 歌曲封面、进度条和紧凑控制区；播放状态下封面转为圆形并旋转，暂停时停止。控制栏左侧 `✦` 是音乐记忆入口，播放模式位于下一首右侧，两者都不打开额外选择面板。系统开启“减少动态效果”时不执行旋转或脉冲动画。

Full Panel 高度固定在约 400px，并在小视口降至可用高度。歌单区域默认显示约三至四行并在内部滚动；切换对话或瞬间时仍使用同一面板边界，避免扩展成长页面级音乐应用。

播放器中的模式按钮单击后依次切换顺序播放、歌曲随机、歌单循环和单曲循环，不打开弹出菜单。Spotify 本身把 shuffle 和 repeat 作为两个独立设置，Mori 将它们呈现为互斥模式：启用一种时同步关闭另一种。模式变更必须作用于当前 active device，并写回统一 PlaybackState。

当前歌曲信息下方显示播放进度。SDK/Web API 的 `progressMs` 是校准点；播放期间 UI 每秒本地推进并限制在 `durationMs` 内，新的播放状态事件到达后重新校准。

## 7. 对话与记忆

正式聊天链路为：

```text
ChatPanel → MORI_SEND_MESSAGE → CompanionService
  → 组装当前歌曲 / 最近 12 条对话 / 最多 50 条 Moment 摘要
  → 播放意图时准备最多 500 首真实可播放曲库候选
  → POST /agent/run → 决策 → 可选 Tool → 最终回复
  → 可选 play_track 经 Extension 候选 URI 二次校验
  → MusicController.playUri
  → chrome.storage.local → MORI_COMPANION_DATA
```

普通聊天不加载曲库。正式 `search_music` 只搜索本次请求提供的真实候选；Playground 的 Mock 搜索不会进入产品链路。播放动作失败时回复明确失败原因，不伪造成功。API/LLM 不可用时使用透明降级文案。

对话最多本地保存 100 条，读取时清理旧版空消息。Moment 只有用户明确触发才写入；Agent 只能搜索摘要，不能创建或修改 Moment。React 只展示后台广播的数据，不持有 AI Key、Spotify Token 或数据库能力。

发送消息采用单请求串行，但不阻塞输入体验：提交后用户消息立即以 pending 状态进入时间线，输入框清空并保持焦点，同时显示 Mori“正在想”状态；后台回复到达后由持久化消息替换 pending。用户可以提前输入下一句，但上一请求完成前不能再次提交，避免本地慢模型导致回复顺序错乱。请求失败时恢复草稿并展示可读错误。

## 8. 音乐偏好分析与缓存

用户点击“开始分析”后，Extension 按以下流程工作：

```text
MusicPreferencePanel
  → MORI_ANALYZE_MUSIC_PREFERENCE
  → MusicPreferenceService（单一后台任务）
  → SpotifyMusicProvider 分页读取完整可用曲库
  → 按 ISRC 或歌名/歌手全局去重
  → 样本上限 = ceil(去重歌曲总数 × 20%)
  → Saved Tracks 分配样本名额的 50%
  → 其余样本名额在可读取普通歌单间平均分配
  → 按 ISRC 或歌名/歌手去重
  → POST Mori API /music-profile
  → 按 ISRC 查询 apps/api/data/music-features.json
  → 仅缺失项请求 MeloData
  → 聚合 MusicPreferenceProfile
  → chrome.storage.local
```

后台用一个共享 Promise 防止重复分析，并保存 `idle / analyzing / succeeded / failed` 状态。`MORI_ANALYZE_MUSIC_PREFERENCE` 只负责启动任务并立即确认，避免耗时分析占用 Chrome 消息通道；页面通过短生命周期的 `MORI_GET_MUSIC_PREFERENCE` 请求每秒读取进度。画像页面卸载不会主动取消请求，重新进入后仍会接入同一个后台任务；分析完成后停止轮询并展示画像。

`apps/api/src/services/music-portrait.mjs` 是独立的画像叙事生成边界。特征聚合完成后，它把 BPM、Energy、Danceability、Valence 标准化为 Rhythm、Energy、Groove、Mood 四项 0～100 分数，并通过 `mori-agent/shared/llm.mjs` 的统一 transport 调用模型。transport 默认使用 Responses API，也支持 Chat Completions；两种协议最终都解析成同一结构化结果。Schema 约束 `summary`、三项 `traits`、`listeningStyle` 和三个 `keywords`，服务端再次校验数量、文本长度和单行格式。五项可解释偏好及只读刻度始终由确定性规则生成；LLM 未配置、超时或返回非法格式时，特征分析仍成功并使用本地画像文案。

偏好 UI 由 `MusicPreferencePanel` 负责一次加载和共享状态，`MusicPreferenceOverview` 与 `MusicPreferenceDetail` 分别承担 What / Why。详情不使用 Accordion；`PlayerCard` 持有 overview/detail 导航状态，因此全局 Header 标题和返回键与内容层级一致。`MusicPreferenceDetail` 内三个 Tab 共享 Profile，不发起额外分析或 LLM 请求；只有 Detail 内容区可滚动，Tab 与 Panel Header 保持固定。

音乐偏好日志会记录用户触发、曲库抽样、逐批特征进度、最终聚合指标、画像来源，以及 LLM 调用前的四项标准化分数和成功后的摘要/特征/关键词。LLM 返回 `incomplete` 时同时记录 `incomplete_details.reason`，便于区分输出额度不足等原因；日志不包含 API Key、歌曲列表或用户身份。

普通歌单配额使用整数平分：每个歌单先取得 `floor(普通歌单预算 / 歌单数)` 个名额，不能整除的余数按歌单列表顺序各增加一个名额。每个歌单独立计数，跨歌单重复歌曲不会占用配额；歌曲不足时保留实际样本数，不复制歌曲或突破其他歌单的比例。

Mori API 每批最多并发处理五首；所有实际 MeloData HTTP 请求共用限速器，控制在每秒最多 4 次、每分钟最多 90 次，为 Free 套餐的 5 次/秒和 100 次/分钟保留余量。MeloData 地址由 composition root 通过必填的 `MELODATA_BASE_URL` 注入服务，业务代码不保留默认绝对地址。缓存命中不占请求槽，也不再承受固定批次等待。每个批次完成后将完整特征缓存写入唯一临时文件，再原子替换正式 JSON；因此进程中断不会留下半份缓存，已消耗额度的结果也不会因后续失败丢失。`apps/api/data/` 被 Git 忽略。

Spotify OAuth 连接状态必须通过后台 Token 判断，不能使用 `PlaybackState.availability` 代替；后者描述播放器可用性，即使已授权也可能暂时是设备或 Provider 错误状态。

## 9. 结构化日志

Extension 后台通过 `background/logger.ts` 向 Service Worker 控制台输出单行 JSON，并以 best-effort 方式转发到 Mori API `POST /logs`。API 不可用不会阻断业务操作。日志统一包含 `timestamp`、`level`、`category` 和 `event`，覆盖以下业务事件：

- Spotify 授权连接/断开和 SDK 播放设备 ready；
- 当前真正开始播放的歌曲变化，包括 URI、标题、歌手、时长和播放状态；SDK 初始化时上报的暂停旧快照不记为正在播放；
- 用户的 Presence、播放、切歌、模式、选歌、刷新曲库、分析、瞬间和聊天操作；
- 音乐偏好开始、任务复用、曲库采样完成、成功或失败；
- 瞬间保存的 ID、时间、备注与歌曲信息；
- 对话的用户文本、Mori 回复和关联歌曲 URI；
- Runtime 请求失败及可读错误。

Mori API 自身日志按日期写入 `apps/api/logs/api_YYYY-MM-DD.log`；Extension 转发日志按日期写入 `apps/api/logs/backend_YYYY-MM-DD.log`。落盘格式为“本地时间 + 级别 + category/event + 中文说明”，当天文件不存在时自动创建，存在时继续追加；写入按来源分别串行排队，避免并发事件互相覆盖。正常日志不输出终端，文件写入失败才使用 stderr 兜底。日志严禁包含 Spotify Token、MeloData Key 或请求 Authorization Header。

API 的 HTTP composition 位于 `apps/api/src/server.mjs`，Agent、Capability、日志和音乐画像路由位于 `routes/`，MeloData/Profile 与 Feature Store 位于 `services/`。根 `apps/api/server.mjs` 只保留稳定启动入口，因此 `pnpm dev:api` 和现有部署命令不变。正式浏览器接口在进入路由前拒绝非 Extension Origin，并在 JSON 解析时执行 2 MiB 上限；开发期 Lab/Playground 由各自路由执行生产环境关闭逻辑。

对话与瞬间日志包含用户内容，仅用于当前明确要求的本地开发诊断；生产环境接入集中式日志前必须增加用户授权、脱敏、保留期限和访问控制，不能默认上传这些内容。

## 10. Playback Host 协议与安全

`packages/contracts/playback-host.ts` 定义三个 Host 命令：

- `PLAYER_INIT`：传入短期 access token，初始化或恢复设备；
- `PLAYER_ACTIVATE`：在用户播放操作中激活音频元素；
- `PLAYER_SET_VOLUME`：播放开始后恢复 SDK 本地输出音量。

Host URL 只用于 Extension offscreen 配置 iframe，不进入跨 Origin Host payload。只有 `PLAYER_INIT` 携带短期 token，`PLAYER_SET_VOLUME` 只携带 0–1 的音量值。offscreen 发送消息时指定精确 `targetOrigin`，回包同时校验 iframe window 与 origin。Host 不持久化 token，也不会在回包中返回 token。

Playback Host 的 CSP 必须显式允许 `frame-src https://sdk.scdn.co`。官方 SDK 会在内部创建 `embedded/index.html` iframe；若只允许 SDK 脚本而阻止该 iframe，`connect()` 不一定立即报错，而会表现为 Mori 等待设备超时。`connect-src` 还必须包含 `'self'`；本地开发同时列出 `http://127.0.0.1:3210` 和 `http://localhost:3210`，避免 Host 自身连接被策略拦截。

## 11. 修改入口

- 调整 Mori 外观或手势：`apps/extension/src/mori/`
- 调整主面板、播放条或功能页：`apps/extension/src/player/`、`chat/`、`companion/MomentPanel.tsx`
- 增加数据管理、音乐品味等日常设置：`apps/extension/src/settings/`
- 调整音乐偏好采样或任务状态：`apps/extension/src/background/music-preference-service.ts`、`providers/spotify/spotify-provider.ts`
- 调整特征查询、MeloData 限流或持久化缓存：`apps/api/server.mjs`
- 调整 Extension 日志格式或脱敏：`apps/extension/src/background/logger.ts`
- 调整 OAuth、Client ID 或 Playback Host 技术配置：`apps/extension/src/options/`
- 调整全局播放行为：先改 `MusicProvider` / `MusicController`，不要在组件内增加 Spotify 分支
- 调整 Spotify API：`providers/spotify/spotify-web-api.ts`
- 调整 SDK 生命周期：`apps/player-host/src/spotify-player.ts`
- 修改 Extension/Host 消息：同步修改 `packages/contracts/playback-host.ts` 两端消费者
- 增加真正后端：只进入 `apps/api/`，并通过共享 contract 暴露接口

## 12. 验证

提交前至少运行：

```bash
pnpm check
```

该命令执行严格 TypeScript 检查（包含未使用变量/参数）、Extension 构建和 Playback Host 构建。涉及播放时还应手动验证：连接 Premium 账号、首次播放、暂停、切歌、选择歌单歌曲、刷新网页、切换标签，以及 Host 不可用时的错误提示或 Connect 回退。

