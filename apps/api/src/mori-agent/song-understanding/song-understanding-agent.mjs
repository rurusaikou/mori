import { SONG_INSIGHT_SCHEMA, validateSongInsight } from './song-understanding.types.mjs'
import { SONG_UNDERSTANDING_PROMPT, SONG_UNDERSTANDING_VERSION } from './song-understanding.prompt.mjs'
import { createTrackInsightRepository } from './insight-repository.mjs'

export function createSongUnderstandingAgent({ llm, resolveFeatures, providers = {}, repository = createTrackInsightRepository(), logInfo = () => {}, logError = () => {} }) {
  return {
    async analyze(track) {
      const normalized = normalizeTrack(track)
      // ISRC 标识具体 Recording，优先级高于 Spotify URI；同一录音在不同 Spotify
      // 市场或专辑下出现时仍可复用洞察，同时不会把 Live/翻唱版本错误合并。
      const key = normalized.isrc ? `isrc:${normalized.isrc}` : `track:${normalized.uri ?? `${normalized.artist}:${normalized.title}`}`
      const cached = repository.get(key)
      if (cached) { logInfo('song_understanding', 'cache_hit', { key, title: normalized.title }); return cached }
      const evidence = await collectEvidence(normalized, resolveFeatures, providers, logError)
      try {
        const result = await llm({ prompt: SONG_UNDERSTANDING_PROMPT, input: { track: normalized, ...evidence }, schema: SONG_INSIGHT_SCHEMA, schemaName: 'mori_song_understanding_v0_1', maxTokens: 1800 })
        const insight = { track: normalized, ...validateSongInsight(result.data), analysisVersion: SONG_UNDERSTANDING_VERSION, model: result.model, analyzedAt: new Date().toISOString() }
        repository.set(key, insight)
        logInfo('song_understanding', 'analysis_completed', { key, title: normalized.title, missingLayers: insight.missingLayers, model: result.model })
        return insight
      } catch (error) {
        // 外部证据已经完成收集时，LLM/Schema 失败不应让 Conversation Agent 无响应。
        // 降级结果只翻译确定性 Audio Features，其他层保持 unavailable，杜绝“顺口补全”。
        logError('song_understanding', 'analysis_failed', error, { key, title: normalized.title })
        const fallback = deterministicFallback(normalized, evidence)
        repository.set(key, fallback)
        return fallback
      }
    },
  }
}

async function collectEvidence(track, resolveFeatures, providers, logError) {
  const soundEvidence = track.isrc ? resolveFeatures?.(track.isrc) ?? null : null
  const safeGet = async (name, provider) => {
    if (!provider) return null
    try { return await provider.get(track) }
    catch (error) { logError('song_understanding', 'provider_failed', error, { provider: name, title: track.title }); return null }
  }
  // 各 Provider 彼此独立并行；单源超时只影响对应层，避免歌词服务拖垮整次对话。
  const [licensedLyricsInsight, creditsEvidence, receptionEvidence] = await Promise.all([
    safeGet('lyrics', providers.lyrics), safeGet('musicbrainz', providers.credits), safeGet('lastfm', providers.reception),
  ])
  return { soundEvidence, licensedLyricsInsight, creditsEvidence, receptionEvidence }
}

function deterministicFallback(track, evidence) {
  const observations = soundObservations(evidence.soundEvidence)
  const soundAvailable = observations.length > 0
  const unavailable = (extra = {}) => ({ available: false, summary: '', confidence: 0, sources: [], ...extra })
  return {
    track,
    sound: { available: soundAvailable, summary: soundAvailable ? observations.join('；') : '', observations, confidence: soundAvailable ? 0.85 : 0, sources: soundAvailable ? [{ provider: 'melodata', label: 'Audio Features', url: '' }] : [] },
    lyrics: unavailable({ themes: [], perspective: '', imagery: [], emotionalArc: '' }),
    creation: unavailable({ lyricists: [], composers: [], relationships: [], background: '' }),
    reception: unavailable({ listenerTags: [], commonInterpretations: [], disagreements: [], culturalContext: '' }),
    integratedInsight: soundAvailable ? `目前只能从声音层判断《${track.title}》：${observations.join('，')}；歌词、创作与听众理解仍缺少可靠资料。` : `目前还没有足够的可靠资料分析《${track.title}》。`,
    missingLayers: ['lyrics', 'creation', 'reception', ...(!soundAvailable ? ['sound'] : [])],
    analysisVersion: SONG_UNDERSTANDING_VERSION,
    model: null,
    analyzedAt: new Date().toISOString(),
  }
}

function soundObservations(features) {
  if (!features) return []
  const result = []
  if (Number.isFinite(features.bpm)) result.push(`节奏约 ${Math.round(features.bpm)} BPM`)
  if (Number.isFinite(features.energy)) result.push(`能量感${features.energy >= 0.65 ? '偏强' : features.energy <= 0.35 ? '偏弱' : '适中'}`)
  if (Number.isFinite(features.danceability)) result.push(`律动${features.danceability >= 0.65 ? '明显' : features.danceability <= 0.35 ? '较克制' : '自然'}`)
  return result
}
function normalizeTrack(track) {
  if (!track || typeof track.title !== 'string' || !track.title.trim() || typeof track.artist !== 'string' || !track.artist.trim()) throw new Error('Song Understanding 缺少歌曲身份')
  return { title: track.title.trim(), artist: track.artist.trim(), ...(track.uri ? { uri: String(track.uri) } : {}), ...(track.isrc ? { isrc: String(track.isrc).replaceAll('-', '').toUpperCase() } : {}) }
}
