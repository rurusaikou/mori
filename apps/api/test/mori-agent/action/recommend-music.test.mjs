/** Recommendation Tool 回归：无条件推荐必须打破候选原始顺序，有条件推荐仍按特征排序。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createRecommendMusicTool } from '../../../src/mori-agent/action/tools/recommend-music.mjs'

const catalog = [
  { uri: 'spotify:track:first', isrc: 'FIRST', title: '第一首', artist: 'A' },
  { uri: 'spotify:track:second', isrc: 'SECOND', title: '第二首', artist: 'B' },
  { uri: 'spotify:track:third', isrc: 'THIRD', title: '第三首', artist: 'C' },
]

test('open recommendation rotates from an injected random position', async () => {
  const tool = createRecommendMusicTool(catalog, null, () => 0.7)
  const result = await tool.execute({ query: '', excludeUris: [] })
  assert.deepEqual(result.results.map((track) => track.uri), [
    'spotify:track:third',
    'spotify:track:first',
    'spotify:track:second',
  ])
})

test('preference recommendation keeps deterministic feature ranking', async () => {
  const features = new Map([
    ['FIRST', { energy: 0.2 }],
    ['SECOND', { energy: 0.9 }],
    ['THIRD', { energy: 0.5 }],
  ])
  const tool = createRecommendMusicTool(catalog, (uri) => features.get(uri), () => 0.7)
  const result = await tool.execute({ query: '有能量', excludeUris: [] })
  assert.equal(result.results[0].uri, 'spotify:track:second')
})
