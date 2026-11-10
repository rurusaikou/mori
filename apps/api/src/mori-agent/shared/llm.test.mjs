import assert from 'node:assert/strict'
import test from 'node:test'
import { createCapabilityLlm } from './llm.mjs'

const schema = {
  type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false,
}

test('keeps the existing Responses API request shape by default', async () => {
  let url; let body
  const llm = createCapabilityLlm({
    env: { MORI_LLM_ENDPOINT: 'https://llm.example/v1/responses', MORI_LLM_API_KEY: 'secret', MORI_LLM_MODEL: 'model' },
    fetchImpl: async (requestUrl, init) => {
      url = requestUrl; body = JSON.parse(init.body)
      return new Response(JSON.stringify({ status: 'completed', output_text: '{"answer":"ok"}', model: 'model' }), { status: 200 })
    },
  })
  const result = await llm({ prompt: 'prompt', input: { value: 1 }, schema, schemaName: 'test_schema' })
  assert.equal(url, 'https://llm.example/v1/responses')
  assert.equal(body.text.format.type, 'json_schema')
  assert.equal(body.max_output_tokens, 1200)
  assert.equal(result.data.answer, 'ok')
})

test('supports a local Chat Completions base URL without an API key', async () => {
  let url; let headers; let body
  const llm = createCapabilityLlm({
    env: { MORI_LLM_ENDPOINT: '127.0.0.1:11434', MORI_LLM_MODEL: 'qwen3.5:4b', MORI_LLM_API_STYLE: 'chat_completions', MORI_LLM_REASONING_EFFORT: 'none' },
    fetchImpl: async (requestUrl, init) => {
      url = requestUrl; headers = init.headers; body = JSON.parse(init.body)
      return new Response(JSON.stringify({ model: 'qwen3.5:4b', choices: [{ message: { content: '```json\n{"answer":"本地模型"}\n```' } }], usage: { total_tokens: 12 } }), { status: 200 })
    },
  })
  const result = await llm({ prompt: 'prompt', input: { value: 1 }, schema, schemaName: 'test_schema' })
  assert.equal(url, 'http://127.0.0.1:11434/v1/chat/completions')
  assert.equal(headers.Authorization, undefined)
  assert.equal(body.response_format.type, 'json_schema')
  assert.equal(body.response_format.json_schema.strict, true)
  assert.equal(body.max_tokens, 1200)
  assert.equal(body.reasoning_effort, 'none')
  assert.equal(result.data.answer, '本地模型')
})

test('reports an actionable error when reasoning consumes the entire output budget', async () => {
  const llm = createCapabilityLlm({
    env: { MORI_LLM_ENDPOINT: '127.0.0.1:11434', MORI_LLM_MODEL: 'local', MORI_LLM_API_STYLE: 'chat_completions' },
    fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: '', reasoning: 'thinking' }, finish_reason: 'length' }] }), { status: 200 }),
  })
  await assert.rejects(() => llm({ prompt: 'prompt', input: {}, schema, schemaName: 'test_schema' }), /输出额度不足/)
})

test('can fall back to JSON object mode for local servers without json_schema support', async () => {
  let body
  const llm = createCapabilityLlm({
    env: { MORI_LLM_ENDPOINT: 'http://127.0.0.1:11434', MORI_LLM_MODEL: 'local', MORI_LLM_API_STYLE: 'chat_completions', MORI_LLM_JSON_MODE: 'json_object' },
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body)
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"answer":"ok"}' } }] }), { status: 200 })
    },
  })
  await llm({ prompt: 'prompt', input: {}, schema, schemaName: 'test_schema' })
  assert.deepEqual(body.response_format, { type: 'json_object' })
  assert.match(body.messages[0].content, /JSON Schema/)
})

test('accepts a longer timeout for local thinking models', async () => {
  let timeoutSignal
  const llm = createCapabilityLlm({
    env: { MORI_LLM_ENDPOINT: '127.0.0.1:11434', MORI_LLM_MODEL: 'local', MORI_LLM_API_STYLE: 'chat_completions', MORI_LLM_TIMEOUT_MS: '120000' },
    fetchImpl: async (_url, init) => {
      timeoutSignal = init.signal
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"answer":"ok"}' } }] }), { status: 200 })
    },
  })
  await llm({ prompt: 'prompt', input: {}, schema, schemaName: 'test_schema' })
  assert.equal(timeoutSignal.aborted, false)
})
