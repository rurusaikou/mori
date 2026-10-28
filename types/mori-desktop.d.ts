import type { MusicState } from '@/lib/music/types'

declare global {
  interface Window {
    moriDesktop?: {
      openWindow: (type: 'player' | 'presence' | 'conversation') => Promise<void>
      closeCurrentWindow: () => Promise<void>
      music: {
        getState: () => Promise<MusicState>
        command: (command: 'play' | 'pause' | 'previous' | 'next' | 'seek' | 'volume' | 'shuffle' | 'repeat' | 'queue' | 'activate' | 'deactivate', payload?: Record<string, unknown>) => Promise<void>
        onState: (listener: (state: MusicState) => void) => () => void
      }
    }
  }
}

export {}
