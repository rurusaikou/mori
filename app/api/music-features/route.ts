import { NextResponse } from 'next/server'
import { getFeatureCache } from '@/lib/server/music-data-store'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const isrc = new URL(request.url).searchParams.get('isrc')?.replaceAll('-', '').toUpperCase()
  if (!isrc) return NextResponse.json({ error: '缺少 ISRC' }, { status: 400 })
  const feature = (await getFeatureCache())[isrc] ?? null
  return NextResponse.json({ feature })
}
