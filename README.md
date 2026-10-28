# Mori

Mori 是一款以音乐为纽带的 AI 陪伴产品。

> From Music to the World.  
> 陪你听歌，也陪你走向更广阔的世界。

当前仓库是面向 macOS 的 Mori 桌面 MVP。应用以独立 Player 和透明 Presence 启动，点击 Mori 按需打开 Conversation；三个窗口共享主进程音乐状态并恢复各自位置。Electron 管理原生窗口和 Spotify Soloist 播放进程，Next.js/React 负责界面和本地服务。歌曲特征、音乐画像和 Mori 内收听记录使用本地 JSON 持久化，文字 AI、心情与部分陪伴内容仍为原型状态。

## 产品目标

Mori 希望成为一个有稳定性格、愿意倾听、能够逐渐熟悉用户的 AI 音乐伙伴。

产品围绕三层价值展开：

1. **日常与情绪陪伴**：提供低压力的文字交流、心情记录和安静相处体验。
2. **音乐探索与自我理解**：通过歌曲表达感受、发现作品，并理解音乐对用户的个人意义。
3. **真实世界连接**：让音乐成为连接朋友、城市、文化和现实生活的起点。

MVP 优先验证的问题是：当用户听到一首喜欢的歌时，是否愿意把它分享给 Mori，并在长期相处中形成有意义的音乐记忆。

## 产品边界

Mori 坚持以下边界：

- 以文字交流和音乐共同体验为主要交互方式。
- **不提供实时语音通话、后台麦克风监听或持续语音唤醒。**
- 陪伴不等于持续聊天；用户可以安静听歌或随时离开。
- 理解不等于擅自解读用户情绪，Mori 应优先尊重用户自己的表达。
- 记忆不等于无限收集信息，长期记忆需要用户确认。
- 不通过高频通知、过度迎合或排他性关系制造情感依赖。
- 不承诺临床心理治疗或诊断效果。
- 不自建盗版曲库，不使用非官方接口抓取私人音乐数据。
- 音乐播放与账号接入必须遵守对应平台的授权和使用规则。

## 当前产品功能

### Desktop Player / Presence / Conversation

- Player 独立展示封面、歌曲、歌手、进度、音量和基础播放控制。
- Presence 是透明、无边框、可拖动且常驻最前的 Mori 角色窗口；点击 Mori 打开或聚焦 Conversation。
- Conversation 是独立聊天窗口，只轻量展示当前音乐上下文；关闭后音乐、Presence 和聊天记录不丢失。
- 三类窗口位置保存在本机，重新启动后恢复；Playlist、Dock 和 Lyrics 尚未进入当前 Phase。

### 首页

- Mori 伙伴形象与问候
- 内嵌文字聊天入口，可把主页消息带入完整聊天页
- 从首页进入陪伴偏好设置
- 播放期间显示全局 Spotify Mini Player

### 文字聊天

- 文本消息输入
- 快捷回复
- 模拟输入状态和上下文回应
- 在对话中展示歌曲卡片
- 从聊天进入心情记录

当前回复由本地规则模拟，并非真实 AI 模型。

### 心情记录

心情记录采用四步流程：

1. 选择当前心情强度。
2. 选择具体感受标签。
3. 选择影响心情的因素。
4. 选择是否关联此刻播放的歌曲，并保存到共同记忆。

该功能用于帮助用户表达和整理感受，不进行心理诊断。

### 安静陪伴

- 展示当前播放状态
- 播放或暂停音乐
- 选择夜雨、海浪、篝火、森林等环境音
- 低打扰地结束陪伴

当前音频播放和环境音均为交互状态演示。

### 共同记忆

- 按音乐、心情、对话和生活瞬间筛选
- 记录 Mori 内真实 Spotify 收听次数、累计时长和最近收听时间
- 同一歌曲按标准化歌名与歌手聚合，底层会话按 `sessionId` 去重

音乐收听记忆来自服务端 `data/listening-history.json`；心情、对话和生活瞬间仍包含本地模拟数据。当前尚未提供编辑、删除和跨设备同步。

### 音乐集与音乐服务连接

- Spotify OAuth PKCE 登录、Token 刷新和真实歌单同步
- 连接后后台预取可读取歌单，支持 24 小时可选缓存和手动清理
- 点击歌单先进入曲目列表，再进入 Mori 风格的 Spotify 播放器
- 全局同步当前歌曲、播放状态和进度；从 Mini Player 返回完整播放页时，首屏直接复用全局状态，避免等待 SDK 期间显示错误曲目
- “接下来播放”读取 Soloist 的真实 Queue，不为桌面效果创建假歌曲列表
- 播放页 Mori 律动使用缓存的 BPM 控制周期，并以 energy、danceability 控制幅度
- 播放页“一起听”基于可用的节奏特征提供克制的陪伴描述，并连接聊天与共同记忆中的瞬间记录
- 独立音乐偏好页面，通过 MeloData 分析歌曲特征并生成用户画像
- 网易云音乐与 QQ 音乐的待合作状态
- 从歌单进入安静陪听

桌面侧栏提供“音乐集”、Mori 首页和“记忆”三个主入口。点击首页主动消息可查看完整对话；首页输入框会先发送消息，再展开文字对话。

首页与文字对话共享当前播放状态、聊天记录和输入草稿；聊天页是首页陪伴状态的展开，返回首页后会继续显示 Mori 最近一条回复。

点击歌单会进入 Mori 风格的播放器，并保留跳转 Spotify 的入口。桌面播放底层使用 Spotify Soloist，不代理、修改或下载音乐内容；Player、Presence 和 Conversation 都只通过统一 Music Context 读取状态，不直接连接 Soloist。

### 陪伴偏好

- 回复长度
- 主动开启话题的程度
- 心情音乐推荐
- 每日问候
- 安静时段
- 音乐账号、记忆与隐私入口

## 隐私与安全

### 产品原则

- 只收集实现功能所必需的数据。
- 私人经历和心情记录默认不自动转为长期记忆。
- 用户应能够查看、纠正、删除记忆并关闭记忆功能。
- 音乐平台授权应采用最小权限范围。
- 不保存音乐平台密码；正式接入应使用平台 OAuth。
- 不将私人歌单、聊天或心情数据默认用于模型训练。
- 解除音乐账号连接后，应撤销或删除相应授权信息。
- 日志和分析数据中不应记录访问令牌、私人消息或完整心情内容。

### 当前原型的数据状态

当前版本没有正式数据库。歌曲特征、用户音乐画像和 Mori 内收听历史由本机 Next.js Route Handler 写入 `data/*.json`，适合单机桌面原型。聊天与部分设置仍主要保存在 React 内存中。Spotify OAuth Token 暂存在 Electron 渲染进程的 `localStorage`；后续桌面版本应迁移到 macOS Keychain。

本地数据文件：

- `data/music-features.json`：按 ISRC 缓存基本稳定的歌曲音频特征。
- `data/music-profiles.json`：按 Spotify 用户 ID 保存可动态更新的偏好画像。
- `data/listening-history.json`：按用户和 Spotify URI 保存收听汇总与最近 200 个会话快照。

生产版本仍需补充：

- 用户身份认证和会话管理
- 服务端数据加密与访问控制
- OAuth Token 安全存储和轮换
- 记忆授权、修改、导出和删除
- 数据保留期限与隐私政策
- 滥用防护、速率限制和安全审计日志

项目当前使用 Next.js `16.4.3`，已避开 `16.4.0` 已知的关键漏洞。发布前仍应定期运行依赖审计，并移除不需要的运行时依赖。

## 技术栈

- Next.js 16
- Electron 45
- React 19
- TypeScript
- Tailwind CSS 4
- Lucide React
- pnpm
- Spotify Web API / Spotify Soloist
- MeloData 音乐特征 API

更详细的说明：

- [项目架构](docs/ARCHITECTURE.md)
- [代码结构](docs/CODE_STRUCTURE.md)
- [缓存机制](docs/CACHE_MECHANISM.md)
- [ISRC 学习文档](docs/ISRC_GUIDE.md)
- [音乐律动方案调研](docs/MUSIC_RHYTHM_RESEARCH.md)
- [Spotify Soloist 桌面播放方案调研](docs/SPOTIFY_SOLOIST_RESEARCH.md)
- [Spotify Web Playback SDK 说明](docs/SPOTIFY_WEB_PLAYBACK_SDK.md)

## 启动项目

### 环境要求

- Node.js 20 或更高版本
- pnpm 12（推荐使用 `package.json` 中声明的版本）

如果尚未启用 pnpm：

```bash
corepack enable
corepack prepare pnpm@12.3.4 --activate
```

### 安装依赖

```bash
pnpm install
```

### 配置 Spotify

1. 在 [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) 创建应用。
2. 在应用的 Redirect URIs 中精确添加：

```text
http://127.0.0.1:3210/spotify/callback
```

3. 复制 Client ID，新建 `.env.local`：

```bash
cp .env.example .env.local
```

然后填写：

```text
NEXT_PUBLIC_SPOTIFY_CLIENT_ID=你的_Client_ID
NEXT_PUBLIC_SPOTIFY_REDIRECT_URI=http://127.0.0.1:3210/spotify/callback
```

PKCE 前端授权不需要、也不应在这里填写 Client Secret。Spotify 开发模式目前要求应用所有者使用 Premium 账号；如果其他账号无法登录，还需在 Dashboard 中把该用户加入允许列表。

### 配置桌面播放

Mori Desktop 使用 Spotify Soloist 输出音频，不再在 Electron 中加载 Web Playback SDK。请从 Spotify 官方页面下载与你的平台匹配的 Soloist，并使用 Premium 账号生成个人 API Key，然后在 `.env.local` 填写：

```text
MORI_SOLOIST_PATH=/Soloist/可执行文件/绝对路径
MORI_SOLOIST_API_KEY=你的个人_API_Key
```

API Key 只由 Electron 主进程读取，不要使用 `NEXT_PUBLIC_` 前缀，也不要提交到仓库。首次启动后需要在 Spotify 官方客户端的设备列表中选择 `Mori` 完成 Connect 配对。Soloist 当前只提供 Apple Silicon macOS 构建，且官方构建有 90 天有效期；详细限制见 [Soloist 调研](docs/SPOTIFY_SOLOIST_RESEARCH.md)。

### 启动 macOS 桌面端

```bash
pnpm dev
```

该命令会在 `127.0.0.1:3210` 启动本地渲染服务，并自动打开 Player 与 Presence；点击 Mori 会创建 Conversation。Spotify 不接受 `localhost` 作为本地回调主机，请使用 `127.0.0.1`。

如需只调试渲染层，可运行 `pnpm dev:renderer`；这不是 Mori 的默认产品入口。

### 类型检查

```bash
pnpm exec tsc --noEmit
```

### 构建渲染层

```bash
pnpm build
```

当前 `pnpm build` 生成 Electron 使用的 Next.js 渲染与本地服务产物。macOS `.app` 打包、签名和公证尚未纳入本轮 MVP。

如果当前运行环境限制 Turbopack 创建本地进程或端口，可以使用：

```bash
pnpm exec next build --webpack
```

### 安全审计

```bash
pnpm audit --prod
```

## 当前阶段

Soloist Phase 1 与基础多窗口 Phase 2 已进入代码验证。下一阶段优先事项：

1. 使用有效 Soloist 官方二进制完成真实播放、首次配对和队列验证。
2. 实现记忆确认、编辑和删除。
3. 将 Spotify Token 从渲染进程存储迁移到 macOS Keychain，并实现平台侧授权撤销指引。
4. 接入真实文字 AI，并建立 Mori 人格和安全边界。
5. 按 Phase 3 实现 Playlist Window 与 Player Dock，再进行 `.app` 打包、签名和公证。

