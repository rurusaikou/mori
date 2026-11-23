/** Recommendation Tool 只生成可审计的客户端请求，不持有曲库或执行播放。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createRecommendMusicTool } from '../../../src/mori-agent/action/tools/recommend-music.mjs'

test('delegates open recommendation without inventing candidates', async () => {
  const result = await createRecommendMusicTool().execute({ query: '', excludeUris: [] })
  assert.deepEqual(result, { status: 'PENDING', operation: 'recommend_music', query: '', excludeUris: [], tracks: [] })
})

test('preserves explicit preference and exclusions for Extension execution', async () => {
  const result = await createRecommendMusicTool().execute({ query: '有能量', excludeUris: ['spotify:track:current'] })
  assert.deepEqual(result, { status: 'PENDING', operation: 'recommend_music', query: '有能量', excludeUris: ['spotify:track:current'], tracks: [] })
})
