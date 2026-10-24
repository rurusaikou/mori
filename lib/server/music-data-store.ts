import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { MusicFeatures, MusicPreferenceProfile } from '@/lib/music-profile'

const dataDirectory = path.join(process.cwd(), 'data')
const featuresPath = path.join(dataDirectory, 'music-features.json')
const profilesPath = path.join(dataDirectory, 'music-profiles.json')
const listeningHistoryPath = path.join(dataDirectory, 'listening-history.json')

export type ListeningEvent = {
  sessionId: string
  spotifyUri: string
  isrc?: string
  title: string
  artist: string
  album?: string
  artwork?: string
  startedAt: string
  updatedAt: string
  listenedMs: number
  positionMs: number
  durationMs: number
  completed: boolean
}

export type ListeningTrackHistory = {
  spotifyUri: string
  isrc?: string
  title: string
  artist: string
  album?: string
  artwork?: string
  playCount: number
  completedCount: number
  totalListenedMs: number
  lastPositionMs: number
  lastPlayedAt: string
  timeline: ListeningEvent[]
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(filePath, 'utf8')) as T } catch { return fallback }
}

async function writeJson(filePath: string, value: unknown) {
  await mkdir(dataDirectory, { recursive: true })
  // 先写唯一临时文件再原子替换，避免进程中断留下半份 JSON。
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, filePath)
}

export async function getFeatureCache() {
  return readJson<Record<string, MusicFeatures>>(featuresPath, {})
}

export async function saveFeatures(features: MusicFeatures[]) {
  const cache = await getFeatureCache()
  for (const feature of features) cache[feature.isrc] = feature
  await writeJson(featuresPath, cache)
}

export async function getMusicProfile(userId: string) {
  const profiles = await readJson<Record<string, MusicPreferenceProfile>>(profilesPath, {})
  return profiles[userId] ?? null
}

export async function saveMusicProfile(userId: string, profile: MusicPreferenceProfile) {
  const profiles = await readJson<Record<string, MusicPreferenceProfile>>(profilesPath, {})
  profiles[userId] = profile
  await writeJson(profilesPath, profiles)
}

export async function saveListeningEvent(userId: string, event: ListeningEvent) {
  const histories = await readJson<Record<string, Record<string, ListeningTrackHistory>>>(listeningHistoryPath, {})
  const userHistory = histories[userId] ?? {}
  const previous = userHistory[event.spotifyUri]
  const previousEvent = previous?.timeline.find((item) => item.sessionId === event.sessionId)
  const timeline = previous?.timeline.filter((item) => item.sessionId !== event.sessionId) ?? []
  timeline.push(event)
  timeline.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))

  // 同一 session 每 5 秒会上报一次；先扣除旧快照再加入新快照，防止累计时长重复计算。
  userHistory[event.spotifyUri] = {
    spotifyUri: event.spotifyUri,
    isrc: event.isrc ?? previous?.isrc,
    title: event.title,
    artist: event.artist,
    album: event.album,
    artwork: event.artwork,
    playCount: (previous?.playCount ?? 0) + (previousEvent ? 0 : 1),
    completedCount: (previous?.completedCount ?? 0) + (event.completed && !previousEvent?.completed ? 1 : 0),
    totalListenedMs: Math.max(0, (previous?.totalListenedMs ?? 0) - (previousEvent?.listenedMs ?? 0) + event.listenedMs),
    lastPositionMs: event.positionMs,
    lastPlayedAt: event.updatedAt,
    timeline: timeline.slice(0, 200),
  }
  histories[userId] = userHistory
  await writeJson(listeningHistoryPath, histories)
  return userHistory[event.spotifyUri]
}

export async function getListeningHistory(userId: string) {
  const histories = await readJson<Record<string, Record<string, ListeningTrackHistory>>>(listeningHistoryPath, {})
  return Object.values(histories[userId] ?? {}).sort((a, b) => Date.parse(b.lastPlayedAt) - Date.parse(a.lastPlayedAt))
}
