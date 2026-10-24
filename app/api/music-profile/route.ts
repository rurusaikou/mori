import { NextResponse } from 'next/server'
import { buildMusicPreference, type MusicFeatures } from '@/lib/music-profile'
import { getFeatureCache, getMusicProfile, saveFeatures, saveMusicProfile } from '@/lib/server/music-data-store'

type InputTrack = { isrc?: string; title: string; artist: string }

const MELODATA_BASE = 'https://melodata.voltenworks.com/api/v1'
export const runtime = 'nodejs'

function numeric(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function melodata(path: string, apiKey: string, attempt = 0): Promise<any> {
  const response = await fetch(`${MELODATA_BASE}${path}`, { headers: { Authorization: `Bearer ${apiKey}` }, cache: 'no-store' })
  if (response.status === 202) {
    // MeloData 可能先接受分析任务再异步产出特征，遵循 Retry-After 做有限轮询。
    if (attempt < 4) {
      const retryAfter = Number(response.headers.get('retry-after'))
      await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 3000)
      return melodata(path, apiKey, attempt + 1)
    }
    return null
  }
  if (response.status === 404) return null
  if (response.status === 429) {
    const result = await response.json().catch(() => null)
    if (result?.error?.code === 'quota_exhausted') throw new Error('MeloData 本月查询额度已用完')
    if (attempt < 3) {
      const retryAfter = Number(response.headers.get('retry-after'))
      await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1200 * (attempt + 1))
      return melodata(path, apiKey, attempt + 1)
    }
    throw new Error('MeloData 请求频率过快，请稍后重新分析')
  }
  if (!response.ok) {
    const result = await response.json().catch(() => null)
    throw new Error(result?.error?.message ?? `MeloData 请求失败（${response.status}）`)
  }
  return response.json()
}

async function analyzeTrack(track: InputTrack, apiKey: string): Promise<MusicFeatures | null> {
  let isrc = track.isrc?.replaceAll('-', '').toUpperCase()
  if (!isrc) {
    const resolved = await melodata(`/tracks/resolve?title=${encodeURIComponent(track.title)}&artist=${encodeURIComponent(track.artist)}`, apiKey)
    isrc = resolved?.data?.isrc
  }
  if (!isrc) return null
  const result = await melodata(`/tracks/${encodeURIComponent(isrc)}/features`, apiKey)
  const data = result?.data
  const features = data?.features
  if (!features) return null
  return {
    isrc,
    bpm: numeric(features.bpm),
    tempoConfidence: numeric(features.tempo_confidence),
    energy: numeric(features.energy),
    danceability: numeric(features.danceability),
    valence: numeric(features.valence),
    acousticness: numeric(features.acousticness),
    instrumentalness: numeric(features.instrumentalness),
  }
}

export async function POST(request: Request) {
  const apiKey = process.env.MELODATA_API_KEY?.trim()
  if (!apiKey) return NextResponse.json({ error: '尚未配置 MELODATA_API_KEY' }, { status: 503 })

  const body = await request.json().catch(() => null) as { userId?: string; tracks?: InputTrack[] } | null
  const userId = body?.userId?.trim()
  const tracks = body?.tracks?.filter((track) => track?.title && track?.artist).slice(0, 100) ?? []
  if (!userId) return NextResponse.json({ error: '缺少 Spotify 用户 ID' }, { status: 400 })
  if (!tracks.length) return NextResponse.json({ error: '没有可以分析的歌曲' }, { status: 400 })

  try {
    const cache = await getFeatureCache()
    const cachedFeatures = tracks.flatMap((track) => {
      const isrc = track.isrc?.replaceAll('-', '').toUpperCase()
      return isrc && cache[isrc] ? [cache[isrc]] : []
    })
    const missing = tracks.filter((track) => {
      const isrc = track.isrc?.replaceAll('-', '').toUpperCase()
      return !isrc || !cache[isrc]
    })
    const fetched: MusicFeatures[] = []
    // 小批次加间隔可降低 429；每批立即持久化，后续重试能够复用已完成结果。
    for (let index = 0; index < missing.length; index += 2) {
      const batch = await Promise.all(missing.slice(index, index + 2).map((track) => analyzeTrack(track, apiKey)))
      const completed = batch.filter((item): item is MusicFeatures => item !== null)
      fetched.push(...completed)
      if (completed.length) await saveFeatures(completed)
      if (index + 2 < missing.length) await wait(1100)
    }
    const profile = buildMusicPreference([...cachedFeatures, ...fetched], tracks.length)
    if (!profile.trackCount) return NextResponse.json({ error: '歌曲仍在 MeloData 排队分析，请稍后再次尝试' }, { status: 422 })
    await saveMusicProfile(userId, profile)
    return NextResponse.json({ profile })
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : '音乐特征分析失败' }, { status: 502 })
  }
}

export async function GET(request: Request) {
  const userId = new URL(request.url).searchParams.get('userId')?.trim()
  if (!userId) return NextResponse.json({ error: '缺少 Spotify 用户 ID' }, { status: 400 })
  return NextResponse.json({ profile: await getMusicProfile(userId) })
}
