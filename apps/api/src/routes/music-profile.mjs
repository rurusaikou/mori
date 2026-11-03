/**
 * 作用：校验音乐画像请求并调用 MusicProfileService。
 * 输入：POST /music-profile 的歌曲列表和服务端 MELODATA_API_KEY。
 * 输出：MusicPreferenceProfile JSON 或明确的 4xx/5xx 错误。
 */
import { json, readRequestJson } from '../http.mjs'
import { logError } from '../logging.mjs'

export function createMusicProfileRoute(analyzeMusicProfile) {
  return async function handleMusicProfileRoute(request, response) {
    const apiKey = process.env.MELODATA_API_KEY?.trim()
    if (!apiKey) { json(request, response, 503, { error: 'Mori API 尚未配置 MELODATA_API_KEY' }); return }
    try {
      const body = await readRequestJson(request)
      const tracks = Array.isArray(body?.tracks) ? body.tracks.filter((track) => track?.title && track?.artist) : []
      if (!tracks.length) { json(request, response, 400, { error: '没有可以分析的歌曲' }); return }
      const profile = await analyzeMusicProfile(tracks, apiKey)
      if (!profile) { json(request, response, 422, { error: '歌曲特征仍在分析或暂不可用，请稍后重试' }); return }
      json(request, response, 200, { profile })
    } catch (error) {
      logError('music_preference', 'analysis_failed', error)
      const status = error?.statusCode ?? 502
      json(request, response, status, { error: status === 413 ? '请求歌曲数据过大' : error instanceof Error ? error.message : '音乐特征分析失败' })
    }
  }
}
