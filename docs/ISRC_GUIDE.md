# ISRC 学习与项目落地指南

更新日期：2026-10-24

## 1. 一句话理解 ISRC

**ISRC（International Standard Recording Code，国际标准录音制品编码）是某一个具体录音版本的全球标识符。**

它标识的是 recording，不是抽象意义上的“歌曲”。同一首作品可能存在录音室版、现场版、混音版、重新录制版等多个录音，因此可能对应多个 ISRC。

例如《某首歌》可以同时拥有：

```text
歌曲/作品
├── 2018 年录音室版       → ISRC A
├── 2021 年演唱会现场版   → ISRC B
├── 2023 年 DJ Remix      → ISRC C
└── 原录音的无损格式版本   → 通常仍使用 ISRC A
```

IFPI 明确说明：ISRC 用于识别录音和音乐视频，不用于识别作曲作品、歌词、歌手、专辑或文件格式。[IFPI：ISRC 官方说明](https://isrc.ifpi.org/)

## 2. ISRC 为什么存在

仅靠“歌名 + 歌手”无法可靠识别录音：

- 同名歌曲可能来自不同歌手。
- 同一首歌可能有现场版、伴奏版、剪辑版和混音版。
- 不同语言、地区或平台可能使用不同的标题写法。
- 同一录音可能被重复收录到单曲、专辑和精选集中。

ISRC 提供了跨平台、跨地区、跨发行渠道识别具体录音的稳定键。发行商、流媒体、广播机构和版权管理机构会用它连接录音元数据、使用记录和收益分配。[IFPI：为什么使用 ISRC](https://isrc.ifpi.org/why-use-isrc)

## 3. ISRC 的结构

ISRC 由 12 个字母或数字组成，常见展示形式为：

```text
ISRC AA-6QZ-20-00047
     └─┬─┘ └┬┘ └─┬─┘
      Prefix Year Designation
```

拆解如下：

| 部分 | 长度 | 示例 | 含义 |
|---|---:|---|---|
| Prefix Code | 5 | `AA6QZ` | 由 ISRC 机构分配的注册者前缀 |
| Year of Reference | 2 | `20` | 分配 ISRC 的年份后两位 |
| Designation Code | 5 | `00047` | 注册者在该年份分配的唯一顺序码 |

在 API 和数据库中通常去掉 `ISRC`、空格和连字符，规范化为：

```text
AA6QZ2000047
```

IFPI 对结构的官方说明见 [ISRC 官方网站](https://isrc.ifpi.org/) 和 [ISRC Handbook](https://isrc.ifpi.org/isrc-standard/isrc-handbook)。

### 常见误解

前两位字符不应被理解为录音的创作国家、歌手国籍或版权归属。IFPI 说明这些字符本身只用于构成标识符；ISRC 也不直接证明权利所有权。[IFPI：为什么使用 ISRC](https://isrc.ifpi.org/why-use-isrc)

## 4. ISRC 标识什么、不标识什么

| 对象 | 是否使用 ISRC | 说明 |
|---|---:|---|
| 一次具体的录音室录音 | 是 | ISRC 的核心对象 |
| 现场录音 | 是 | 与录音室版通常是不同 ISRC |
| Remix/Edit | 是 | 内容发生实质变化，需要新 ISRC |
| 同一录音的 MP3/FLAC/WAV | 通常相同 | 格式、码率或分辨率变化不等于新录音 |
| 同一录音被收录进精选集 | 通常相同 | 未修改录音时继续使用原 ISRC |
| 仅做普通 remaster | 通常相同 | 有重大创造性变化时才可能需要新 ISRC |
| 作曲作品或歌词 | 否 | 音乐作品使用 ISWC 等标识体系 |
| 专辑/CD/数字发行产品 | 否 | 产品通常使用 UPC/EAN 等标识 |
| 歌手 | 否 | 艺术家使用平台 ID、ISNI 等其他标识 |

IFPI 规定，现场版、remix/edit、播放时长显著变化等情况通常需要新 ISRC；同一录音换格式、码率或发行渠道通常保留原 ISRC。[IFPI FAQ](https://isrc.ifpi.org/faqs)、[何时分配新 ISRC](https://isrc.ifpi.org/why-use-isrc/when-to-assign)

## 5. ISRC 与其他 ID 的区别

### ISRC 与 Spotify Track ID

| 特征 | ISRC | Spotify Track ID |
|---|---|---|
| 所属范围 | 跨平台行业标识 | Spotify 内部标识 |
| 标识对象 | 具体录音 | Spotify 目录中的一个 track 条目 |
| 跨平台匹配 | 适合 | 不适合 |
| 是否可能一对多 | 一个 ISRC 可能对应多个平台条目 | 一个 ID 对应一个 Spotify 条目 |
| 示例 | `USRC17607839` | `4u7EnebtmKWzUH433cf5Qv` |

同一录音可能在 Spotify 中作为单曲、专辑曲目和精选集曲目出现，从而存在多个 Spotify Track ID，但这些条目可能共享同一个 ISRC。

Spotify Track 对象通过 `external_ids.isrc` 返回 ISRC。[Spotify Get Track](https://developer.spotify.com/documentation/web-api/reference/get-track)

### ISRC 与 ISWC

- **ISRC**：识别录音。例如某位歌手在某次录音中演唱的版本。
- **ISWC**：识别音乐作品/作曲本身。例如词曲作者创作的那首作品。

同一 ISWC 对应的作品可以由不同歌手录制，每个录音拥有自己的 ISRC。

### ISRC 与 UPC/EAN

- **ISRC**：识别一首具体录音。
- **UPC/EAN**：通常识别专辑、单曲发行包或商品。

一张专辑通常有一个 UPC/EAN，但其中每首录音分别拥有 ISRC。

## 6. 为什么 Mori 使用 ISRC

Mori 需要把 Spotify 曲目和 MeloData 特征连接起来：

```text
Spotify Track
  └── external_ids.isrc
        └── MeloData /tracks/{isrc}/features
              └── BPM、energy、danceability 等
```

ISRC 在这里充当跨服务连接键：

- Spotify Track ID 只在 Spotify 内有效。
- 歌名和歌手容易受到语言、标点、版本名称影响。
- ISRC 更接近“具体录音版本”，适合缓存音频特征。
- 多个 Spotify 条目共享相同 ISRC 时，只需向 MeloData 查询一次。

当前 Mori 将歌曲特征按 ISRC 保存在：

```text
data/music-features.json
```

示意结构：

```json
{
  "USRC17607839": {
    "isrc": "USRC17607839",
    "bpm": 150.2,
    "tempoConfidence": 0.82,
    "energy": 0.71,
    "danceability": 0.4,
    "valence": null,
    "acousticness": null,
    "instrumentalness": null
  }
}
```

## 7. Mori 中的完整数据流

```text
用户连接 Spotify
  ↓
读取喜欢的歌曲与可访问歌单
  ↓
取得 Spotify Track 对象
  ↓
读取 external_ids.isrc
  ↓
按 ISRC 去重
  ↓
检查服务器 music-features.json
  ├── 已缓存 → 直接复用
  └── 未缓存 → 调用 MeloData
                  ↓
                写入特征缓存
  ↓
聚合歌曲特征
  ↓
写入该用户的 music-profiles.json
```

这解释了为什么歌曲特征和用户画像应分开保存：

- 一首录音的 BPM、能量等特征可供所有用户复用。
- 用户画像是多个录音特征的聚合结果，需要随用户收藏和行为变化更新。

## 8. 规范化与校验

### 规范化函数

```ts
export function normalizeIsrc(input: string) {
  return input
    .trim()
    .toUpperCase()
    .replace(/^ISRC\s*/, '')
    .replaceAll('-', '')
    .replaceAll(' ', '')
}
```

例如：

```text
isrc us-rc1-76-07839
US-RC1-76-07839
USRC17607839
```

规范化后都是：

```text
USRC17607839
```

### 格式校验

```ts
export function isValidIsrc(value: string) {
  return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(normalizeIsrc(value))
}
```

这个正则只能验证语法，不能证明：

- ISRC 已真实注册。
- 元数据对应正确录音。
- 发行商没有误填或重复分配。
- 当前平台返回的是预期版本。

## 9. 工程中的常见问题

### 9.1 缺少 ISRC

本地文件、部分旧录音或不完整平台数据可能没有 ISRC。Mori 当前可以退回到“歌名 + 第一位歌手”让 MeloData 尝试解析，但这条路径存在误匹配风险。

推荐顺序：

```text
ISRC 精确匹配
→ Spotify Track ID 对照服务
→ 歌名 + 歌手 + 专辑 + 时长模糊匹配
→ 无法确认时不写入永久缓存
```

### 9.2 一个 ISRC 对应多个 Spotify Track ID

这是正常情况，常见于同一录音同时出现在原专辑、精选集和重新发行版本中。Mori 应按 ISRC 去重歌曲特征，但在播放层面仍保留 Spotify Track ID/URI。

### 9.3 同一首歌存在多个 ISRC

也可能是正常情况，因为“歌”不是“录音”。现场版、remix、重新录制版应该分别分析，不能只靠标题合并。

此外，现实数据中也可能存在发行商错误分配或重复编码，因此 ISRC 是优秀的主匹配键，但不是绝对无误的真相源。

### 9.4 ISRC 不应作为数据库唯一实体的全部信息

建议歌曲特征表仍保留辅助信息：

```json
{
  "isrc": "USRC17607839",
  "title": "Bohemian Rhapsody",
  "artist": "Queen",
  "durationMs": 354320,
  "source": "melodata",
  "analysisVersion": "1.9",
  "fetchedAt": "2026-10-24T09:00:00Z"
}
```

这些字段可以帮助人工排查版本误配，但不应取代 ISRC 成为跨平台主键。

## 10. 推荐的数据模型

### 录音标识

```ts
type RecordingIdentity = {
  isrc: string
  spotifyTrackIds: string[]
  title: string
  artists: string[]
  durationMs: number
}
```

### 歌曲特征

```ts
type RecordingFeatures = {
  isrc: string
  bpm: number | null
  tempoConfidence: number | null
  energy: number | null
  danceability: number | null
  valence: number | null
  acousticness: number | null
  instrumentalness: number | null
  source: 'melodata'
  analysisVersion: string | null
  fetchedAt: string
}
```

### 用户偏好

```ts
type MusicProfile = {
  spotifyUserId: string
  sampleIsrcs: string[]
  averageBpm: number | null
  energy: number | null
  danceability: number | null
  valence: number | null
  acousticness: number | null
  updatedAt: string
}
```

## 11. 学习检查题

1. 为什么同一首歌的现场版和录音室版通常不能共用歌曲特征？
2. 为什么相同 ISRC 的单曲版和精选集收录版通常可以复用 BPM？
3. 为什么不能仅用歌名作为 `music-features` 的缓存键？
4. Spotify Track ID 和 ISRC 分别应该用于播放层还是跨平台数据层？
5. ISRC 的前两位字符是否代表歌手国籍？

答案：

1. 它们是不同录音，通常具有不同 ISRC 和音频特征。
2. 如果音频录音未发生改变，它们是同一个 recording。
3. 同名歌曲、版本差异和多语言元数据会造成冲突。
4. Spotify Track ID/URI 用于 Spotify 播放，ISRC 用于跨平台匹配和特征缓存。
5. 不是。它属于分配标识结构，不应解释为歌手国籍或录音来源地。

## 12. 延伸阅读

- [IFPI ISRC 官方网站](https://isrc.ifpi.org/)
- [IFPI ISRC FAQ](https://isrc.ifpi.org/faqs)
- [ISRC Handbook](https://isrc.ifpi.org/isrc-standard/isrc-handbook)
- [Spotify Track API](https://developer.spotify.com/documentation/web-api/reference/get-track)
