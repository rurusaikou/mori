import assert from 'node:assert/strict'
import test from 'node:test'
import { REQUIRED_EVALUATION_CATEGORIES, UNIFIED_CONVERSATION_CASES } from '../../../src/mori-agent/evaluation/conversation-cases.mjs'
import { evaluateConversationCase } from '../../../src/mori-agent/evaluation/conversation-evaluator.mjs'

test('evaluation set covers every Mori main-chain module and historical bad-case class', () => {
  const categories = new Set(UNIFIED_CONVERSATION_CASES.map((item) => item.category))
  assert.deepEqual([...REQUIRED_EVALUATION_CATEGORIES].sort(), [...categories].sort())
  assert.ok(UNIFIED_CONVERSATION_CASES.length >= 17)
  assert.ok(UNIFIED_CONVERSATION_CASES.every((item) => item.id && item.source && item.severity && item.description))
  assert.ok(UNIFIED_CONVERSATION_CASES.some((item) => item.id === 'interjection-does-not-repeat-action'))
  assert.ok(UNIFIED_CONVERSATION_CASES.some((item) => item.id === 'exact-track-correction'))
  assert.ok(UNIFIED_CONVERSATION_CASES.some((item) => item.id === 'accept-pending-proposal'))
})

test('rubric rejects unsupported claims without pretending to prove semantic correctness', () => {
  const testCase = UNIFIED_CONVERSATION_CASES.find((item) => item.id === 'teacher-reunion-roles')
  const result = evaluateConversationCase(testCase, { success: true, finalResponse: '老师终于能好好休息了。' })
  assert.equal(result.passed, false)
  assert.ok(result.issues.some((issue) => issue.startsWith('unsupported claim:')))
})

test('rubric accepts an on-topic, non-fabricated teacher update', () => {
  const testCase = UNIFIED_CONVERSATION_CASES.find((item) => item.id === 'omitted-subject-luggage')
  const result = evaluateConversationCase(testCase, { success: true, finalResponse: '看来老师已经开始准备出发了。' })
  assert.equal(result.passed, true)
})

test('rubric checks the client action contract, query grounding, and exclusions', () => {
  const exact = UNIFIED_CONVERSATION_CASES.find((item) => item.id === 'exact-track-correction')
  const wrongIntent = evaluateConversationCase(exact, {
    success: true, finalResponse: '我先找找。', meta: { runId: 'run-1' },
    action: { type: 'music_request', intent: 'RECOMMEND', query: '徐佳莹', excludeUris: [] },
  })
  assert.equal(wrongIntent.passed, false)
  assert.ok(wrongIntent.issues.some((issue) => issue.includes('action intent')))
  assert.ok(wrongIntent.issues.some((issue) => issue.includes('身骑白马')))

  const other = UNIFIED_CONVERSATION_CASES.find((item) => item.id === 'explicit-other-song')
  const missingExclusion = evaluateConversationCase(other, {
    success: true, finalResponse: '我先挑一首。', meta: { runId: 'run-2' },
    action: { type: 'music_request', intent: 'RECOMMEND', query: '', excludeUris: [] },
  })
  assert.equal(missingExclusion.passed, false)
  assert.ok(missingExclusion.issues.some((issue) => issue.includes('action exclusion')))
})

test('rubric rejects any side effect for an interjection', () => {
  const testCase = UNIFIED_CONVERSATION_CASES.find((item) => item.id === 'interjection-does-not-repeat-action')
  const result = evaluateConversationCase(testCase, {
    success: true, finalResponse: '好，我切到下一首。',
    action: { type: 'playback_control', command: 'NEXT' },
  })
  assert.equal(result.passed, false)
  assert.ok(result.issues.some((issue) => issue.startsWith('unexpected action:')))
})
