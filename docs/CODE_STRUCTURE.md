# Mori 代码结构

本文档记录当前 Mori macOS 桌面 MVP 的代码组织、职责边界和主要数据流。

缓存的完整命中、失效和清理规则见 [CACHE_MECHANISM.md](CACHE_MECHANISM.md)。

## 目录概览

```text
musichoney/
├── electron-main.mjs           # Electron 主进程、MusicService 与应用生命周期
├── electron-preload.cjs        # 受限的多窗口与音乐 IPC
├── electron-dev.mjs            # 同时管理本地渲染服务和 Electron
├── electron/window-manager.mjs # 三类 BrowserWindow、位置恢复与单实例管理
├── electron/music/              # Soloist 进程、协议 Adapter、标准化与 MusicService
├── docs/
│   ├── ARCHITECTURE.md          # 进程边界、数据流与架构决策
│   └── CODE_STRUCTURE.md        # 文件职责与代码导航
├── app/
│   ├── globals.css              # 全局主题、Tailwind 配置和动画
│   ├── layout.tsx               # HTML 根布局、Metadata、Viewport
│   ├── spotify/callback/page.tsx # Spotify OAuth 回调页
│   ├── api/music-profile/route.ts # 音乐画像读取与分析
│   ├── api/music-features/route.ts # 按 ISRC 读取已缓存歌曲特征
│   ├── api/listening-history/route.ts # 收听历史读写
│   └── page.tsx                 # 应用页面入口
├── components/
│   ├── mori/
│   │   ├── screens/             # 独立业务页面
│   │   │   ├── home-screen.tsx
│   │   │   ├── chat-screen.tsx
│   │   │   ├── mood-screen.tsx
│   │   │   ├── quiet-screen.tsx
│   │   │   ├── memories-screen.tsx
│   │   │   ├── connect-screen.tsx
│   │   │   ├── music-profile-screen.tsx
│   │   │   └── settings-screen.tsx
│   │   ├── app-chrome.tsx       # 桌面侧栏、Mini Player、Toast
│   │   ├── desktop-windows.tsx  # Player、Presence、Conversation 独立窗口 UI
│   │   ├── mascot.tsx           # Mori 角色及表情动画
│   │   ├── mori-app.tsx         # 桌面外壳和页面调度
│   │   ├── mori-context.tsx     # 全局导航、播放和提示状态
│   │   ├── music-context.tsx    # 统一音乐状态与播放命令
│   │   ├── spotify-context.tsx  # Spotify 账号、用户和歌单状态
│   │   ├── primitives.tsx       # 通用按钮、顶部栏、封面、歌曲卡片等
├── lib/
│   ├── music/types.ts           # MusicService 与渲染层共享的领域类型
│   ├── mori-data.ts             # 页面、歌曲、歌单、记忆等领域类型与模拟数据
│   ├── spotify.ts               # OAuth PKCE、Token 刷新和 Web API 请求
│   ├── spotify-track-cache.ts   # 歌单曲目缓存与请求去重
│   ├── music-profile.ts         # 音乐特征和用户画像聚合
│   ├── server/music-data-store.ts # data/*.json 原子持久化
│   └── utils.ts                 # className 合并工具
├── public/
│   ├── covers/                  # 示例歌曲与歌单封面
│   └── ...                      # 图标和占位资源
├── components.json              # shadcn 配置
├── next.config.mjs              # Next.js 配置
├── package.json                 # 依赖和脚本
├── postcss.config.mjs           # PostCSS/Tailwind 配置
└── tsconfig.json                # TypeScript 配置
```

## 应用入口

### `app/layout.tsx`

负责：

- 设置中文页面语言。
- 注入全局 CSS 和 Geist 字体。
- 配置标题、描述、图标和渲染窗口 Viewport。

不在根布局接入网页分析 SDK。桌面版后续如果需要遥测，应先明确采集范围、用户授权和脱敏规则。

### `app/page.tsx`

负责 Electron 渲染层的页面入口，Mori 占满整个桌面窗口，不再渲染手机外壳或浏览器产品介绍。

这里不放业务状态或具体页面逻辑。

## 应用外壳与页面调度

### `components/mori/mori-app.tsx`

`MoriApp` 根据 Electron 加载 URL 的 `window` 参数选择独立的 `PlayerWindow`、`PresenceWindow` 或 `ConversationWindow`。没有窗口参数时保留完整 `DesktopShell` 作为渲染层调试入口。所有窗口都挂载 `MusicProvider`，但真实音乐状态只保存在主进程 `MusicService` 中。

```ts
const screens: Record<ScreenId, () => React.ReactNode> = {
  home: HomeScreen,
  chat: ChatScreen,
  mood: MoodScreen,
  quiet: QuietScreen,
  memories: MemoriesScreen,
  settings: SettingsScreen,
  'music-profile': MusicProfileScreen,
  connect: ConnectScreen,
}
```

页面分为三类：

- 主入口：`connect`（音乐集）、`home`（Mori 首页）、`memories`（记忆）
- 沉浸式页面：`mood`、`quiet`
- 独立详情页：`settings`、`music-profile`

沉浸式页面隐藏桌面侧栏，避免心情记录和陪听过程被其他入口干扰。

## 全局状态

### `components/mori/mori-context.tsx`

`MoriProvider` 当前管理 Mori 原型本身的状态。聊天消息和草稿会写入 `localStorage`，因此 Conversation BrowserWindow 关闭并重新创建后不会丢失；播放状态不在这里持久化，而由主进程持续持有：

| 状态 | 用途 |
|---|---|
| `stack` | 页面导航栈 |
| `screen` | 当前页面 |
| `toast` | 短暂提示消息 |
| `currentTrack` | 非 Spotify 原型页面使用的示例歌曲 |
| `isPlaying` | 与示例歌曲配套的原型播放状态 |

对外提供：

- `navigate(id)`：进入页面。
- `back()`：返回上一页面。
- `showToast(message)`：显示两秒提示。
- `togglePlay(track?)`：切换歌曲或播放状态。

侧栏主入口会重建以首页为根的导航栈，聊天、设置、心情等详情页则保留来源页面，保证返回行为一致。当前导航不是 URL 路由，刷新页面会回到首页。页面自己的 `useState` 会在页面卸载后重置；需要跨页面或跨会话保留的数据应提升到 Context、独立 Store 或服务端。

## 业务页面

### `home-screen.tsx`

首页使用夜景氛围图、Mori 主视觉、真实当前音乐卡和轻量聊天入口。当前音乐卡直接读取 `SpotifyProvider`，可恢复完整播放页并控制播放/暂停；首页不再叠加 Mini Player。主页输入的消息暂存到 `sessionStorage`，完整聊天页挂载后消费并发送，避免为一次页面交接引入额外全局 Store。

首页不应重新加入语音通话或麦克风入口。

### `chat-screen.tsx`

文字聊天页面包含：

- 本地消息数组
- 文本输入和快捷回复
- 输入中动画
- 基于关键词的模拟回复
- 歌曲推荐卡片
- 心情记录快捷入口

`replyTo()` 只是演示规则。真实 AI 接入时，应将它替换为受控的服务端对话请求，不应在客户端暴露模型密钥。

### `mood-screen.tsx`

心情记录是一个四步本地状态机：

```text
心情强度
  → 感受标签
  → 影响因素
  → 关联歌曲与保存
```

组件内部保存：

- `step`
- `score`
- `selectedFeelings`
- `selectedInfluences`
- `withMusic`

当前点击保存后显示 Toast 并进入记忆页。后续应将完整结果写入全局状态或后端，而不是依赖静态示例记录。

### `quiet-screen.tsx`

负责低打扰陪听：

- 展示当前歌曲和播放状态
- 切换播放/暂停
- 选择环境音
- 结束陪伴

环境音目前只有 UI 状态，没有真实音频资源。

### `memories-screen.tsx`

负责：

- 按 `music`、`mood`、`chat`、`moment` 筛选。
- 按日期分组展示。
- 从 `/api/listening-history` 读取 Mori 内的真实收听行为。
- 按标准化歌名与歌手聚合多 Spotify URI 版本，并按 `sessionId` 去重。

心情、对话和生活瞬间目前仍来自 `lib/mori-data.ts`。未来需要支持用户确认、编辑、删除和撤回长期记忆。

### `connect-screen.tsx`

负责音乐平台连接：

- Spotify 真实账号连接、同步、解除本机连接。
- 展示当前用户的真实 Spotify 歌单。
- 点击歌单进入 Mori 风格的曲目列表与播放器；桌面底层使用主进程 MusicService / Soloist，并保留官方跳转入口。
- 播放器的“接下来播放”读取 SDK `track_window.next_tracks`；SDK 尚未返回该字段时，才从当前曲目之后的歌单内容生成回退列表。
- 网易云音乐、QQ 音乐待合作状态。

`spotify-context.tsx` 管理账号和音乐库状态并在已有 Token 时自动同步；`lib/spotify.ts` 实现 PKCE、`state` 校验、Token 刷新、歌单分页和 API 错误转换。回调页交换授权码后返回应用。播放状态不由 SpotifyProvider 保存，而由主进程 MusicService 在应用生命周期内持续持有并广播给每个窗口。

从 Mini Player 返回完整播放器时，点击处理会直接调用 SDK `activateElement()`，确保音频激活发生在浏览器认可的用户手势中。页面挂载只读取 Spotify 状态，不自动转移设备或改变播放；播放、暂停和切歌只响应用户在 Mori 中的明确操作。

`spotify-context.tsx` 还持有全局当前歌曲、播放/暂停、进度和完整播放器可见状态。Provider 会在 SDK 延迟创建后接管全局监听，确保离开播放页后 Mini Player 仍随 Spotify 切歌更新。

`spotify-track-cache.ts` 提供两层缓存：模块内存与 `sessionStorage`，TTL 为 24 小时。进行中的请求以 Promise 去重，因此页面卸载、重新进入或详情页同时请求时不会重复访问 Spotify。用户可以在设置页关闭或手动清理缓存。

播放页的 Mori 律动通过 `/api/music-features` 读取当前歌曲已缓存的 BPM、energy 和 danceability：BPM 控制周期，能量与律动感控制振幅，低强度歌曲按两拍完成一次柔和变化。未命中特征时回退到 96 BPM 和低强度；这只是歌曲级特征可视化，不是实时音频频谱分析。

### `music-profile-screen.tsx`

独立展示和更新音乐画像。读取流程先请求服务端已有画像；重新分析时收集最多 100 首喜欢歌曲和本人/协作歌单歌曲，由服务端按 ISRC 复用歌曲特征，仅向 MeloData 请求缺失项。

当前 Token 存在浏览器 `localStorage`，适合无后端 MVP。生产版应迁移至受保护的服务端会话，并补充平台侧授权撤销流程。

### `settings-screen.tsx`

管理文字陪伴和通知偏好：

- 回复长度
- 主动开启话题程度
- 心情音乐推荐
- 每日问候
- 安静时段

本项目没有语音通话，因此这里不应出现声音角色、说话速度或麦克风设置。

## 共享组件

### `app-chrome.tsx`

- `PlayerWindow`：独立桌面播放器，提供真实 Soloist 状态、进度、音量和核心控制。
- `PresenceWindow`：透明无边框 Mori 窗口，点击后打开或聚焦 Conversation。
- `ConversationWindow`：复用聊天页面；关闭后由本地持久化恢复消息和草稿。
- `DesktopSidebar`：三个主入口，依次为音乐集、Mori 首页和记忆。
- `MiniPlayer`：跨页面的 Spotify 播放条；完整播放器打开时隐藏。
- `Toast`：非阻塞状态反馈。

Mini Player 使用绝对定位悬浮在桌面内容区底部，不占据页面文档流。`DesktopShell` 只在播放栏实际可见时下发滚动安全区变量，无播放栏时维持最小底距。

### `primitives.tsx`

- `IconButton`
- `TopBar`
- `Cover`
- `PlayButton`
- `TrackCard`
- `Switch`

业务页面应优先复用这些组件，保持点击区域、键盘焦点和视觉反馈一致。

### `mascot.tsx`

纯 CSS Mori 角色，支持：

- `idle`
- `talking`
- `sleepy`

`talking` 表示文字互动状态，不代表语音通话。角色动画遵守 `prefers-reduced-motion`。

## 数据模型

领域类型集中在 `lib/mori-data.ts`：

- `ScreenId`：页面标识。
- `Track`：歌曲基础信息。
- `MemoryType`：记忆分类。
- `Memory`：共同记忆。
- `Playlist`：外部歌单摘要。

`Memory` 等陪伴数据仍包含模拟内容；Spotify 歌曲、播放状态、音乐画像和收听历史已经使用真实数据。接入正式数据库时，建议进一步拆分：

```text
Track / Album / Playlist
PlaybackSource / PlaybackState
MoodEntry / MoodFactor
Memory / MemoryConsent
MusicConnection / OAuthGrant
```

不要继续把歌单伪装成 `Track`；真实播放模型应包含播放源、当前曲目、队列、进度、设备和平台。

## 样式系统

`app/globals.css` 使用 Tailwind CSS 4：

- `:root` 定义颜色、圆角和语义 Token。
- `@theme inline` 将 CSS 变量暴露给 Tailwind。
- 自定义 `mori-*` 关键帧负责角色、波形、进度和输入动画。
- 所有重要动画应提供 `motion-safe` 或 reduced-motion 兼容方式。

视觉修改应优先使用语义色，如 `bg-card`、`text-muted-foreground`、`text-primary`，避免在每个页面重复硬编码颜色。

## 状态与持久化的下一步

当前持久化分层：

| 数据 | 位置 | 生命周期 |
|---|---|---|
| Spotify Token | 浏览器 `localStorage` | 解除连接或令牌失效前 |
| 歌单歌曲缓存 | 内存 + `sessionStorage` | 最长 24 小时，可由用户关闭/清理 |
| 歌曲特征 | `data/music-features.json` | 按 ISRC 长期复用 |
| 音乐画像 | `data/music-profiles.json` | 按用户重新分析更新 |
| 收听记忆 | `data/listening-history.json` | 每 5 秒及暂停/切歌/退出时更新 |
| 聊天、心情、通知偏好 | React 内存/模拟数据 | 当前页面或应用会话 |

`data/*.json` 写入采用“唯一临时文件 + rename”原子替换，但没有跨进程锁。推荐按以下顺序演进：

1. 将音乐连接、心情记录、设置和记忆提升到全局 Store。
2. 使用 `localStorage` 完成可用性验证。
3. 引入用户身份后迁移到服务端数据库。
4. 为敏感记录增加授权、加密、删除和审计能力。

不要把 OAuth Token、模型密钥或私人记录存入源码、Git、公开环境变量或客户端日志。

## 开发检查

```bash
# 类型检查
pnpm exec tsc --noEmit

# 开发环境
pnpm dev

# 生产构建
pnpm build

# Turbopack 在受限环境无法创建进程时
pnpm build -- --webpack

# 生产依赖审计
pnpm audit --prod
```

修改页面后至少验证：

- 默认 `1180 × 760` 桌面窗口
- 最小 `960 × 640` 桌面窗口
- macOS 标题栏拖动区与交通灯按钮
- 返回和桌面侧栏导航
- 键盘焦点与按钮标签
- 心情记录完整四步流程
- 播放状态与 Mini Player 同步
- `prefers-reduced-motion`

