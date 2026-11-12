/**
 * Tool：Playground 使用稳定 Mock；正式产品只检索 Extension 明确提供的可播放曲库。
 * 输入：模型归纳的歌名、歌手或听感 query，以及 composition root 注入的 ISRC 特征读取器。
 * 输出：最多五首真实候选；只负责排序，不产生播放副作用或接受模型提供的任意 URI。
 */
export function createSearchMusicTool(catalog = null, resolveFeatures = null) {
  const productMode = Array.isArray(catalog)
  return {
    name: 'search_music',
    description: productMode ? '在用户可播放曲库中搜索歌曲；命中后由 Extension 播放首个结果' : '搜索歌曲、艺人或相关音乐信息',
    async execute(args) {
      const query = requiredQuery(args)
      return productMode
        ? { query, source: 'user_library', results: searchCatalog(catalog, query, resolveFeatures) }
        : { query, source: 'mock', results: mockResults(query) }
    },
  }
}
function requiredQuery(args) { if (typeof args?.query !== 'string' || !args.query.trim()) throw new Error('search_music.query 必须是非空字符串'); return args.query.trim() }
function mockResults(query) { return [{ id: 'mock-track-1', title: query, artist: 'Mock Artist', note: 'V0.1 Mock Result，尚未连接真实音乐 API' }] }
function searchCatalog(catalog, query, resolveFeatures) {
  const terms = query.toLocaleLowerCase().split(/[\s·、，,《》「」]+/u).filter(Boolean)
  if (terms.length && terms.every((term) => /^(任意|随便|随机|一首|歌曲?|音乐|安排)$/u.test(term))) return catalog.slice(0, 5)
  return catalog
    .map((track) => ({ track, score: scoreTrack(track, terms, query) + scoreFeatures(resolveFeatures?.(track.isrc), query) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5)
    .map(({ track }) => track)
}
function scoreFeatures(features, query) {
  if (!features) return 0
  const bpm = normalized(features.bpm, 60, 180)
  const energy = normalized(features.energy)
  const groove = normalized(features.danceability)
  const mood = normalized(features.valence)
  const acoustic = normalized(features.acousticness)
  let score = 0
  // Feature intent is deliberately deterministic: the LLM translates natural language into a
  // concise query, while real cached audio features—not model guesses—rank playable tracks.
  if (/(有节奏|节奏感|律动|动感|跳舞|蹦迪|groove|dance)/iu.test(query)) score += groove * 8 + bpm * 3
  if (/(快节奏|偏快|速度快)/u.test(query)) score += bpm * 9
  if (/(带劲|有能量|高能|燃|强烈|力量|energy)/iu.test(query)) score += energy * 9
  if (/(安静|舒缓|柔和|放松|轻柔|低能量)/u.test(query)) score += (1 - energy) * 7 + (1 - bpm) * 3
  if (/(明亮|开心|快乐|积极|轻快)/u.test(query)) score += mood * 8
  if (/(深沉|忧郁|伤感|内省|暗色)/u.test(query)) score += (1 - mood) * 8
  if (/(原声|自然|木吉他|乐器感)/u.test(query)) score += acoustic * 8
  if (/(电子|现代制作|合成器)/u.test(query)) score += (1 - acoustic) * 8
  return score
}
function normalized(value, min = 0, max = 1) {
  // Missing features contribute zero instead of an invented neutral score. This keeps semantic
  // recommendations explainable: only tracks analyzed by the profile pipeline gain feature score.
  return Number.isFinite(value) ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0
}
function scoreTrack(track, terms, query) {
  const title = track.title.toLocaleLowerCase(); const artist = track.artist.toLocaleLowerCase()
  const normalizedQuery = query.toLocaleLowerCase()
  const embedded = (artist && normalizedQuery.includes(artist) ? 8 : 0) + (title && normalizedQuery.includes(title) ? 7 : 0)
  return embedded + terms.reduce((score, term) => score + (artist === term ? 8 : artist.includes(term) ? 5 : 0) + (title === term ? 7 : title.includes(term) ? 4 : 0), 0)
}
