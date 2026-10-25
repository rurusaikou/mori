'use client'

import type { ScreenId } from '@/lib/mori-data'
import { BottomNav, MiniPlayer, StatusBar, Toast } from './app-chrome'
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
const WITH_MINI_PLAYER: ScreenId[] = ['home', 'connect', 'memories', 'settings']

export function MoriApp() {
  return (
    <SpotifyProvider>
      <MoriProvider><PhoneShell /></MoriProvider>
    </SpotifyProvider>
  )
}

function PhoneShell() {
  const { screen, currentTrack } = useMori()
  const spotify = useSpotify()
  const Screen = screens[screen]
  const showMiniPlayer = WITH_MINI_PLAYER.includes(screen) && !spotify.fullPlayerOpen && Boolean(spotify.nowPlaying || currentTrack)

  return (
    <div className="relative flex h-dvh w-full flex-col overflow-hidden bg-linear-to-b from-[#241d47] via-background to-[#120e24] pt-[env(safe-area-inset-top)] md:h-[min(844px,calc(100dvh-48px))] md:w-[390px] md:rounded-[46px] md:pt-0 md:shadow-[0_40px_100px_rgba(0,0,0,0.7),0_0_0_10px_#0a0814,0_0_0_11px_#4a3d66]" style={{ '--mori-mini-player-height': showMiniPlayer ? '3.5rem' : '0rem' } as React.CSSProperties}>
      <StatusBar />
      <main className="relative min-h-0 flex-1">
        <div key={screen} className="absolute inset-0 animate-in fade-in slide-in-from-right-2 duration-300">
          <Screen />
        </div>
      </main>
      {showMiniPlayer && <MiniPlayer />}
      {!IMMERSIVE.includes(screen) && <BottomNav />}
      <Toast />
    </div>
  )
}
