# Mori 音乐律动数据方案调研报告

更新日期：2026-10-24（Asia/Tokyo）

> 目前采用的是MeloData，使用ISRC策略获取歌曲信息。

## 1. 调研目标

目标是在 Mori 的 Spotify 播放页中，让角色下方的三根律动柱尽可能贴合当前歌曲，同时评估数据覆盖率、同步精度、接入成本、运行稳定性和 Spotify 合规风险。

本报告区分三个容易混淆的能力：

- **动画律动**：只要歌曲播放就随机起伏，不依赖歌曲数据。
- **BPM 跟拍**：按整首歌的平均 BPM 改变动画周期，但不知道真正的第一拍在哪里。
- **逐拍同步**：拥有每一拍的时间戳与置信度，能够在拖动进度后继续对准拍点。

结论先行：ReccoBeats、MeloData、GetSongBPM 主要适合 BPM 跟拍；Cyanite 更适合拥有合法音源的自有曲库；只有对完整音频执行 Essentia/librosa 一类 beat tracking，才能得到可靠的逐拍时间轴。Spotify Web Playback SDK 本身不提供 PCM、波形、BPM 或逐拍数据。

## 2. 总体比较

| 方案 | 输入 | BPM | 能量/舞曲性 | 逐拍时间戳 | Spotify 场景覆盖 | 费用 | Mori 适配度 |
|---|---|---:|---:|---:|---:|---:|---:|
| ReccoBeats 曲库查询 | 曲目匹配/服务内 ID | 是 | 是 | 否 | 中高，需实测中文及日文曲库 | 免费 | 高，适合原型 |
| MeloData | ISRC 或歌名 + 歌手 | 是，带置信度 | 是 | 否 | 中高，约 185 万首归档加按需分析 | 免费至 $299/月 | 最高，适合产品化验证 |
| GetSongBPM | 歌名 + 歌手 | 是 | 舞曲性、声学性 | 否 | 中，版本匹配风险较高 | 免费，强制回链 | 中，适合备用源 |
| Cyanite | 有权上传的音频文件 | 是 | 丰富，含分段标签 | 未明确提供 beat grid | 不适用于直接分析 Spotify 流 | API 约 €290/月起，另计使用量 | 低，除非转向自有曲库 |
| 自建 Essentia/librosa | 有权处理的完整音频 | 是 | 可扩展 | 是 | 不适用于直接获取 Spotify 流 | 软件免费，承担计算/存储 | 自有音源下最高 |
| 人工维护节拍数据 | 人工录入 BPM/首拍/变速点 | 是 | 可录入 | 可录入 | 只覆盖精选歌曲 | 人力成本 | 小曲库高，大曲库低 |

## 3. 方案一：ReccoBeats

### 能力与接口

ReccoBeats 提供曲目音频特征接口 `GET /v1/track/:id/audio-features`，返回 tempo、energy、danceability、loudness、valence 等整曲特征。它也提供上传音频的 `/v1/analysis/audio-features`，支持 MP3、OGG、WAV、AIFF 等格式，但单文件上限 5 MB，最多分析前 30 秒。

官方说明服务无需 API Key，可用于个人和商业项目且当前免费。限流数值没有公开，只说明超限返回 429，并建议缓存与遵守 `Retry-After`。

来源：

- [ReccoBeats 音频特征接口](https://reccobeats.com/docs/apis/get-track-audio-features)
- [ReccoBeats 上传分析说明](https://reccobeats.com/docs/documentation/Analysis/audio-features-extraction)
- [ReccoBeats 限流说明](https://reccobeats.com/docs/documentation/rate-limiting)
- [ReccoBeats 使用条款](https://reccobeats.com/docs/documentation/terms-of-service)

### 对 Mori 的价值

可以用 `tempo` 决定柱子的周期，用 `energy` 决定最大高度，用 `danceability` 决定三根柱子之间的差异。它不返回每一拍的时间戳，因此动画只能以 BPM 近似跟拍。若不知道歌曲的第一拍偏移量，动画可能速度正确但相位不对。

### 优点

- 无需密钥，原型接入最快。
- 可同时获得 BPM、能量、舞曲性，动画不必只改变速度。
- 可作为 Spotify 已下线/受限 Audio Features 的替代数据源。

### 风险

- 官方不公布固定限流和 SLA，生产稳定性不可预测。
- 服务条款明确按“现状可用”提供，可能随时修改或停止。
- 曲库命中率、亚洲音乐覆盖率、不同发行版本的匹配准确率需要实测。
- 上传分析仍要求 Mori 自己拥有合法音频文件，Spotify 流不能导出后上传。

### 结论

适合作为两周内完成验证的首选原型方案，不建议作为无缓存、无备用源的唯一生产依赖。

## 4. 方案二：MeloData

### 能力与接口

MeloData 以 ISRC 为主要标识，`GET /v1/tracks/{isrc}/features` 返回 BPM、tempo confidence、key、energy、danceability、valence、loudness 和 time signature。也提供歌名/歌手解析到 ISRC 的接口，并返回匹配置信度；低置信度结果会给出警告。

未缓存歌曲会返回 202 并排队分析，客户端按 `Retry-After` 有界重试。官方说明当前曲库由约 185 万首 AcousticBrainz 归档数据和可用预览片段的按需分析组成。分析基于预览时，结果可能只代表歌曲的一部分。

截至本报告日期的公开套餐：

| 套餐 | 月费 | 月查询量 | 速率上限 |
|---|---:|---:|---:|
| Free | $0 | 1,000 | 5 次/秒、100 次/分钟 |
| Dev | $19 | 25,000 | 10 次/秒、300 次/分钟 |
| Pro | $79 | 200,000 | 25 次/秒、1,000 次/分钟 |
| Scale | $299 | 1,000,000 + SLA | 50 次/秒、3,000 次/分钟 |

来源：[MeloData API 文档、价格与限制](https://melodata.voltenworks.com/docs)

### 对 Mori 的价值

这是最适合产品化实验的数据源。Mori 可以从 Spotify Track ID 请求 Spotify `Get Track`，取得 `external_ids.isrc`，再用 ISRC 查询 MeloData。Spotify 官方 Track 对象当前仍包含 ISRC。

来源：[Spotify Get Track](https://developer.spotify.com/documentation/web-api/reference/get-track)

动画映射建议：

- `bpm >= 60` 且 `tempo_confidence >= 0.65`：启用 BPM 跟拍。
- `energy`：控制最大柱高和发光强度。
- `danceability`：控制节拍间的变化幅度。
- 低置信度或字段为空：退回柔和默认律动，不展示“同步节拍”字样。

### 优点

- 使用 ISRC，能区分原版、现场版、混音版等具体录音。
- BPM 带置信度，便于决定是否启用跟拍。
- 价格、限流、配额和错误语义清楚。
- 支持批量预分析，适合在打开歌单时提前预热缓存。

### 风险

- 仍只有整曲 BPM，没有 beat grid，也没有首拍偏移。
- 新歌可能先返回 202，无法保证首次播放立即取得数据。
- 依赖 iTunes/Deezer 可用预览做按需分析；无预览歌曲可能永久不可用。
- 这是较新的服务，应通过真实歌单做覆盖率和稳定性验证。

### 结论

如果要把功能做成可维护的产品能力，MeloData 是当前综合最优选择。建议先用 Free 套餐做 200–500 首中、日、英歌曲的命中率与 BPM 误差测试。

## 5. 方案三：GetSongBPM

### 能力与接口

GetSongBPM 使用歌名和歌手搜索，结果包含整数 BPM、拍号、调性、danceability 和 acousticness。API 免费，但必须注册 API Key，并在网站或商店页面提供指向 GetSongBPM 的链接。限流为每小时 3,000 次，超限后 Key 会被阻止一小时。

来源：[GetSongBPM API 文档](https://getsongbpm.com/api)

### 对 Mori 的价值

可直接使用 Web Playback SDK 已经提供的歌曲名和歌手名查询，不必额外读取 ISRC。适合作为 MeloData/ReccoBeats 未命中时的第二备用源。

### 优点

- 免费，调用模型简单。
- 曲库宣称覆盖超过 600 万首。
- 同时返回拍号，未来可以让 3/4、4/4 等歌曲使用不同的视觉重音模式。

### 风险

- 歌名并不是稳定主键；现场版、重制版、伴奏版和同名歌曲容易误匹配。
- BPM 是整数，精度低于提供小数 BPM 的服务。
- 没有匹配置信度和逐拍时间轴。
- 强制回链会影响 UI 和法务文案。

### 结论

适合作为低成本备用源，不建议作为主数据源。接入时必须同时校验歌手、专辑、时长和发行年份，不能直接采用第一条搜索结果。

## 6. 方案四：Cyanite

### 能力与接口

Cyanite 是面向音乐企业的分析与标签平台。它能输出 BPM、拍号、能量、情绪、流派、乐器等数据，并提供约 15 秒粒度的分段标签。标准流程是上传音频、等待异步分析、接收 Webhook，再读取结果。

官方快速开始要求上传 MP3 文件，常规限制为 20 MB、15 分钟。分析通常从几秒到 30 秒。免费账户每月可分析 5 首；官方产品文章列出的 API 基础费约为 €290/月，实际费用还取决于曲库规模和分析量。

来源：

- [Cyanite REST API 快速开始](https://docs.cyanite.ai/docs/intro/)
- [Cyanite 功能与价格 FAQ](https://cyanite.ai/faq/)
- [Cyanite 音频分析字段](https://api-docs.cyanite.ai/docs/audio-analysis-v6-classifier/)

### 对 Mori 的价值

如果 Mori 未来接入用户自有音乐、独立音乐人授权曲库或品牌自有音源，Cyanite 可以让动画不仅按 BPM 变化，还根据不同段落的能量和情绪改变。但公开资料没有证明它会返回每一拍的时间戳，因此不能把它等同于精确 beat tracking。

### 优点

- 音乐特征丰富，支持段落级变化。
- 有企业支持、Webhook、批量处理和商业服务。
- 除律动外，还能支持情绪标签、推荐和自然语言检索。

### 风险

- 必须拿到并上传音频，不适合当前纯 Spotify 播放链路。
- 成本显著高于仅查询 BPM 的服务。
- 异步分析不适合第一次播放时即时等待。
- 需要处理音频版权、用户授权、存储期限和删除流程。

### 结论

当前不推荐。只有 Mori 获得合法、自有或用户明确授权上传的音频文件，并且需要更广泛的音乐智能功能时才值得采用。

## 7. 方案五：自建 Essentia/librosa 分析服务

### 能力

Essentia 的 `RhythmExtractor2013` 可以输出 BPM、每个 beat 的时间位置、置信度和拍间隔。官方建议的 `multifeature` 模式更准确但更慢，而且算法依赖整首歌的统计信息，不适合边播放边做实时检测。librosa 也提供 `beat_track`、`tempo` 和 PLP 等节拍分析能力。

来源：

- [Essentia beat detection 与 BPM 教程](https://essentia.upf.edu/tutorial_rhythm_beatdetection.html)
- [librosa Beat and Tempo API](https://librosa.org/doc/latest/api/)

### 推荐架构

1. 对拥有处理权的音频做离线分析。
2. 保存 `{ bpm, beatTimes[], confidence, energyEnvelope[] }`。
3. 用 ISRC 或内部录音 ID 建立缓存。
4. 播放时依据 Spotify `position` 二分查找下一拍。
5. 拖动进度或切歌后重新定位，避免计时器累计漂移。

### 优点

- 唯一能够完全掌控逐拍时间轴和算法版本的方案。
- 可离线批处理，播放时只读取很小的 JSON。
- 可增加 onset、段落、能量包络等更细的视觉驱动数据。

### 风险

- 最大阻碍不是算法，而是合法音源。Spotify SDK 不提供可送入分析器的 PCM 数据。
- 需要音频上传、对象存储、任务队列、分析 worker、缓存和删除机制。
- 变速、弱拍、古典乐、现场录音等曲目仍可能检测错误，需要置信度和人工纠正。

### 结论

自有音源场景下是技术上最准确的长期方案；当前 Spotify-only 场景下不可行。

## 8. 方案六：人工维护精选曲目节拍数据

### 做法

针对展示用或重点歌单，为每个 ISRC 保存：

```json
{
  "isrc": "...",
  "bpm": 92.4,
  "firstBeatMs": 380,
  "meter": 4,
  "sections": [
    { "startMs": 0, "energy": 0.3 },
    { "startMs": 42000, "energy": 0.8 }
  ]
}
```

### 优点

- 精选歌曲可以获得最可靠的视觉体验。
- 不依赖第三方服务在线可用性。
- 可人工处理半拍/双倍 BPM、弱起和变速问题。

### 风险

- 无法扩展到用户任意歌单。
- 数据制作与版本维护成本高。
- 同一歌曲的不同录音、重制版、现场版不能共用一组节拍数据。

### 结论

适合产品演示和官方精选歌单，不适合作为完整产品方案。

## 9. Spotify 合规评估

Spotify Developer Policy 明确禁止把通过 Spotify Platform 访问的录音与视觉媒体同步，Web Playback SDK 文档也重复了这一限制。其示例列举广告、影片、电视、幻灯片、视频或类似内容；角色旁的节拍动画是否构成被禁止的“类似视觉内容”并没有针对性豁免。

来源：

- [Spotify Developer Policy](https://developer.spotify.com/policy)
- [Spotify Web Playback SDK Reference](https://developer.spotify.com/documentation/web-playback-sdk/reference)
- [Spotify Compliance Tips](https://developer.spotify.com/compliance-tips)

风险判断：

- **普通播放状态动画**：较低风险。动画表达“正在播放”，不声称与内容同步。
- **仅按平均 BPM 改变速度**：中等风险。已经与录音特征形成同步关系。
- **逐拍、歌词、段落精确同步**：高风险，接近政策明确限制的同步用途。

因此在没有 Spotify 书面确认前，不建议把功能命名为“实时节拍同步”，也不建议把逐拍动画作为商业发布卖点。此处是产品风险判断，不构成法律意见。

## 10. 推荐决策

### 推荐路线：分两阶段

**阶段 1：低风险数据验证，不直接上线逐拍同步**

1. 服务器端接 MeloData Free，密钥不暴露给浏览器。
2. 用 Spotify Track ID 获取 ISRC，再查询 BPM、energy、danceability 和 tempo confidence。
3. 对 200–500 首中、日、英歌曲离线统计覆盖率和误差。
4. 缓存结果 30–90 天；202 按 `Retry-After` 最多重试 3 次。
5. ReccoBeats 作为实验对照，不直接作为唯一生产源。

**阶段 2：完成政策确认后再决定 UI 行为**

- 若 Spotify 明确允许：以 BPM 控制动画周期，以 energy 控制幅度；使用播放进度重新计算相位，避免漂移。
- 若无法确认：数据只用于非同步的情绪化动画参数，例如快歌更活泼、慢歌更舒缓，但不逐拍闪动。
- 若未来转为自有授权曲库：采用 Essentia 离线生成 beat grid，获得真正逐拍同步。

### 建议的降级链

```text
MeloData 高置信度结果
  → ReccoBeats/GetSongBPM 备用结果
  → 按歌曲类别选择非同步动画
  → 完全查不到时使用当前柔和默认律动
```

### 上线门槛

- 曲目匹配准确率 ≥ 98%，不同版本不得误配。
- 目标地区歌单 BPM 命中率 ≥ 85%。
- 低置信度数据不得驱动跟拍。
- 第三方请求失败不能影响播放控制。
- API Key 只能保存在服务端。
- 在上线前取得 Spotify 对具体表现方式的书面政策确认。

## 11. 最终结论

- **最快原型**：ReccoBeats。
- **综合最佳产品验证**：MeloData。
- **最佳免费备用源**：GetSongBPM。
- **自有/授权曲库的企业分析**：Cyanite。
- **真正逐拍同步**：自建 Essentia/librosa，但必须拥有合法音频。
- **当前 Mori 最稳妥的产品选择**：先做 MeloData 离线覆盖率实验；UI 继续使用非精确同步的柔和动画，待 Spotify 合规确认后再开启 BPM 跟拍。

## 12. 当前原型落地状态（2026-10-24）

当前实现采用“歌曲级特征可视化”，不是实时音频频谱：

1. 播放页根据 Spotify 曲目的 ISRC 请求 `/api/music-features`。
2. 接口只读取服务端 `data/music-features.json` 中已经由 MeloData 分析并缓存的特征，不因播放动作额外消耗分析额度。
3. BPM 只用于计算动画周期，不能代表歌曲是否激烈。
4. energy 作为振幅的主要参数，danceability 作为辅助参数。
5. 低强度歌曲以两拍完成一次变化，并使用较小的最大柱高和缓慢光圈。
6. 缺失特征时回退到 96 BPM、低 energy 和低 danceability，优先保证平稳体验。
7. 暂停时停止柱状律动；系统开启 `prefers-reduced-motion` 时禁用相关动画。

### 本次验证得到的实现原则

- 不得只用 BPM 同时控制速度和振幅。快但平稳的歌曲并不等于高能量歌曲。
- 不应让所有歌曲都达到相同最大柱高，否则即使周期正确，视觉上仍会显得激烈。
- 回退参数必须保守；数据缺失时宁可轻微呼吸，也不要制造虚假的强烈节拍。
- 当前没有 beat grid 和首拍偏移，因此五根柱子只是依据整曲特征生成的近似律动，文案和代码注释均不得称为“实时同步”。
