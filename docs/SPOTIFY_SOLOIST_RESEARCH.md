# Spotify Soloist 桌面播放方案调研

更新日期：2026-10-29

当前实施状态：Phase 1 已接入 `SoloistProcess → SoloistAdapter → MusicService → IPC → MusicProvider`，并完成配置加载、陈旧端点清理、类型和语法验证。Phase 2 已实现 Player、Presence、Conversation 三个独立窗口以及共享音乐状态、位置恢复和对话恢复。当前 `.env.local` 已配置 API Key，但 Soloist 路径仍是示例占位值，真实音频、首次配对和构建到期行为仍待有效官方二进制验证。

## 1. 调研背景

Mori 浏览器版本可以通过 Spotify Web Playback SDK 正常播放，但 Electron 桌面版本会停在“正在创建 Spotify 播放设备”，始终收不到 SDK 的 `ready(device_id)`。同一账号、Token 和本地服务在 Chrome 中可以播放，说明问题集中在 Electron 的 EME/Widevine DRM 播放环境，而不是 Spotify 账号连接或歌单读取。

本调研评估 Spotify 官方 Soloist 是否可以作为 Mori 桌面端播放引擎，绕开 Electron 内嵌浏览器的 DRM 限制。

## 2. 结论

Spotify Soloist 在技术上适合作为 Mori 桌面端的播放后端：它是 Spotify 官方的无界面 Spotify Connect 客户端，音频由独立原生进程输出，不经过 Electron，也不依赖 Web Playback SDK、EME 或 Widevine。Soloist 提供本机 WebSocket API，覆盖 Mori 当前需要的播放、暂停、切歌、进度、随机、循环、队列与状态事件。

但它目前不适合直接无感打包进公开发行版，主要限制是：

- macOS 只提供 Apple Silicon、macOS 13 及以上版本。
- 每位用户需要用 Premium 账号生成自己的 Soloist API Key。
- API Key 不能嵌入 Mori 或分享给其他用户。
- Spotify 禁止应用重新分发 Soloist 二进制，用户必须从官方页面下载。
- Soloist 构建只有 90 天有效期，需要持续更新。

建议先把 Soloist 实现为桌面开发版的可选播放引擎，验证完整链路；浏览器继续使用 Web Playback SDK。正式分发前再评估安装引导、自动检测、版本更新和产品门槛。

## 3. Soloist 是什么

Soloist 是 Spotify 官方提供的 headless Spotify Connect 客户端。它作为独立命令行进程运行，把当前电脑注册成 Spotify Connect 播放设备，并直接使用操作系统音频系统输出声音：

```text
Mori Electron UI
        ↓ 受限 IPC
Electron 主进程
        ↓ 本机 WebSocket
Spotify Soloist 进程
        ↓ Spotify Connect
Spotify 服务
        ↓
macOS Core Audio
```

与 Web Playback SDK 不同，Soloist 不是网页播放器，也不需要在 Electron 渲染进程中解密和播放 Spotify 音频。

官方支持的平台包括：

| 平台 | 支持范围 |
|---|---|
| macOS | Apple Silicon，macOS 13+ |
| Windows | x86_64 |
| Linux | ARMv7、AArch64、x86_64 |

## 4. 能力与 Mori 需求对照

Soloist WebSocket API 提供以下控制命令：

| Mori 能力 | Soloist 支持情况 | 对应能力 |
|---|---|---|
| 播放/恢复 | 支持 | `play` |
| 播放指定内容 | 支持 | `play` + Spotify URI |
| 暂停 | 支持 | `pause` |
| 上一首/下一首 | 支持 | `skip_prev` / `skip_next` |
| 跳转进度 | 支持 | `seek` |
| 音量 | 支持 | `set_volume` |
| 随机播放 | 支持 | `set_shuffle` |
| 列表/单曲循环 | 支持 | `set_repeat_context` / `set_repeat_track` |
| 添加队列 | 支持 | `add_to_queue` |
| 当前播放状态 | 支持 | `playback_state` 和增量事件 |
| 真实待播队列 | 支持 | `get_queue` / `queue_changed` |
| 进度插值 | 支持 | `position_sync` |
| Connect 设备激活 | 支持 | `activate` / `deactivate` |

`play.uri` 可以接收歌曲、专辑、歌单或单集 URI，因此 Mori 可以继续使用当前 Spotify URI 数据，不需要自己获取或处理音频文件。

## 5. 身份验证与首次配对

Soloist 使用两部分身份状态：

1. 用户从 Spotify for Developers 生成的 Soloist API Key。
2. 用户从 Spotify 官方客户端选择 Soloist 设备后建立的 Spotify Connect 会话。

首次流程为：

1. 用户使用 Premium 账号生成自己的 Soloist API Key。
2. 启动 Soloist，并传入设备名、API Key、数据目录和本机 WebSocket 地址。
3. 用户在同一局域网的 Spotify 官方客户端中选择 Mori/Soloist 设备。
4. Soloist 把 Connect 会话保存在自己的数据目录。
5. 后续启动复用同一数据目录即可恢复会话。

API Key 与 Mori 现有的 Spotify OAuth Token 不是同一个凭据。API Key 必须视为本机秘密，不能进入渲染进程、日志、源码或公开安装包。

## 6. 本机 WebSocket 安全边界

Soloist 的 WebSocket API 没有内建身份验证、TLS、Origin 校验或 CSRF 防护，因此必须：

- 只绑定 `127.0.0.1`，不能绑定局域网地址或 `0.0.0.0`。
- 使用端口 `0` 让系统分配随机端口。
- 由 Electron 主进程读取 Soloist 数据目录中的 `ws.addr` 和 `ws.port`。
- 由主进程连接 WebSocket，再通过白名单 IPC 向渲染层暴露必要状态和命令。
- 不向渲染层暴露 API Key、Soloist 数据目录或任意 WebSocket 发送能力。

这与 Mori 当前“只通过 preload 暴露有限桌面能力”的安全原则一致。

## 7. 推荐的代码结构

播放 UI 不应直接依赖 Web Playback SDK 或 Soloist。建议抽象统一播放接口：

```ts
interface PlaybackAdapter {
  connect(): Promise<void>
  play(uri?: string): Promise<void>
  pause(): Promise<void>
  next(): Promise<void>
  previous(): Promise<void>
  seek(positionMs: number): Promise<void>
  setShuffle(enabled: boolean): Promise<void>
  setRepeat(mode: 'off' | 'context' | 'track'): Promise<void>
  getQueue(): Promise<PlaybackQueue>
  subscribe(listener: (event: PlaybackEvent) => void): () => void
}
```

实现分工：

```text
BrowserPlaybackAdapter
  └── Spotify Web Playback SDK

DesktopPlaybackAdapter
  └── Electron preload IPC
        └── Electron 主进程 SoloistManager
              ├── Soloist 子进程生命周期
              ├── WebSocket 发现与连接
              ├── 命令确认和错误映射
              └── 播放事件标准化
```

Spotify Web API 仍负责账号资料、歌单和喜欢歌曲读取；Soloist 只替换桌面播放与状态同步层。

## 8. 进程与状态设计

桌面端应明确区分以下状态：

```text
未安装 Soloist
→ 缺少 API Key
→ 正在启动进程
→ 等待首次 Spotify Connect 配对
→ 已连接但未激活
→ 播放设备已就绪
→ 构建即将到期/已到期
→ 进程退出或本机 API 断开
```

不要继续复用“正在连接 Spotify”概括所有状态。Soloist 退出码、WebSocket `auth_state`、`device_changed` 和错误事件应映射为可执行的用户提示。

## 9. 分发和维护风险

### 9.1 禁止重新分发

Spotify 要求应用链接到官方下载页，不能把 Soloist 压缩包或二进制直接放入 Mori 安装包。因此 Mori 需要提供安装检测和官方下载安装引导，而不是自动从自己的服务器分发。

### 9.2 90 天构建期限

每个 Soloist 构建从构建日期起只能使用 90 天，到期后以退出码 `10` 结束。Mori 需要读取版本和剩余有效期，在到期前提示用户从官方页面更新。

### 9.3 平台覆盖

当前 macOS 仅支持 Apple Silicon。Intel Mac 必须回退到浏览器播放、Spotify 官方客户端控制或其他方案。

### 9.4 用户门槛

用户需要 Premium、Spotify for Developers 账号、个人 API Key和首次 Connect 配对。这比普通 OAuth 登录复杂，现阶段更适合开发验证和高级用户，不宜假设为无感消费者流程。

## 10. 分阶段验证建议

### 阶段一：独立可行性验证

- 手动下载官方 Apple Silicon 构建。
- 使用个人 API Key 启动 Soloist。
- 开启 `--ws 127.0.0.1:0`。
- 完成 Spotify Connect 配对。
- 验证歌曲、歌单 URI 播放以及全部控制命令。
- 验证当前歌曲、进度和队列事件。

### 阶段二：Electron 主进程接入

- 实现 `SoloistManager`，管理启动、退出和异常恢复。
- 读取随机 WebSocket 端口并连接。
- 通过 preload 暴露固定命令，不开放原始 WebSocket。
- 将 Soloist 事件适配成 Mori 现有播放状态。

### 阶段三：双播放后端

- 浏览器继续使用 Web Playback SDK。
- Electron 优先使用 Soloist。
- Soloist 不可用时明确回退到浏览器或 Spotify 官方客户端，不再尝试不可用的 Electron Web Playback SDK。

## 11. 最终建议

采用“浏览器 Web Playback SDK + 桌面 Soloist”的双后端架构，但先以实验性功能验证，不立即承诺公开分发。Soloist 能从根本上解决 Electron DRM 问题，并且其官方 WebSocket 能力与 Mori 播放器高度匹配；真正的产品风险主要在安装、API Key、90 天更新和平台覆盖，而不是播放能力。

## 12. 参考资料

- [Spotify Soloist 官方文档](https://developer.spotify.com/documentation/soloist)
- [Soloist Overview](https://developer.spotify.com/documentation/soloist/concepts/overview)
- [Soloist Authentication](https://developer.spotify.com/documentation/soloist/concepts/authentication)
- [Soloist Basic Integration](https://developer.spotify.com/documentation/soloist/howtos/basic-integration)
- [Soloist WebSocket API](https://developer.spotify.com/documentation/soloist/reference/websocket-api)
- [Soloist Downloads and Updates](https://developer.spotify.com/documentation/soloist/reference/downloads-and-updates)
- [Spotify 官方 Soloist GitHub 仓库](https://github.com/spotify/soloist)
