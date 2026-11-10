/**
 * 作用：统一封装 Responses 与 Chat Completions 两种 Structured Output transport。
 * 输入：模块 Prompt、Input、JSON Schema，以及服务端环境配置。
 * 输出：解析后的结构化数据、实际模型和 Token Usage；不包含业务规则。
 */
export function createCapabilityLlm({ fetchImpl = fetch, env = process.env } = {}) {
  return async function runStructured({ prompt, input, schema, schemaName, temperature = 0.2, maxTokens = 1200 }) {
    const apiStyle = apiStyleFrom(env)
    const endpoint = resolveEndpoint(env.MORI_LLM_ENDPOINT?.trim(), apiStyle)
    const model = env.MORI_LLM_MODEL?.trim()
    if (!endpoint || !model) throw new Error('Capability LLM 未配置')
    const timeoutMs = positiveInteger(env.MORI_LLM_TIMEOUT_MS, 30_000)
    const apiKey = env.MORI_LLM_API_KEY?.trim()
    const sendApiKey = env.MORI_LLM_SEND_API_KEY?.trim().toLowerCase() !== 'false'
    const headers = { 'Content-Type': 'application/json', ...(apiKey && sendApiKey ? { Authorization: `Bearer ${apiKey}` } : {}) }
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(apiStyle === 'responses'
        ? responsesBody({ model, prompt, input, schema, schemaName, temperature, maxTokens })
        : chatCompletionsBody({ model, prompt, input, schema, schemaName, temperature, maxTokens, jsonMode: jsonModeFrom(env), reasoningEffort: env.MORI_LLM_REASONING_EFFORT?.trim() })),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const result = await response.json().catch(() => null)
    if (!response.ok) throw new Error(result?.error?.message || `LLM 请求失败（${response.status}）`)
    if (result?.status && result.status !== 'completed') throw new Error(`LLM 响应未完成（${result.status}${result?.incomplete_details?.reason ? `：${result.incomplete_details.reason}` : ''}）`)
    const text = apiStyle === 'responses' ? responsesOutputText(result) : chatOutputText(result)
    if (!text) {
      const finishReason = result?.choices?.[0]?.finish_reason
      if (finishReason === 'length') throw new Error('LLM 输出额度不足，未生成最终 Structured Output')
      throw new Error('LLM 未返回 Structured Output')
    }
    return { data: JSON.parse(cleanJson(text)), model: result?.model || model, tokenUsage: result.usage ?? null }
  }
}

export function isLlmConfigured(env = process.env) {
  return Boolean(env.MORI_LLM_ENDPOINT?.trim() && env.MORI_LLM_MODEL?.trim())
}

function responsesBody({ model, prompt, input, schema, schemaName, temperature, maxTokens }) {
  return {
    model, temperature, max_output_tokens: maxTokens,
    input: [{ role: 'system', content: prompt }, { role: 'user', content: JSON.stringify(input) }],
    text: { format: { type: 'json_schema', name: schemaName, schema } },
  }
}

function chatCompletionsBody({ model, prompt, input, schema, schemaName, temperature, maxTokens, jsonMode, reasoningEffort }) {
  const schemaInstruction = `\n\n只输出符合以下 JSON Schema 的 JSON 对象，不要使用 Markdown 代码块：\n${JSON.stringify(schema)}`
  const responseFormat = jsonMode === 'json_schema'
    ? { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } }
    : jsonMode === 'json_object' ? { type: 'json_object' } : undefined
  return {
    model, temperature, max_tokens: maxTokens,
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    messages: [{ role: 'system', content: `${prompt}${schemaInstruction}` }, { role: 'user', content: JSON.stringify(input) }],
    ...(responseFormat ? { response_format: responseFormat } : {}),
  }
}

function responsesOutputText(result) {
  if (typeof result?.output_text === 'string') return result.output_text
  for (const item of result?.output ?? []) for (const part of item?.content ?? []) if (part?.type === 'output_text') return part.text
  return null
}

function chatOutputText(result) {
  const content = result?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((part) => typeof part === 'string' ? part : part?.text || '').join('')
  return null
}

function apiStyleFrom(env) {
  const value = env.MORI_LLM_API_STYLE?.trim().toLowerCase() || 'responses'
  if (!['responses', 'chat_completions'].includes(value)) throw new Error(`MORI_LLM_API_STYLE 不支持：${value}`)
  return value
}

function jsonModeFrom(env) {
  const value = env.MORI_LLM_JSON_MODE?.trim().toLowerCase() || 'json_schema'
  if (!['json_schema', 'json_object', 'prompt_only'].includes(value)) throw new Error(`MORI_LLM_JSON_MODE 不支持：${value}`)
  return value
}

function resolveEndpoint(value, apiStyle) {
  if (!value) return ''
  const url = new URL(/^https?:\/\//i.test(value) ? value : `http://${value}`)
  if (url.pathname === '/' || !url.pathname) url.pathname = apiStyle === 'responses' ? '/v1/responses' : '/v1/chat/completions'
  return url.toString()
}

function cleanJson(value) {
  const trimmed = value.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenced ? fenced[1] : trimmed
}

function positiveInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}
