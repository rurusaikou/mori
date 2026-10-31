import type { ConversationMessage, MusicMemory, PlaybackState } from '@mori/domain'
import { extensionStorage } from '../storage/extension-storage'

const greeting: ConversationMessage = {
  id: 'mori-welcome',
  role: 'mori',
  text: '我在。想聊聊现在听到的歌吗？',
  createdAt: new Date(0).toISOString(),
}

export async function getCompanionData() {
  const [storedMessages, memories] = await Promise.all([extensionStorage.getConversation(), extensionStorage.getMemories()])
  return { messages: storedMessages.length ? storedMessages : [greeting], memories }
}

export async function sendCompanionMessage(text: string, playback: PlaybackState) {
  const value = text.trim()
  if (!value) throw new Error('请输入想和 Mori 说的话')
  const messages = (await getCompanionData()).messages
  const now = new Date().toISOString()
  const userMessage: ConversationMessage = { id: crypto.randomUUID(), role: 'user', text: value, createdAt: now, trackUri: playback.track?.uri }

  // The repository still has no production AI backend. Keep the fallback explicit and isolated so
  // an approved AI adapter can replace it without sending Spotify metadata to a model by accident.
  const reply = localReply(value, playback)
  const moriMessage: ConversationMessage = { id: crypto.randomUUID(), role: 'mori', text: reply, createdAt: now, trackUri: playback.track?.uri }
  const next = [...messages, userMessage, moriMessage].slice(-100)
  await extensionStorage.setConversation(next)
  return next
}

export async function saveMusicMemory(note: string, playback: PlaybackState) {
  const memories = await extensionStorage.getMemories()
  const memory: MusicMemory = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    note: note.trim() || (playback.track ? `记住和 Mori 一起听《${playback.track.title}》的这一刻。` : '记住这一刻。'),
    track: playback.track,
  }
  const next = [memory, ...memories].slice(0, 200)
  await extensionStorage.setMemories(next)
  return next
}

function localReply(text: string, playback: PlaybackState) {
  const track = playback.track
  if (/喜欢|好听|收藏/.test(text)) return track ? `我也记住了，你很喜欢《${track.title}》这一刻。` : '等音乐响起时，再告诉我是哪一段打动了你。'
  if (/累|安静|休息/.test(text)) return '那就先不用急着说什么。我安静地陪你听一会儿。'
  if (track) return `我在听《${track.title}》。对你来说，这首歌现在像什么？`
  return '我在。等音乐响起，我们再慢慢聊。'
}
