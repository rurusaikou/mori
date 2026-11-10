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
├── CompanionService ───── Agent 请求、对话持久化与用户授权记忆
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

CompanionService ── POST /agent/run ── Mori Agent
                                      ├── search_memory
                                      ├── get_music_context
                                      └── search_music（用户曲库候选）
```

Extension 和 Player Host 只共享 `packages/contracts/playback-host.ts` 中的纯类型、消息源常量与命令定义。音乐、对话和记忆领域类型来自 `packages/domain/`，共享包不包含浏览器运行时实现。

## 3. 核心状态

### PlaybackState

`MusicController` 持有唯一播放快照。SDK 或 Web API 的结果必须先进入 Controller，再写入 `chrome.storage.session` 并广播。Content UI 不自行伪造播放成功。

### Presence

Presence 开关和归一化位置存储在 `chrome.storage.local`。普通 HTTP(S) 页面预先注入轻量 content script；只有开关开启时才渲染 Mori。因此刷新、跨站导航、新标签页和浏览器重启后都能恢复。

关闭 Presence 是后台统一动作：工具栏或 Panel 发出 `MORI_CLOSE` 后，`MusicController` 先暂停活动播放，`PresenceController` 再持久化关闭并广播所有已注入标签页。单个页面不能只隐藏自己的 React UI；暂停失败也不能阻止全局关闭。

Mori 本体是固定 viewport 锚点，Panel 是相对锚点绝对定位的独立层。Panel 展开方向由锚点所在象限决定，并经过 16px viewport 边界碰撞修正；Panel 不进入 Mori 的布局盒，因此展开、收起和功能页变化不会改变锚点坐标。

Mini Player 与 Full Panel 都提供设置入口，并在同一锚点内切换到 Mori 的应用设置视图。音乐品味画像属于 `settings/`；OAuth、Client ID、Playback Host 和 Mori API URL 等开发配置仍属于独立 `options/`，两者不混用。

### 音乐偏好

`SpotifyMusicProvider` 分页读取 Saved Tracks 与全部可读取普通歌单，先按 ISRC 或歌名/歌手全局去重，再将样本上限计算为去重歌曲总数的 20%（结果向上取整）。最终样本中，Saved Tracks 使用 50% 名额，其余 50% 在普通歌单间平均分配。某个歌单样本不足时不重复歌曲补位。`MusicPreferenceService` 在后台维护单一分析任务和 `idle / analyzing / succeeded / failed` 状态，因此 UI 离开后任务继续，重新进入可恢复状态且不会重复提交。

Extension 将样本发送到 Mori API；API 使用服务端 `MELODATA_API_KEY` 查询音频特征，并按 ISRC 持久化到 `apps/api/data/music-features.json`。重新分析先读取缓存，只请求缺失特征。最终 `MusicPreferenceProfile` 写入 `chrome.storage.local`。

### 对话与记忆

`CompanionService` 将当前歌曲、最近对话、用户主动保存的 Moment 摘要和受限曲库候选发送到 `/agent/run`。LLM Key 只存在于 API；Spotify Token、封面和音频不进入 Agent。API 不可用时 Extension 返回明确降级文案。

Moment 不是 Agent Tool，只有用户主动点击时才保存。Agent 请求播放时只能选择 Extension 提供的候选 URI；Extension 再次校验后由 `MusicController` 执行，模型不能直接访问 Spotify。对话与 Moment 当前仍保存在 `chrome.storage.local`，尚无用户身份、跨设备同步或真实 Memory DB。

### Spotify 曲库缓存

歌单与歌曲 metadata 使用 `chrome.storage.session` 保存 60 分钟缓存，由 Provider 统一读写。过期缓存采用 stale-while-revalidate：先立即返回旧数据，再在后台刷新。缓存跨页面和 Service Worker 暂停恢复，但不跨浏览器会话；明确刷新、重新授权、账号变化或断开账号时清除。

首次建立缓存时，以最多四个并发请求预检每个普通歌单的内容访问权限；明确的 403/404 在列表首次展示前标记为不可用。暂时性网络错误和限流不会让歌单被错误置灰。

## 4. 安全边界

- OAuth 使用 Authorization Code + PKCE，不使用 Client Secret。
- Token 仅由 trusted Extension contexts 访问；storage 对 content script 设置为 `TRUSTED_CONTEXTS`。
- `MELODATA_API_KEY` 只存在于 Mori API 进程环境变量，不进入 Extension bundle 或 Chrome Storage。
- 本地 Mori API 拒绝普通网页 Origin，只接受 `chrome-extension://` 浏览器请求和无 Origin 的 CLI 诊断；JSON 请求体限制为 2 MiB。该限制用于保护本地开发服务，不能替代生产身份认证。
- Content Script 运行在 Shadow DOM 中，不把凭据注入宿主页面。
- Playback Host 只在内存中接收短期 access token，不写入 storage，也不回传 token；offscreen 同时校验 iframe window 与配置 origin，并定向发送敏感消息。
- 生产 Playback Host 必须是 HTTPS，并配置限制性的 CSP 与 `frame-ancestors`。
- Mori 不下载、代理、缓存或修改 Spotify 音频。

## 5. 生命周期

Service Worker 可能随时挂起，所以持久状态不能只放内存。音频不能放在 popup 或 content script：popup 会在失焦时关闭，content script 会随导航销毁。Provider 在需要播放时确保 offscreen document 存在；offscreen document 再维护 Playback Host iframe。

Chrome 因长时间没有音频活动而回收 offscreen document 后，下一次播放命令会重新创建完整链路。

## 6. MusicProvider 抽象

UI 不直接调用 Spotify SDK。`MusicProvider` 提供：

- 连接与断开；
- 获取播放状态；
- 播放、暂停、上一首、下一首；
- 设置随机与循环播放模式；
- 获取、刷新和查询缓存中的用户歌单与歌曲；
- 获取用于音乐偏好分析的去重曲库样本；
- 播放 Spotify URI；

新增 Apple Music、YouTube Music 等 Provider 时应实现相同边界，不在 React 组件中增加平台 SDK 分支。

## 7. 构建与部署

- Extension 由 esbuild 分上下文构建：service worker 为 ESM，content/offscreen 为 IIFE，options 为 ESM。
- Playback Host 构建成静态 `index.html + player.js`，本地开发服务器提供 `/playback-host/`。
- Chrome 开发模式加载 `apps/extension/`；目录迁移后需要重新登记新的 Spotify Redirect URI。
- 生产环境部署 `apps/player-host/dist/` 到 HTTPS，再在 Extension 设置中配置 URL。
- 本地音乐偏好服务通过 `pnpm dev:api` 启动，默认地址为 `http://127.0.0.1:3211`；生产环境必须替换为 HTTPS API。


