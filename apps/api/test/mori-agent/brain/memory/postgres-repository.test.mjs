import assert from 'node:assert/strict'
import test from 'node:test'
import { createPostgresMemoryRepository } from '../../../../src/mori-agent/brain/memory/postgres-repository.mjs'

test('uses an explicit unavailable repository when database is not configured', async () => {
  const repository = await createPostgresMemoryRepository()
  assert.equal(repository.available, false)
  assert.match(repository.reason, /未配置/)
  assert.deepEqual(await repository.search({ userId: 'u1', query: 'music' }), [])
})

test('refreshes the frequent-track graph only after a completed listening event', async () => {
  const queries = []
  const pool = {
    async query(sql) {
      queries.push(sql)
      if (/SELECT count\(\*\).*listening_events/su.test(sql)) return { rows: [{ plays: 0 }] }
      return { rows: [] }
    },
  }
  const repository = await createPostgresMemoryRepository({ pool })
  const base = {
    userId: 'u1',
    track: { uri: 'spotify:track:1', title: 'Song', artist: 'Artist' },
    positionMs: 180_000,
    durationMs: 180_000,
    source: 'user_selected',
    timeZone: 'Asia/Tokyo',
    occurredAt: '2026-11-18T12:00:00.000Z',
  }

  await repository.appendListeningEvent({ ...base, eventId: 'paused-1', type: 'paused' })
  assert.equal(queries.filter((sql) => /SELECT count\(\*\).*listening_events/su.test(sql)).length, 0)

  await repository.appendListeningEvent({ ...base, eventId: 'completed-1', type: 'completed' })
  assert.equal(queries.filter((sql) => /SELECT count\(\*\).*listening_events/su.test(sql)).length, 1)
})
