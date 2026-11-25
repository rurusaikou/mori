/**
 * Ackem Recall Composer 的轻量实现：先保留确定性歌曲命中，再按类型预算选择少量结果。
 * Repository 负责召回候选；Composer 负责去重和 Context token 预算，二者职责分离。
 */
export function composeRelevantMemory(candidates, { limit = 5, factLimit = 2, momentLimit = 2 } = {}) {
  const selected = []
  const seen = new Set()
  const counts = { fact: 0, moment: 0, other: 0 }
  const ordered = [...(candidates ?? [])].sort(compareCandidate)
  for (const candidate of ordered) {
    if (!candidate?.id || seen.has(candidate.id) || selected.length >= limit) continue
    const bucket = candidate.kind === 'moment' ? 'moment' : candidate.kind === 'preference' ? 'fact' : 'other'
    const cap = bucket === 'moment' ? momentLimit : bucket === 'fact' ? factLimit : limit
    if (counts[bucket] >= cap) continue
    selected.push(candidate); seen.add(candidate.id); counts[bucket] += 1
  }
  // 类型配额有剩余但候选不足时，用其余高分候选补满总预算，避免人为丢失唯一相关记忆。
  for (const candidate of ordered) {
    if (!candidate?.id || seen.has(candidate.id) || selected.length >= limit) continue
    selected.push(candidate); seen.add(candidate.id)
  }
  return selected
}

function compareCandidate(a, b) {
  const reasonPriority = { TRACK_URI: 0, TRACK_IDENTITY: 1, KEYWORD: 2, SEMANTIC: 3 }
  return (reasonPriority[a.matchReason] ?? 4) - (reasonPriority[b.matchReason] ?? 4)
    || (Number(b.score) || 0) - (Number(a.score) || 0)
    || String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''))
}
