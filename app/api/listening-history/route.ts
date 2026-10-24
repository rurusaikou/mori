import { NextResponse } from 'next/server'
import { getListeningHistory, saveListeningEvent, type ListeningEvent } from '@/lib/server/music-data-store'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const userId = new URL(request.url).searchParams.get('userId')?.trim()
  if (!userId) return NextResponse.json({ error: '缺少 Spotify 用户 ID' }, { status: 400 })
  return NextResponse.json({ history: await getListeningHistory(userId) })
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { userId?: string; event?: Partial<ListeningEvent> }
    const { userId, event } = body
    if (!userId || !event?.sessionId || !event.spotifyUri || !event.title || !event.startedAt || !event.updatedAt) {
      return NextResponse.json({ error: '收听记录缺少必要字段' }, { status: 400 })
    }
    const normalized: ListeningEvent = {
      sessionId: event.sessionId,
      spotifyUri: event.spotifyUri,
      isrc: event.isrc,
      title: event.title,
      artist: event.artist ?? '',
      album: event.album,
      artwork: event.artwork,
      startedAt: event.startedAt,
      updatedAt: event.updatedAt,
      listenedMs: Math.max(0, Math.round(event.listenedMs ?? 0)),
      positionMs: Math.max(0, Math.round(event.positionMs ?? 0)),
      durationMs: Math.max(0, Math.round(event.durationMs ?? 0)),
      completed: Boolean(event.completed),
    }
    const history = await saveListeningEvent(userId, normalized)
    return NextResponse.json({ history })
  } catch (cause) {
    console.error('Failed to save listening history', cause)
    return NextResponse.json({ error: '保存收听记录失败' }, { status: 500 })
  }
}
