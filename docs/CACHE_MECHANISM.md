# Mori 缓存机制

本文档说明 Mori 当前原型中的缓存与持久化机制。这里的“缓存”分为两类：

1. 浏览器端 Spotify 曲目缓存，用来减少重复加载歌单。
2. 服务端音乐数据缓存，用来复用歌曲特征、用户画像和收听历史。

两者用途、生命周期和清理方式不同，不能混为一谈。

## 1. 总览

| 数据 | 存储位置 | 主键 | 生命周期 | 用户能否清理 |
|---|---|---|---|---|
| 喜欢的歌曲 | 内存 + `sessionStorage` | `saved:{spotifyUserId}` | 最长 24 小时 | 可以 |
| 歌单曲目 | 内存 + `sessionStorage` | `playlist:{playlistId}` | 最长 24 小时 | 可以 |
| 进行中的 Spotify 请求 | 模块内 `Map` | 同上 | 请求结束前 | 间接取消复用 |
| 歌曲音频特征 | `data/music-features.json` | ISRC | 长期复用 | 当前无 UI |
| 用户音乐画像 | `data/music-profiles.json` | Spotify 用户 ID | 重新分析时更新 | 当前无 UI |
| 收听历史 | `data/listening-history.json` | 用户 ID + Spotify URI | 持续更新 | 当前无 UI |
| Spotify OAuth Token | `localStorage` | 固定 Token Key | 到期、刷新或解除连接 | 解除连接时清理 |

## 2. Spotify 曲目缓存

实现位置：`lib/spotify-track-cache.ts`。

### 2.1 为什么需要缓存

Spotify 歌单可能包含数百首歌曲，需要通过分页接口逐页读取。如果每次进入音乐集或歌单详情都重新请求，会产生以下问题：

- 页面反复显示加载动画。
- 大歌单等待时间较长。
- 页面切换过程中可能重复发起同一个请求。
- 更容易触发 Spotify API 限流。

因此 Mori 在 Spotify 连接并获得歌单列表后，后台预取当前账号有权读取的歌单曲目。

### 2.2 两层缓存

读取顺序如下：

```text
内存 Map
  ↓ 未命中或已过期
sessionStorage
  ↓ 未命中或已过期
Spotify Web API
```

#### 内存缓存

- 当前 JavaScript 页面会话中读取速度最快。
- 页面组件卸载后仍然存在，因为缓存位于模块作用域。
- 浏览器刷新或模块重新加载后会丢失。

#### `sessionStorage`

- 浏览器刷新后仍可恢复。
- 只属于当前浏览器标签页会话。
- 关闭标签页后由浏览器清理。
- 当前 TTL 为 24 小时。

如果大歌单超过浏览器的 `sessionStorage` 配额，写入失败不会阻断播放。Mori 会继续使用内存缓存，但刷新页面后该歌单可能需要重新获取。

### 2.3 缓存键

```text
mori.track-cache.saved:{spotifyUserId}
mori.track-cache.playlist:{playlistId}
```

“喜欢的歌曲”必须包含 Spotify 用户 ID，避免切换账号后误用另一个账号的数据。Spotify Playlist ID 本身全局唯一，因此普通歌单直接使用 Playlist ID。

缓存值结构：

```ts
type TrackCacheEntry = {
  savedAt: number
  tracks: SpotifyTrack[]
}
```

### 2.4 请求去重

只缓存最终结果还不够。用户可能在后台预取尚未结束时进入歌单详情，也可能切换页面后重新挂载音乐集。

Mori 使用模块级 `activeRequests` 保存正在进行的 Promise：

```text
第一次请求 playlist:A
  → 创建 Promise 并保存

第二次请求 playlist:A
  → 复用相同 Promise

请求成功或失败
  → 从 activeRequests 删除
```

这样能够保证同一时间同一个歌单最多只有一个 Spotify 请求链。页面卸载不会取消该请求，返回页面后会继续等待原任务，而不是从第一页重新读取。

### 2.5 连接后的后台预取

`ConnectScreen` 获得 Spotify 用户和歌单后会：

1. 读取全部“喜欢的歌曲”。
2. 找出本人创建或参与协作、且允许第三方读取的歌单。
3. 跳过仍在有效期内的缓存。
4. 使用最多两个并发 Worker 获取缺失歌单。
5. 每个歌单完成后立即写入缓存，并把该歌单单独更新为可播放状态。

后台预取不会阻塞歌单列表；列表摘要同步完成后会立即展示。尚未完成的歌单显示“准备中”，其他已经缓存的歌单可以直接打开。用户点击尚未缓存的歌单时，详情页会立即请求该歌单，相当于绕过后台队列优先加载；如果后台已经开始相同请求，则通过 `activeRequests` 复用该请求，不会重复拉取。

限制为两个并发任务是为了降低 Spotify 限流风险。无权读取的第三方歌单不会预取。

### 2.6 用户设置与清理

设置页提供：

- `保留音乐缓存` 开关。
- `立即清理音乐缓存` 操作。

偏好保存在：

```text
localStorage["mori.spotify.keep-track-cache"]
```

行为如下：

| 操作 | 结果 |
|---|---|
| 默认开启 | 正常读取和写入缓存 |
| 关闭开关 | 立即清除内存与会话缓存，后续不写入 |
| 手动清理 | 删除现有缓存，但不改变开关状态 |
| 解除 Spotify，开关开启 | 保留曲目缓存 |
| 解除 Spotify，开关关闭 | 清理曲目缓存 |

清理 Spotify 曲目缓存不会删除音乐画像、歌曲特征或收听记忆。

### 2.7 当前失效策略

缓存会在以下情况失效：

- 保存时间超过 24 小时。
- 用户关闭“保留音乐缓存”。
- 用户点击“立即清理音乐缓存”。
- `sessionStorage` 会话被浏览器清除。
- 开发时模块热更新导致内存缓存重建，且会话缓存没有成功写入。

当前点击“同步”主要刷新 Spotify 用户和歌单摘要，不会强制删除所有曲目缓存。后续可以根据歌单 `snapshot_id` 精确判断歌单是否变化；目前的 `SpotifyPlaylist` 类型尚未保存该字段。

## 3. 服务端歌曲特征缓存

实现位置：

- `app/api/music-profile/route.ts`
- `lib/server/music-data-store.ts`
- `data/music-features.json`

歌曲的 BPM、energy、danceability 等特征在同一录音版本中通常稳定，因此使用 ISRC 作为缓存键：

```text
ISRC → MusicFeatures
```

分析音乐偏好时：

1. 先按 ISRC 查询 `music-features.json`。
2. 已有特征直接复用。
3. 只把缺失歌曲发送给 MeloData。
4. 每两首为一批，批次之间等待，降低 429 风险。
5. 每批成功后立即保存，避免后续歌曲失败导致已完成结果丢失。

如果歌曲没有 ISRC，服务端先通过歌名和歌手解析 ISRC，再请求特征。

## 4. 用户音乐画像

实现位置：

- `components/mori/screens/music-profile-screen.tsx`
- `app/api/music-profile/route.ts`
- `data/music-profiles.json`

音乐画像和歌曲特征不同：

- 歌曲特征属于歌曲，通常保持稳定。
- 音乐画像属于用户，会随着喜欢歌曲和歌单变化。

进入音乐偏好页面时，客户端先调用：

```text
GET /api/music-profile?userId={spotifyUserId}
```

如果已有画像就直接展示，不会调用 MeloData。用户点击“重新分析”时才收集最新歌曲，并调用 POST 重新聚合画像；其中已有的歌曲特征仍然复用。

## 5. 收听历史不是临时缓存

`data/listening-history.json` 属于用户数据持久化，不是可随意丢弃的性能缓存。

播放器在以下时机保存收听快照：

- 播放期间每 5 秒。
- 暂停时。
- 切歌时。
- 离开播放器时。

服务端用 `sessionId` 更新同一次收听会话：先扣除旧快照时长，再加入新快照时长，避免每 5 秒重复累加。每首歌最多保留最近 200 个会话快照，同时维护播放次数、完成次数、累计时长、最后进度和最后播放时间。

记忆页会按标准化后的“歌名 + 歌手”合并可能来自不同 Spotify URI 的同一首歌，再使用 `sessionId` 去重。

## 6. JSON 文件写入安全

服务端写入 `data/*.json` 时采用：

```text
写入唯一临时文件
  → rename 原子替换目标文件
```

这样可以降低进程中断导致 JSON 只写入一半的风险。

当前实现没有跨进程锁。如果同时运行多个 Next.js 实例，仍可能出现读改写竞争，因此只适合单机 MVP。生产环境应迁移到数据库，并使用事务、唯一约束或原子更新。

## 7. 缓存命中示例

### 再次进入同一个歌单

```text
进入歌单
  → 内存命中
  → 立即显示歌曲
```

### 刷新页面后进入歌单

```text
进入歌单
  → 内存未命中
  → sessionStorage 命中且未超过 24 小时
  → 恢复内存缓存并立即显示
```

### 后台预取过程中进入歌单

```text
后台正在请求 playlist:A
  → 详情页请求 playlist:A
  → 命中 activeRequests
  → 两个页面等待同一个 Promise
```

### 重新分析音乐偏好

```text
100 首输入歌曲
  → 93 首 ISRC 已有特征
  → 直接读取 93 首
  → 仅向 MeloData 请求剩余 7 首
  → 合并后更新用户画像
```

## 8. 后续改进

1. 保存 Spotify `snapshot_id`，只在歌单版本发生变化时失效。
2. 大歌单从 `sessionStorage` 迁移到 IndexedDB，避免容量限制。
3. 为缓存增加大小统计、最近使用时间和按歌单清理。
4. 将 JSON 文件迁移到正式数据库。
5. 为音乐画像增加版本号、输入集合摘要和自动增量更新。
6. 为敏感用户数据增加删除、导出、保留期限和访问控制。

