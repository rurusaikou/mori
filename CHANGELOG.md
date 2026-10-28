# 版本与重要修改记录

## 2026-10-29 — Soloist Phase 1 修正与基础多窗口 Phase 2

### 完成

- Electron 主进程现在自行读取 `.env.local`，避免 Next.js 已读取配置但 Soloist 子进程仍拿不到路径与 API Key。
- Soloist 启动前清除遗留 `ws.addr` / `ws.port`，避免异常退出后持续重连旧端口；启动异常同步进入共享 Music State。
- 新增 `WindowManager`，以单实例方式管理 Player、Presence、Conversation 三个独立 BrowserWindow，并在本机恢复窗口位置。
- Player 使用统一 Music Context 展示真实歌曲、进度、音量和控制；Presence 使用现有 Mori 角色、透明无边框并支持点击打开 Conversation。
- Conversation 复用现有聊天界面；消息与草稿写入本地存储，关闭窗口不会停止音乐，也不会丢失对话。
- preload 只允许打开三种产品窗口和发送白名单音乐命令，不向渲染层暴露 Soloist 端点或密钥。

### 验证

- TypeScript、Electron/Node 语法检查及 `git diff --check` 通过。
- 开发环境实机启动后，Player、Presence、Conversation 三个渲染入口均成功加载。
- `.env.local` 的 API Key 已被主进程识别；当前 Soloist 路径仍是 `/absolute/path/to/soloist` 示例值，因此真实音频与首次配对尚未验证。
- Phase 3 的 Playlist/Dock 和 Phase 4 的 Lyrics/Magnet/Snap 均未提前实现。

## 2026-10-29 — Spotify 播放诊断与 Soloist 调研

### 完成

- 完成 Soloist Phase 1 代码接入：Electron 主进程新增 Soloist 进程管理、回环 WebSocket Adapter、MusicService 和统一状态标准化层。
- 新增受限音乐 IPC 与 React Music Context，Player、Mini Player 和完整播放页不再直接访问 Web Playback SDK 或 `deviceId`。
- SpotifyProvider 缩减为账号和音乐库兼容层；真实曲目、进度、队列、音量、随机和循环状态统一来自 MusicService。
- 移除桌面 Web Playback SDK 类型、初始化脚本、播放 API 控制函数和不再需要的播放 scopes；Spotify OAuth 与音乐库读取继续保留。
- 增加 Soloist 未配置、等待配对、已连接和错误状态，不使用假播放数据掩盖外部配置缺失。
- 将 Web Playback SDK 初始化拆分为组件加载、权限验证、Connect 设备创建和就绪阶段，显示等待时间，并分别处理初始化、授权、账号、设备离线和播放错误。
- 播放器启动超过 15 秒时显示具体停留阶段和重试入口，不再用“Spotify 未连接”概括播放器故障。
- 歌单曲目缓存改为后台渐进执行，不再等待全部歌单缓存完成后才展示列表；单个歌单完成后立即更新为可播放状态。
- 用户点击尚未缓存的歌单时立即优先加载，并复用后台进行中的相同请求，避免重复访问 Spotify。
- 确认浏览器可以播放而 Electron 桌面模式无法创建 Web Playback SDK 设备，问题边界收敛到 Electron DRM/EME 运行环境。
- 新增 Spotify Soloist 桌面播放方案调研，记录能力、身份验证、本机 WebSocket 安全边界、分发限制、双播放后端架构与分阶段验证建议。

### 文档

- 更新缓存机制与 Web Playback SDK 说明，并在 README 中增加 Soloist 调研入口。

### 验证

- TypeScript 类型检查通过。
- `git diff --check` 通过。
- Electron 主进程与新增 Soloist 模块通过 Node 语法检查，MusicService 通过模拟官方事件的协议烟测。
- 当时尚未完成有效 Soloist 二进制验证；后续状态见上方 Phase 1/Phase 2 记录。
- 完整生产构建受当前环境无法访问 Google Fonts 阻断，与播放器修改无关。

## 2026-10-27 — 转为 macOS 桌面 MVP

### 完成

- 修正 Spotify OAuth 回调在 Next.js 开发模式中重复交换授权码，导致第二次执行错误显示“登录校验失败”的问题。
- Electron 主进程现在保存真实窗口形态；OAuth 整页跳转返回后，渲染层会恢复完整/迷你状态，不再把迷你播放器拉伸到完整窗口。
- 修正本机 Spotify OAuth 回调仍指向旧端口 `3000` 的配置；桌面端统一使用 `http://127.0.0.1:3210/spotify/callback`。
- 新增千千静听式紧凑桌面形态：应用默认以 `420 × 154` 迷你播放器启动，可展开为完整 Mori 空间并再次收起。
- 修正 sandbox 下 ESM preload 未建立窗口 bridge，导致展开后完整界面仍被裁切在迷你窗口内的问题；界面现在会等待原生窗口完成缩放后再切换。
- 关闭 Next.js 开发角标，避免其遮挡迷你播放器封面和桌面侧栏。
- 移除迷你播放器右侧重复的 Mori 入口，保留封面和顶部展开按钮，并把空间留给歌曲信息与进度。
- 开发启动器现在显式处理终端中断，退出 Electron 时会回收 Next.js 子进程，避免 `3210` 端口残留占用。
- 迷你播放器保留封面、歌曲信息、进度、上一首、播放/暂停、下一首和 Mori 入口，Spotify 状态继续双向同步。
- 增加只接受 `compact`/`full` 枚举值的最小 Electron IPC，用于安全调整原生窗口尺寸。
- 项目定位从浏览器移动端原型调整为面向 macOS 的 Electron 桌面应用。
- Electron 主进程、预加载脚本和开发启动器成为项目根级入口，不再维护附加的 `desktop/` 子项目。
- `pnpm dev` 默认同时启动本地 Next.js 渲染服务与 Mori 桌面窗口。
- 移除网页产品介绍与手机外壳，改为 macOS 隐藏式标题栏、桌面侧栏和自适应内容区。
- 保留现有 Mori 原型、Spotify Web Playback SDK、聊天、心情和记忆能力。
- Spotify 本地回调端口统一为 `127.0.0.1:3210`。
- README 已按桌面项目重写，并新增架构文档、同步代码结构文档和 Spotify SDK 说明入口。
- 为 Electron 安全边界、开发启动顺序、导航栈、PKCE 与 Spotify 进度插值补充核心注释。
- 移除未使用的 preload bridge、基础 Button 组件、Vercel 网页分析和 Spotify 设备转移函数；构建目录固定为桌面产物并恢复 TypeScript 构建检查。

### 当前验证边界

- Electron 窗口和 Next.js 渲染层已成功启动并完成截图验证。
- macOS `.app` 打包、签名、公证以及打包环境中的 Spotify DRM/音频播放仍待验证。

## 2026-10-26 — 播放状态恢复修正

### 文档

- 增加 Spotify Web Playback SDK 说明，记录 Connect 设备模型、双向同步机制、Mori 项目边界及开源使用者的集成责任。

### 今日问题与修正

1. **点击 Mini Player 后，完整播放器短暂显示另一首歌曲**

   Mini Player 使用全局 Spotify 当前状态，而完整播放器挂载后的第一帧曾在 SDK 状态返回前回退到队列首曲，导致歌曲、封面和进度不一致。现在恢复完整播放器时会先使用全局当前歌曲、播放状态与进度，SDK 返回后再无缝接管。

2. **恢复完整播放器后显示正在播放但没有声音**

   Mini Player 点击时现在会在用户手势内激活 Web Playback SDK 音频，以满足 Safari 等浏览器的自动播放限制。打开页面只读取播放状态，不自动转移设备；播放、暂停和切歌仍只由用户在 Mori 中的明确操作触发。

### 验证

- TypeScript 类型检查通过。
- `git diff --check` 通过。

## 2026-10-25 — 陪伴流程与播放页体验完善

### 完成

- 首页与聊天页共享聊天记录、输入草稿和当前播放状态，并抽离共用聊天输入组件。
- 底部 Mori 入口调整为返回首页；首页主动消息可展开完整对话。
- 心情记录与播放页的“记录瞬间”接入共同记忆。
- 播放页将原歌词占位区改为“一起听”，根据歌曲 BPM、energy 和 danceability 展示克制的陪伴描述与标签。
- 增加“记录这一刻”弹窗，展示当前歌曲与播放进度，支持填写最多 200 字并确认保存。
- “接下来播放”改为优先读取 Spotify Web Playback SDK 的真实 `track_window.next_tracks`，并补充待播曲目类型。

### 今日问题与修正

1. **瞬间记录按钮与整体视觉不一致**

   将实色高亮按钮调整为较暗的紫色玻璃样式，保留半透明背景、磨砂、细描边和内高光；按钮文案改为“确认”。

2. **“接下来播放”固定展示歌单第 2～5 首**

   改为展示 Spotify 播放器返回的真实待播队列，使随机播放后的顺序也与实际播放一致；播放器尚未返回队列时，才从当前歌曲之后回退计算。

3. **待播区域的“查看歌单”与当前模块语义不一致**

   移除该入口，只保留真实待播歌曲列表。

### 验证

- TypeScript 类型检查通过。
- `git diff --check` 通过。

## 2026-10-24 — Mori MVP 雏形

### 完成

- 完成 Mori 手机端页面框架、底部导航、角色动画与响应式手机外壳。
- 接入 Spotify OAuth PKCE、Token 刷新、用户资料、喜欢歌曲与歌单分页读取。
- 接入 Spotify Web Playback SDK，支持播放、暂停、切歌、进度、随机、列表循环与单曲循环。
- 增加全局 Spotify Mini Player，可跨页面同步当前歌曲并返回完整播放页。
- 增加连接后歌单预取、请求 Promise 去重、内存与会话缓存，以及用户缓存开关。
- 接入 MeloData，通过 ISRC 缓存歌曲特征，并生成可动态更新的用户音乐画像。
- 增加 Mori 内收听行为采集、服务端 JSON 持久化和真实音乐记忆聚合。
- 将音乐偏好拆为独立页面；精简首页并增加轻量聊天窗口。

### 今日问题与修正

1. **随机与循环按钮只有视觉、没有行为**  
   接入 Spotify shuffle/repeat API，并实现关闭、列表循环、单曲循环三态反馈。

2. **Mori 律动柱固定或速度失真**  
   将角色动画绑定真实播放状态，并通过服务端缓存的 MeloData 特征驱动五根律动柱。首次实现只用 BPM 同时控制速度和满幅跳动，导致平稳歌曲表现过激；修正后 BPM 只控制周期，energy 与 danceability 控制振幅，低强度歌曲按两拍完成一次柔和变化。该效果不声称是实时频谱或逐拍同步。

3. **喜欢歌曲与部分歌单无法读取**  
   补充 `user-library-read`，区分本人/协作歌单与 Spotify 不允许第三方读取的歌单；喜欢歌曲支持完整分页。

4. **MeloData 返回 202/429/502，分析后 data 为空**  
   对异步 202 按 `Retry-After` 有限轮询；区分额度耗尽与速率限制；每两首一批并立即保存成功特征，避免整批失败丢失结果。

5. **歌单点击直接播放，缺少曲目列表**  
   增加歌单详情层，点击歌曲或“播放全部”后才进入完整播放器。

6. **页面切换后歌单重复加载**  
   增加模块级 Promise 请求去重与 24 小时双层缓存；修复 React 开发模式副作用清理导致预取被取消但仍标记完成的问题。

7. **缓存无法由用户管理**  
   增加“保留音乐缓存”开关和立即清理入口；关闭缓存后不再写入，解除连接按用户选择处理。

8. **底部播放栏与 Spotify 当前歌曲不同步**  
   将 SDK 状态监听提升到 `SpotifyProvider`，持续同步歌曲、封面、播放状态和进度；完整播放页打开时隐藏 Mini Player。

9. **右上角播放入口错误进入歌单**  
   保存最近播放队列，并从缓存或当前歌曲构造恢复上下文；点击后直接返回完整播放页且不重新起播。

10. **收听记忆重复显示同一首歌**  
    服务端以会话快照增量更新，展示层按标准化歌名与歌手合并多个 URI，再按 `sessionId` 去重次数与时长。

11. **播放器与页面背景出现断层、Mini Player 两侧不透明**  
    统一沉浸页背景覆盖状态栏；Mini Player 改为悬浮玻璃卡片，使左右区域透出下层内容。

### 已知限制

- JSON 文件存储仅适合单机原型，没有跨进程写锁，不适合多实例部署。
- Spotify Token 仍保存在浏览器 `localStorage`，生产环境需要服务端安全会话。
- 只能精确记录 Mori 内播放行为，无法补齐 Spotify App 外的完整收听时间线。
- Spotify 内播放要求 Premium；第三方歌词正文尚未接入授权服务。
- 聊天回复、心情、通知设置及非音乐记忆仍包含本地模拟数据。
