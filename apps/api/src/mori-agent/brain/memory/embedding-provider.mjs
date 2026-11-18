/**
 * 作用：把 Memory 文本转换为固定维度向量，兼容 Ollama Native 与 OpenAI Embeddings API。
 * 输入：文本以及服务端 Embedding 环境配置。
 * 输出：经过维度校验的 number[]；未配置时返回 null Provider，而不是伪造向量。
 */
export function createEmbeddingProvider({ fetchImpl = fetch, env = process.env } = {}) {
  const endpoint = env.MORI_EMBEDDING_ENDPOINT?.trim()
  const model = env.MORI_EMBEDDING_MODEL?.trim()
  if (!endpoint || !model) return null
  const style = env.MORI_EMBEDDING_API_STYLE?.trim().toLowerCase() || 'ollama'
  if (!['ollama', 'openai'].includes(style)) throw new Error(`MORI_EMBEDDING_API_STYLE 不支持：${style}`)
  const dimensions = positiveInteger(env.MORI_EMBEDDING_DIMENSIONS, 768)
  const timeoutMs = positiveInteger(env.MORI_EMBEDDING_TIMEOUT_MS, 30_000)
  const apiKey = env.MORI_EMBEDDING_API_KEY?.trim()

  return {
    model,
    dimensions,
    async embed(text) {
      if (typeof text !== 'string' || !text.trim()) throw new Error('Embedding 文本不能为空')
      const response = await fetchImpl(resolveEndpoint(endpoint, style), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify(style === 'ollama' ? { model, input: text.trim() } : { model, input: text.trim(), dimensions }),
        signal: AbortSignal.timeout(timeoutMs),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error?.message || body?.error || `Embedding 请求失败（${response.status}）`)
      const vector = style === 'ollama' ? body?.embeddings?.[0] : body?.data?.[0]?.embedding
      if (!Array.isArray(vector) || vector.length !== dimensions || vector.some((value) => !Number.isFinite(value))) {
        throw new Error(`Embedding 维度无效，期望 ${dimensions}，实际 ${Array.isArray(vector) ? vector.length : 0}`)
      }
      return vector
    },
  }
}

function resolveEndpoint(value, style) {
  const url = new URL(/^https?:\/\//i.test(value) ? value : `http://${value}`)
  if (url.pathname === '/' || !url.pathname) url.pathname = style === 'ollama' ? '/api/embed' : '/v1/embeddings'
  return url.toString()
}

function positiveInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}
