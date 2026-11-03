import assert from 'node:assert/strict'
import test from 'node:test'
import { createMusicProfileService } from './music-profile.mjs'

const MELODATA_BASE_URL = 'https://melodata.example/api/v1'

function createStore() {
  const values = new Map()
  let persistCount = 0
  return {
    get: (key) => values.get(key),
    has: (key) => values.has(key),
    set: (key, value) => values.set(key, value),
    get size() { return values.size },
    get persistCount() { return persistCount },
    async persist() { persistCount += 1 },
  }
}

function featureResponse(isrc) {
  return new Response(JSON.stringify({ data: { features: { bpm: 120, energy: 0.6, danceability: 0.7, valence: 0.5, acousticness: 0.2, instrumentalness: 0.1 }, isrc } }), { status: 200 })
}

test('retries a transient network failure and completes the profile', async () => {
  let requests = 0
  const analyze = createMusicProfileService({
    featureStore: createStore(),
    logInfo() {},
    melodataBaseUrl: MELODATA_BASE_URL,
    waitImpl: async () => {},
    rateLimit: false,
    fetchImpl: async () => {
      requests += 1
      if (requests === 1) throw new TypeError('fetch failed')
      return featureResponse('TEST00000001')
    },
  })

  const profile = await analyze([{ isrc: 'TEST00000001', title: 'One', artist: 'Artist' }], 'key')
  assert.equal(requests, 2)
  assert.equal(profile.trackCount, 1)
})

test('skips one exhausted track without discarding successful tracks', async () => {
  const analyze = createMusicProfileService({
    featureStore: createStore(),
    logInfo() {},
    melodataBaseUrl: MELODATA_BASE_URL,
    waitImpl: async () => {},
    rateLimit: false,
    fetchImpl: async (url) => {
      if (url.includes('FAIL00000001')) throw new TypeError('fetch failed')
      return featureResponse('GOOD00000001')
    },
  })

  const profile = await analyze([
    { isrc: 'FAIL00000001', title: 'Bad', artist: 'Artist' },
    { isrc: 'GOOD00000001', title: 'Good', artist: 'Artist' },
  ], 'key')
  assert.equal(profile.trackCount, 1)
  assert.equal(profile.requestedCount, 2)
})

test('processes five tracks per batch and persists each completed batch', async () => {
  const store = createStore()
  const analyze = createMusicProfileService({
    featureStore: store,
    logInfo() {},
    melodataBaseUrl: MELODATA_BASE_URL,
    waitImpl: async () => {},
    rateLimit: false,
    fetchImpl: async (url) => featureResponse(url),
  })
  const tracks = Array.from({ length: 11 }, (_, index) => ({
    isrc: `TEST000000${String(index).padStart(2, '0')}`,
    title: `Track ${index}`,
    artist: 'Artist',
  }))

  const profile = await analyze(tracks, 'key')
  assert.equal(profile.trackCount, 11)
  assert.equal(store.persistCount, 3)
})

test('uses the injected MeloData base URL without a duplicate slash', async () => {
  let requestedUrl = ''
  const analyze = createMusicProfileService({
    featureStore: createStore(),
    logInfo() {},
    melodataBaseUrl: 'https://melodata.example/custom/v1/',
    rateLimit: false,
    fetchImpl: async (url) => {
      requestedUrl = String(url)
      return featureResponse('TEST00000001')
    },
  })

  await analyze([{ isrc: 'TEST00000001', title: 'One', artist: 'Artist' }], 'key')
  assert.equal(requestedUrl, 'https://melodata.example/custom/v1/tracks/TEST00000001/features')
})

test('requires an injected MeloData base URL', () => {
  assert.throws(
    () => createMusicProfileService({ featureStore: createStore(), logInfo() {} }),
    /MELODATA_BASE_URL/,
  )
})
