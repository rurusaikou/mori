/**
 * 作用：接收 Extension 转发的结构化业务日志并输出到 API 终端。
 * 输入：POST /logs JSON 日志对象。
 * 输出：202 accepted 或可读的 400 JSON 错误。
 */
import { json, readRequestJson } from '../http.mjs'
import { logExtensionEntry } from '../logging.mjs'
import { MORI_AGENT_PROMPT_VERSION } from '../mori-agent/expression/prompts.mjs'
import { capabilityStage } from '../mori-agent/shared/logger.mjs'

export async function handleLogsRoute(request, response) {
  try {
    const entry = await readRequestJson(request)
    if (!entry || typeof entry.category !== 'string' || typeof entry.event !== 'string') {
      json(request, response, 400, { error: 'Invalid log entry' }); return
    }
    await logExtensionEntry(entry)
    mirrorAgentActionResult(entry)
    json(request, response, 202, { accepted: true })
  } catch (error) {
    json(request, response, error?.statusCode ?? 400, { error: error?.statusCode === 413 ? 'Request body is too large' : 'Invalid JSON' })
  }
}

function mirrorAgentActionResult(entry) {
  const stages = {
    agent_playback_control_started: 'agent_client_action_started',
    agent_playback_control_completed: 'agent_client_action_completed',
    agent_playback_control_failed: 'agent_client_action_failed',
  }
  const stage = entry.category === 'conversation' ? stages[entry.event] : null
  if (!stage || typeof entry.agentRunId !== 'string' || !entry.agentRunId) return
  // Extension 与服务端不共享进程内 Run 对象；使用 agentRunId 把真实副作用回执追加到
  // 同一份 Capability Log，避免服务端 planned 与客户端 result 分散在两套日志中。
  capabilityStage({
    runId: entry.agentRunId,
    capability: 'conversation_agent',
    promptVersion: typeof entry.promptVersion === 'string' && entry.promptVersion ? entry.promptVersion : MORI_AGENT_PROMPT_VERSION,
    logSource: 'runtime',
  }, stage, {
    command: entry.command,
    status: entry.event.endsWith('_completed') ? 'COMPLETED' : entry.event.endsWith('_failed') ? 'FAILED' : 'STARTED',
    isPlaying: entry.isPlaying,
    trackUri: entry.trackUri ?? null,
    ...(entry.error ? { error: entry.error } : {}),
  })
}
