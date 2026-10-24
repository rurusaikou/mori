'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ScreenId, Track } from '@/lib/mori-data'

type Toast = { id: number; message: string }

type MoriContextValue = {
  screen: ScreenId
  navigate: (id: ScreenId) => void
  back: () => void
  toast: Toast | null
  showToast: (message: string) => void
  currentTrack: Track | null
  isPlaying: boolean
  togglePlay: (track?: Track) => void
}

const MoriContext = createContext<MoriContextValue | null>(null)

const TAB_SCREENS: ScreenId[] = ['connect', 'chat', 'memories']

export function MoriProvider({ children }: { children: React.ReactNode }) {
  const [stack, setStack] = useState<ScreenId[]>(['home'])
  const [toast, setToast] = useState<Toast | null>(null)
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('screen') === 'connect') {
      setStack(['home', 'connect'])
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
    () => ({ screen, navigate, back, toast, showToast, currentTrack, isPlaying, togglePlay }),
    [screen, navigate, back, toast, showToast, currentTrack, isPlaying, togglePlay],
  )

  return <MoriContext.Provider value={value}>{children}</MoriContext.Provider>
}

export function useMori() {
  const ctx = useContext(MoriContext)
  if (!ctx) throw new Error('useMori must be used within MoriProvider')
  return ctx
}
