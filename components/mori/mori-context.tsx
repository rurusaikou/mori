'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { tracks, type Memory, type ScreenId, type Track } from '@/lib/mori-data'

type Toast = { id: number; message: string }

export type ChatMessage =
  | { id: string; role: 'bot' | 'me'; text: string }
  | { id: string; role: 'song'; track: Track }

export const MORI_HOME_GREETING = '今晚过得怎么样？我在听。'

function replyToChat(text: string): ChatMessage[] {
  const id = String(Date.now())
  if (/歌|音乐|听/.test(text)) {
    return [
      { id: `${id}-t`, role: 'bot', text: '这首很适合现在的夜晚，我陪你一起听。' },
      { id: `${id}-s`, role: 'song', track: tracks.eveningBreeze },
    ]
  }
  if (/安静|累|休息/.test(text)) {
    return [{ id, role: 'bot', text: '嗯……那今晚就先听会儿歌吧。想说话的时候，我一直都在。' }]
  }
  return [{ id, role: 'bot', text: '我在。我们可以慢慢说，也可以先听一会儿歌。' }]
}

type MoriContextValue = {
  screen: ScreenId
  navigate: (id: ScreenId) => void
  back: () => void
  toast: Toast | null
  showToast: (message: string) => void
  savedMemories: Memory[]
  addMemory: (memory: Memory) => void
  chatMessages: ChatMessage[]
  chatDraft: string
  setChatDraft: (draft: string) => void
  chatTyping: boolean
  sendChatMessage: (text: string) => void
  currentTrack: Track | null
  isPlaying: boolean
  togglePlay: (track?: Track) => void
}

const MoriContext = createContext<MoriContextValue | null>(null)

const TAB_SCREENS: ScreenId[] = ['connect', 'chat', 'memories']
const MEMORIES_STORAGE_KEY = 'mori.saved-memories'
const LEGACY_MOOD_MEMORIES_STORAGE_KEY = 'mori.mood-memories'

export function MoriProvider({ children }: { children: React.ReactNode }) {
  const [stack, setStack] = useState<ScreenId[]>(['home'])
  const [toast, setToast] = useState<Toast | null>(null)
  const [savedMemories, setSavedMemories] = useState<Memory[]>([])
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { id: 'home-greeting', role: 'bot', text: MORI_HOME_GREETING },
  ])
  const [chatDraft, setChatDraft] = useState('')
  const [chatTyping, setChatTyping] = useState(false)
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chatReplyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('screen') === 'connect') {
      setStack(['home', 'connect'])
    }
  }, [])

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    if (chatReplyTimer.current) clearTimeout(chatReplyTimer.current)
  }, [])

  useEffect(() => {
    try {
      const stored = localStorage.getItem(MEMORIES_STORAGE_KEY) ?? localStorage.getItem(LEGACY_MOOD_MEMORIES_STORAGE_KEY)
      if (stored) {
        const parsed: unknown = JSON.parse(stored)
        if (Array.isArray(parsed)) setSavedMemories(parsed as Memory[])
      }
    } catch {
      // 本地缓存异常不应阻止用户继续使用心情记录。
    }
  }, [])

  const screen = stack[stack.length - 1]

  const navigate = useCallback((id: ScreenId) => {
    setStack((prev) => {
      if (prev[prev.length - 1] === id) return prev
      if (id === 'home') return ['home']
      if (TAB_SCREENS.includes(id)) return ['home', id]
      return [...prev, id]
    })
  }, [])

  const back = useCallback(() => {
    setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : ['home']))
  }, [])

  const showToast = useCallback((message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ id: Date.now(), message })
    toastTimer.current = setTimeout(() => setToast(null), 2000)
  }, [])

  const addMemory = useCallback((memory: Memory) => {
    setSavedMemories((previous) => {
      const next = [memory, ...previous]
      try {
        localStorage.setItem(MEMORIES_STORAGE_KEY, JSON.stringify(next))
      } catch {
        // 即使浏览器拒绝持久化，也先保证本次会话中的记忆会立即更新。
      }
      return next
    })
  }, [])

  const sendChatMessage = useCallback((text: string) => {
    const value = text.trim()
    if (!value || chatTyping) return
    setChatMessages((previous) => [...previous, { id: `me-${Date.now()}`, role: 'me', text: value }])
    setChatDraft('')
    setChatTyping(true)
    chatReplyTimer.current = setTimeout(() => {
      setChatMessages((previous) => [...previous, ...replyToChat(value)])
      setChatTyping(false)
    }, 900)
  }, [chatTyping])

  const togglePlay = useCallback(
    (track?: Track) => {
      if (track && track.id !== currentTrack?.id) {
        setCurrentTrack(track)
        setIsPlaying(true)
        showToast(`正在播放 · ${track.title}`)
        return
      }
      if (!currentTrack) return
      setIsPlaying(!isPlaying)
      showToast(isPlaying ? '音乐已暂停' : `继续播放 · ${currentTrack.title}`)
    },
    [currentTrack, isPlaying, showToast],
  )

  const value = useMemo(
    () => ({ screen, navigate, back, toast, showToast, savedMemories, addMemory, chatMessages, chatDraft, setChatDraft, chatTyping, sendChatMessage, currentTrack, isPlaying, togglePlay }),
    [screen, navigate, back, toast, showToast, savedMemories, addMemory, chatMessages, chatDraft, setChatDraft, chatTyping, sendChatMessage, currentTrack, isPlaying, togglePlay],
  )

  return <MoriContext.Provider value={value}>{children}</MoriContext.Provider>
}

export function useMori() {
  const ctx = useContext(MoriContext)
  if (!ctx) throw new Error('useMori must be used within MoriProvider')
  return ctx
}
