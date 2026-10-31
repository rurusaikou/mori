# Mori Extension

Chrome Manifest V3 Extension 源码。Chrome 开发模式加载本目录，构建脚本把运行文件写入被忽略的 `build/`。

## 开发

```bash
pnpm dev
pnpm dev:host   # 另一个终端
```

Extension 由四个运行上下文组成：

- Service Worker：状态、OAuth、Provider 与消息编排；
- Content Script + Shadow DOM：网页上的 Mori UI；
- Options：Client ID、Playback Host URL 与连接设置；
- Offscreen Document：跨 tab 维护远程 Playback Host iframe。

Spotify SDK 不在 Extension 中执行；它属于同级独立前端 `apps/player-host/`。
Spotify OAuth 与 REST API 都内聚在 `src/providers/spotify/`；Content 与 Options 通过 `src/shared/runtime-client.ts` 调用后台。

UI 按产品能力拆分：`content/` 只注入 Shadow DOM，`mori/` 管理角色与手势，`player/` 管理播放和歌单，`chat/` 管理对话。

