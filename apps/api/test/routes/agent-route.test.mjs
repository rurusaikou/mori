/** 验证客户端动作使用同一 exchangeId 将 planned 归档收敛为用户实际看到的最终回复。 */
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'
import { createAgentRoutes } from '../../src/routes/agent.mjs'

test('archives a client action as pending and replaces it with the confirmed final response', async () => {
  const writes = []
  const repository = { available: true, appendConversationMessage: async (value) => { writes.push(value); return value } }
  const productAgent = { execute: async () => ({
    success: true,
    finalResponse: '正在切换。',
    action: { type: 'playback_control', command: 'NEXT' },
    meta: { runId: 'run-1', version: 'mori-agent-v1.0' },
  }) }
  const route = createAgentRoutes({ productAgent, playgroundAgent: productAgent, memoryRepository: repository, memoryUserId: 'user-1' })
  const initial = await call(route, '/agent/run', { userMessage: '切歌', currentTrack: { uri: 'spotify:track:a', title: 'A', artist: '歌手 A' }, timeZone: 'Asia/Tokyo' })

  assert.equal(initial.status, 200)
  assert.match(initial.body.exchangeId, /^[0-9a-f-]{36}$/u)
  assert.equal(writes.find((item) => item.role === 'assistant').status, 'pending')
  assert.equal(writes.find((item) => item.role === 'assistant').content, '正在切换。')

  const confirmed = await call(route, '/agent/action-result', {
    exchangeId: initial.body.exchangeId,
    finalResponse: '切到下一首。',
    status: 'COMPLETED',
    currentTrack: { uri: 'spotify:track:b', title: 'B', artist: '歌手 B' },
    timeZone: 'Asia/Tokyo',
  })
  assert.equal(confirmed.status, 200)
  const final = writes.at(-1)
  assert.equal(final.exchangeId, initial.body.exchangeId)
  assert.equal(final.role, 'assistant')
  assert.equal(final.status, 'completed')
  assert.equal(final.content, '切到下一首。')
  assert.equal(final.track.uri, 'spotify:track:b')
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
