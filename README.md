# Mori

Mori 是一款以音乐为纽带的 AI 陪伴产品。

> From Music to the World.  
> 陪你听歌，也陪你走向更广阔的世界。

当前仓库包含 Mori 移动端 MVP 的高保真交互原型。Spotify 已支持真实授权、歌单读取与 Premium Web Playback SDK 播放；歌曲特征、音乐画像和 Mori 内收听记录使用本地服务端 JSON 持久化。文字 AI、心情与部分陪伴内容仍为原型状态。

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
- “接下来播放”优先读取 Spotify Web Playback SDK 的真实待播队列，尚未取得队列时才按当前歌曲在歌单中的位置回退展示
- 播放页 Mori 律动使用缓存的 BPM 控制周期，并以 energy、danceability 控制幅度
- 播放页“一起听”基于可用的节奏特征提供克制的陪伴描述，并连接聊天与共同记忆中的瞬间记录
- 独立音乐偏好页面，通过 MeloData 分析歌曲特征并生成用户画像
- 网易云音乐与 QQ 音乐的待合作状态
- 从歌单进入安静陪听

底部导航左侧的“音乐集”直接进入“我的音乐世界”；中间 Mori 图标返回 Mori 首页；右侧进入共同记忆。点击首页主动消息可查看完整对话；首页输入框会先发送消息，再展开文字对话。

首页与文字对话共享当前播放状态、聊天记录和输入草稿；聊天页是首页陪伴状态的展开，返回首页后会继续显示 Mori 最近一条回复。

点击歌单会进入 Mori 风格的播放器，并保留跳转 Spotify 的入口。播放底层使用 Spotify Web Playback SDK，不代理、修改或下载音乐内容；Mori 内播放需要 Spotify Premium，并需要 `streaming`、读取播放状态和控制播放权限。

从 Mini Player 恢复完整播放器时，会在点击手势内激活浏览器音频，以满足 Safari 等浏览器对 SDK 发声的限制。打开页面本身只读取 Spotify 状态，不自动转移设备或改变播放；播放、暂停和切歌仅由用户在 Mori 中的明确操作触发。

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

当前版本没有正式数据库。歌曲特征、用户音乐画像和 Mori 内收听历史由 Next.js Route Handler 写入 `data/*.json`，适合单机开发原型，不适合多实例部署或高并发写入。聊天与部分设置仍主要保存在 React 内存中。Spotify OAuth Token 保存在当前浏览器的 `localStorage`，仅适合 MVP 原型；生产版本应改为受保护的服务端会话或更强的设备安全存储。

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
- React 19
- TypeScript
- Tailwind CSS 4
- Lucide React
- pnpm
- Spotify Web API / Web Playback SDK
- MeloData 音乐特征 API

更详细的说明：

- [代码结构](docs/CODE_STRUCTURE.md)
- [缓存机制](docs/CACHE_MECHANISM.md)
- [ISRC 学习文档](docs/ISRC_GUIDE.md)
- [音乐律动方案调研](docs/MUSIC_RHYTHM_RESEARCH.md)
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

### 配置 Spotify（真实歌单）

1. 在 [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) 创建应用。
2. 在应用的 Redirect URIs 中精确添加：

```text
http://127.0.0.1:3000/spotify/callback
```

3. 复制 Client ID，新建 `.env.local`：

```bash
cp .env.example .env.local
```

然后填写：

```text
NEXT_PUBLIC_SPOTIFY_CLIENT_ID=你的_Client_ID
NEXT_PUBLIC_SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/spotify/callback
```

PKCE 前端授权不需要、也不应在这里填写 Client Secret。Spotify 开发模式目前要求应用所有者使用 Premium 账号；如果其他账号无法登录，还需在 Dashboard 中把该用户加入允许列表。

### 启动开发环境

```bash
pnpm dev
```

打开 [http://127.0.0.1:3000](http://127.0.0.1:3000)。Spotify 不接受 `localhost` 作为本地回调主机，请使用 `127.0.0.1`。手机宽度下显示全屏 App，桌面宽度下显示手机原型框架和产品说明。

### 类型检查

```bash
pnpm exec tsc --noEmit
```

### 生产构建

```bash
pnpm build
```

如果当前运行环境限制 Turbopack 创建本地进程或端口，可以使用：

```bash
pnpm exec next build --webpack
```

### 启动生产构建

```bash
pnpm start
```

### 安全审计

```bash
pnpm audit --prod
```

## 当前阶段

项目目前处于交互原型和 MVP 验证阶段。下一阶段优先事项：

1. 持久化心情、记忆、设置和播放状态。
2. 实现记忆确认、编辑和删除。
3. 将 Spotify Token 从浏览器存储迁移到安全的服务端会话，并实现平台侧授权撤销指引。
4. 接入真实文字 AI，并建立 Mori 人格和安全边界。
5. 完善异常状态、隐私控制和用户测试指标。

