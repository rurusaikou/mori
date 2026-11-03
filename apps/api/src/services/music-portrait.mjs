/**
 * 作用：把聚合后的音乐指标交给可配置 LLM，生成用户可读的五项偏好与音乐画像。
 * 输入：MusicPreferenceProfile、服务端 LLM 配置；不接收歌曲列表或用户身份。
 * 输出：结构化 MusicPreferencePortrait；未配置或生成失败时返回 null 供调用方回退。
 */
const DIMENSIONS = {
  rhythmPreference: ['舒缓', '适中', '中等偏快', '偏快'],
  energyPreference: ['舒缓', '平衡', '有能量'],
  groovePreference: ['沉浸', '平衡', '动感'],
  moodPreference: ['深沉', '平衡', '明亮'],
  soundPreference: ['现代制作', '混合', '自然原声'],
}

export function createMusicPortraitService({ logInfo, logError, fetchImpl = fetch, env = process.env }) {
  return async function generateMusicPortrait(profile) {
    const endpoint = env.MORI_LLM_ENDPOINT?.trim()
    const apiKey = env.MORI_LLM_API_KEY?.trim()
    const model = env.MORI_LLM_MODEL?.trim()
    if (!endpoint || !apiKey || !model) {
      logInfo('music_preference', 'portrait_fallback', { reason: 'llm_not_configured' })
      return null
    }

    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0.45,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt() },
            { role: 'user', content: JSON.stringify(profileMetrics(profile)) },
          ],
        }),
        signal: AbortSignal.timeout(30_000),
      })
      const result = await response.json().catch(() => null)
      if (!response.ok) throw new Error(result?.error?.message || `LLM 请求失败（${response.status}）`)
      const content = result?.choices?.[0]?.message?.content
      if (typeof content !== 'string') throw new Error('LLM 未返回画像内容')
      const generated = JSON.parse(content)
      const portrait = validateAndEnrich(generated, profile)
      logInfo('music_preference', 'portrait_generated', { model })
      return portrait
    } catch (error) {
      logError('music_preference', 'portrait_generation_failed', error)
      return null
    }
  }
}

function systemPrompt() {
  return `你是 Mori，一位克制、温和的音乐理解伙伴。根据用户的聚合音乐指标生成听歌偏好，只能解释音乐选择，禁止推断人格、心理状态、生活方式或身份。

只返回一个 JSON 对象，不要 Markdown，不要额外字段：
{
  "rhythmPreference":{"status":"舒缓|适中|中等偏快|偏快","description":"一句中文解释"},
  "energyPreference":{"status":"舒缓|平衡|有能量","description":"一句中文解释"},
  "groovePreference":{"status":"沉浸|平衡|动感","description":"一句中文解释"},
  "moodPreference":{"status":"深沉|平衡|明亮","description":"一句中文解释"},
  "soundPreference":{"status":"现代制作|混合|自然原声","description":"一句中文解释"},
  "musicProfileSummary":"一至两句完整中文音乐画像"
}

要求：描述自然、具体、像在理解用户；摘要要综合指标之间的关系，不得简单罗列五个状态，不得出现原始数字。每项 description 不超过 28 个汉字，摘要不超过 80 个汉字。`
}

function profileMetrics(profile) {
  return {
    averageBpm: profile.averageBpm,
    energy: profile.energy,
    danceability: profile.danceability,
    valence: profile.valence,
    acousticness: profile.acousticness,
    instrumentalness: profile.instrumentalness,
    analyzedTrackCount: profile.trackCount,
    requestedTrackCount: profile.requestedCount,
  }
}

function validateAndEnrich(value, profile) {
  if (!value || typeof value !== 'object') throw new Error('LLM 画像不是对象')
  const portrait = {}
  for (const [key, statuses] of Object.entries(DIMENSIONS)) {
    const dimension = value[key]
    if (!dimension || !statuses.includes(dimension.status) || !validText(dimension.description, 80)) {
      throw new Error(`LLM 画像字段无效：${key}`)
    }
    portrait[key] = { status: dimension.status, description: dimension.description.trim(), ...measurement(key, profile) }
  }
  if (!validText(value.musicProfileSummary, 180)) throw new Error('LLM 音乐画像摘要无效')
  portrait.musicProfileSummary = value.musicProfileSummary.trim()
  return portrait
}

function measurement(key, profile) {
  if (key === 'rhythmPreference') {
    const value = profile.averageBpm
    return { position: value === null ? 0.5 : clamp((value - 60) / 100), level: value === null ? 'unknown' : value < 90 ? 'low' : value < 115 ? 'balanced' : 'high' }
  }
  const fields = { energyPreference: 'energy', groovePreference: 'danceability', moodPreference: 'valence', soundPreference: 'acousticness' }
  const thresholds = { energyPreference: [0.4, 0.68], groovePreference: [0.4, 0.68], moodPreference: [0.38, 0.62], soundPreference: [0.35, 0.6] }
  const value = profile[fields[key]]
  const [low, high] = thresholds[key]
  return { position: value === null ? 0.5 : clamp(value), level: value === null ? 'unknown' : value < low ? 'low' : value > high ? 'high' : 'balanced' }
}

function validText(value, maxLength) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength && !/[\r\n]/.test(value)
}

function clamp(value) { return Math.min(1, Math.max(0, value)) }
