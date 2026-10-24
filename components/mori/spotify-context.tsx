'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { disconnectSpotify, getSpotifyLibrary, getSpotifyToken, startSpotifyLogin, type SpotifyPlaylist, type SpotifyUser } from '@/lib/spotify'

type SpotifyContextValue = {
  configured: boolean; connected: boolean; loading: boolean; user: SpotifyUser | null; playlists: SpotifyPlaylist[]; error: string | null
  nowPlaying: { uri: string; title: string; artist: string; artwork?: string } | null; isPlaying: boolean
  progressMs: number; durationMs: number; fullPlayerOpen: boolean
  fullPlayerRequested: boolean
  connect: () => Promise<void>; disconnect: () => void; sync: () => Promise<void>
  updatePlayback: (state: SpotifyPlaybackState | null) => void; togglePlayback: () => Promise<void>
  setFullPlayerOpen: (open: boolean) => void
  requestFullPlayer: () => void; consumeFullPlayerRequest: () => void
}
const SpotifyContext = createContext<SpotifyContextValue | null>(null)

export function SpotifyProvider({ children }: { children: React.ReactNode }) {
  const configured = Boolean(process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID?.trim())
  const [connected, setConnected] = useState(false)
  const [loading, setLoading] = useState(false)
  const [user, setUser] = useState<SpotifyUser | null>(null)
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([])
  const [error, setError] = useState<string | null>(null)
  const [nowPlaying, setNowPlaying] = useState<SpotifyContextValue['nowPlaying']>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [progressMs, setProgressMs] = useState(0)
  const [durationMs, setDurationMs] = useState(0)
  const [fullPlayerOpen, setFullPlayerOpen] = useState(false)
  const [fullPlayerRequested, setFullPlayerRequested] = useState(false)
  const observedPlayerRef = useRef<SpotifyPlayer | null>(null)
  const sync = useCallback(async () => {
    if (!getSpotifyToken()) return
    setLoading(true); setError(null)
    try {
      const library = await getSpotifyLibrary()
      setConnected(true); setUser(library.user); setPlaylists(library.playlists)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Spotify 同步失败'
      setError(message)
      if (message.includes('登录已过期')) disconnectSpotify()
      setConnected(Boolean(getSpotifyToken()))
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { if (getSpotifyToken()) void sync() }, [sync])
  const disconnect = useCallback(() => {
    disconnectSpotify(); setConnected(false); setUser(null); setPlaylists([]); setError(null); setNowPlaying(null); setIsPlaying(false)
  }, [])
  const updatePlayback = useCallback((state: SpotifyPlaybackState | null) => {
    if (!state) { setIsPlaying(false); return }
    const track = state.track_window.current_track
    setNowPlaying({ uri: track.uri, title: track.name, artist: track.artists.map((item) => item.name).join('、'), artwork: track.album.images[0]?.url })
    setIsPlaying(!state.paused)
    setProgressMs(state.position)
    setDurationMs(state.duration)
  }, [])
  useEffect(() => {
    // Web Playback SDK 由播放页延迟创建；Provider 轮询接管一次监听，使离开播放页后仍能同步切歌与进度。
    const observePlayer = () => {
      const player = window.moriSpotifyPlayer
      if (!player || observedPlayerRef.current === player) return
      observedPlayerRef.current = player
      player.addListener('player_state_changed', updatePlayback)
      void player.getCurrentState().then(updatePlayback)
    }
    observePlayer()
    const timer = window.setInterval(observePlayer, 500)
    return () => {
      window.clearInterval(timer)
      observedPlayerRef.current?.removeListener('player_state_changed', updatePlayback)
      observedPlayerRef.current = null
    }
  }, [updatePlayback])
  useEffect(() => {
    if (!isPlaying || !durationMs) return
    const timer = window.setInterval(() => setProgressMs((value) => Math.min(durationMs, value + 1_000)), 1_000)
    return () => window.clearInterval(timer)
  }, [isPlaying, durationMs])
  const togglePlayback = useCallback(async () => {
    const player = window.moriSpotifyPlayer
    if (!player) return
    await player.togglePlay()
    setIsPlaying((value) => !value)
  }, [])
  const requestFullPlayer = useCallback(() => setFullPlayerRequested(true), [])
  const consumeFullPlayerRequest = useCallback(() => setFullPlayerRequested(false), [])
  const value = useMemo(() => ({ configured, connected, loading, user, playlists, error, nowPlaying, isPlaying, progressMs, durationMs, fullPlayerOpen, fullPlayerRequested, connect: startSpotifyLogin, disconnect, sync, updatePlayback, togglePlayback, setFullPlayerOpen, requestFullPlayer, consumeFullPlayerRequest }), [configured, connected, loading, user, playlists, error, nowPlaying, isPlaying, progressMs, durationMs, fullPlayerOpen, fullPlayerRequested, disconnect, sync, updatePlayback, togglePlayback, requestFullPlayer, consumeFullPlayerRequest])
  return <SpotifyContext.Provider value={value}>{children}</SpotifyContext.Provider>
}

export function useSpotify() {
  const context = useContext(SpotifyContext)
  if (!context) throw new Error('useSpotify must be used within SpotifyProvider')
  return context
}
