/**
 * 明确歌曲搜索请求。正式环境只生成待客户端执行的 Tool Request：Spotify 凭证属于
 * Extension，服务端不得依赖预加载候选或接收 OAuth Token。Playground 保留 Mock Result。
 */
export function createSearchMusicTool(mode = 'delegate') {
  return {
    name: 'search_music',
    description: '按明确歌名、歌手或版本查找歌曲；先查用户完整曲库，未命中再查 Spotify',
    async execute(args) {
      const query = requiredQuery(args)
      if (mode === 'delegate') return { status: 'PENDING', operation: 'search_music', query, excludeUris: exclusions(args), tracks: [] }
      return { query, source: 'mock', results: [{ id: 'mock-track-1', title: query, artist: 'Mock Artist', note: 'Playground Mock Result' }] }
    },
  }
}

function requiredQuery(args) {
  if (typeof args?.query !== 'string' || !args.query.trim()) throw new Error('search_music.query 必须是非空字符串')
  return args.query.trim()
}

function exclusions(args) {
  return Array.isArray(args?.excludeUris) ? args.excludeUris.filter((uri) => typeof uri === 'string' && uri) : []
}
