# Spotify Web Playback SDK 说明

最后更新：2026-10-26

## 1. 文档目的

本文档说明 Spotify Web Playback SDK 在 Mori 中的实际作用、播放状态为什么会与 Spotify 客户端同步，以及开源使用者需要了解的技术边界。

## 2. 核心结论

Spotify Web Playback SDK 会把浏览器注册成一个 Spotify Connect 播放设备。它不是向 Mori 提供一份可以独立管理的音乐文件，也不会建立脱离 Spotify 账号的播放会话。

当 Mori 浏览器成为当前播放设备后，Mori、Spotify 桌面端和 Spotify 手机端控制的是同一个 Spotify 播放会话。因此：

- Spotify 暂停，Mori 的真实播放也会暂停。
- Spotify 切歌，Mori 的真实播放也会切歌。
- Mori 播放、暂停或切歌，Spotify 客户端会显示相同变化。
- Mori 不能禁止同一账号的官方 Spotify 客户端控制该播放设备。

这是 Spotify Connect 的产品机制，不是 Mori 状态管理导致的重复同步。

## 3. 设备与播放会话模型

```text
Spotify 账号的播放会话
        │
        ├── Spotify 桌面端
        ├── Spotify 手机端
        ├── 智能音箱
        └── Mori 音乐伙伴
            （Web Playback SDK 创建的浏览器设备）
```

Spotify 客户端中显示的“Mori 音乐伙伴”就是 Mori 创建的 Connect 设备。声音由该浏览器输出，但播放状态仍属于 Spotify 账号的统一播放会话。

## 4. 状态变化流程

以用户在 Spotify 桌面端切歌为例：

```text
Spotify 桌面端点击下一首
        ↓
Spotify 更新账号当前播放状态
        ↓
Mori 的 Web Playback SDK 收到 player_state_changed
        ↓
浏览器开始播放新的歌曲
        ↓
Mori 更新歌名、封面、进度和待播队列
```

Mori 不能通过忽略 `player_state_changed` 获得独立播放。忽略事件只会让 UI 停留在旧歌曲，真实音频仍然已经暂停或切换，最终造成界面与声音不一致。

## 5. Mori 的功能边界

### Spotify 负责

- Spotify 账号、曲库和歌单。
- 音频流、DRM、音质和版权控制。
- Spotify Connect 播放设备与账号级播放状态。
- 实际的播放、暂停、切歌、随机和循环结果。

### Mori 负责

- 展示 Spotify 当前歌曲、封面、进度和播放状态。
- 接收用户在 Mori 中发起的播放、暂停、切歌、随机和循环操作。
- 聊天、陪听、歌曲特征展示、心情记录和共同记忆。
- 清楚提示音乐由 Spotify 提供。

### 不应发生

- 打开播放器、进入聊天或记录瞬间时自动改变 Spotify 播放状态。
- 为了制造“独立播放”的假象而忽略 Spotify 的真实状态事件。
- 下载、导出、代理或修改 Spotify 音频流。
- 把 Spotify Web Playback SDK 描述为 Mori 自有的独立播放器。

## 6. 浏览器音频激活

Safari 等浏览器通常要求音频播放由用户手势触发。Mori 从 Mini Player 进入完整播放器时，会在点击处理内调用 SDK 的 `activateElement()`，让浏览器允许 Web Playback SDK 输出声音。

音频激活只是在浏览器层面解除播放限制，不会让播放会话脱离 Spotify，也不应在页面挂载时自动切换播放设备。

## 7. 当前项目中的对应实现

- `components/mori/spotify-context.tsx`：保存全局当前歌曲、播放状态和进度，并监听 SDK 状态。
- `components/mori/app-chrome.tsx`：Mini Player 展示全局播放状态，并在用户点击时激活浏览器音频。
- `components/mori/screens/connect-screen.tsx`：创建或复用 Web Playback SDK 播放器，提供完整播放控制和陪听界面。
- `lib/spotify.ts`：封装 Spotify Web API 的播放、随机、循环和设备相关请求。
- `types/spotify-web-playback.d.ts`：声明 SDK 播放器、当前曲目和真实待播队列类型。

## 8. 开源使用说明

Mori 是开源参考实现，不提供公共 Spotify 应用凭据、托管播放服务或音乐授权。使用者需要自行：

- 在 Spotify Developer Dashboard 创建应用。
- 配置自己的 Client ID 和回调地址。
- 使用满足播放条件的 Spotify 账号。
- 根据自己的使用和分发方式遵守 Spotify Developer Policy。
- 对自行修改、部署或分发的版本负责。

仓库提供的默认方案是 Spotify 陪伴控制器：

- Spotify 继续负责音乐播放和版权。
- Mori 负责控制入口、陪听、聊天和记忆。
- Mori 与 Spotify 的播放状态仍然双向同步。

使用者如果将项目改造成原生 iOS/Android 客户端，应自行评估 Spotify App Remote SDK。WebView 在后台播放、音频激活、锁屏控制和生命周期方面存在额外限制。

### 改造成独立播放器

如果使用者希望 Spotify 的暂停或切歌不影响 Mori，就不能继续使用 Spotify Web Playback SDK 或 App Remote 作为播放引擎，需要自行替换音源和播放层，并处理：

- 音乐版权与地区授权。
- 音频文件或流媒体地址。
- DRM、CDN 与播放统计。
- 后台播放、锁屏控制和离线能力。

Spotify API 不能把 Spotify 曲库授权给 Mori 建立一个与 Spotify Connect 分离的播放器。

## 9. 当前项目定义

在继续使用 Spotify Web Playback SDK 的前提下，建议使用以下定义：

> Mori 是一个拥有聊天、陪听和记忆能力的开源 Spotify 陪伴控制器参考实现。

避免使用“Mori 独立音乐播放器”或“Mori 独占控制 Spotify”这类描述。

## 10. 官方资料

- [Spotify Web Playback SDK Reference](https://developer.spotify.com/documentation/web-playback-sdk/reference)
- [Spotify Web API：Transfer Playback](https://developer.spotify.com/documentation/web-api/reference/transfer-a-users-playback)
- [Spotify iOS SDK](https://developer.spotify.com/documentation/ios)
- [Spotify Android SDK](https://developer.spotify.com/documentation/android)
- [Spotify Developer Policy](https://developer.spotify.com/policy)

