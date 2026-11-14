import assert from 'node:assert/strict'
import test from 'node:test'
import { createEmbeddingProvider } from './embedding-provider.mjs'

test('returns no provider when embedding is not configured', () => {
  assert.equal(createEmbeddingProvider({ env: {} }), null)
})

test('calls the Ollama embedding endpoint and validates dimensions', async () => {
  let request
  const provider = createEmbeddingProvider({
    env: { MORI_EMBEDDING_ENDPOINT: '127.0.0.1:11434', MORI_EMBEDDING_MODEL: 'nomic-embed-text', MORI_EMBEDDING_DIMENSIONS: '3' },
    fetchImpl: async (url, options) => { request = { url, options }; return { ok: true, json: async () => ({ embeddings: [[0.1, 0.2, 0.3]] }) } },
  })
  assert.deepEqual(await provider.embed('喜欢有层次的声音'), [0.1, 0.2, 0.3])
  assert.equal(request.url, 'http://127.0.0.1:11434/api/embed')
  assert.deepEqual(JSON.parse(request.options.body), { model: 'nomic-embed-text', input: '喜欢有层次的声音' })
})

test('rejects vectors with a different dimension', async () => {
  const provider = createEmbeddingProvider({
    env: { MORI_EMBEDDING_ENDPOINT: 'http://localhost:11434', MORI_EMBEDDING_MODEL: 'test', MORI_EMBEDDING_DIMENSIONS: '2' },
    fetchImpl: async () => ({ ok: true, json: async () => ({ embeddings: [[0.1]] }) }),
  })
  await assert.rejects(provider.embed('test'), /期望 2/)
})
