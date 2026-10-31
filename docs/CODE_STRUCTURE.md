# Mori 代码结构

```text
apps/
├── extension/                       # Chrome Extension 前端
│   ├── manifest.json
│   └── src/
│       ├── background/              # Service Worker 与 Controller
│       ├── chat/                    # 聊天面板
│       ├── companion/               # 本地对话与记忆 fallback
│       ├── content/                 # Shadow DOM 注入入口与隔离样式
│       ├── mori/                    # Mori 本体、手势与视觉状态
│       ├── offscreen/               # Player Host iframe 桥
│       ├── options/                 # Extension 设置
│       ├── player/                  # 播放卡片与歌单面板
│       ├── providers/spotify/       # Spotify OAuth、API、Provider
│       ├── shared/                  # Extension 内消息与客户端
│       └── storage/                 # Chrome Storage
│
├── player-host/                     # Spotify 播放前端
│   ├── index.html
│   ├── player.css                   # Host 独立样式（满足 CSP）
│   └── src/
│       ├── player.ts                # 跨窗口协议入口
│       └── spotify-player.ts        # SDK 与设备生命周期
│
└── api/                             # 生产后端边界
    └── README.md                    # 当前尚未实现服务

packages/
├── domain/
│   ├── music.ts                     # MusicProvider 与播放领域
│   ├── companion.ts                 # 对话与记忆领域
│   └── index.ts
└── contracts/
    └── playback-host.ts             # Extension/Host 播放协议

scripts/
├── build-extension.mjs
└── build-playback-host.mjs
```

## 前端应用

`apps/extension` 是产品主前端。Content Script 负责注入，Service Worker 负责 Chrome 生命周期与业务编排，React 组件只展示状态和发送意图。

`apps/player-host` 是特殊播放前端，运行 Spotify Web Playback SDK 和 DRM/EME。它不保存业务数据，也不访问 Chrome Extension API。

## 后端

`apps/api` 是明确的服务端边界。当前 MVP 仍使用 Extension trusted context 完成 Spotify PKCE、本地对话和记忆，因此没有创建假的 API Server。未来身份、Refresh Token、AI、数据库和同步代码只能进入此目录。

## 共享包

`packages/domain` 只包含平台无关的领域类型。`packages/contracts` 只包含跨应用协议。两者不得 import React、Chrome API、DOM、数据库或 Provider SDK。

TypeScript 使用 `@mori/domain` 和 `@mori/contracts/playback-host`，避免应用间使用多层相对路径。

## 核心文件

| 文件 | 责任 |
|---|---|
| `apps/extension/src/background/service-worker.ts` | Extension 消息入口与编排 |
| `apps/extension/src/background/music-controller.ts` | 唯一 PlaybackState 与广播 |
| `apps/extension/src/background/presence-controller.ts` | Toolbar、可见性与注入恢复 |
| `apps/extension/src/providers/spotify/spotify-provider.ts` | MusicProvider、设备与 offscreen |
| `apps/extension/src/providers/spotify/spotify-auth.ts` | Spotify PKCE 与 Token 刷新 |
| `apps/extension/src/content/index.tsx` | Shadow DOM 注入入口 |
| `apps/extension/src/mori/MoriPresence.tsx` | Mori 手势与页面状态 |
| `apps/extension/src/player/PlayerCard.tsx` | 三页主面板与固定底部播放条 |
| `apps/extension/src/player/PlaylistPanel.tsx` | Spotify 歌单与歌曲 |
| `apps/extension/src/chat/ChatPanel.tsx` | 对话记录与输入 |
| `apps/extension/src/companion/MomentPanel.tsx` | 用户授权保存的音乐瞬间 |
| `apps/extension/src/offscreen/offscreen.ts` | Player Host 生命周期与消息转发 |
| `apps/player-host/src/player.ts` | Host 协议与 Origin 锁定 |
| `apps/player-host/src/spotify-player.ts` | Spotify SDK 与 Connect 设备 |
| `packages/domain/music.ts` | 音乐领域模型与 Provider 接口 |
| `packages/contracts/playback-host.ts` | 两个前端共享的播放协议 |

## 依赖方向

```text
apps/extension ───────┐
                      ├──▶ packages/domain
apps/api（未来）──────┤
                      └──▶ packages/contracts ◀── apps/player-host

Extension Content → Background → SpotifyProvider
                                  ↓
                              Offscreen → Player Host
```

禁止：

- Content Script 直接读取 Token 或调用 Spotify API；
- Player Host 访问 Chrome Extension API；
- 共享包依赖任何应用实现；
- 前端直接访问未来数据库；
- AI Key 或 Spotify Refresh Token 进入 Content Script；
- 手工修改 `apps/extension/build/` 或 `apps/player-host/dist/`。
