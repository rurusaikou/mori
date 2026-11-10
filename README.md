# Mori

Mori 是悬浮在浏览器中的 AI 音乐知音伙伴。Spotify 是当前 Music Provider；Mori 提供跨网页常驻角色、播放控制、歌单浏览、对话和经用户允许保存的音乐记忆。

文档入口：产品边界见 [PRODUCT.md](docs/PRODUCT.md)，系统架构见 [ARCHITECTURE.md](docs/ARCHITECTURE.md)，代码导航见 [CODE_STRUCTURE.md](docs/CODE_STRUCTURE.md)，运行逻辑见 [IMPLEMENTATION.md](docs/IMPLEMENTATION.md)。Agent 闭环见 [MORI_AGENT_PLAYGROUND_V0.1_2026-11-09.md](docs/MORI_AGENT_PLAYGROUND_V0.1_2026-11-09.md)，独立 Capability 见 [MORI_AGENT_V0_IMPLEMENTATION_2026-11-08.md](docs/MORI_AGENT_V0_IMPLEMENTATION_2026-11-08.md)。

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
pnpm dev:api      # 终端 3：从 .env.local 读取 MELODATA_API_KEY
```

然后：

1. 打开 `chrome://extensions` 并开启开发者模式。
2. 选择“加载已解压的扩展程序”，加载仓库中的 `apps/extension/`，不要加载 `apps/extension/build/`。
3. 打开 Mori 设置，将显示的 Redirect URI 注册到 Spotify Developer Dashboard。
4. 填写 Spotify Client ID；本地 Playback Host 保持默认地址；连接 Spotify Premium 账号。
5. 如需音乐偏好分析，启动本地 Mori API；密钥只配置在 API 进程，不填写到 Extension。
6. 打开任意普通 HTTP(S) 页面，点击工具栏 Mori 图标。

代码更新后需要在 `chrome://extensions` 重新加载扩展，并刷新测试网页。

## 命令

| 命令 | 用途 |
|---|---|
| `pnpm dev` | 监听 Extension bundle |
| `pnpm dev:host` | 监听并提供本地 Playback Host |
| `pnpm dev:api` | 监听并启动本地 Mori API（需要 `MELODATA_API_KEY`） |
| `pnpm build` | 构建 Extension 与 Playback Host |
| `pnpm build:extension` | 只构建 Extension |
| `pnpm build:host` | 只构建 Playback Host |
| `pnpm check` | TypeScript 检查并构建 Extension 与 Playback Host |

构建产物位于 `apps/extension/build/` 和 `apps/player-host/dist/`，均不提交 Git。

## 开发日志

- Mori API 自身日志按日期写入 `apps/api/logs/api_YYYY-MM-DD.log`；Extension 转发的 Spotify、当前歌曲、用户事件、瞬间和对话日志按日期写入 `apps/api/logs/backend_YYYY-MM-DD.log`。当天文件不存在时自动创建，存在时继续追加。
- 两个文件均为一行一条的中文可读日志，并保留 `[category/event]` 标识方便检索；文件被 Git 忽略，可使用 `tail -f` 查看。Extension 日志同时保留在 `chrome://extensions` → Mori → “Service Worker”检查视图。
- 日志不会输出 OAuth Token 或第三方 API Key；当前本地开发日志会包含对话和瞬间正文。

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

`docs/` 保存本地开发文档，按“产品定义 → 系统边界 → 代码位置 → 实现流程 → 第三方约束”分层；该目录不纳入版本控制。后端尚未实现的公开边界说明保留在 [apps/api/README.md](apps/api/README.md)。

