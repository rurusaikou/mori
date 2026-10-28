# Mori 项目架构

本文档说明 Mori macOS 桌面 MVP 的运行边界、核心模块、数据流和当前技术决策。具体文件职责见 [CODE_STRUCTURE.md](CODE_STRUCTURE.md)，桌面播放方案见 [SPOTIFY_SOLOIST_RESEARCH.md](SPOTIFY_SOLOIST_RESEARCH.md)。

## 1. 架构目标

当前架构服务于一个可直接开发验证的 macOS MVP：保留 Mori 的角色、陪伴与记忆原型，同时接入真实 Spotify 授权和播放。现阶段优先保证状态一致、开发速度和边界清晰，尚未覆盖 `.app` 分发、签名、公证和多用户云同步。

## 2. 运行结构

```text
macOS
└── Electron 主进程
    ├── WindowManager 管理 Player / Presence / Conversation
    ├── Soloist Process → Local WebSocket → MusicService
    ├── 把外部链接交给系统浏览器
    └── 加载 http://127.0.0.1:3210
        └── Next.js 本地服务与渲染层
            ├── React / Mori UI 与前端状态
            ├── Route Handlers
            ├── Spotify Web API / Shared Music Context
            └── 本机 data/*.json
```

Electron 目前负责桌面窗口生命周期和 Soloist 播放服务。`SoloistAdapter` 只连接回环 WebSocket，`MusicService` 保存统一播放快照，再通过受限 IPC 广播给渲染层；UI 不接触 Soloist API Key、端口或原始协议。Next.js 仍作为本地服务存在，是因为音乐画像、特征缓存和收听历史已经通过 Route Handlers 读写。

## 3. 进程与安全边界

### Electron 主进程

`electron-main.mjs` 启动后创建独立 Player 与透明 Presence；Conversation 由点击 Presence 或 Player 中的 Mori 入口按需创建。`WindowManager` 以窗口类型为唯一键，重复打开只聚焦现有实例，并把每个窗口的 bounds 保存到 Electron `userData/window-state.json`。Presence 为无边框透明常驻窗口，Player 与 Conversation 使用 macOS 隐藏式标题栏。

所有窗口均启用 `contextIsolation` 与 `sandbox`。`electron-preload.cjs` 只暴露白名单窗口操作和音乐命令；渲染层没有 Node、任意 WebSocket、进程或密钥权限。Electron 主进程单独读取 `.env.local` 中的 Soloist 配置，API Key 不使用 `NEXT_PUBLIC_`，也不会通过 preload 进入渲染层。

`electron-dev.mjs` 仅用于本地开发：先启动 Next.js，确认本地地址可访问，再打开 Electron；窗口退出时同时回收本地服务。

### Next.js 渲染与本地服务

- `app/` 提供页面入口、Spotify OAuth 回调和本地 API。
- `components/mori/` 提供桌面外壳、业务页面和全局状态。
- `lib/` 提供 Spotify 接入、缓存、画像计算和 JSON 数据访问。

渲染层可访问 Spotify Token，因此当前实现只适合作为本机 MVP。正式分发前应把 Token 迁移到 macOS Keychain，并重新评估本地服务端口、CSP 与协议回调方案。

## 4. 核心状态边界

| 状态 | 所属模块 | 生命周期 |
|---|---|---|
| 页面导航、聊天、临时记忆与提示 | `MoriProvider` | 当前窗口会话；聊天、草稿和记忆写入 `localStorage` |
| Spotify 用户与歌单 | `SpotifyProvider` | 当前窗口会话，来自 Spotify Web API |
| 当前歌曲、进度、队列与播放状态 | 主进程 `MusicService` + 渲染层 `MusicProvider` | 应用进程生命周期，随 Soloist 事件同步 |
| Spotify OAuth Token | `lib/spotify.ts` | 当前本机 `localStorage` |
| 歌单曲目缓存 | `spotify-track-cache.ts` | 内存与 `sessionStorage`，默认 24 小时 |
| 音乐特征、画像、收听历史 | Route Handlers + `music-data-store.ts` | 本机 `data/*.json` |

业务页面不应各自维护另一份“当前播放歌曲”。完整播放器、首页与 Mini Player 都以 `MusicProvider` 的状态为准；`SpotifyProvider` 只负责账号和音乐库。页面内部状态只负责本页面的选择、加载和展示。

## 5. 关键数据流

### 启动

1. `pnpm dev` 启动 `electron-dev.mjs`。
2. 开发启动器启动 `127.0.0.1:3210` 上的 Next.js。
3. 本地服务就绪后，Electron 主进程读取 Soloist 配置并恢复窗口位置。
4. Electron 分别以 `?window=player`、`?window=presence`、`?window=conversation` 加载同一渲染入口。
5. 各窗口的 `MusicProvider` 从同一个主进程 `MusicService` 获取快照；React Provider 恢复本地 Token、聊天、记忆和可用缓存。

### Spotify 授权

1. 渲染层生成 PKCE verifier、challenge 与 state。
2. 用户在 Spotify 授权页面登录。
3. Spotify 回调 `/spotify/callback`，应用校验 state 并交换 Token。
4. Token 保存在本机，随后读取用户信息和歌单。

项目不保存 Spotify 密码，也不使用 Client Secret。开源使用者需要创建自己的 Spotify Developer 应用和 Client ID。

### 播放与同步

1. Electron 主进程使用用户提供的官方 Soloist 可执行文件和个人 API Key 启动本机播放进程。
2. Soloist 通过回环 WebSocket 发送 `auth_state`、`playback_state`、`track_changed`、`position_sync` 和 `queue_changed`。
3. `SoloistAdapter` 解析协议，`MusicService` 转换并保存统一音乐快照。
4. preload 将白名单命令送入 MusicService，并向所有渲染窗口广播状态。
5. `MusicProvider` 向 Player、播放页和陪伴界面提供同一状态；事件间进度只在 UI 中插值，新的 `position_sync` 会重新校准。

Mori 不下载、代理或解密 Spotify 音频。真实音频由 Spotify Soloist 输出；首次使用必须由用户在 Spotify 官方客户端中选择 Mori 设备完成 Connect 配对。

### 本地数据

Route Handlers 通过 `lib/server/music-data-store.ts` 串行化写操作，并使用临时文件替换目标文件，降低并发写入和中途退出造成 JSON 损坏的风险。`data/` 被 Git 忽略，因为它包含每位使用者的本机数据。

## 6. 已确定的技术决策

- 项目整体面向 macOS，不再把桌面端作为 `desktop/` 子项目维护。
- Electron 桌面播放统一使用 Spotify Soloist，不再依赖 Web Playback SDK 的 Widevine/EME 环境。
- 保留 Next.js 本地服务，先复用现有 Route Handlers；打包阶段再决定采用独立本地进程或 Electron 主进程适配层。
- Electron preload 只提供三种已知窗口的打开/关闭和白名单音乐命令；其他原生能力仍需按具体功能增加最小化、可审计的 IPC。
- Phase 2 只实现 Player、Presence、Conversation。Playlist/Dock 属于 Phase 3，Lyrics、Magnet 与 Snap 属于 Phase 4。
- 当前数据本地优先，不把聊天、心情或私人歌单发送到未声明的第三方服务。

## 7. 发布前缺口

- macOS `.app` 打包、应用图标、签名、公证和自动更新。
- 生产环境本地服务的启动、端口冲突处理与健康检查。
- Spotify OAuth 的桌面回调策略和 Token Keychain 存储。
- Content Security Policy、权限审计和依赖审计。
- 用户数据导出、删除、迁移和损坏恢复。
- 真实 AI 服务的服务端密钥隔离、内容边界和成本控制。

