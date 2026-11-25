/** Memory Extraction 的独立 Input/Output Schema；Fact 与 Moment 分开验证。 */
import { confidence, noExtra, object, text } from '../../../shared/executor.mjs'

export const MEMORY_SCHEMA = {
  type: 'object',
  properties: {
    facts: { type: 'array', maxItems: 2, items: { type: 'object', properties: {
      category: { type: 'string', enum: ['preference', 'dislike', 'music_fact'] },
      dimension: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      attribute: { anyOf: [{ type: 'string' }, { type: 'null' }] }, content: { type: 'string' },
      confidence: { type: 'number' }, evidence: { type: 'string' },
      supersedesId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    }, required: ['category', 'dimension', 'attribute', 'content', 'confidence', 'evidence', 'supersedesId'], additionalProperties: false } },
    moments: { type: 'array', maxItems: 1, items: { type: 'object', properties: {
      summary: { type: 'string' }, userReflection: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      confidence: { type: 'number' }, evidence: { type: 'string' },
    }, required: ['summary', 'userReflection', 'confidence', 'evidence'], additionalProperties: false } },
  }, required: ['facts', 'moments'], additionalProperties: false,
}

export function validateMemoryInput(value) {
  object(value); noExtra(value, ['userMessage', 'assistantResponse', 'conversationContext', 'currentTrack', 'existingFacts'], 'Memory input')
  text(value.userMessage, 'userMessage')
  if (value.assistantResponse != null) text(value.assistantResponse, 'assistantResponse')
  if (value.currentTrack != null) validateTrack(value.currentTrack)
  if (value.existingFacts != null && !Array.isArray(value.existingFacts)) throw new Error('existingFacts 必须是数组')
  return value
}

export function validateMemoryOutput(value, input) {
  object(value, 'Memory output'); noExtra(value, ['facts', 'moments'], 'Memory output')
  if (!Array.isArray(value.facts) || value.facts.length > 2) throw new Error('facts 无效')
  if (!Array.isArray(value.moments) || value.moments.length > 1) throw new Error('moments 无效')
  const facts = value.facts.map((fact) => {
    object(fact, 'fact'); noExtra(fact, ['category', 'dimension', 'attribute', 'content', 'confidence', 'evidence', 'supersedesId'], 'fact')
    if (!['preference', 'dislike', 'music_fact'].includes(fact.category)) throw new Error('fact.category 无效')
    if (fact.dimension != null) text(fact.dimension, 'fact.dimension')
    if (fact.attribute != null) text(fact.attribute, 'fact.attribute')
    text(fact.content, 'fact.content'); confidence(fact.confidence); explicitEvidence(fact.evidence, input.userMessage)
    if (fact.supersedesId != null && !(input.existingFacts ?? []).some((item) => item.id === fact.supersedesId)) throw new Error('supersedesId 必须来自 existingFacts')
    return fact
  })
  const moments = value.moments.map((moment) => {
    object(moment, 'moment'); noExtra(moment, ['summary', 'userReflection', 'confidence', 'evidence'], 'moment')
    text(moment.summary, 'moment.summary'); if (moment.userReflection != null) text(moment.userReflection, 'moment.userReflection')
    confidence(moment.confidence); explicitEvidence(moment.evidence, input.userMessage)
    if (!input.currentTrack) throw new Error('没有确定歌曲时不能创建 Music Moment 候选')
    return moment
  })
  return { facts, moments }
}

function explicitEvidence(value, userMessage) { text(value, 'evidence'); if (!userMessage.includes(value)) throw new Error('evidence 必须逐字来自当前用户消息') }
function validateTrack(value) { object(value, 'currentTrack'); text(value.uri, 'currentTrack.uri'); text(value.title, 'currentTrack.title'); text(value.artist, 'currentTrack.artist') }
