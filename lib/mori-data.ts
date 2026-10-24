export type ScreenId = 'home' | 'chat' | 'mood' | 'quiet' | 'memories' | 'settings' | 'connect' | 'music-profile'

export type Track = {
  id: string
  title: string
  artist: string
  cover: string
}

export const tracks = {
  eveningBreeze: {
    id: 'evening-breeze',
    title: '晚风',
    artist: 'YOASOBI',
    cover: '/covers/evening-breeze.png',
  },
  maybe: {
    id: 'maybe',
    title: 'たぶん',
    artist: 'YOASOBI',
    cover: '/covers/maybe.png',
  },
} satisfies Record<string, Track>

export type MemoryType = 'music' | 'chat' | 'moment' | 'mood'

export type Memory = {
  id: string
  date: string
  type: MemoryType
  title: string
  note: string
  time: string
  track?: Track
}

export const memories: Memory[] = [
  {
    id: 'mood-today',
    date: '今天',
    type: 'mood',
    title: '平平淡淡 · 疲惫',
    note: '主要受到工作的影响，也把《晚风》留在了这段心情里。',
    time: '21:48',
    track: tracks.eveningBreeze,
  },
  {
    id: 'm1',
    date: '今天',
    type: 'music',
    title: '晚风',
    track: tracks.eveningBreeze,
    note: '今天有点累，但听完这首歌，心情平静了很多。',
    time: '20:12',
  },
  {
    id: 'm2',
    date: '今天',
    type: 'chat',
    title: '和 Mori 聊了工作',
    note: '虽然有点迷茫，但好像更清楚自己要什么了。',
    time: '21:37',
  },
  {
    id: 'm3',
    date: '10 月 20 日',
    type: 'music',
    title: 'たぶん',
    track: tracks.maybe,
    note: '它让你想起大学最后一个夏天。',
    time: '23:05',
  },
  {
    id: 'm4',
    date: '10 月 20 日',
    type: 'moment',
    title: '一起看了日落',
    note: '你说今天的云像棉花糖，Mori 悄悄记下来了。',
    time: '17:48',
  },
]

export const memoryFilters: { id: 'all' | MemoryType; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'music', label: '音乐' },
  { id: 'mood', label: '心情' },
  { id: 'chat', label: '对话' },
  { id: 'moment', label: '瞬间' },
]

export type Playlist = {
  id: string
  name: string
  meta: string
  cover: string
}

export const playlists: Playlist[] = [
  { id: 'late-night', name: '深夜一个人听', meta: '48 首 · 2 小时 56 分', cover: '/covers/late-night.png' },
  { id: 'recent-likes', name: '最近喜欢', meta: '96 首 · 刚刚更新', cover: '/covers/recent-likes.png' },
  { id: 'quiet-work', name: '安静工作', meta: '32 首 · 低打扰播放', cover: '/covers/quiet-work.png' },
]

export const ambientSounds = ['夜雨', '海浪', '篝火', '森林'] as const
