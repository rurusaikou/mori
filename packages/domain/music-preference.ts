export type MusicFeatures = {
  isrc: string
  bpm: number | null
  energy: number | null
  danceability: number | null
  valence: number | null
  acousticness: number | null
  instrumentalness: number | null
}

export type MusicPreferenceProfile = {
  analyzedAt: number
  trackCount: number
  requestedCount: number
  averageBpm: number | null
  energy: number | null
  danceability: number | null
  valence: number | null
  acousticness: number | null
  instrumentalness: number | null
  insight?: MusicProfileInsight
  /** 兼容已保存在 Extension 本地的旧版画像。 */
  portrait?: MusicPreferencePortrait
}

export type MusicProfileInsight = {
  summary: string
  traits: Array<{ name: string; description: string }>
  listeningStyle: string
  keywords: string[]
}

export type MusicPreferenceAnalysisState = {
  status: 'idle' | 'analyzing' | 'succeeded' | 'failed'
  profile: MusicPreferenceProfile | null
  error: string | null
}

export type MusicPreferenceDimension = {
  status: string
  description: string
  position: number
  level: 'low' | 'balanced' | 'high' | 'unknown'
}

export type MusicPreferencePortrait = {
  rhythmPreference: MusicPreferenceDimension
  energyPreference: MusicPreferenceDimension
  groovePreference: MusicPreferenceDimension
  moodPreference: MusicPreferenceDimension
  soundPreference: MusicPreferenceDimension
  musicProfileSummary: string
}

export function deriveMusicPreferencePortrait(profile: MusicPreferenceProfile): MusicPreferencePortrait {
  const rhythmPreference = rhythm(profile.averageBpm)
  const energyPreference = scaled(profile.energy, {
    low: ['舒缓', '比起强烈刺激，更偏爱安静舒展的音乐'],
    balanced: ['平衡', '既能享受舒缓，也会被适度的力量感吸引'],
    high: ['有能量', '比起安静舒缓，更容易被有力量感的音乐吸引'],
  })
  const groovePreference = scaled(profile.danceability, {
    low: ['自然', '不太追求强烈舞感，更偏向自然、沉浸地聆听'],
    balanced: ['平衡', '会留意律动，但不需要每首歌都适合起舞'],
    high: ['动感', '更容易被鲜明节拍和流动的律动吸引'],
  })
  const moodPreference = scaled(profile.valence, {
    low: ['深沉', '更常被克制、深沉的情绪色彩吸引'],
    balanced: ['平衡', '明亮和深沉的歌都会听，没有明显偏向'],
    high: ['明亮', '更容易被明朗、积极的情绪色彩吸引'],
  }, 0.38, 0.62)
  const soundPreference = scaled(profile.acousticness, {
    low: ['现代制作', '更偏爱电子质感和现代制作的声音'],
    balanced: ['混合', '自然乐器和现代制作感的声音都能接受'],
    high: ['自然原声', '更偏爱自然乐器和真实、松弛的声音质感'],
  }, 0.35, 0.6)

  return {
    rhythmPreference,
    energyPreference,
    groovePreference,
    moodPreference,
    soundPreference,
    musicProfileSummary: summarize({ rhythmPreference, energyPreference, groovePreference, moodPreference, soundPreference }),
  }
}

export function describeMusicPreference(profile: MusicPreferenceProfile) {
  return deriveMusicPreferencePortrait(profile).musicProfileSummary
}

function rhythm(value: number | null): MusicPreferenceDimension {
  if (value === null) return unknown()
  const position = clamp((value - 60) / 100)
  if (value < 90) return { status: '舒缓', description: '更喜欢舒展、从容，不急于推进的歌', position, level: 'low' }
  if (value < 115) return { status: '适中', description: '更喜欢速度自然、听感从容的歌', position, level: 'balanced' }
  if (value <= 135) return { status: '中等偏快', description: '更喜欢中等偏快、不拖沓的歌', position, level: 'high' }
  return { status: '偏快', description: '更容易被快速、持续推进的节奏吸引', position, level: 'high' }
}

function scaled(value: number | null, labels: Record<'low' | 'balanced' | 'high', [string, string]>, low = 0.4, high = 0.68): MusicPreferenceDimension {
  if (value === null) return unknown()
  const level = value < low ? 'low' : value > high ? 'high' : 'balanced'
  return { status: labels[level][0], description: labels[level][1], position: clamp(value), level }
}

function summarize(preferences: Omit<MusicPreferencePortrait, 'musicProfileSummary'>) {
  const { rhythmPreference: rhythm, energyPreference: energy, groovePreference: groove, moodPreference: mood, soundPreference: sound } = preferences
  let opening: string
  if (energy.level === 'high' && rhythm.level === 'high' && groove.level === 'low') opening = '你偏爱有能量、有推进感，却不过分躁动的音乐'
  else if (energy.level === 'high' && groove.level === 'high') opening = '你容易被有能量、律动鲜明，能带动身体的音乐吸引'
  else if (energy.level === 'low' && rhythm.level === 'low') opening = '你更偏爱舒缓、留有呼吸感，能够慢慢沉浸的音乐'
  else if (groove.level === 'low') opening = '你听歌更看重沉浸和层次，而不是强烈的舞动感'
  else if (rhythm.level === 'high') opening = '你偏爱节奏利落、有自然推进感的音乐'
  else opening = '你的节奏与能量偏好较为均衡，既接受舒展，也享受适度推进'

  let ending: string
  if (mood.level === 'balanced' && sound.level === 'balanced') ending = '你对音乐的情绪与声音风格保持着开放。'
  else if (mood.level === 'high' && sound.level === 'high') ending = '明亮的情绪与自然原声质感更容易打动你。'
  else if (mood.level === 'low' && sound.level === 'low') ending = '你也更常选择深沉情绪与现代制作质感。'
  else if (mood.level === 'high') ending = '在情绪上，你更容易靠近明亮、轻盈的表达。'
  else if (mood.level === 'low') ending = '在情绪上，你更容易靠近克制、深沉的表达。'
  else if (sound.level === 'high') ending = '声音上，你更偏爱自然乐器与真实质感。'
  else if (sound.level === 'low') ending = '声音上，你更偏爱现代制作与电子质感。'
  else ending = '你对不同情绪和声音质感都保有开放度。'
  return `${opening}；${ending}`
}

function unknown(): MusicPreferenceDimension {
  return { status: '待分析', description: '还需要更多歌曲特征才能判断', position: 0.5, level: 'unknown' }
}

function clamp(value: number) { return Math.min(1, Math.max(0, value)) }
