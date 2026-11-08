/**
 * 作用：封装五个 Capability 共用的 Responses API Structured Outputs 网络调用。
 * 输入：模块自己的 Prompt、Input、JSON Schema 和 Schema 名称。
 * 输出：解析后的结构化数据、实际模型和 Token Usage；不包含任何 Capability 业务规则。
 */
export function createCapabilityLlm({ fetchImpl = fetch, env = process.env } = {}) {
  return async function runStructured({ prompt, input, schema, schemaName }) {
    const endpoint = env.MORI_LLM_ENDPOINT?.trim()
    const apiKey = env.MORI_LLM_API_KEY?.trim()
    const model = env.MORI_LLM_MODEL?.trim()
    if (!endpoint || !apiKey || !model) throw new Error('Capability LLM 未配置')
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, temperature: 0.2, max_output_tokens: 1200,
        input: [{ role: 'system', content: prompt }, { role: 'user', content: JSON.stringify(input) }],
        text: { format: { type: 'json_schema', name: schemaName, schema } },
      }),
      signal: AbortSignal.timeout(30_000),
    })
    const result = await response.json().catch(() => null)
    if (!response.ok) throw new Error(result?.error?.message || `LLM 请求失败（${response.status}）`)
    if (result?.status && result.status !== 'completed') throw new Error(`LLM 响应未完成（${result.status}${result?.incomplete_details?.reason ? `：${result.incomplete_details.reason}` : ''}）`)
    const text = outputText(result)
    if (!text) throw new Error('LLM 未返回 Structured Output')
    return { data: JSON.parse(text), model, tokenUsage: result.usage ?? null }
  }
}

function outputText(result) {
  if (typeof result?.output_text === 'string') return result.output_text
  for (const item of result?.output ?? []) for (const part of item?.content ?? []) if (part?.type === 'output_text') return part.text
  return null
}
