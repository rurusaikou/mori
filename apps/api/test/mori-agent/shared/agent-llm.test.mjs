import assert from 'node:assert/strict'
import test from 'node:test'
import { createAgentLlm } from '../../../src/mori-agent/shared/agent-llm.mjs'

const tool = {
  name: 'search_memory',
  description: '搜索相关记忆',
  parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
}

test('Chat Completions transport keeps message roles and parses a native function call', async () => {
  let requestBody
  const llm = createAgentLlm({
    env: { MORI_LLM_ENDPOINT: 'http://llm.test/v1/chat/completions', MORI_LLM_MODEL: 'test-model', MORI_LLM_API_STYLE: 'chat_completions' },
    fetchImpl: async (_url, request) => {
      requestBody = JSON.parse(request.body)
      return jsonResponse({ model: 'test-model', choices: [{ message: { content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'search_memory', arguments: '{"query":"日语课"}' } }] } }], usage: { total_tokens: 12 } })
    },
  })
  const result = await llm({
    messages: [{ role: 'system', content: 'Persona' }, { role: 'user', content: '最近的课怎么样' }, { role: 'assistant', content: '聊得很开心。' }, { role: 'user', content: '老师呢？' }],
    tools: [tool],
  })

  assert.deepEqual(requestBody.messages.map((message) => message.role), ['system', 'user', 'assistant', 'user'])
  assert.equal(requestBody.messages[1].content, '最近的课怎么样')
  assert.equal(requestBody.tools[0].function.name, 'search_memory')
  assert.deepEqual(result.toolCalls, [{ id: 'call-1', name: 'search_memory', arguments: { query: '日语课' } }])
  assert.equal(result.tokenUsage.total_tokens, 12)
})

test('Responses transport round-trips function call and tool observation items', async () => {
  let requestBody
  const llm = createAgentLlm({
    env: { MORI_LLM_ENDPOINT: 'http://llm.test/v1/responses', MORI_LLM_MODEL: 'test-model', MORI_LLM_API_STYLE: 'responses' },
    fetchImpl: async (_url, request) => {
      requestBody = JSON.parse(request.body)
      return jsonResponse({
        status: 'completed', model: 'test-model',
        output: [
          { type: 'message', content: [{ type: 'output_text', text: '我记得你刚上完日语课。' }] },
          { type: 'function_call', call_id: 'call-2', name: 'search_memory', arguments: '{"query":"老师"}' },
        ],
        usage: { total_tokens: 18 },
      })
    },
  })
  const result = await llm({
    messages: [
      { role: 'system', content: 'Persona' },
      { role: 'user', content: '刚上完日语课' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'call-1', name: 'search_memory', arguments: { query: '日语课' } }] },
      { role: 'tool', toolCallId: 'call-1', content: '{"ok":true}' },
    ],
    tools: [tool],
  })

  assert.deepEqual(requestBody.input.map((item) => item.type ?? item.role), ['system', 'user', 'function_call', 'function_call_output'])
  assert.equal(requestBody.input[2].call_id, 'call-1')
  assert.equal(requestBody.input[3].output, '{"ok":true}')
  assert.equal(requestBody.tools[0].name, 'search_memory')
  assert.deepEqual(result.toolCalls, [{ id: 'call-2', name: 'search_memory', arguments: { query: '老师' } }])
  assert.equal(result.content, '我记得你刚上完日语课。')
})

test('Chat Completions stream emits text deltas and assembles fragmented tool arguments', async () => {
  let requestBody
  const chunks = [
    { choices: [{ delta: { content: '你好，' } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'stream-call', type: 'function', function: { name: 'search_memory', arguments: '{"query":' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"日语课"}' } }] } }] },
    { choices: [], usage: { total_tokens: 14 } },
  ]
  const llm = createAgentLlm({
    env: { MORI_LLM_ENDPOINT: 'http://llm.test/v1/chat/completions', MORI_LLM_MODEL: 'test-model', MORI_LLM_API_STYLE: 'chat_completions' },
    fetchImpl: async (_url, request) => {
      requestBody = JSON.parse(request.body)
      return sseResponse(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n')
    },
  })
  const events = []
  const result = await llm.stream({ messages: [{ role: 'user', content: '记得日语课吗？' }], tools: [tool] }, (event) => events.push(event))

  assert.equal(requestBody.stream, true)
  assert.equal(result.content, '你好，')
  assert.deepEqual(result.toolCalls, [{ id: 'stream-call', name: 'search_memory', arguments: { query: '日语课' } }])
  assert.deepEqual(events, [{ type: 'text_delta', delta: '你好，' }])
})

test('Responses stream emits text deltas and parses completed function call output', async () => {
  let requestBody
  const events = [
    { type: 'response.output_text.delta', delta: '我来查一下。' },
    { type: 'response.output_item.added', output_index: 1, item: { id: 'item-1', type: 'function_call', call_id: 'response-call', name: 'search_memory', arguments: '' } },
    { type: 'response.function_call_arguments.delta', output_index: 1, delta: '{"query":"日语课"}' },
    { type: 'response.completed', response: {
      status: 'completed', model: 'test-model', output_text: '我来查一下。',
      output: [{ type: 'function_call', call_id: 'response-call', name: 'search_memory', arguments: '{"query":"日语课"}' }],
      usage: { total_tokens: 16 },
    } },
  ]
  const llm = createAgentLlm({
    env: { MORI_LLM_ENDPOINT: 'http://llm.test/v1/responses', MORI_LLM_MODEL: 'test-model', MORI_LLM_API_STYLE: 'responses' },
    fetchImpl: async (_url, request) => {
      requestBody = JSON.parse(request.body)
      return sseResponse(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''))
    },
  })
  const deltas = []
  const result = await llm.stream({ messages: [{ role: 'user', content: '你记得日语课吗？' }], tools: [tool] }, (event) => deltas.push(event.delta))

  assert.equal(requestBody.stream, true)
  assert.deepEqual(deltas, ['我来查一下。'])
  assert.deepEqual(result.toolCalls, [{ id: 'response-call', name: 'search_memory', arguments: { query: '日语课' } }])
  assert.equal(result.tokenUsage.total_tokens, 16)
})

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
}

function sseResponse(value) {
  return new Response(value, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}