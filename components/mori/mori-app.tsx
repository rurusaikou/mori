'use client'

import { useEffect, useState } from 'react'

import type { ScreenId } from '@/lib/mori-data'
import { DesktopSidebar, MiniPlayer, Toast } from './app-chrome'
import { MoriProvider, useMori } from './mori-context'
import { MoodScreen } from './screens/mood-screen'
import { ChatScreen } from './screens/chat-screen'
import { ConnectScreen } from './screens/connect-screen'
import { HomeScreen } from './screens/home-screen'
import { MemoriesScreen } from './screens/memories-screen'
import { QuietScreen } from './screens/quiet-screen'
import { SettingsScreen } from './screens/settings-screen'
import { MusicProfileScreen } from './screens/music-profile-screen'
import { SpotifyProvider, useSpotify } from './spotify-context'
import { MusicProvider } from './music-context'
import { ConversationWindow, PlayerWindow, PresenceWindow, type DesktopWindowType } from './desktop-windows'

const screens: Record<ScreenId, () => React.ReactNode> = {
  home: HomeScreen,
  chat: ChatScreen,
  mood: MoodScreen,
  quiet: QuietScreen,
  memories: MemoriesScreen,
  settings: SettingsScreen,
  connect: ConnectScreen,
  'music-profile': MusicProfileScreen,
}

const IMMERSIVE: ScreenId[] = ['mood', 'quiet']
const WITH_MINI_PLAYER: ScreenId[] = ['connect', 'memories', 'settings']

export function MoriApp() {
  const [windowType, setWindowType] = useState<DesktopWindowType | 'workspace' | null>(null)
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('window')
    setWindowType(value === 'player' || value === 'presence' || value === 'conversation' ? value : 'workspace')
  }, [])

  if (!windowType) return <div className="h-dvh bg-[#171229]" />
  return (
    <MusicProvider>
      <SpotifyProvider>
        <MoriProvider>
          {windowType === 'player' ? <PlayerWindow /> : windowType === 'presence' ? <PresenceWindow /> : windowType === 'conversation' ? <ConversationWindow /> : <DesktopShell />}
        </MoriProvider>
      </SpotifyProvider>
    </MusicProvider>
  )
}

function DesktopShell() {
  const { screen, currentTrack } = useMori()
  const spotify = useSpotify()
  const Screen = screens[screen]
  const showMiniPlayer = WITH_MINI_PLAYER.includes(screen) && !spotify.fullPlayerOpen && Boolean(spotify.nowPlaying || currentTrack)

  return (
    <div className="relative flex h-dvh w-full overflow-hidden bg-linear-to-b from-[#241d47] via-background to-[#120e24]" style={{ '--mori-mini-player-height': showMiniPlayer ? '4.5rem' : '0rem' } as React.CSSProperties}>
      {screen === 'home' && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[calc(31rem+2.75rem)] overflow-hidden">
          <img src="/mori-home-night.png" alt="" className="size-full object-cover object-[center_42%] opacity-75" />
          <span className="absolute inset-0 bg-linear-to-b from-[#151331]/10 via-[#17112d]/10 to-[#17112d]" />
          <span className="absolute inset-x-0 top-0 h-36 bg-linear-to-b from-[#1d1941]/80 to-transparent" />
        </div>
      )}
      {!IMMERSIVE.includes(screen) && <DesktopSidebar />}
      <div className="relative min-w-0 flex-1 pt-8 [-webkit-app-region:no-drag] before:absolute before:inset-x-0 before:top-0 before:h-8 before:[-webkit-app-region:drag]">
        {window.moriDesktop && <button type="button" onClick={() => void window.moriDesktop?.openWindow('player')} className="absolute right-3 top-1 z-50 rounded-lg px-2.5 py-1 text-[11px] text-white/45 transition hover:bg-white/10 hover:text-white [-webkit-app-region:no-drag]">播放器</button>}
        <main className="relative h-full min-h-0">
          <div key={screen} className="absolute inset-0 animate-in fade-in duration-200">
            <Screen />
          </div>
        </main>
        {showMiniPlayer && <MiniPlayer />}
        <Toast />
      </div>
    </div>
  )
}
