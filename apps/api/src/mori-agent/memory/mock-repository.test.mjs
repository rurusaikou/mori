/** Mock Repository 测试：确保搜索只返回相关项且不修改输入数据。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockMemoryRepository } from './mock-repository.mjs'

test('returns related mock memories in score order', () => {
  const source = [{ id: 'a', content: '旅行时听过这首歌', context: '毕业旅行' }, { id: 'b', content: '不喜欢吵闹音乐' }]
  const result = createMockMemoryRepository(source).search('旅行')
  assert.equal(result[0].id, 'a'); assert.equal(source[0].score, undefined)
})

test('returns empty result when no memory is related', () => {
  assert.deepEqual(createMockMemoryRepository([{ id: 'a', content: '喜欢爵士' }]).search('旅行'), [])
})
