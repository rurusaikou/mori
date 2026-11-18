import assert from 'node:assert/strict'
import test from 'node:test'
import { createSongUnderstandingAgent } from '../../../../src/mori-agent/perception/song-understanding/song-understanding-agent.mjs'
import { createTrackInsightRepository } from '../../../../src/mori-agent/perception/song-understanding/insight-repository.mjs'
import { createSongEvidenceProviders } from '../../../../src/mori-agent/perception/song-understanding/providers.mjs'
import { validateSongInsight } from '../../../../src/mori-agent/perception/song-understanding/song-understanding.types.mjs'

const layer = (extra = {}) => ({ available: false, summary: '', confidence: 0, sources: [], ...extra })
const completeInsight = {
  sound: { available: true, summary: '声音有推进感但律动克制。', confidence: 0.9, sources: [{ provider: 'melodata', label: 'Audio Features', url: '' }], observations: ['123 BPM', '能量偏高'] },
  lyrics: layer({ themes: [], perspective: '', imagery: [], emotionalArc: '' }),
  creation: layer({ lyricists: [], composers: [], relationships: [], background: '' }),
  reception: layer({ listenerTags: [], commonInterpretations: [], disagreements: [], culturalContext: '' }),
  integratedInsight: '目前只能确认它在声音上有推进感，歌词、创作和听众理解仍缺少可靠资料。',
  missingLayers: ['lyrics', 'creation', 'reception'],
}

test('builds a four-layer insight and caches it by ISRC', async () => {
  let calls = 0
  const repository = createTrackInsightRepository()
  const agent = createSongUnderstandingAgent({
    llm: async ({ input }) => { calls += 1; assert.equal(input.soundEvidence.bpm, 123); return { data: completeInsight, model: 'test-model' } },
    resolveFeatures: () => ({ bpm: 123, energy: 0.72, danceability: 0.39 }),
    repository,
  })
  const track = { uri: 'spotify:track:1', isrc: 'tw-test-1', title: '测试歌', artist: '测试歌手' }
  const first = await agent.analyze(track)
  const second = await agent.analyze(track)
  assert.equal(first.sound.available, true)
  assert.deepEqual(second, first)
  assert.equal(calls, 1)
})

test('never invents missing semantic layers when the LLM fails', async () => {
  const agent = createSongUnderstandingAgent({
    llm: async () => { throw new Error('offline') },
    resolveFeatures: () => ({ bpm: 80, energy: 0.2, danceability: 0.3 }),
  })
  const result = await agent.analyze({ title: '测试歌', artist: '测试歌手', isrc: 'TEST' })
  assert.equal(result.sound.available, true)
  assert.equal(result.lyrics.available, false)
  assert.deepEqual(result.missingLayers, ['lyrics', 'creation', 'reception'])
  assert.match(result.integratedInsight, /只能从声音层判断/)
})

test('keeps external providers disabled until explicitly configured', () => {
  assert.deepEqual(createSongEvidenceProviders({ env: {}, fetchImpl: async () => { throw new Error('must not call') } }), { lyrics: null, credits: null, reception: null })
})

test('lyrics provider sends track identity and keeps only the provider result', async () => {
  let request
  const providers = createSongEvidenceProviders({
    env: { MORI_LYRICS_INSIGHT_ENDPOINT: 'http://127.0.0.1:3220/track-insight', MORI_LYRICS_INSIGHT_API_KEY: 'secret' },
    fetchImpl: async (url, options) => { request = { url, options }; return { ok: true, json: async () => ({ themes: ['克制表达'], sourceLabel: 'Licensed provider', sourceUrl: 'https://example.test/source' }) } },
  })
  const result = await providers.lyrics.get({ isrc: 'TEST', title: '测试歌', artist: '测试歌手' })
  assert.deepEqual(JSON.parse(request.options.body), { isrc: 'TEST', title: '测试歌', artist: '测试歌手' })
  assert.equal(result.source.provider, 'lyrics_insight')
  assert.equal(result.themes[0], '克制表达')
})

test('rejects contradictory availability and missingLayers', () => {
  assert.throws(() => validateSongInsight({ ...completeInsight, missingLayers: ['sound', 'lyrics', 'creation', 'reception'] }), /矛盾/)
})
