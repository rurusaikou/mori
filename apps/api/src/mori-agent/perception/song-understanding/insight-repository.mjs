/** Perception 的进程内歌曲洞察缓存；接口与存储实现分离，后续可替换为 PostgreSQL。 */
export function createTrackInsightRepository({ ttlMs = 7 * 24 * 60 * 60 * 1_000 } = {}) {
  const cache = new Map()
  return {
    get(key) {
      const item = cache.get(key)
      if (!item || Date.now() - item.storedAt > ttlMs) { if (item) cache.delete(key); return null }
      return structuredClone(item.value)
    },
    set(key, value) { cache.set(key, { storedAt: Date.now(), value: structuredClone(value) }); return value },
    get size() { return cache.size },
  }
}
