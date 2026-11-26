/** 纯函数候选排序：不访问 Spotify，便于用真实 bad case 做确定性回归。 */
export function rankTextMatches(tracks, query) {
  const normalized = normalizeMusicSearchText(query)
  const terms = normalized.split(/[\s·、，,]+/u).filter((term) => term.length > 1)
  return tracks
    .map((track) => {
      const title = normalizeMusicSearchText(track.title); const artist = normalizeMusicSearchText(track.artist)
      const score = (title && normalized.includes(title) ? 12 : 0) + (artist && normalized.includes(artist) ? 10 : 0)
        + terms.reduce((sum, term) => sum + (title.includes(term) ? 6 : 0) + (artist.includes(term) ? 5 : 0), 0)
      return { track, score }
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((item) => item.track)
}

export function exactSearchMatches(tracks, query) {
  const normalizedQuery = normalizeMusicSearchText(query)
  return rankTextMatches(tracks, query).filter((track) => {
    // SEARCH 表示用户给了确定歌曲。歌手相同不能代替歌名命中；
    // Live/Remaster 等 Spotify 版本后缀不应让同一首歌被误判为不同目标。
    const title = searchableBaseTitle(track.title)
    return Boolean(title && normalizedQuery.includes(title))
  })
}

export function normalizeMusicSearchText(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase().replaceAll('瑩', '莹').trim()
}

function searchableBaseTitle(value) {
  return normalizeMusicSearchText(value)
    .replace(/\s*[-–—(]\s*(?:live|remaster(?:ed)?(?:\s*\d{2,4})?|现场版)[^)]*\)?\s*$/iu, '')
    .trim()
}
