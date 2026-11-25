/**
 * 将有效 Music Facts 收敛为可解释的动态品味维度。
 * 这里只做确定性证据聚合；不从单次播放或当前情绪推断长期偏好。
 */
export function consolidateTasteProfile(facts, updatedAt = new Date().toISOString()) {
  const groups = new Map()
  for (const fact of facts ?? []) {
    if (!fact?.id || !fact?.content || fact.status === 'superseded' || fact.status === 'deleted') continue
    const category = fact.tags?.find((tag) => ['preference', 'dislike', 'music_fact'].includes(tag)) ?? 'music_fact'
    const dimension = fact.tags?.find((tag) => tag.startsWith('dimension:'))?.slice('dimension:'.length) || category
    const attribute = fact.tags?.find((tag) => tag.startsWith('attribute:'))?.slice('attribute:'.length) || null
    const weight = clamp(Number(fact.confidence) || 0)
    const identity = `${dimension}\u0000${attribute ?? ''}`
    if (!groups.has(identity)) groups.set(identity, { dimension, attribute, evidence: [] })
    groups.get(identity).evidence.push({ ...fact, category, weight })
  }

  return [...groups.values()].map(({ dimension, attribute, evidence }) => {
    const positive = evidence.filter((item) => item.category !== 'dislike').reduce((sum, item) => sum + item.weight, 0)
    const negative = evidence.filter((item) => item.category === 'dislike').reduce((sum, item) => sum + item.weight, 0)
    const total = positive + negative
    const balance = total ? (positive - negative) / total : 0
    const stance = Math.abs(balance) < 0.25 ? 'mixed' : balance > 0 ? 'likes' : 'dislikes'
    const confidence = round(clamp(Math.abs(balance) * Math.min(1, total / 2)))
    const strongest = [...evidence].sort((a, b) => b.weight - a.weight)[0]
    return {
      dimension,
      attribute,
      stance,
      summary: strongest.content,
      confidence,
      evidenceIds: evidence.map((item) => item.id),
      updatedAt,
    }
  }).sort((a, b) => b.confidence - a.confidence || a.dimension.localeCompare(b.dimension) || String(a.attribute).localeCompare(String(b.attribute)))
}

function clamp(value) { return Math.max(0, Math.min(1, value)) }
function round(value) { return Math.round(value * 1000) / 1000 }
