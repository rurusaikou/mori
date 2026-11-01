/**
 * 作用：采样 Spotify 曲库并通过 Mori API 生成、保存用户音乐偏好画像。
 * 输入：MusicController 提供的曲库歌曲，以及 Options 中配置的 Mori API 地址。
 * 输出：持久化并返回 MusicPreferenceProfile；失败时返回可执行的连接或分析错误。
 */
import type { MusicPreferenceAnalysisState, MusicPreferenceProfile, MusicTrack } from '@mori/domain'
import { extensionStorage } from '../storage/extension-storage'
import type { MusicController } from './music-controller'
import { logError, logInfo } from './logger'

let analysisTask: Promise<MusicPreferenceProfile> | null = null
let analysisState: MusicPreferenceAnalysisState = { status: 'idle', profile: null, error: null }

export async function getMusicPreferenceState() {
  const profile = await extensionStorage.getMusicPreference()
  return { ...analysisState, profile: analysisState.profile ?? profile }
}

export async function analyzeMusicPreference(music: MusicController) {
  if (analysisTask) {
    logInfo('music_preference', 'analysis_reused')
    return analysisTask
  }
  analysisState = { status: 'analyzing', profile: await extensionStorage.getMusicPreference(), error: null }
  logInfo('music_preference', 'analysis_started')
  analysisTask = runAnalysis(music)
    .then((profile) => {
      analysisState = { status: 'succeeded', profile, error: null }
      logInfo('music_preference', 'analysis_completed', { trackCount: profile.trackCount, requestedCount: profile.requestedCount })
      return profile
    })
    .catch((cause) => {
      const error = cause instanceof Error ? cause.message : '音乐偏好分析失败'
      analysisState = { ...analysisState, status: 'failed', error }
      logError('music_preference', 'analysis_failed', cause)
      throw cause
    })
    .finally(() => { analysisTask = null })
  return analysisTask
}

async function runAnalysis(music: MusicController) {
  const tracks = await music.getPreferenceTracks()
  logInfo('music_preference', 'library_sample_ready', { sampledTracks: tracks.length })
  if (!tracks.length) throw new Error('喜欢的歌曲和可读取歌单中没有可以分析的歌曲')

  const apiBaseUrl = (await extensionStorage.getApiBaseUrl()).replace(/\/$/, '')
  let response: Response
  try {
    response = await fetch(`${apiBaseUrl}/music-profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tracks: tracks.map(toAnalysisTrack) }),
    })
  } catch {
    throw new Error(`无法连接 Mori API（${apiBaseUrl}），请先启动或配置音乐分析服务`)
  }
  const result = await response.json().catch(() => null) as { profile?: MusicPreferenceProfile; error?: string } | null
  if (!response.ok || !result?.profile) throw new Error(result?.error || '音乐偏好分析失败')
  await extensionStorage.setMusicPreference(result.profile)
  return result.profile
}

function toAnalysisTrack(track: MusicTrack) {
  return { isrc: track.isrc, title: track.title, artist: track.artist.split('、')[0] || track.artist }
}
