/**
 * 作用：统一承载正式 Agent API 与仅开发环境开放的 Playground 页面/API。
 * 输入：POST /agent/run、POST /agent/playground/run 或 GET /agent-playground 资源请求。
 * 输出：Agent 执行结果；正式与调试 Agent 由 composition root 分别注入。
 */
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { json, readRequestJson } from '../http.mjs'

const directory = fileURLToPath(new URL('../mori-agent/playground/', import.meta.url))
const contentTypes = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8' }

export function createAgentRoutes({ productAgent, playgroundAgent, memoryRepository, memoryUserId, detectMemoryCandidate }, env = process.env) {
  const playgroundEnabled = env.NODE_ENV !== 'production'
  return async function handleAgentRequest(request, response) {
    if (request.method === 'POST' && request.url === '/agent/run') {
      await runAgent(request, response, productAgent, { memoryRepository, memoryUserId, detectMemoryCandidate })
      return true
    }
    if (request.method === 'POST' && request.url === '/agent/action-result') {
      await storeActionResult(request, response, { memoryRepository, memoryUserId })
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
  const createdAt = new Date().toISOString()
  const archive = memory.memoryRepository?.available && memory.memoryUserId
  try {
    input = await readRequestJson(request)
    const storedUserMessage = archive
      ? await memory.memoryRepository.appendConversationMessage(conversationRecord(input, memory.memoryUserId, exchangeId, 'user', 'pending', createdAt))
      : null
    const result = await agent.execute(input)
    if (archive) {
      // pending 先保证用户输入可恢复；同一 exchange/role 使用 upsert 收敛为 completed/failed，
      // 避免请求重试制造同一轮的重复对话记录。
      await memory.memoryRepository.appendConversationMessage(conversationRecord(input, memory.memoryUserId, exchangeId, 'user', result.success ? 'completed' : 'failed', createdAt))
      // 有客户端动作时，服务端回复只是 planned 文案。先保存 pending，等 Extension
      // 以同一 exchangeId 回写用户真正看到的最终回复和确认后的歌曲。
      if (result.success) await memory.memoryRepository.appendConversationMessage(conversationRecord({ ...input, userMessage: result.finalResponse }, memory.memoryUserId, exchangeId, 'assistant', result.action ? 'pending' : 'completed', new Date().toISOString()))
      if (result.success && memory.detectMemoryCandidate) {
        // 候选提炼是可重试派生任务，不是回复成功条件；失败不能撤销已保存的原始对话。
        void detectAndStore(memory, input, storedUserMessage).catch(() => undefined)
      }
    }
    json(request, response, result.success ? 200 : 400, { ...result, exchangeId })
  } catch (error) {
    if (archive && input) await memory.memoryRepository.appendConversationMessage(conversationRecord(input, memory.memoryUserId, exchangeId, 'user', 'failed', createdAt)).catch(() => undefined)
    json(request, response, error?.statusCode ?? 400, { success: false, error: error instanceof Error ? error.message : 'Invalid request' })
  }
}

async function storeActionResult(request, response, memory) {
  try {
    const input = await readRequestJson(request)
    if (!isUuid(input?.exchangeId) || typeof input?.finalResponse !== 'string' || !input.finalResponse.trim()) {
      json(request, response, 400, { success: false, error: 'Invalid action result' }); return
    }
    if (memory.memoryRepository?.available && memory.memoryUserId) {
      await memory.memoryRepository.appendConversationMessage(conversationRecord({
        userMessage: input.finalResponse.trim(),
        currentTrack: input.currentTrack ?? null,
        timeZone: input.timeZone,
      }, memory.memoryUserId, input.exchangeId, 'assistant', 'completed', new Date().toISOString()))
    }
    json(request, response, 200, { success: true })
  } catch (error) {
    json(request, response, error?.statusCode ?? 400, { success: false, error: error instanceof Error ? error.message : 'Invalid action result' })
  }
}

function isUuid(value) { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value) }

async function detectAndStore(memory, input, storedMessage) {
  const detected = await memory.detectMemoryCandidate({ userMessage: input.userMessage, conversationContext: input.conversationHistory, currentTrack: input.currentTrack })
  if (!detected?.success || !detected.data?.shouldCreate) return
  await memory.memoryRepository.createCandidate({
    userId: memory.memoryUserId,
    content: detected.data.candidate.content,
    confidence: detected.data.candidate.confidence,
    sourceMessageId: storedMessage.id,
    evidence: detected.data.candidate.evidence,
    track: input.currentTrack,
    createdAt: storedMessage.createdAt,
  })
}

function conversationRecord(input, userId, exchangeId, role, status, createdAt) {
  const track = input.currentTrack
    ? { uri: input.currentTrack.uri ?? `local:${input.currentTrack.artist}:${input.currentTrack.title}`, title: input.currentTrack.title, artist: input.currentTrack.artist }
    : null
  return { userId, exchangeId, role, status, content: input.userMessage, track, timeZone: input.timeZone ?? 'UTC', createdAt }
}
