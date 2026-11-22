/**
 * 模糊听歌请求。Brain 只整理推荐条件；真实候选、排除和 Spotify 播放由拥有用户授权
 * 的 Extension Action 层执行，避免服务端维护一份不完整的临时曲库。
 */
export function createRecommendMusicTool() {
  return {
    name: 'recommend_music',
    description: '目标不明确时，根据听感、场景和相关 Memory 推荐歌曲',
    async execute(args) {
      return {
        operation: 'recommend_music',
        query: typeof args?.query === 'string' ? args.query.trim() : '',
        excludeUris: Array.isArray(args?.excludeUris) ? args.excludeUris.filter((uri) => typeof uri === 'string' && uri) : [],
      }
    },
  }
}
