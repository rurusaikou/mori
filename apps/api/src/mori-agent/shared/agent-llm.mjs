/** Native conversational transport for Agent messages and optional function tools. */
export function createAgentLlm({ fetchImpl = fetch, env = process.env } = {}) {
  const runAgentLlm = async function runAgentLlm({ messages, tools = [], toolChoice = 'auto', maxTokens = 1200 }) {
    const apiStyle = (env.MORI_LLM_API_STYLE?.trim().toLowerCase() || 'responses')
    if (!['responses', 'chat_completions'].includes(apiStyle)) throw new Error(`MORI_LLM_API_STYLE 不支持：${apiStyle}`)
    const model = env.MORI_LLM_MODEL?.trim()
    const endpoint = resolveEndpoint(env.MORI_LLM_ENDPOINT?.trim(), apiStyle)
    if (!model || !endpoint) throw new Error('Agent LLM 未配置')
    const apiKey = env.MORI_LLM_API_KEY?.trim()
    const sendApiKey = env.MORI_LLM_SEND_API_KEY?.trim().toLowerCase() !== 'false'
    const headers = { 'Content-Type': 'application/json', ...(apiKey && sendApiKey ? { Authorization: `Bearer ${apiKey}` } : {}) }
    const body = apiStyle === 'responses'
      ? responsesBody({ model, messages, tools, toolChoice, maxTokens })
      : chatCompletionsBody({ model, messages, tools, toolChoice, maxTokens })
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(positiveInteger(env.MORI_LLM_TIMEOUT_MS, 30_000)),
    })
    const result = await response.json().catch(() => null)
    if (!response.ok) throw new Error(result?.error?.message || `Agent LLM 请求失败（${response.status}）`)
    if (result?.status && result.status !== 'completed') throw new Error(`Agent LLM 响应未完成（${result.status}）`)
    return apiStyle === 'responses' ? parseResponses(result, model) : parseChatCompletions(result, model)
  }
  runAgentLlm.stream = async function streamAgentLlm({ messages, tools = [], toolChoice = 'auto', maxTokens = 1200, signal }, onEvent = () => {}) {
    const apiStyle = (env.MORI_LLM_API_STYLE?.trim().toLowerCase() || 'responses')
    if (!['responses', 'chat_completions'].includes(apiStyle)) throw new Error(`MORI_LLM_API_STYLE 不支持：${apiStyle}`)
    const model = env.MORI_LLM_MODEL?.trim()
    const endpoint = resolveEndpoint(env.MORI_LLM_ENDPOINT?.trim(), apiStyle)
    if (!model || !endpoint) throw new Error('Agent LLM 未配置')
    const apiKey = env.MORI_LLM_API_KEY?.trim()
    const sendApiKey = env.MORI_LLM_SEND_API_KEY?.trim().toLowerCase() !== 'false'
    const headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(apiKey && sendApiKey ? { Authorization: `Bearer ${apiKey}` } : {}) }
    const body = apiStyle === 'responses'
      ? { ...responsesBody({ model, messages, tools, toolChoice, maxTokens }), stream: true }
      : { ...chatCompletionsBody({ model, messages, tools, toolChoice, maxTokens }), stream: true, stream_options: { include_usage: true } }
    const timeout = AbortSignal.timeout(positiveInteger(env.MORI_LLM_TIMEOUT_MS, 30_000))
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
    const response = await fetchImpl(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal: requestSignal })
    if (!response.ok) {
      const error = await response.json().catch(() => null)
      throw new Error(error?.error?.message || `Agent LLM 流请求失败（${response.status}）`)
    }
    if (!response.body) throw new Error('Agent LLM 流响应没有 Body')
    return apiStyle === 'responses'
      ? consumeResponsesStream(response.body, model, onEvent)
      : consumeChatStream(response.body, model, onEvent)
  }
  return runAgentLlm
}

async function consumeChatStream(body, fallbackModel, onEvent) {
  let content = ''
  let model = fallbackModel
  let tokenUsage = null
  const calls = new Map()
  for await (const data of readSseData(body)) {
    if (data === '[DONE]') break
    const chunk = parseSseJson(data)
    if (!chunk) continue
    model = chunk.model || model
    tokenUsage = chunk.usage ?? tokenUsage
    const delta = chunk.choices?.[0]?.delta
    if (typeof delta?.content === 'string') {
      content += delta.content
      onEvent({ type: 'text_delta', delta: delta.content })
    }
    for (const update of delta?.tool_calls ?? []) {
      const current = calls.get(update.index) ?? { id: '', name: '', argumentsText: '' }
      if (update.id) current.id = update.id
      if (update.function?.name) current.name += update.function.name
      if (update.function?.arguments) current.argumentsText += update.function.arguments
      calls.set(update.index, current)
    }
  }
  const toolCalls = [...calls.entries()].sort(([left], [right]) => left - right).map(([, call]) => ({
    id: call.id || `call-${randomId()}`,
    name: call.name,
    arguments: parseArguments(call.argumentsText || '{}'),
  }))
  return { content, toolCalls, model, tokenUsage }
}

async function consumeResponsesStream(body, fallbackModel, onEvent) {
  let content = ''
  let model = fallbackModel
  let tokenUsage = null
  const calls = new Map()
  for await (const data of readSseData(body)) {
    const event = parseSseJson(data)
    if (!event) continue
    if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
      content += event.delta
      onEvent({ type: 'text_delta', delta: event.delta })
    } else if (event.type === 'response.output_item.added' && event.item?.type === 'function_call') {
      calls.set(event.output_index, {
        id: String(event.item.call_id ?? event.item.id ?? ''), name: String(event.item.name ?? ''), argumentsText: String(event.item.arguments ?? ''),
      })
    } else if (event.type === 'response.function_call_arguments.delta') {
      const current = calls.get(event.output_index) ?? { id: String(event.call_id ?? event.item_id ?? ''), name: String(event.name ?? ''), argumentsText: '' }
      current.argumentsText += event.delta ?? ''
      calls.set(event.output_index, current)
    } else if (event.type === 'response.output_item.done' && event.item?.type === 'function_call') {
      const current = calls.get(event.output_index) ?? { id: '', name: '', argumentsText: '' }
      current.id = String(event.item.call_id ?? event.item.id ?? current.id)
      current.name = String(event.item.name ?? current.name)
      current.argumentsText = String(event.item.arguments ?? current.argumentsText)
      calls.set(event.output_index, current)
    } else if (event.type === 'response.completed' && event.response) {
      const completed = parseResponses(event.response, model)
      model = completed.model
      tokenUsage = completed.tokenUsage
      if (!content && completed.content) {
        content = completed.content
        onEvent({ type: 'text_delta', delta: completed.content })
      }
      if (completed.toolCalls.length) return completed
    } else if (event.type === 'response.failed') {
      throw new Error(event.response?.error?.message || 'Agent LLM 流请求失败')
    }
  }
  const toolCalls = [...calls.entries()].sort(([left], [right]) => left - right).map(([, call]) => ({
    id: call.id || `call-${randomId()}`,
    name: call.name,
    arguments: parseArguments(call.argumentsText || '{}'),
  }))
  return { content, toolCalls, model, tokenUsage }
}

async function* readSseData(body) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })
      let boundary
      while ((boundary = buffer.search(/\r?\n\r?\n/u)) !== -1) {
        const block = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/u, '')
        const data = block.split(/\r?\n/u).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
        if (data) yield data
      }
      if (done) break
    }
    if (buffer.startsWith('data:')) yield buffer.slice(5).trimStart()
  } finally {
    reader.releaseLock()
  }
}

function parseSseJson(value) {
  try { return JSON.parse(value) } catch { return null }
}

function randomId() { return Math.random().toString(36).slice(2, 10) }

function responsesBody({ model, messages, tools, toolChoice, maxTokens }) {
  return {
    model,
    max_output_tokens: maxTokens,
    input: responsesInput(messages),
    ...(tools.length ? { tools: tools.map(responsesTool), tool_choice: responsesToolChoice(toolChoice) } : {}),
  }
}

function chatCompletionsBody({ model, messages, tools, toolChoice, maxTokens }) {
  return {
    model,
    max_tokens: maxTokens,
    messages: messages.map(chatMessage),
    ...(tools.length ? { tools: tools.map(chatTool), tool_choice: chatToolChoice(toolChoice) } : {}),
  }
}

function responsesInput(messages) {
  const input = []
  for (const message of messages) {
    if (message.role === 'tool') {
      input.push({ type: 'function_call_output', call_id: message.toolCallId, output: message.content })
      continue
    }
    if (message.role === 'assistant' && message.toolCalls?.length) {
      if (message.content) input.push({ role: 'assistant', content: message.content })
      for (const call of message.toolCalls) {
        input.push({ type: 'function_call', call_id: call.id, name: call.name, arguments: JSON.stringify(call.arguments) })
      }
      continue
    }
    input.push({ role: message.role, content: message.content })
  }
  return input
}

function chatMessage(message) {
  if (message.role === 'assistant' && message.toolCalls?.length) {
    return {
      role: 'assistant',
      content: message.content || null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      })),
    }
  }
  if (message.role === 'tool') return { role: 'tool', tool_call_id: message.toolCallId, content: message.content }
  return { role: message.role, content: message.content }
}

function responsesTool(tool) {
  return { type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters, strict: true }
}

function chatTool(tool) {
  return { type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters, strict: true } }
}

function responsesToolChoice(choice) {
  if (choice === 'auto' || choice === 'none' || choice === 'required') return choice
  return { type: 'function', name: choice }
}

function chatToolChoice(choice) {
  if (choice === 'auto' || choice === 'none' || choice === 'required') return choice
  return { type: 'function', function: { name: choice } }
}

function parseResponses(result, fallbackModel) {
  const output = result?.output ?? []
  const content = typeof result?.output_text === 'string'
    ? result.output_text
    : output.flatMap((item) => item?.content ?? []).filter((part) => part?.type === 'output_text').map((part) => part.text ?? '').join('')
  const toolCalls = output.filter((item) => item?.type === 'function_call').map((item) => ({
    id: String(item.call_id ?? item.id ?? ''),
    name: String(item.name ?? ''),
    arguments: parseArguments(item.arguments),
  }))
  return { content, toolCalls, model: result?.model || fallbackModel, tokenUsage: result?.usage ?? null }
}

function parseChatCompletions(result, fallbackModel) {
  const message = result?.choices?.[0]?.message
  const content = typeof message?.content === 'string'
    ? message.content
    : Array.isArray(message?.content) ? message.content.map((part) => part?.text ?? '').join('') : ''
  const toolCalls = (message?.tool_calls ?? []).map((call) => ({
    id: String(call.id ?? ''),
    name: String(call.function?.name ?? ''),
    arguments: parseArguments(call.function?.arguments),
  }))
  return { content, toolCalls, model: result?.model || fallbackModel, tokenUsage: result?.usage ?? null }
}

function parseArguments(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  if (typeof value !== 'string') throw new Error('Agent LLM 返回了无效的 Tool 参数')
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('arguments must be an object')
    return parsed
  } catch {
    throw new Error('Agent LLM 返回了无效的 Tool 参数')
  }
}

function resolveEndpoint(value, apiStyle) {
  if (!value) return ''
  const url = new URL(/^https?:\/\//i.test(value) ? value : `http://${value}`)
  if (url.pathname === '/' || !url.pathname) url.pathname = apiStyle === 'responses' ? '/v1/responses' : '/v1/chat/completions'
  return url.toString()
}

function positiveInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}