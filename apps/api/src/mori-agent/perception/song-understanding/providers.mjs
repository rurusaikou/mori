/** Perception 可选外部证据 Provider：未配置时返回 null，不用伪数据填满四层。 */
export function createSongEvidenceProviders({ env = process.env, fetchImpl = fetch } = {}) {
  return {
    lyrics: createLyricsProvider(env, fetchImpl),
    credits: createMusicBrainzProvider(env, fetchImpl),
    reception: createLastFmProvider(env, fetchImpl),
  }
}

function createLyricsProvider(env, fetchImpl) {
  const endpoint = env.MORI_LYRICS_INSIGHT_ENDPOINT?.trim()
  if (!endpoint) return null
  return {
    async get(track) {
      // 这里只接收已经授权的“歌词洞察”服务。完整歌词不进入 Mori API、日志或缓存，
      // 避免 Song Agent 在长期数据中复制受版权保护的歌词正文。
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(env.MORI_LYRICS_INSIGHT_API_KEY ? { Authorization: `Bearer ${env.MORI_LYRICS_INSIGHT_API_KEY}` } : {}) },
        body: JSON.stringify({ isrc: track.isrc, title: track.title, artist: track.artist }),
        signal: AbortSignal.timeout(12_000),
      })
      if (!response.ok) throw new Error(`Lyrics Insight 请求失败（${response.status}）`)
      const data = await response.json()
      return { ...data, source: { provider: 'lyrics_insight', label: data.sourceLabel || 'Licensed lyrics insight', url: data.sourceUrl || '' } }
    },
  }
}

function createMusicBrainzProvider(env, fetchImpl) {
  if (env.MORI_MUSICBRAINZ_ENABLED?.trim().toLowerCase() !== 'true') return null
  return {
    async get(track) {
      if (!track.isrc) return null
      // ISRC 先定位 Recording，再保留其 Work 关系。V0.1 不把表演艺人误写为作词/作曲，
      // Contributor 需要后续继续查询 Work relationships 后才能进入 creation layer。
      const url = `https://musicbrainz.org/ws/2/isrc/${encodeURIComponent(track.isrc)}?inc=recordings+artist-credits+work-rels&fmt=json`
      const response = await fetchImpl(url, {
        headers: { 'User-Agent': env.MORI_MUSICBRAINZ_USER_AGENT?.trim() || 'Mori/0.1 (local-development)' },
        signal: AbortSignal.timeout(12_000),
      })
      if (!response.ok) throw new Error(`MusicBrainz 请求失败（${response.status}）`)
      const data = await response.json()
      const recording = data.recordings?.[0]
      if (!recording) return null
      const workRelations = (recording.relations ?? []).filter((relation) => relation.work)
      return {
        recordingId: recording.id,
        recordingTitle: recording.title,
        artists: (recording['artist-credit'] ?? []).map((item) => item.name || item.artist?.name).filter(Boolean),
        works: workRelations.map((relation) => ({ id: relation.work.id, title: relation.work.title, relationType: relation.type })),
        source: { provider: 'musicbrainz', label: 'MusicBrainz recording/work relationships', url: `https://musicbrainz.org/recording/${recording.id}` },
      }
    },
  }
}

function createLastFmProvider(env, fetchImpl) {
  const apiKey = env.LASTFM_API_KEY?.trim()
  if (!apiKey) return null
  return {
    async get(track) {
      const params = new URLSearchParams({ method: 'track.getInfo', api_key: apiKey, artist: track.artist, track: track.title, autocorrect: '1', format: 'json' })
      const url = `https://ws.audioscrobbler.com/2.0/?${params}`
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(12_000) })
      if (!response.ok) throw new Error(`Last.fm 请求失败（${response.status}）`)
      const data = await response.json()
      if (!data.track) return null
      const tags = array(data.track.toptags?.tag).map((tag) => tag.name).filter(Boolean).slice(0, 12)
      // Tags 和社区摘要只能描述“听众怎样标注/讨论”，不能提升为歌词事实或专业乐评共识。
      return {
        listenerTags: tags,
        listeners: number(data.track.listeners),
        playcount: number(data.track.playcount),
        communitySummary: plainText(data.track.wiki?.summary),
        source: { provider: 'lastfm', label: 'Last.fm listener tags and track information', url: data.track.url || '' },
      }
    },
  }
}

function array(value) { return Array.isArray(value) ? value : value ? [value] : [] }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null }
function plainText(value) { return typeof value === 'string' ? value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1200) : '' }
