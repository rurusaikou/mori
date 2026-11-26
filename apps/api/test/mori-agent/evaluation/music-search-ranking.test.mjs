import assert from 'node:assert/strict'
import test from 'node:test'
import { exactSearchMatches, rankTextMatches } from '../../../../extension/src/background/music-search-ranking.mjs'

const tracks = [
  { uri: 'spotify:track:wrong', title: '最初的記憶', artist: '徐佳莹' },
  { uri: 'spotify:track:target', title: '身骑白马', artist: '徐佳瑩' },
  { uri: 'spotify:track:live', title: '身骑白马 - Live', artist: '徐佳莹' },
]

test('P0 exact search rejects an artist-only match with the wrong title', () => {
  const matches = exactSearchMatches(tracks, '身骑白马 徐佳莹')
  assert.deepEqual(matches.map((track) => track.uri), ['spotify:track:target', 'spotify:track:live'])
})

test('recommendation ranking may still use an artist-only constraint', () => {
  const matches = rankTextMatches(tracks, '徐佳莹')
  assert.equal(matches.length, 3)
})
