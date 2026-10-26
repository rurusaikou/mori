'use client'

import type { ScreenId } from '@/lib/mori-data'
import { BottomNav, MiniPlayer, Toast } from './app-chrome'
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
const WITH_MINI_PLAYER: ScreenId[] = ['connect', 'memories', 'settings']

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
    <div className="relative flex h-dvh w-full overflow-hidden bg-linear-to-b from-[#241d47] via-background to-[#120e24]" style={{ '--mori-mini-player-height': showMiniPlayer ? '4.5rem' : '0rem' } as React.CSSProperties}>
      {screen === 'home' && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[calc(31rem+2.75rem)] overflow-hidden">
          <img src="/mori-home-night.png" alt="" className="size-full object-cover object-[center_42%] opacity-75" />
          <span className="absolute inset-0 bg-linear-to-b from-[#151331]/10 via-[#17112d]/10 to-[#17112d]" />
          <span className="absolute inset-x-0 top-0 h-36 bg-linear-to-b from-[#1d1941]/80 to-transparent" />
        </div>
      )}
      {!IMMERSIVE.includes(screen) && <BottomNav />}
      <div className="relative min-w-0 flex-1 pt-8 [-webkit-app-region:no-drag] before:absolute before:inset-x-0 before:top-0 before:h-8 before:[-webkit-app-region:drag]">
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
