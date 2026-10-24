'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { disconnectSpotify, getSpotifyLibrary, getSpotifyToken, startSpotifyLogin, type SpotifyPlaylist, type SpotifyUser } from '@/lib/spotify'

type SpotifyContextValue = {
  configured: boolean; connected: boolean; loading: boolean; user: SpotifyUser | null; playlists: SpotifyPlaylist[]; error: string | null
  connect: () => Promise<void>; disconnect: () => void; sync: () => Promise<void>
}
const SpotifyContext = createContext<SpotifyContextValue | null>(null)

export function SpotifyProvider({ children }: { children: React.ReactNode }) {
  const configured = Boolean(process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID?.trim())
  const [connected, setConnected] = useState(false)
  const [loading, setLoading] = useState(false)
  const [user, setUser] = useState<SpotifyUser | null>(null)
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([])
  const [error, setError] = useState<string | null>(null)
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
  const value = useMemo(() => ({ configured, connected, loading, user, playlists, error, connect: startSpotifyLogin, disconnect, sync }), [configured, connected, loading, user, playlists, error, disconnect, sync])
  return <SpotifyContext.Provider value={value}>{children}</SpotifyContext.Provider>
}

export function useSpotify() {
  const context = useContext(SpotifyContext)
  if (!context) throw new Error('useSpotify must be used within SpotifyProvider')
  return context
}
