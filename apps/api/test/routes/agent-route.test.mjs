/** 验证客户端动作使用同一 exchangeId 将 planned 归档收敛为用户实际看到的最终回复。 */
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'
import { createAgentRoutes } from '../../src/routes/agent.mjs'
import { recentCapabilityLogs } from '../../src/mori-agent/shared/logger.mjs'

test('archives a client action as pending and replaces it with the confirmed final response', async () => {
  const writes = []
  const processed = []
  const repository = { available: true, appendConversationMessage: async (value) => { writes.push(value); return value } }
  const productAgent = { execute: async () => ({
    success: true,
    finalResponse: '正在切换。',
    action: { type: 'playback_control', command: 'NEXT' },
    meta: { runId: 'run-1', version: 'mori-agent-v1.1', model: 'decision-model' },
  }) }
  const route = createAgentRoutes({ productAgent, playgroundAgent: productAgent, memoryRepository: repository, memoryUserId: 'user-1', postTurnMemoryProcessor: { process: async (value) => { processed.push(value) } } })
  const initial = await call(route, '/agent/run', { userMessage: '切歌', currentTrack: { uri: 'spotify:track:a', title: 'A', artist: '歌手 A' }, timeZone: 'Asia/Tokyo' })

  assert.equal(initial.status, 200)
  assert.match(initial.body.exchangeId, /^[0-9a-f-]{36}$/u)
  assert.match(initial.body.actionResultToken, /^[0-9a-f-]{36}$/u)
  assert.equal(writes.find((item) => item.role === 'assistant').status, 'pending')
  assert.equal(writes.find((item) => item.role === 'assistant').content, '正在切换。')

  const rejected = await call(route, '/agent/action-result', {
    exchangeId: initial.body.exchangeId,
    runId: 'run-1',
    actionResultToken: '00000000-0000-4000-8000-000000000000',
    finalResponse: '伪造结果', status: 'COMPLETED', currentTrack: null, timeZone: 'Asia/Tokyo',
  })
  assert.equal(rejected.status, 400)

  const confirmed = await call(route, '/agent/action-result', {
    exchangeId: initial.body.exchangeId,
    runId: 'run-1',
    actionResultToken: initial.body.actionResultToken,
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
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(processed.length, 1)
  assert.equal(processed[0].assistantMessage.content, '切到下一首。')
  assert.equal(processed[0].input.currentTrack.uri, 'spotify:track:b')
  const actionResultLog = recentCapabilityLogs().findLast((entry) => entry.runId === 'run-1' && entry.stage === 'agent_action_result_received')
  assert.equal(actionResultLog.promptVersion, 'mori-agent-v1.1')
  assert.equal(actionResultLog.model, 'decision-model')
  assert.equal(actionResultLog.exchangeId, initial.body.exchangeId)
})

test('starts post-turn memory only after a direct final response is archived', async () => {
  const writes = []; const processed = []
  const repository = { available: true, appendConversationMessage: async (value) => { writes.push(value); return value } }
  const productAgent = { execute: async () => ({ success: true, finalResponse: '我记住你说的重点了。', meta: { runId: 'run-direct' } }) }
  const route = createAgentRoutes({
    productAgent, playgroundAgent: productAgent, memoryRepository: repository, memoryUserId: 'user-1',
    postTurnMemoryProcessor: { process: async (value) => { processed.push(value) } },
  })
  const result = await call(route, '/agent/run', { userMessage: '我一直喜欢克制的编曲', currentTrack: null, timeZone: 'Asia/Tokyo' })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(result.status, 200)
  assert.equal(processed.length, 1)
  assert.equal(processed[0].userMessage.status, 'completed')
  assert.equal(processed[0].assistantMessage.status, 'completed')
  assert.equal(writes.at(-1).content, '我记住你说的重点了。')
})

test('streams Agent progress and then sends the ordinary final result event', async () => {
  const productAgent = {
    execute: async (_input, correlation) => {
      correlation.onStreamEvent({ type: 'delta', text: '你好，' })
      return { success: true, finalResponse: '你好，我在。', meta: { runId: 'stream-run', version: 'mori-agent-v1.1' } }
    },
  }
  const route = createAgentRoutes({ productAgent, playgroundAgent: productAgent }, { NODE_ENV: 'test' })
  const request = Readable.from([Buffer.from(JSON.stringify({ userMessage: '你好' }))])
  request.method = 'POST'; request.url = '/agent/stream'; request.headers = { 'x-mori-request-id': 'stream-request' }
  const chunks = []
  const response = {
    status: null, headers: null, headersSent: false, destroyed: false, writableEnded: false,
    writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true; return this },
    flushHeaders() {},
    write(value) { chunks.push(value); return true },
    end(value) { if (value) chunks.push(value); this.writableEnded = true; return this },
    on() {},
  }

  assert.equal(await route(request, response), true)
  assert.equal(response.status, 200)
  assert.match(response.headers['Content-Type'], /text\/event-stream/u)
  const payload = chunks.join('')
  assert.match(payload, /"type":"started"/u)
  assert.match(payload, /"type":"progress"/u)
  assert.match(payload, /"text":"你好，"/u)
  assert.match(payload, /"type":"result"/u)
  assert.match(payload, /"finalResponse":"你好，我在。"/u)
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
