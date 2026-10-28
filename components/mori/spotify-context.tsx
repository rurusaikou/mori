'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { disconnectSpotify, getSpotifyLibrary, getSpotifyToken, startSpotifyLogin, type SpotifyPlaylist, type SpotifyUser } from '@/lib/spotify'
import { useMusic } from './music-context'

type SpotifyContextValue = {
  configured: boolean; connected: boolean; loading: boolean; user: SpotifyUser | null; playlists: SpotifyPlaylist[]; error: string | null
  nowPlaying: { uri: string; title: string; artist: string; artwork?: string } | null; isPlaying: boolean
  progressMs: number; durationMs: number; fullPlayerOpen: boolean
  fullPlayerRequested: boolean
  connect: () => Promise<void>; disconnect: () => void; sync: () => Promise<void>
  togglePlayback: () => Promise<void>
  setFullPlayerOpen: (open: boolean) => void
  requestFullPlayer: () => void; consumeFullPlayerRequest: () => void
}
const SpotifyContext = createContext<SpotifyContextValue | null>(null)

export function SpotifyProvider({ children }: { children: React.ReactNode }) {
  const music = useMusic()
  const configured = Boolean(process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID?.trim())
  const [connected, setConnected] = useState(false)
  const [loading, setLoading] = useState(false)
  const [user, setUser] = useState<SpotifyUser | null>(null)
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([])
  const [error, setError] = useState<string | null>(null)
  const [fullPlayerOpen, setFullPlayerOpen] = useState(false)
  const [fullPlayerRequested, setFullPlayerRequested] = useState(false)
  const nowPlaying = music.track ? { uri: music.track.uri, title: music.track.title, artist: music.track.artist, artwork: music.track.artwork } : null
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
    disconnectSpotify(); setConnected(false); setUser(null); setPlaylists([]); setError(null)
  }, [])
  const togglePlayback = music.toggle
  const requestFullPlayer = useCallback(() => setFullPlayerRequested(true), [])
  const consumeFullPlayerRequest = useCallback(() => setFullPlayerRequested(false), [])
  const value = useMemo(() => ({ configured, connected, loading, user, playlists, error, nowPlaying, isPlaying: music.isPlaying, progressMs: music.progressMs, durationMs: music.durationMs, fullPlayerOpen, fullPlayerRequested, connect: startSpotifyLogin, disconnect, sync, togglePlayback, setFullPlayerOpen, requestFullPlayer, consumeFullPlayerRequest }), [configured, connected, loading, user, playlists, error, nowPlaying, music.isPlaying, music.progressMs, music.durationMs, fullPlayerOpen, fullPlayerRequested, disconnect, sync, togglePlayback, requestFullPlayer, consumeFullPlayerRequest])
  return <SpotifyContext.Provider value={value}>{children}</SpotifyContext.Provider>
}

export function useSpotify() {
  const context = useContext(SpotifyContext)
  if (!context) throw new Error('useSpotify must be used within SpotifyProvider')
  return context
}
