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

UI 按产品能力拆分：`content/` 只注入 Shadow DOM，`mori/` 管理角色与手势，`player/` 管理播放和歌单，`chat/` 管理对话，`settings/` 管理 Mori 内部设置。`options/` 只承担 OAuth 与 Playback Host 等技术配置。

播放控制遵循 `UI → RuntimeRequest → MusicController → MusicProvider`。UI 不直接调用 Spotify；耗时的播放/切歌请求先快速确认，最终结果通过 PlaybackState 广播。普通歌单使用 Spotify context，Saved Tracks 的前后导航队列保存在 `chrome.storage.session`，进度拖动只在松手时提交一次 seek。

