import assert from 'node:assert/strict'
import test from 'node:test'
import { composeRelevantMemory } from '../../../../src/mori-agent/brain/memory/recall-composer.mjs'

test('prioritizes exact track memories while preserving Fact and Moment diversity', () => {
  const result = composeRelevantMemory([
    { id: 'f-keyword-1', kind: 'preference', score: 0.9, matchReason: 'KEYWORD' },
    { id: 'f-track', kind: 'preference', score: 1, matchReason: 'TRACK_URI' },
    { id: 'f-keyword-2', kind: 'preference', score: 0.8, matchReason: 'KEYWORD' },
    { id: 'f-keyword-3', kind: 'preference', score: 0.7, matchReason: 'KEYWORD' },
    { id: 'm-track', kind: 'moment', score: 1, matchReason: 'TRACK_URI' },
    { id: 'm-keyword', kind: 'moment', score: 0.6, matchReason: 'KEYWORD' },
  ], { limit: 5, factLimit: 2, momentLimit: 2 })

  assert.deepEqual(result.slice(0, 2).map((item) => item.id), ['f-track', 'm-track'])
  assert.equal(result.filter((item) => item.kind === 'moment').length, 2)
  assert.equal(result.length, 5)
})

test('deduplicates candidates and fills unused type budget', () => {
  const result = composeRelevantMemory([
    { id: 'f1', kind: 'preference', score: 1, matchReason: 'TRACK_URI' },
    { id: 'f1', kind: 'preference', score: 0.5, matchReason: 'KEYWORD' },
    { id: 'f2', kind: 'preference', score: 0.8, matchReason: 'KEYWORD' },
    { id: 'f3', kind: 'preference', score: 0.7, matchReason: 'KEYWORD' },
  ], { limit: 3, factLimit: 2, momentLimit: 1 })
  assert.deepEqual(result.map((item) => item.id), ['f1', 'f2', 'f3'])
})
