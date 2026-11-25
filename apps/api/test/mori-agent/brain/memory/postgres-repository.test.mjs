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

test('deduplicates an identical Music Fact and appends its evidence', async () => {
  const queries = []
  const client = {
    async query(sql, values) {
      queries.push({ sql, values })
      if (/SELECT id,status,confidence FROM agent_memories/su.test(sql)) return { rows: [{ id: 'fact-1', status: 'candidate', confidence: 0.6 }] }
      return { rows: [], rowCount: 1 }
    },
    release() {},
  }
  const pool = { query: async () => ({ rows: [] }), connect: async () => client }
  const repository = await createPostgresMemoryRepository({ pool })
  const result = await repository.upsertMusicFact({
    userId: 'u1', category: 'preference', dimension: 'vocal', attribute: 'clear_female_vocal', content: '用户喜欢清澈女声',
    sourceMessageId: 'message-2', evidence: '这种女声我很喜欢', confidence: 0.9,
    confirmed: true, createdAt: '2026-11-24T10:00:00.000Z',
  })

  assert.equal(result.id, 'fact-1')
  assert.equal(result.deduplicated, true)
  assert.equal(result.status, 'confirmed')
  assert.equal(queries.find(({ sql }) => /SELECT id,status,confidence FROM agent_memories/su.test(sql)).values[3], 'fact_key:preference:vocal:clear_female_vocal')
  assert.equal(queries.filter(({ sql }) => /INSERT INTO memory_evidence/su.test(sql)).length, 1)
  assert.equal(queries.some(({ sql }) => /INSERT INTO agent_memories/su.test(sql)), false)
})

test('supersedes the old Music Fact before persisting a correction', async () => {
  const queries = []
  const client = {
    async query(sql, values) {
      queries.push({ sql, values })
      if (/UPDATE agent_memories SET status='superseded'/su.test(sql)) return { rows: [{ id: 'old-fact' }], rowCount: 1 }
      if (/INSERT INTO memory_nodes/su.test(sql)) return { rows: [{ id: `node-${queries.length}` }], rowCount: 1 }
      return { rows: [], rowCount: 1 }
    },
    release() {},
  }
  const pool = { query: async () => ({ rows: [] }), connect: async () => client }
  const repository = await createPostgresMemoryRepository({ pool })
  const result = await repository.upsertMusicFact({
    userId: 'u1', category: 'dislike', content: '用户不喜欢高强度鼓点', supersedesId: 'old-fact',
    sourceMessageId: 'message-3', evidence: '不是喜欢，我其实不喜欢这种鼓点', confidence: 1,
    confirmed: true, createdAt: '2026-11-24T10:10:00.000Z',
  })

  assert.equal(result.supersedesId, 'old-fact')
  assert.equal(result.deduplicated, false)
  assert.equal(queries.some(({ sql }) => /INSERT INTO agent_memories/su.test(sql)), true)
  assert.equal(queries.some(({ sql }) => /INSERT INTO memory_evidence/su.test(sql)), true)
})

test('retrieves graph associations from a confirmed track seed', async () => {
  const pool = {
    async query(sql, values) {
      if (/WITH seed AS/su.test(sql)) return { rows: [{
        relation: 'ABOUT_TRACK', weight: 1, properties: {},
        source_type: 'MOMENT', source_key: 'moment-1', source_label: '第一次一起听',
        target_type: 'CATALOG_TRACK', target_key: 'spotify:track:1', target_label: 'Song',
      }] }
      return { rows: [] }
    },
  }
  const repository = await createPostgresMemoryRepository({ pool })
  const associations = await repository.retrieveAssociations({ userId: 'u1', trackUri: 'spotify:track:1' })
  assert.equal(associations[0].relation, 'ABOUT_TRACK')
  assert.equal(associations[0].source.type, 'MOMENT')
  assert.equal(associations[0].target.key, 'spotify:track:1')
})

test('rejects a Music Moment without traceable source messages', async () => {
  const pool = { query: async () => ({ rows: [] }) }
  const repository = await createPostgresMemoryRepository({ pool })
  await assert.rejects(repository.createMusicMoment({
    userId: 'u1', summary: '深夜一起听歌', sourceMessageIds: [], occurredAt: '2026-11-24T10:00:00.000Z',
  }), /sourceMessageIds/)
})

test('supersedes a stale Taste Profile after its last supporting Fact is removed', async () => {
  const queries = []
  const client = {
    async query(sql, values) {
      queries.push({ sql, values })
      if (/source='derived_profile' AND status='confirmed'/su.test(sql)) return { rows: [{ id: 'profile-old', content: 'likes:旧偏好', confidence: 0.8, tags: ['taste_profile', 'dimension:vocal'] }] }
      return { rows: [], rowCount: 1 }
    },
    release() {},
  }
  const pool = {
    async query(sql) {
      if (/source='user_statement'/su.test(sql)) return { rows: [] }
      return { rows: [] }
    },
    connect: async () => client,
  }
  const repository = await createPostgresMemoryRepository({ pool })
  const profile = await repository.refreshTasteProfile({ userId: 'u1', updatedAt: '2026-11-25T00:00:00.000Z' })

  assert.deepEqual(profile, [])
  const staleUpdate = queries.find(({ sql }) => /SET status='superseded'/su.test(sql))
  assert.equal(staleUpdate.values[1], 'profile-old')
})
