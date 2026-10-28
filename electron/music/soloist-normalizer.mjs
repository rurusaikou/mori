function text(entity, field) {
  return entity?.decorations?.identity?.[field]
}

function cover(entity) {
  const covers = entity?.decorations?.visual_identity?.cover
  if (!Array.isArray(covers)) return undefined
  return [...covers].reverse().find((item) => typeof item?.url === 'string')?.url
}

export function normalizeEntity(entity) {
  if (!entity?.uri) return null
  const parent = entity.decorations?.parent?.entity
  const creators = entity.decorations?.creators
  const artists = Array.isArray(creators)
    ? creators.map((creator) => text(creator?.entity, 'name')).filter(Boolean)
    : []
  return {
    uri: entity.uri,
    entityType: entity.entity_type ?? 'unknown',
    title: text(entity, 'name') ?? '未知曲目',
    artists,
    artist: artists.join('、'),
    album: text(parent, 'name'),
    artwork: cover(entity) ?? cover(parent),
    durationMs: entity.decorations?.playback?.duration_ms ?? 0,
  }
}

export function normalizeQueueItem(entry) {
  const track = normalizeEntity(entry?.item)
  if (!track) return null
  return {
    uid: entry.uid ?? track.uri,
    source: entry.source ?? 'context',
    track,
  }
}

export function normalizeQueue(event) {
  const normalize = (items) => (Array.isArray(items) ? items.map(normalizeQueueItem).filter(Boolean) : [])
  return { previous: normalize(event.previous), upcoming: normalize(event.upcoming) }
}

export function normalizeContext(entity) {
  if (!entity?.uri) return null
  return { uri: entity.uri, type: entity.entity_type ?? 'unknown', name: text(entity, 'name') }
}
