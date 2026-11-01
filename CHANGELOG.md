# Changelog

## 2026-11-01 — Anchored adaptive panel

- 将 Mori 固定为 viewport 拖拽锚点，Panel 改为不影响锚点布局的绝对定位层。
- 根据锚点象限自动选择展开方向，并增加 16px viewport 边界碰撞检测。
- 增加 Mori → Mini Player → Full Panel 三级渐进交互和逐级收回行为。
- 修复 closed Shadow DOM 下内部按钮被误判为外部点击的问题，并移除 Mini Player 右上角收藏按钮。
- 将 Full Panel 调整为“标题 → 当前歌曲 → Tab → 内容”，保留 Mini 播放状态；面板约 400px 高，歌单内容内部滚动。
- 明确 `✦` 为「记录这一瞬间」入口，并移除 Full Panel 的心形收藏语义。
- 删除独立的瞬间大按钮，将 `✦` 移到控制栏左侧，并把随机/循环模式移到下一首右侧。
- 将 Panel 与 Mori 的锚点间距缩短为 6px；Spotify 开始播放后显式恢复 Host 本地音量，修复状态正常但没有声音的问题。
- 清理未消费的 Provider capability、播放设备快照、对话/token 元数据、Panel 方向属性和重复 CSS；合并重复的生命周期及后端文档。

## 2026-10-31 — Playback consistency and implementation guide

- 删除未被消费的记忆 UI 状态和已失去用途的 Playback Host 控制命令。
- 统一 Mori 设备与 Spotify Connect 回退设备的 Web API 播放控制路径。
- 修复 Host 初始化失败后的重试、切歌后的状态刷新和设备 ID 同步。
- 收紧 offscreen 播放事件来源与跨 Origin payload 边界。
- 补齐 Playback Host 的 `'self'`/本地连接与 `sdk.scdn.co/embedded` iframe CSP 权限，修复被策略阻断的设备初始化链路。
- 将 Playback Host 内联样式迁移到独立 CSS，消除 CSP inline-style 错误。
- 按歌单、对话、瞬间三页与固定底部播放条重构 Mori 展开界面。
- 切歌改为控制当前 active Spotify 设备，并将真实成功或失败反馈给 UI。
- 将主面板压缩为 mini 尺寸，并增加跨页面复用的 60 分钟 Spotify 曲库缓存与后台刷新。
- 兼容 Spotify 写操作的空或非 JSON 成功响应，避免把底层 JSON 解析异常显示给用户。
- 修正对话页签图标；不可播放歌曲置灰禁用；底部圆形歌曲封面随播放状态旋转。
- 歌曲播放保留 playlist context 与 track offset，修复单曲队列导致上一首/下一首无效。
- 播放栏增加随机、歌单循环和单曲循环状态，单击循环切换并同步 Spotify active device；增加本地推进的歌曲进度条。
- 增加 Saved Tracks“我收藏的歌曲”；读取内容被 Spotify 拒绝的歌单会缓存为置灰禁用状态。
- 首次加载歌单列表时并发预检内容访问权限，使 Forbidden 歌单首次展示即置灰。
- 根据真实缓存状态显示歌单同步提示，缓存命中时不再出现 Spotify 加载文案。
- 启用 TypeScript 未使用代码检查，并增加代码实现说明。

## 2026-10-30 — Extension-only architecture

- 移除 Electron、Desktop UI、Soloist、Next.js、桌面素材和专属依赖。
- 保留并重构 Manifest V3 Browser Extension 产品线。
- 将 Spotify Web Playback SDK 从 Next/Extension sandbox 迁移到独立静态 Playback Host。
- 新增独立 Extension/Host 构建、开发服务器和部署边界。
- 完整更新 README、架构、代码结构、生命周期和 Spotify SDK 文档。
- 保留 Shadow DOM Presence、Spotify PKCE、MusicProvider、歌单、聊天、记忆和跨页面播放能力。
- 集中 Extension/Playback Host 协议，内聚 Spotify OAuth，并拆分 Host 协议层与 SDK 设备层。
- 按 `apps/extension`、`apps/player-host`、`apps/api`、`packages/domain` 和 `packages/contracts` 完成前后端分类。
- Extension UI 进一步拆分为 `content`、`mori`、`player` 与 `chat` 产品模块。
