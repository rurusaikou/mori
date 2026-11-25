/**
 * 作用：统一承载正式 Agent API 与仅开发环境开放的 Playground 页面/API。
 * 输入：POST /agent/run、POST /agent/playground/run 或 GET /agent-playground 资源请求。
 * 输出：Agent 执行结果；正式与调试 Agent 由 composition root 分别注入。
 */
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { json, readRequestJson } from '../http.mjs'
import { capabilityStage } from '../mori-agent/shared/logger.mjs'

const directory = fileURLToPath(new URL('../mori-agent/playground/', import.meta.url))
const contentTypes = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8' }

export function createAgentRoutes({ productAgent, playgroundAgent, memoryRepository, memoryUserId, postTurnMemoryProcessor }, env = process.env) {
  const playgroundEnabled = env.NODE_ENV !== 'production'
  const pendingActionResults = new Map()
  return async function handleAgentRequest(request, response) {
    if (request.method === 'POST' && request.url === '/agent/run') {
      await runAgent(request, response, productAgent, { memoryRepository, memoryUserId, postTurnMemoryProcessor, pendingActionResults })
      return true
    }
    if (request.method === 'POST' && request.url === '/agent/action-result') {
      await storeActionResult(request, response, { memoryRepository, memoryUserId, postTurnMemoryProcessor, pendingActionResults })
      return true
    }
    if (!playgroundEnabled) return false
    if (request.method === 'POST' && request.url === '/agent/playground/run') {
      await runAgent(request, response, playgroundAgent)
      return true
    }
    const files = { '/agent-playground': 'index.html', '/agent-playground/': 'index.html', '/agent-playground/playground.css': 'playground.css', '/agent-playground/playground.js': 'playground.js' }
    const file = files[request.url]
    if (request.method === 'GET' && file) {
      response.writeHead(200, { 'Content-Type': contentTypes[file.split('.').at(-1)], 'Cache-Control': 'no-store' })
      response.end(await readFile(`${directory}${file}`, 'utf8'))
      return true
    }
    return false
  }
}

async function runAgent(request, response, agent, memory = {}) {
  let input
  const exchangeId = randomUUID()
  const requestId = typeof request.headers['x-mori-request-id'] === 'string' && request.headers['x-mori-request-id'].trim()
    ? request.headers['x-mori-request-id'].trim()
    : null
  const createdAt = new Date().toISOString()
  const archive = memory.memoryRepository?.available && memory.memoryUserId
  try {
    input = await readRequestJson(request)
    const requestLogRun = { runId: 'pending', capability: 'conversation_agent', promptVersion: 'unknown', model: 'unknown', requestId, exchangeId }
    capabilityStage(requestLogRun, 'agent_route_received', { requestId, exchangeId, userMessage: input?.userMessage, currentTrack: input?.currentTrack ?? null })
    if (archive) await memory.memoryRepository.appendConversationMessage(conversationRecord(input, memory.memoryUserId, exchangeId, 'user', 'pending', createdAt))
    const result = await agent.execute(input, { requestId, exchangeId })
    const correlatedLogRun = result.meta?.runId ? {
      runId: result.meta.runId, capability: 'conversation_agent', promptVersion: result.meta.version ?? 'unknown', model: result.meta.model ?? 'unknown', requestId, exchangeId,
    } : requestLogRun
    const actionResultToken = result.success && result.action && memory.pendingActionResults ? randomUUID() : null
    if (actionResultToken) {
      memory.pendingActionResults.set(actionResultToken, { exchangeId, runId: result.meta?.runId ?? null, expiresAt: Date.now() + 24 * 60 * 60 * 1000 })
    }
    if (archive) {
      // pending 先保证用户输入可恢复；同一 exchange/role 使用 upsert 收敛为 completed/failed，
      // 避免请求重试制造同一轮的重复对话记录。
      const completedUserMessage = await memory.memoryRepository.appendConversationMessage(conversationRecord(input, memory.memoryUserId, exchangeId, 'user', result.success ? 'completed' : 'failed', createdAt))
      // 有客户端动作时，服务端回复只是 planned 文案。先保存 pending，等 Extension
      // 以同一 exchangeId 回写用户真正看到的最终回复和确认后的歌曲。
      const assistantMessage = result.success
        ? await memory.memoryRepository.appendConversationMessage(conversationRecord({ ...input, userMessage: result.finalResponse }, memory.memoryUserId, exchangeId, 'assistant', result.action ? 'pending' : 'completed', new Date().toISOString()))
        : null
      const routeLogRun = result.meta?.runId ? correlatedLogRun : null
      if (routeLogRun) capabilityStage(routeLogRun, 'agent_conversation_archived', {
        exchangeId, userMessageStatus: result.success ? 'completed' : 'failed',
        assistantMessageStatus: assistantMessage?.status ?? null, awaitsClientActionResult: Boolean(result.success && result.action),
      })
      if (result.success && result.action && actionResultToken) {
        Object.assign(memory.pendingActionResults.get(actionResultToken), { input, userMessage: completedUserMessage })
        if (routeLogRun) capabilityStage(routeLogRun, 'agent_post_turn_memory_deferred', { exchangeId, reason: 'awaiting confirmed client action result' })
      } else if (result.success && memory.postTurnMemoryProcessor && assistantMessage) {
        // 只有用户实际收到的最终回复已归档后才处理 Memory。它是派生任务，失败不撤销原始对话。
        if (routeLogRun) capabilityStage(routeLogRun, 'agent_post_turn_memory_scheduled', { exchangeId, trigger: 'direct_response_archived' })
        void memory.postTurnMemoryProcessor.process({ input, userMessage: completedUserMessage, assistantMessage, agentRunId: result.meta?.runId }).catch(() => undefined)
      }
    }
    capabilityStage(correlatedLogRun, result.success ? 'agent_route_completed' : 'agent_route_failed', {
      requestId, exchangeId, runId: result.meta?.runId ?? null, success: result.success,
      actionType: result.action?.type ?? 'direct_response', httpStatus: result.success ? 200 : 400,
      ...(result.error ? { error: result.error } : {}),
    })
    json(request, response, result.success ? 200 : 400, { ...result, exchangeId, ...(actionResultToken ? { actionResultToken } : {}) })
  } catch (error) {
    if (archive && input) await memory.memoryRepository.appendConversationMessage(conversationRecord(input, memory.memoryUserId, exchangeId, 'user', 'failed', createdAt)).catch(() => undefined)
    capabilityStage({ runId: 'pending', capability: 'conversation_agent', promptVersion: 'unknown', model: 'unknown', requestId, exchangeId }, 'agent_route_failed', { requestId, exchangeId, success: false, httpStatus: error?.statusCode ?? 400, error: error instanceof Error ? error.message : String(error) })
    json(request, response, error?.statusCode ?? 400, { success: false, error: error instanceof Error ? error.message : 'Invalid request' })
  }
}

async function storeActionResult(request, response, memory) {
  try {
    const input = await readRequestJson(request)
    pruneExpiredActionResults(memory.pendingActionResults)
    const pending = typeof input?.actionResultToken === 'string' ? memory.pendingActionResults.get(input.actionResultToken) : null
    if (!isUuid(input?.exchangeId) || typeof input?.finalResponse !== 'string' || !input.finalResponse.trim()
      || !['COMPLETED', 'FAILED'].includes(input?.status) || !pending
      || pending.exchangeId !== input.exchangeId || pending.runId !== (input.runId ?? null)) {
      json(request, response, 400, { success: false, error: 'Invalid action result' }); return
    }
    if (memory.memoryRepository?.available && memory.memoryUserId) {
      const routeLogRun = pending.runId ? { runId: pending.runId, capability: 'conversation_agent', promptVersion: 'mori-agent-v1.0', model: 'client' } : null
      if (routeLogRun) capabilityStage(routeLogRun, 'agent_action_result_received', { exchangeId: input.exchangeId, status: input.status, currentTrack: input.currentTrack ?? null })
      const assistantMessage = await memory.memoryRepository.appendConversationMessage(conversationRecord({
        userMessage: input.finalResponse.trim(),
        currentTrack: input.currentTrack ?? null,
        timeZone: input.timeZone,
      }, memory.memoryUserId, input.exchangeId, 'assistant', 'completed', new Date().toISOString()))
      if (routeLogRun) capabilityStage(routeLogRun, 'agent_action_result_archived', { exchangeId: input.exchangeId, status: input.status, assistantMessageStatus: 'completed' })
      if (input.status === 'COMPLETED' && memory.postTurnMemoryProcessor && pending.input && pending.userMessage) {
        const completedInput = { ...pending.input, currentTrack: input.currentTrack ?? pending.input.currentTrack ?? null }
        if (routeLogRun) capabilityStage(routeLogRun, 'agent_post_turn_memory_scheduled', { exchangeId: input.exchangeId, trigger: 'client_action_result_archived' })
        void memory.postTurnMemoryProcessor.process({ input: completedInput, userMessage: pending.userMessage, assistantMessage, agentRunId: pending.runId }).catch(() => undefined)
      }
    }
    memory.pendingActionResults.delete(input.actionResultToken)
    json(request, response, 200, { success: true })
  } catch (error) {
    json(request, response, error?.statusCode ?? 400, { success: false, error: error instanceof Error ? error.message : 'Invalid action result' })
  }
}

function pruneExpiredActionResults(values) {
  for (const [token, value] of values) if (value.expiresAt <= Date.now()) values.delete(token)
}

function isUuid(value) { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value) }

function conversationRecord(input, userId, exchangeId, role, status, createdAt) {
  const track = input.currentTrack
    ? { uri: input.currentTrack.uri ?? `local:${input.currentTrack.artist}:${input.currentTrack.title}`, title: input.currentTrack.title, artist: input.currentTrack.artist }
    : null
  return { userId, exchangeId, role, status, content: input.userMessage, track, timeZone: input.timeZone ?? 'UTC', createdAt }
}
