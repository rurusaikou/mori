export type MusicFeatures = {
  isrc: string
  bpm: number | null
  tempoConfidence: number | null
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
}

function average(values: Array<number | null>) {
  const valid = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null
}

export function buildMusicPreference(features: MusicFeatures[], requestedCount: number): MusicPreferenceProfile {
  return {
    analyzedAt: Date.now(),
    trackCount: features.length,
    requestedCount,
    averageBpm: average(features.map((item) => item.bpm)),
    energy: average(features.map((item) => item.energy)),
    danceability: average(features.map((item) => item.danceability)),
    valence: average(features.map((item) => item.valence)),
    acousticness: average(features.map((item) => item.acousticness)),
    instrumentalness: average(features.map((item) => item.instrumentalness)),
  }
}

export function describeMusicPreference(profile: MusicPreferenceProfile) {
  const descriptions: string[] = []
  if (profile.averageBpm !== null) descriptions.push(profile.averageBpm < 90 ? '偏爱舒缓节奏' : profile.averageBpm > 130 ? '偏爱明快节奏' : '偏爱适中的节奏')
  if (profile.energy !== null) descriptions.push(profile.energy > 0.68 ? '高能量' : profile.energy < 0.38 ? '氛围柔和' : '能量均衡')
  if (profile.acousticness !== null && profile.acousticness > 0.58) descriptions.push('偏原声质感')
  if (profile.danceability !== null && profile.danceability > 0.65) descriptions.push('律动感明显')
  if (profile.valence !== null) descriptions.push(profile.valence > 0.62 ? '整体明亮' : profile.valence < 0.35 ? '更偏内省' : '情绪色彩平衡')
  return descriptions.slice(0, 3).join('、') || '正在形成你的音乐偏好'
}
