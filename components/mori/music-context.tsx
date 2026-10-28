'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { MusicState } from '@/lib/music/types'

const initialState: MusicState = {
  connectionStatus: 'unavailable', loggedIn: false, isActiveDevice: false, track: null, context: null,
  playbackStatus: 'idle', isPlaying: false, durationMs: 0, progressMs: 0,
  positionAnchor: { positionMs: 0, timestampMs: 0, speed: 0 }, volume: 0, shuffle: false, repeat: 'off',
  queue: { previous: [], upcoming: [] }, availableActions: [], error: null,
}

type MusicContextValue = MusicState & {
  play: (uri?: string) => Promise<void>; pause: () => Promise<void>; toggle: () => Promise<void>
  previous: () => Promise<void>; next: () => Promise<void>; seek: (positionMs: number) => Promise<void>
  setVolume: (volume: number) => Promise<void>; setShuffle: (enabled: boolean) => Promise<void>
  setRepeat: (mode: 'off' | 'context' | 'track') => Promise<void>; refreshQueue: () => Promise<void>
}
const MusicContext = createContext<MusicContextValue | null>(null)

export function MusicProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState(initialState)
  useEffect(() => {
    const bridge = window.moriDesktop?.music
    if (!bridge) return
    void bridge.getState().then(setState)
    return bridge.onState(setState)
  }, [])
  useEffect(() => {
    if (!state.isPlaying || !state.durationMs) return
    const timer = window.setInterval(() => setState((current) => ({ ...current, progressMs: Math.min(current.durationMs, current.progressMs + 1_000) })), 1_000)
    return () => window.clearInterval(timer)
  }, [state.isPlaying, state.durationMs])

  const command = useCallback(async (name: Parameters<NonNullable<typeof window.moriDesktop>['music']['command']>[0], payload?: Record<string, unknown>) => {
    if (!window.moriDesktop?.music) throw new Error('桌面音乐服务不可用')
    await window.moriDesktop.music.command(name, payload)
  }, [])
  const play = useCallback((uri?: string) => command('play', uri ? { uri } : undefined), [command])
  const pause = useCallback(() => command('pause'), [command])
  const toggle = useCallback(() => state.isPlaying ? pause() : play(), [state.isPlaying, pause, play])
  const previous = useCallback(() => command('previous'), [command])
  const next = useCallback(() => command('next'), [command])
  const seek = useCallback((positionMs: number) => command('seek', { positionMs }), [command])
  const setVolume = useCallback((volume: number) => command('volume', { volume }), [command])
  const setShuffle = useCallback((enabled: boolean) => command('shuffle', { enabled }), [command])
  const setRepeat = useCallback((mode: 'off' | 'context' | 'track') => command('repeat', { mode }), [command])
  const refreshQueue = useCallback(() => command('queue', { limit: 0 }), [command])
  const value = useMemo(() => ({ ...state, play, pause, toggle, previous, next, seek, setVolume, setShuffle, setRepeat, refreshQueue }), [state, play, pause, toggle, previous, next, seek, setVolume, setShuffle, setRepeat, refreshQueue])
  return <MusicContext.Provider value={value}>{children}</MusicContext.Provider>
}

export function useMusic() {
  const context = useContext(MusicContext)
  if (!context) throw new Error('useMusic must be used within MusicProvider')
  return context
}
