# Spotify Web Playback SDK

## 核心结论

Web Playback SDK 把 Mori Playback Host 注册成 Spotify Connect 设备。声音由 Host 所在浏览器输出，但播放会话仍属于用户的 Spotify 账号。

要求与限制：

- 播放能力要求 Spotify Premium。
- SDK 需要支持 EME/DRM 的正常安全 Web Origin。
- 跨域 iframe 必须允许 `autoplay` 和 `encrypted-media`。
- 浏览器 autoplay policy 可能要求额外用户手势。
- Mori 不能下载、代理、修改或建立脱离 Spotify Connect 的音频会话。

## Mori 的实现

SDK 不运行在 content script、service worker 或 Extension sandbox。它运行在独立 `apps/player-host/` 静态应用中：

```text
Extension Provider
  → Offscreen Document
  → Playback Host iframe
  → Spotify Web Playback SDK
  → Mori Connect device
```

Playback Host：

- 动态加载 `https://sdk.scdn.co/spotify-player.js`；
- 在 `connect()` 前注册 ready/error listeners，避免丢失快速失败事件；
- 只在内存中保存当前 access token；
- 通过带 window/origin 校验的 `postMessage` 接收设备初始化和用户手势激活命令；
- 将 ready、not_ready、state 和 error 事件发送回 Extension。

`player.ts` 只处理跨窗口协议，`spotify-player.ts` 封装 SDK 生命周期；二者与 Extension 共用 `packages/contracts/playback-host.ts`，避免命令和事件结构漂移。

## 状态同步

Spotify 官方客户端与 Mori 控制的是同一账号播放会话。任一设备暂停或切歌都会改变真实状态。Mori 必须接收 `player_state_changed` 并更新 UI，不能通过忽略事件伪造独立播放。

实际的播放、暂停和切歌统一由 Spotify Web API 按 `device_id` 执行。这样 Mori 自建设备与 Spotify Connect 回退设备使用同一条控制路径；SDK Host 只承担设备、音频和状态事件，不重复实现另一套控制逻辑。

## 部署

`pnpm build:host` 生成 `apps/player-host/dist/`。生产服务器必须：

- 使用 HTTPS；
- 正确返回 `index.html` 与 `player.js`；
- CSP 的 `connect-src` 允许 `'self'`、本地开发 Host、Spotify HTTPS/WSS；同时允许 SDK 脚本、SDK 内部的 `https://sdk.scdn.co/embedded/index.html` iframe、媒体 blob 和 worker blob；
- 页面样式由独立 `player.css` 提供，并通过 `style-src 'self'` 加载，不使用会被 CSP 拦截的内联 `<style>`；
- `frame-ancestors` 只允许预期的 Extension Origin；
- 不在服务端记录 URL、body 或消息中的 OAuth token。

本地开发运行 `pnpm dev:host`，默认 URL 为 `http://127.0.0.1:3210/playback-host/`。

## 官方资料

- [Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk)
- [Web Playback SDK Reference](https://developer.spotify.com/documentation/web-playback-sdk/reference)
- [Spotify Web API Player](https://developer.spotify.com/documentation/web-api/reference/#category-player)
- [Spotify Developer Policy](https://developer.spotify.com/policy)

