import assert from 'node:assert/strict'
import test from 'node:test'
import { consolidateTasteProfile } from '../../../../src/mori-agent/brain/memory/taste-profile.mjs'

test('builds an evidence-backed taste dimension from multiple Music Facts', () => {
  const profile = consolidateTasteProfile([
    { id: 'f1', content: '喜欢清澈女声', status: 'confirmed', confidence: 0.9, tags: ['preference', 'dimension:vocal'] },
    { id: 'f2', content: '常主动选择女声作品', status: 'candidate', confidence: 0.7, tags: ['preference', 'dimension:vocal'] },
  ], '2026-11-24T12:00:00.000Z')

  assert.equal(profile.length, 1)
  assert.equal(profile[0].dimension, 'vocal')
  assert.equal(profile[0].stance, 'likes')
  assert.deepEqual(profile[0].evidenceIds, ['f1', 'f2'])
  assert.equal(profile[0].updatedAt, '2026-11-24T12:00:00.000Z')
  assert.ok(profile[0].confidence > 0.7)
})

test('contradictory evidence lowers confidence instead of overwriting the profile', () => {
  const [profile] = consolidateTasteProfile([
    { id: 'f1', content: '喜欢强鼓点', status: 'confirmed', confidence: 0.9, tags: ['preference', 'dimension:rhythm'] },
    { id: 'f2', content: '不喜欢强鼓点', status: 'confirmed', confidence: 0.9, tags: ['dislike', 'dimension:rhythm'] },
  ])

  assert.equal(profile.stance, 'mixed')
  assert.equal(profile.confidence, 0)
  assert.deepEqual(profile.evidenceIds, ['f1', 'f2'])
})

test('ignores superseded facts when consolidating taste', () => {
  const profile = consolidateTasteProfile([
    { id: 'old', content: '旧结论', status: 'superseded', confidence: 1, tags: ['preference', 'dimension:mood'] },
    { id: 'new', content: '现在更喜欢轻松的歌', status: 'confirmed', confidence: 1, tags: ['preference', 'dimension:mood'] },
  ])
  assert.deepEqual(profile[0].evidenceIds, ['new'])
})

test('keeps compatible positive and negative preferences for different attributes', () => {
  const profile = consolidateTasteProfile([
    { id: 'f1', content: '喜欢含蓄表达', status: 'confirmed', confidence: 1, tags: ['preference', 'dimension:lyrical_expression', 'attribute:subtle_expression'] },
    { id: 'f2', content: '不喜欢过度直白', status: 'confirmed', confidence: 1, tags: ['dislike', 'dimension:lyrical_expression', 'attribute:overly_direct_expression'] },
  ])
  assert.equal(profile.length, 2)
  assert.deepEqual(profile.map(({ attribute, stance }) => [attribute, stance]).sort(), [
    ['overly_direct_expression', 'dislikes'],
    ['subtle_expression', 'likes'],
  ])
})
