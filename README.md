# Mori

Mori 是悬浮在浏览器中的 AI 音乐知音伙伴。Spotify 是当前 Music Provider；Mori 提供跨网页常驻角色、播放控制、歌单浏览、对话和经用户允许保存的音乐记忆。

本仓库按前端应用、后端边界和共享包分类，不再包含 Electron、Desktop UI、Soloist 或 Next.js 应用。

## 目录

```text
apps/
├── extension/       Chrome Manifest V3 前端
├── player-host/     Spotify Web Playback SDK 播放前端
└── api/             Mori 生产后端边界（待实现）
packages/
├── domain/          音乐、对话、记忆领域模型
└── contracts/       跨应用播放协议
scripts/             构建和本地开发脚本
docs/                产品、前后端架构与 Spotify 文档
```

## 本地开发

```bash
pnpm install
pnpm dev          # 终端 1：监听 Extension
pnpm dev:host     # 终端 2：启动 http://127.0.0.1:3210/playback-host/
```

然后：

1. 打开 `chrome://extensions` 并开启开发者模式。
2. 选择“加载已解压的扩展程序”，加载仓库中的 `apps/extension/`，不要加载 `apps/extension/build/`。
3. 打开 Mori 设置，将显示的 Redirect URI 注册到 Spotify Developer Dashboard。
4. 填写 Spotify Client ID；本地 Playback Host 保持默认地址；连接 Spotify Premium 账号。
5. 打开任意普通 HTTP(S) 页面，点击工具栏 Mori 图标。

代码更新后需要在 `chrome://extensions` 重新加载扩展，并刷新测试网页。

## 命令

| 命令 | 用途 |
|---|---|
| `pnpm dev` | 监听 Extension bundle |
| `pnpm dev:host` | 监听并提供本地 Playback Host |
| `pnpm build` | 构建 Extension 与 Playback Host |
| `pnpm build:extension` | 只构建 Extension |
| `pnpm build:host` | 只构建 Playback Host |
| `pnpm check` | TypeScript、两个构建和基础完整性检查 |

构建产物位于 `apps/extension/build/` 和 `apps/player-host/dist/`，均不提交 Git。

## 运行架构

```text
Toolbar / Content UI
        │
        ▼
Background Service Worker
├── PresenceController
├── MusicController
├── SpotifyMusicProvider
├── CompanionService
└── ExtensionStorage
        │
        ├── Content Script → Shadow DOM → Mori UI
        └── Offscreen Document → HTTPS Playback Host → Spotify Web Playback SDK
```

Content Script 不读取 Spotify DOM，也不持有 OAuth Token。Background 是播放状态和凭据的唯一可信边界。Playback Host 只在内存中使用短期 access token，用正常 Web Origin 承载 Spotify DRM/EME 和音频。

生产环境必须将 `apps/player-host/dist/` 部署到 HTTPS，并在 Mori 设置中填写部署地址。Spotify Web Playback SDK 要求 Premium，正式分发还必须遵守 Spotify Developer Policy。

## 文档

- [产品定义](docs/PRODUCT.md)
- [项目架构](docs/ARCHITECTURE.md)
- [代码结构](docs/CODE_STRUCTURE.md)
- [代码实现说明](docs/IMPLEMENTATION.md)
- [后端边界](docs/BACKEND.md)
- [Extension 生命周期与消息流](docs/BROWSER_EXTENSION_ARCHITECTURE.md)
- [Spotify Web Playback SDK](docs/SPOTIFY_WEB_PLAYBACK_SDK.md)

