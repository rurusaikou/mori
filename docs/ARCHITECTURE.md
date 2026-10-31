# Mori 项目架构

## 1. 产品边界

Mori 是 Browser Extension，不是 Spotify Web Player 的附属 UI，也不是完整 Spotify Client。

- Spotify：账号、曲库、歌单、音频流、DRM 和 Connect 会话。
- Mori：悬浮陪伴、轻量播放交互、音乐对话和授权记忆。
- Playback Host：在正常 HTTPS Origin 中创建 Mori Spotify Connect 设备。

仓库不存在 Desktop/Electron 运行路径。前端位于 `apps/extension` 与 `apps/player-host`；后端边界位于 `apps/api`；跨应用纯类型位于 `packages/`。

## 2. 系统组件

```text
Chrome Toolbar
      │
      ▼
Service Worker
├── PresenceController ─── 显示开关、位置和跨标签恢复
├── MusicController ────── 唯一 PlaybackState、持久化、广播
├── SpotifyProvider ────── OAuth 后的音乐数据与播放操作
├── CompanionService ───── 对话与用户授权记忆
└── ExtensionStorage ───── local/session storage 边界
      │
      ├── tabs.sendMessage
      │      ▼
      │   Content Script → Shadow DOM → PresenceApp
      │
      └── runtime.sendMessage
             ▼
          Offscreen Document
             ▼ postMessage
          Playback Host
             ▼
          Spotify Web Playback SDK
```

Extension 和 Player Host 只共享 `packages/contracts/playback-host.ts` 中的纯类型、消息源常量与命令定义。音乐、对话和记忆领域类型来自 `packages/domain/`，共享包不包含浏览器运行时实现。

## 3. 核心状态

### PlaybackState

`MusicController` 持有唯一播放快照。SDK 或 Web API 的结果必须先进入 Controller，再写入 `chrome.storage.session` 并广播。Content UI 不自行伪造播放成功。

### Presence

Presence 开关和归一化位置存储在 `chrome.storage.local`。普通 HTTP(S) 页面预先注入轻量 content script；只有开关开启时才渲染 Mori。因此刷新、跨站导航、新标签页和浏览器重启后都能恢复。

### 对话与记忆

当前 `CompanionService` 是本地 fallback。对话和记忆保存在 `chrome.storage.local`；只有用户主动点击记忆操作时才保存音乐瞬间。未来 AI adapter 不得直接接触 OAuth Token 或 Spotify 音频。

生产后端将在 `apps/api` 实现用户身份、AI Provider、Spotify Refresh Token 和跨设备记忆。当前目录只记录边界，不伪造未完成的服务。

### Spotify 曲库缓存

歌单与歌曲 metadata 使用 `chrome.storage.session` 保存 60 分钟缓存，由 Provider 统一读写。过期缓存采用 stale-while-revalidate：先立即返回旧数据，再在后台刷新。缓存跨页面和 Service Worker 暂停恢复，但不跨浏览器会话；明确刷新、重新授权、账号变化或断开账号时清除。

首次建立缓存时，以最多四个并发请求预检每个普通歌单的内容访问权限；明确的 403/404 在列表首次展示前标记为不可用。暂时性网络错误和限流不会让歌单被错误置灰。

## 4. 安全边界

- OAuth 使用 Authorization Code + PKCE，不使用 Client Secret。
- Token 仅由 trusted Extension contexts 访问；storage 对 content script 设置为 `TRUSTED_CONTEXTS`。
- Content Script 运行在 Shadow DOM 中，不把凭据注入宿主页面。
- Playback Host 只在内存中接收短期 access token，不写入 storage，也不回传 token；offscreen 同时校验 iframe window 与配置 origin，并定向发送敏感消息。
- 生产 Playback Host 必须是 HTTPS，并配置限制性的 CSP 与 `frame-ancestors`。
- Mori 不下载、代理、缓存或修改 Spotify 音频。

## 5. 生命周期

Service Worker 可能随时挂起，所以持久状态不能只放内存。音频不能放在 popup 或 content script：popup 会在失焦时关闭，content script 会随导航销毁。Provider 在需要播放时确保 offscreen document 存在；offscreen document 再维护 Playback Host iframe。

Chrome 因静音回收 offscreen document 后，下一次播放命令会重新创建完整链路。

## 6. MusicProvider 抽象

UI 不直接调用 Spotify SDK。`MusicProvider` 提供：

- 连接与断开；
- 获取播放状态；
- 播放、暂停、上一首、下一首；
- 获取用户歌单和歌单歌曲；
- 播放 Spotify URI；
- capabilities 描述能力差异。

新增 Apple Music、YouTube Music 等 Provider 时应实现相同边界，不在 React 组件中增加平台 SDK 分支。

## 7. 构建与部署

- Extension 由 esbuild 分上下文构建：service worker 为 ESM，content/offscreen 为 IIFE，options 为 ESM。
- Playback Host 构建成静态 `index.html + player.js`，本地开发服务器提供 `/playback-host/`。
- Chrome 开发模式加载 `apps/extension/`；目录迁移后需要重新登记新的 Spotify Redirect URI。
- 生产环境部署 `apps/player-host/dist/` 到 HTTPS，再在 Extension 设置中配置 URL。

