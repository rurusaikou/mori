/**
 * 作用：把浏览器中产生的 Memory 事实同步到服务端事实库。
 * 同步失败不能撤销用户已经完成的本地操作；调用方记录错误，后续可在此处增加 Outbox 重试。
 */
import type { MusicMemory, PlaybackState } from '@mori/domain'
import { extensionStorage } from '../storage/extension-storage'

export async function syncMoment(memory: MusicMemory) {
  return postMemory('/memory/moments', {
    id: memory.id,
    content: memory.note,
    mood: memory.mood,
    tags: [],
    track: memory.track ? trackPayload(memory.track) : null,
    createdAt: memory.createdAt,
    timeZone: localTimeZone(),
  })
}

export async function syncListeningTransition(previous: PlaybackState, current: PlaybackState, source: ListeningSource = 'unknown') {
  const events: Array<{ state: PlaybackState; type: ListeningEventType }> = []
  const changed = previous.track?.uri !== current.track?.uri
  if (changed && previous.track && previous.isPlaying) {
    const ratio = previous.durationMs > 0 ? previous.progressMs / previous.durationMs : 0
    events.push({ state: previous, type: ratio >= 0.9 ? 'completed' : 'skipped' })
  }
  if (current.track && current.isPlaying && (changed || !previous.isPlaying)) events.push({ state: current, type: 'started' })
  if (!changed && previous.track && previous.isPlaying && !current.isPlaying) events.push({ state: current, type: 'paused' })
  await Promise.all(events.map(({ state, type }) => postMemory('/memory/events/listening', {
    eventId: crypto.randomUUID(),
    type,
    source,
    track: trackPayload(state.track!),
    positionMs: state.progressMs,
    durationMs: state.durationMs,
    occurredAt: new Date().toISOString(),
    timeZone: localTimeZone(),
  })))
}

async function postMemory(path: string, body: unknown) {
  const apiBaseUrl = (await extensionStorage.getApiBaseUrl()).replace(/\/$/, '')
  const response = await fetch(`${apiBaseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const result = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) throw new Error(result.error || `Memory HTTP ${response.status}`)
  return result
}

function trackPayload(track: NonNullable<PlaybackState['track']>) {
  return { uri: track.uri, isrc: track.isrc, title: track.title, artist: track.artist }
}
function localTimeZone() { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }
type ListeningSource = 'user_selected' | 'agent_selected' | 'autoplay' | 'unknown'
type ListeningEventType = 'started' | 'paused' | 'completed' | 'skipped'
