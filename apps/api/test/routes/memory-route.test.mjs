import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'
import { createMemoryRoutes } from '../../src/routes/memory.mjs'

test('writes Music Fact with server-side identity and exposes dedupe result', async () => {
  let received = null
  const repository = {
    available: true,
    upsertMusicFact: async (input) => { received = input; return { id: 'fact-1', status: 'confirmed', deduplicated: true } },
    refreshTasteProfile: async () => [],
  }
  const route = createMemoryRoutes({ repository, userId: 'trusted-user' })
  const result = await call(route, '/memory/music-facts', {
    userId: 'forged-user', category: 'preference', content: '喜欢钢琴', sourceMessageId: 'm1',
    evidence: '我喜欢钢琴', createdAt: '2026-11-24T10:00:00.000Z',
  })

  assert.equal(result.status, 200)
  assert.equal(received.userId, 'trusted-user')
  assert.equal(result.body.deduplicated, true)
})

test('writes a traceable Music Moment through the minimal-memory route', async () => {
  let received = null
  const repository = {
    available: true,
    createMusicMoment: async (input) => { received = input; return { id: 'moment-1', status: 'candidate' } },
  }
  const route = createMemoryRoutes({ repository, userId: 'trusted-user' })
  const result = await call(route, '/memory/music-moments', {
    summary: '第一次一起听这首歌', sourceMessageIds: ['m1', 'm2'], occurredAt: '2026-11-24T10:00:00.000Z',
  })

  assert.equal(result.status, 201)
  assert.deepEqual(received.sourceMessageIds, ['m1', 'm2'])
  assert.equal(result.body.id, 'moment-1')
})

test('confirms a candidate and refreshes the derived taste profile', async () => {
  const calls = []
  const repository = {
    available: true,
    confirmMemory: async (input) => { calls.push(['confirm', input]); return { id: input.id, kind: 'preference', source: 'user_statement' } },
    refreshTasteProfile: async (input) => { calls.push(['profile', input]); return [] },
  }
  const route = createMemoryRoutes({ repository, userId: 'trusted-user' })
  const result = await call(route, '/memory/memories/123e4567-e89b-42d3-a456-426614174000/confirm', {})

  assert.equal(result.status, 200)
  assert.equal(calls[0][1].userId, 'trusted-user')
  assert.equal(calls[1][0], 'profile')
  assert.equal(result.body.confirmed, true)
})

async function call(route, url, body) {
  const request = Readable.from([Buffer.from(JSON.stringify(body))])
  request.method = 'POST'; request.url = url; request.headers = {}
  const result = { status: null, body: null }
  const response = {
    writeHead(status) { result.status = status; return this },
    end(value) { result.body = value ? JSON.parse(value) : null; return this },
  }
  assert.equal(await route(request, response), true)
  return result
}
