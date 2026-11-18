/** 推荐行动只负责按听感和用户约束排序，不承担精确歌名/歌手查找。 */
import { rankCatalogByPreference } from './search-music.mjs'

export function createRecommendMusicTool(catalog, resolveFeatures = null) {
  return {
    name: 'recommend_music',
    description: '从可播放候选中推荐音乐；用于“推荐、换一首、随便来一首”，默认排除当前歌曲',
    async execute(args) {
      const preference = typeof args?.query === 'string' ? args.query.trim() : ''
      const excluded = new Set(Array.isArray(args?.excludeUris) ? args.excludeUris.filter((item) => typeof item === 'string') : [])
      const candidates = catalog.filter((track) => !excluded.has(track.uri))
      const ranked = rankCatalogByPreference(candidates, preference, resolveFeatures)
      // 没有可用音频特征或用户没有给出条件时，仍可从已排除当前曲目的可信候选中推荐；
      // 这与精确搜索的“无匹配即为空”语义不同。
      const pool = ranked.length ? ranked : preference ? [] : rotateFromRandomStart(candidates)
      const results = pool.slice(0, 5)
      return {
        preference,
        excludedUris: [...excluded],
        source: results[0]?.catalogSource ?? 'user_library',
        searchScope: catalog.some((track) => track.catalogSource === 'spotify_search') ? 'library_then_spotify' : 'user_library',
        results,
      }
    },
  }
}

function rotateFromRandomStart(candidates) {
  if (candidates.length < 2) return candidates
  // 无条件推荐没有可解释的排序依据。随机轮换可信候选比永远取数组第一首更符合
  // “随便来一首”的语义；当前曲目已经在上方被排除，因此不会立即重复播放。
  const offset = Math.floor(Math.random() * candidates.length)
  return [...candidates.slice(offset), ...candidates.slice(0, offset)]
}
