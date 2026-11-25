import assert from 'node:assert/strict'
import test from 'node:test'
import { UNIFIED_CONVERSATION_CASES } from '../../../src/mori-agent/evaluation/conversation-cases.mjs'
import { evaluateConversationCase } from '../../../src/mori-agent/evaluation/conversation-evaluator.mjs'

test('evaluation set covers the four observed multi-turn failure classes', () => {
  assert.deepEqual(UNIFIED_CONVERSATION_CASES.map((item) => item.id), [
    'teacher-reunion-roles', 'short-continuation-target', 'omitted-subject-luggage', 'hesitation-feedback',
  ])
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