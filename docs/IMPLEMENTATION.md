# Mori 代码实现说明

本文解释当前代码如何协作，重点记录状态归属、消息路径和第三方限制。目录职责请先看 [CODE_STRUCTURE.md](CODE_STRUCTURE.md)，产品及系统边界请看 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 1. 启动与常驻

Chrome 从 `apps/extension/manifest.json` 启动 Manifest V3 Service Worker，并在普通 HTTP(S) 页面预注入 content bundle。Content Script 只创建 Shadow DOM 容器；是否渲染 Mori 由后台保存的全局 Presence 开关决定。

用户点击工具栏图标后：

1. `service-worker.ts` 等待 storage 恢复；
2. `PresenceController` 切换全局可见状态；
3. 后台向所有已打开标签广播 `MORI_SET_VISIBILITY`；
4. 新页面或刷新后的 content script 通过 `MORI_GET_PRESENCE_STATE` 恢复 Mori；
5. 拖动位置以归一化坐标保存，避免窗口尺寸变化后角色移出视口。

网页切换只会销毁该页的 Content Script，不会销毁后台维护的播放链路。

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

| 请求 | 处理者 | 结果传播方式 |
|---|---|---|
| `MORI_GET_STATE` | `MusicController` | 直接返回快照 |
| `MORI_TOGGLE_PLAYBACK` | `SpotifyMusicProvider` | 立即确认，完成后广播 PlaybackState |
| `MORI_PLAYBACK_COMMAND` | `SpotifyMusicProvider` | 等待 active device 切歌结果，再延迟刷新并广播 |
| `MORI_PLAY_URI` | `SpotifyMusicProvider` | 立即确认，完成后广播 |
| `MORI_GET_PLAYLISTS` / `MORI_GET_PLAYLIST_TRACKS` | Spotify Web API | 直接返回数据或错误 |
| `MORI_REFRESH_LIBRARY` | `SpotifyMusicProvider` | 清除曲库缓存并重新获取歌单 |
| `MORI_SEND_MESSAGE` / `MORI_SAVE_MEMORY` | `CompanionService` | 持久化后向 tabs 广播 |
| `PLAYBACK_EVENT` | `MusicController` | 仅接受 offscreen document 来源 |

初始化 DRM、创建设备和转移播放可能超过普通消息通道的稳定等待时间。因此播放写操作先返回 `{ accepted: true }`，最终成功或失败通过统一 PlaybackState 到达 UI，而不是让页面一直等待原请求。

## 4. Spotify 授权与存储

`spotify-auth.ts` 使用 Authorization Code + PKCE，因此 Extension 中不存在 Client Secret。公开 Client ID、access token 和 refresh token 当前存于 `chrome.storage.local`，但 Service Worker 启动时会把 storage access level 限制为 `TRUSTED_CONTEXTS`，Content Script 无法直接读取。

每次 Web API 请求前通过 `getValidAccessToken()` 检查有效期，并在不足一分钟时刷新。生产后端完成后，refresh token 应迁移到服务端加密保存；这项未来边界记录在 [BACKEND.md](BACKEND.md)。

歌单和歌曲 metadata 由 Provider 缓存在 `chrome.storage.session`，TTL 为 60 分钟。存在缓存时立即返回；超过 TTL 仍先返回旧数据，并在后台刷新（stale-while-revalidate）；没有缓存时才等待 Spotify。同一资源的并发请求复用一个 Promise。明确刷新、重新授权、账号变化或断开 Spotify 时清空缓存；浏览器关闭后由 session storage 自动清除。

歌曲 metadata 同时保存 Spotify 的可播放状态。本地歌曲、`is_playable=false` 或带 restrictions 的条目仍显示在歌单中，但 UI 置灰并禁用，避免用户点击后才收到失败。缓存 schema 变更时通过版本号自动忽略旧 session 数据。

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

SDK Host 只负责创建 Mori 设备、激活浏览器音频元素和上报 `player_state_changed`。播放、暂停、上一首、下一首、播放 URI 都由 Spotify Web API 按最终 `device_id` 执行。统一控制路径是为了保证 Mori 自建设备和 Connect 回退设备行为一致。

歌单歌曲播放使用 `{ context_uri: playlist.uri, offset: { uri: track.uri } }` 建立完整播放上下文，而不是 `{ uris: [track.uri] }` 的单曲队列。这样底部上一首/下一首才能沿当前歌单移动。

Spotify 官方播放接口只接受 album、artist、playlist 作为 `context_uri`；Saved Tracks 不是合法 context。Mori 对“我收藏的歌曲”使用当前已读取的可播放 URI 列表，并把用户所选歌曲旋转到队首后作为队列启动。

角色单击播放会尝试恢复 Spotify 当前播放上下文。若账号当前没有歌曲上下文，用户需要先从 Mori 的歌单面板选择歌曲；Options 中的测试 URI 只用于本地技术验证，不是生产推荐或默认歌单机制。

首次播放前调用 `activateElement()` 是浏览器 autoplay policy 的要求。页面切换后音频仍由 offscreen 中的 Host iframe 输出；Chrome 回收 offscreen document 后，下一次用户操作会重建它。

## 6. 播放状态真值

`MusicController` 是 Extension 内 PlaybackState 的唯一写入者：

- SDK 事件进入 `handleHostEvent()`；
- Web API 查询进入 `refreshFromProvider()`；
- 错误统一转换为用户可理解的 availability 与提示；
- 每次更新写入 `chrome.storage.session` 并广播到所有标签。

切歌或转移设备后，Spotify Web API 可能稍后才返回新状态，因此 Controller 延迟刷新。Web API 返回的 `device.id` 必须写回 PlaybackState，否则一次刷新会覆盖 SDK ready 事件保存的设备信息。

UI 只根据广播状态渲染 `idle`、`listening`、错误和当前歌曲，不自行假设命令已经成功。

展开后的 mini 主面板使用歌单、对话、瞬间三个互斥页面，底部播放条始终存在。上一首/下一首请求会等待 Spotify Web API 的真实结果；Provider 查询当前 active Connect device，而不是为切歌新建一个尚未激活的 Mori 设备。

底部歌曲封面使用圆形唱片形态并保留音乐符号；播放状态下只旋转唱片图片，暂停时停止。系统开启“减少动态效果”时不执行旋转动画。

播放条最右侧的模式按钮单击后依次切换顺序播放、歌曲随机、歌单循环和单曲循环，不打开弹出菜单。Spotify 本身把 shuffle 和 repeat 作为两个独立设置，Mori 将它们呈现为互斥模式：启用一种时同步关闭另一种。模式变更必须作用于当前 active device，并写回统一 PlaybackState。

播放条顶部显示歌曲进度。SDK/Web API 的 `progressMs` 是校准点；播放期间 UI 每秒本地推进并限制在 `durationMs` 内，新的播放状态事件到达后重新校准。

## 7. 对话与记忆

`CompanionService` 目前是本地 fallback，不是已接入的生产 AI：

- 对话保存在 `chrome.storage.local`；
- 只有用户明确触发保存时才写入音乐记忆；
- React 组件只保留当前需要展示的消息状态，记忆集合由后台持久化，不在页面重复维护无消费者副本。

未来接入 AI 后仍需经过后台或 API 层，不能把 AI Key、Spotify token 或数据库访问放进 Content Script。

## 8. Playback Host 协议与安全

`packages/contracts/playback-host.ts` 只定义两个 Host 命令：

- `PLAYER_INIT`：传入短期 access token，初始化或恢复设备；
- `PLAYER_ACTIVATE`：在用户手势链路中激活音频元素。

Host URL 只用于 Extension offscreen 配置 iframe，不进入跨 Origin Host payload。offscreen 发送消息时指定精确 `targetOrigin`，回包同时校验 iframe window 与 origin。Host 不持久化 token，也不会在回包中返回 token。

Playback Host 的 CSP 必须显式允许 `frame-src https://sdk.scdn.co`。官方 SDK 会在内部创建 `embedded/index.html` iframe；若只允许 SDK 脚本而阻止该 iframe，`connect()` 不一定立即报错，而会表现为 Mori 等待设备超时。`connect-src` 还必须包含 `'self'`；本地开发同时列出 `http://127.0.0.1:3210` 和 `http://localhost:3210`，避免 Host 自身连接被策略拦截。

## 9. 修改入口

- 调整 Mori 外观或手势：`apps/extension/src/mori/`
- 调整主面板、播放条或功能页：`apps/extension/src/player/`、`chat/`、`companion/MomentPanel.tsx`
- 调整全局播放行为：先改 `MusicProvider` / `MusicController`，不要在组件内增加 Spotify 分支
- 调整 Spotify API：`providers/spotify/spotify-web-api.ts`
- 调整 SDK 生命周期：`apps/player-host/src/spotify-player.ts`
- 修改 Extension/Host 消息：同步修改 `packages/contracts/playback-host.ts` 两端消费者
- 增加真正后端：只进入 `apps/api/`，并通过共享 contract 暴露接口

## 10. 验证

提交前至少运行：

```bash
pnpm check
```

该命令执行严格 TypeScript 检查（包含未使用变量/参数）、Extension 构建和 Playback Host 构建。涉及播放时还应手动验证：连接 Premium 账号、首次播放、暂停、切歌、选择歌单歌曲、刷新网页、切换标签，以及 Host 不可用时的错误提示或 Connect 回退。
