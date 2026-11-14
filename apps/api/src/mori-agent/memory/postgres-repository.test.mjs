import assert from 'node:assert/strict'
import test from 'node:test'
import { createPostgresMemoryRepository } from './postgres-repository.mjs'

test('uses an explicit unavailable repository when database is not configured', async () => {
  const repository = await createPostgresMemoryRepository()
  assert.equal(repository.available, false)
  assert.match(repository.reason, /未配置/)
  assert.deepEqual(await repository.search({ userId: 'u1', query: 'music' }), [])
})
