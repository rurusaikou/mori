/** Tool：Playground 使用稳定 Mock；正式产品只检索 Extension 明确提供的可播放曲库。 */
export function createSearchMusicTool(catalog = null) {
  const productMode = Array.isArray(catalog)
  return {
    name: 'search_music',
    description: productMode ? '在用户可播放曲库中搜索歌曲；命中后由 Extension 播放首个结果' : '搜索歌曲、艺人或相关音乐信息',
    async execute(args) {
      const query = requiredQuery(args)
      return productMode
        ? { query, source: 'user_library', results: searchCatalog(catalog, query) }
        : { query, source: 'mock', results: mockResults(query) }
    },
  }
}
function requiredQuery(args) { if (typeof args?.query !== 'string' || !args.query.trim()) throw new Error('search_music.query 必须是非空字符串'); return args.query.trim() }
function mockResults(query) { return [{ id: 'mock-track-1', title: query, artist: 'Mock Artist', note: 'V0.1 Mock Result，尚未连接真实音乐 API' }] }
function searchCatalog(catalog, query) {
  const terms = query.toLocaleLowerCase().split(/[\s·、，,《》「」]+/u).filter(Boolean)
  if (terms.length && terms.every((term) => /^(任意|随便|随机|一首|歌曲?|音乐|安排)$/u.test(term))) return catalog.slice(0, 5)
  return catalog
    .map((track) => ({ track, score: scoreTrack(track, terms) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5)
    .map(({ track }) => track)
}
function scoreTrack(track, terms) {
  const title = track.title.toLocaleLowerCase(); const artist = track.artist.toLocaleLowerCase()
  return terms.reduce((score, term) => score + (artist === term ? 8 : artist.includes(term) ? 5 : 0) + (title === term ? 7 : title.includes(term) ? 4 : 0), 0)
}
