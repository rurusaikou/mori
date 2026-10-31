# Browser Extension 生命周期与实现逻辑

## 1. 召唤 Mori

1. 用户点击 Toolbar Action。
2. Service Worker 等待 storage 恢复完成。
3. `PresenceController` 切换全局开关。
4. 已注入的 tabs 收到 `MORI_SET_VISIBILITY`；缺少 content script 的普通页面会补注入。
5. Content Script 在 Shadow DOM 中渲染 Mori，不修改宿主 layout。

## 2. 角色交互

- 单击角色：播放/暂停。
- 拖动：更新视口内位置并保存归一化坐标；拖动阈值避免误触播放。
- 长按：展开 Mori 主面板。
- 主面板顶部在歌单、对话、瞬间三个页面间切换，不叠加多个浮层。
- 当前歌曲和播放控制固定在面板底部，切换功能页时不中断控制。
- 播放条最右侧显示当前播放模式；每次点击按顺序播放 → 歌曲随机 → 歌单循环 → 单曲循环 → 顺序播放循环切换，不打开额外菜单。
- 底部瞬间按钮保存当前歌曲与时刻，并切换到瞬间页提供反馈。
- 播放状态为 playing 时：切换 listening 动画。

## 3. Spotify 登录

1. Options 保存公开 Client ID 和 Playback Host URL。
2. `chrome.identity.launchWebAuthFlow` 发起 Authorization Code + PKCE。
3. Background 用 verifier 交换 token。
4. access/refresh token 写入受 trusted-context 限制的 `chrome.storage.local`。
5. API 调用前检查到期时间，必要时刷新 token。

## 4. 播放一首歌曲

```text
CompanionCard
  → MORI_PLAY_URI
Service Worker
  → 立即确认点击，避免长任务关闭消息通道
MusicController
  → SpotifyProvider.playUri
SpotifyProvider
  → ensure offscreen document
  → PLAYER_INIT(token, hostUrl)
Offscreen
  → iframe 加载 Playback Host
  → PLAYER_INIT(token)
Playback Host
  → Spotify.Player.connect()
  → ready(device_id)
SpotifyProvider
  → activateElement()
  → Web API: transfer playback
  → Web API: start playback(context_uri, offset.uri)
SDK state event
  → Offscreen → Service Worker → MusicController
  → storage.session → 所有 tabs
```

耗时的 SDK、DRM 和设备注册在后台继续执行。UI 立即显示“正在连接播放设备”，最终结果通过 `PlaybackState` 广播，而不是依赖原始 request promise 长时间保持。

这里的 `hostUrl` 只用于 Offscreen 创建 iframe；跨 Origin 发给 Playback Host 的 payload 只包含短期 token。`MORI_PLAY_URI` 来自歌单歌曲点击。直接单击 Mori 的播放按钮则恢复 Spotify 当前播放上下文；账号没有可恢复上下文时，需要先从 Mori 歌单选择歌曲，或在开发设置中填写测试 URI。

从歌单选择歌曲时必须同时传递歌单 `context_uri` 和所选歌曲 `offset.uri`。如果只发送单曲 `uris: [uri]`，Spotify 会创建只有一首歌的队列，随后上一首/下一首即使返回成功也没有相邻歌曲可切换。

## 5. 为什么需要 Playback Host

Manifest V3 Extension page 禁止远程执行 Spotify SDK；Extension sandbox 又使用 opaque origin，不能可靠承载 DRM/EME。Playback Host 是独立正常 Web Origin，专门运行官方 SDK。Offscreen document 只负责 iframe 生命周期和受控消息桥。

本地 Host 是 `http://127.0.0.1:3210/playback-host/`；localhost 被浏览器视为安全开发上下文。生产必须使用 HTTPS，URL 保留末尾斜杠以正确解析静态资源。

## 6. 设备策略

Provider 首先尝试创建 Mori Web Playback SDK 设备。若失败，再查询账户中的非受限 Spotify Connect 设备作为诊断性回退。两者都不可用时显示具体 SDK 原因以及 Connect 状态。

播放、暂停、上一首和下一首都通过 Spotify Web API 控制解析出的 `device_id`。因此回退到已有 Connect 设备时不会走一套残缺的 Host 命令。

Mori 的目标主路径是自己创建设备；官方客户端不是正常使用前置条件。

## 7. 页面切换

Content Script 属于单个 tab，导航后会重建；Playback Host 属于 offscreen document，不属于任何网页。只要 Chrome 保留 offscreen document，页面刷新、跨站导航和切换 tab 都不会终止音乐。若 Chrome 回收它，下一次播放命令会重建。

## 8. 错误模型

- `needs-auth`：未连接或 token 无法续期。
- `needs-premium`：SDK/播放权限要求 Premium。
- `needs-device`：Mori 设备和 Connect 回退均不可用。
- `autoplay-blocked`：浏览器要求新的用户手势。
- `provider-unavailable`：网络、Host、SDK、DRM 或 Spotify 服务异常。

原始 Chrome 消息通道错误必须转换成用户可执行的提示；Spotify HTTP 错误和网络层 `Failed to fetch` 必须区分。

