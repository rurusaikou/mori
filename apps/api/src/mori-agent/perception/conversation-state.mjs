export const EMPTY_CONVERSATION_STATE = Object.freeze({
  activeTopic: null,
  entities: [],
  facts: [],
  lastUserMessage: null,
  lastAssistantMessage: null,
  unresolvedContext: null,
})

export function normalizeConversationState(value, fallback = EMPTY_CONVERSATION_STATE) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback
  const activeTopic = value.activeTopic === null ? null : optionalText(value.activeTopic, 160) ?? fallback.activeTopic
  const sameTopic = activeTopic !== null && activeTopic === fallback.activeTopic
  const entities = normalizeEntities(value.entities, sameTopic ? fallback.entities : [])
  const facts = normalizeFacts(value.facts, sameTopic ? fallback.facts : [])
  return {
    activeTopic,
    entities: mergeEntities(sameTopic ? fallback.entities : [], entities),
    facts: mergeFacts(sameTopic ? fallback.facts : [], facts),
    lastUserMessage: optionalText(value.lastUserMessage, 500) ?? fallback.lastUserMessage,
    lastAssistantMessage: optionalText(value.lastAssistantMessage, 500) ?? fallback.lastAssistantMessage,
    unresolvedContext: value.unresolvedContext === null ? null : optionalText(value.unresolvedContext, 240) ?? fallback.unresolvedContext,
  }
}

function mergeEntities(previous, current) {
  return [...new Map([...previous, ...current].map((entity) => [entity.id, entity])).values()].slice(-12)
}

function mergeFacts(previous, current) {
  const key = (fact) => `${fact.subject}\u0000${fact.relation}\u0000${fact.object}`
  return [...new Map([...previous, ...current].map((fact) => [key(fact), fact])).values()].slice(-16)
}

function normalizeEntities(value, fallback) {
  if (!Array.isArray(value)) return fallback
  return value.slice(-12).flatMap((entity) => {
    if (!entity || typeof entity !== 'object') return []
    const label = optionalText(entity.label, 80)
    const id = optionalText(entity.id, 80) ?? label
    const kind = ['PERSON', 'PLACE', 'OBJECT', 'OTHER'].includes(entity.kind) ? entity.kind : 'OTHER'
    return label ? [{ id, label, kind }] : []
  })
}

function normalizeFacts(value, fallback) {
  if (!Array.isArray(value)) return fallback
  return value.slice(-16).flatMap((fact) => {
    if (!fact || typeof fact !== 'object') return []
    const subject = optionalText(fact.subject, 80)
    const relation = optionalText(fact.relation, 80)
    const object = optionalText(fact.object, 160)
    const evidence = optionalText(fact.evidence, 240)
    const confidence = Number.isFinite(fact.confidence) ? Math.max(0, Math.min(1, fact.confidence)) : 0
    return subject && relation && object && evidence ? [{ subject, relation, object, evidence, confidence }] : []
  })
}

function optionalText(value, maxLength) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : null
}