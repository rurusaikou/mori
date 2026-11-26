/**
 * 作用：记录 Capability 从接收输入到校验完成的每个阶段，且与 Mori 现有日志保持同样的中文可读格式。
 * 输入：本次 Run 的身份信息、阶段名称和阶段数据。
 * 输出：capability_YYYY-MM-DD.log；Debug 日志与用户 Memory、对话存储完全隔离。
 */
import { appendFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const directory = fileURLToPath(new URL('../../../logs/', import.meta.url))
const debugRuns = []
let writeQueue = Promise.resolve()

export function capabilityStage(run, stage, data = {}) {
  const source = run.logSource ?? runtimeLogSource()
  const entry = { timestamp: new Date().toISOString(), source, requestId: run.requestId ?? null, exchangeId: run.exchangeId ?? null, runId: run.runId, capability: run.capability, promptVersion: run.promptVersion, model: run.model, stage, ...data }
  // 内存副本只服务 Lab 当前进程；磁盘文件才用于跨刷新排查。
  debugRuns.push(entry)
  if (debugRuns.length > 500) debugRuns.splice(0, debugRuns.length - 500)
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    await mkdir(directory, { recursive: true })
    const date = localDate(entry.timestamp)
    const prefix = source === 'test' ? 'capability_test' : source === 'debug' ? 'capability_debug' : 'capability'
    await appendFile(path.join(directory, `${prefix}_${date}.log`), `${formatCapabilityLogLine(entry)}\n`, 'utf8')
  }).catch((error) => console.error('[Mori Capability] Failed to write debug log:', error))
}

export function recentCapabilityLogs() { return debugRuns.slice(-100) }

export function formatCapabilityLogLine(entry) {
  const time = localTime(entry.timestamp)
  const level = ['failed', 'agent_error', 'agent_client_action_failed'].includes(entry.stage) ? '错误' : '信息'
  const source = entry.source === 'test' ? '测试' : entry.source === 'debug' ? '调试' : '真实'
  return `${time} [${source}] [${level}] [mori_agent/${entry.capability}/${entry.stage}] ${describeStage(entry)}`
}

function describeStage(entry) {
  const identity = `Run ${entry.runId}，Prompt ${entry.promptVersion}`
  const descriptions = {
    received: () => `${identity}：收到 ${capabilityName(entry.capability)} 输入。输入：${readable(entry.input)}。`,
    input_validated: () => `${identity}：输入格式与业务边界校验通过。`,
    llm_started: () => `${identity}：开始调用 LLM 生成结构化结果。`,
    llm_completed: () => `${identity}：LLM 返回完成（模型：${entry.model}；Token：${tokens(entry.tokenUsage)}）。`,
    output_validated: () => `${identity}：模型输出 Schema 与业务边界校验通过。`,
    completed: () => entry.output?.plannedAction
      ? `${identity}：服务端决策与动作规划完成，耗时 ${entry.latency}ms；plannedResponse 不是用户最终回复，仍待客户端执行和确认。输出：${readable(entry.output)}。`
      : `${identity}：Capability 执行成功，耗时 ${entry.latency}ms。输出：${readable(entry.output)}。`,
    failed: () => `${identity}：Capability 执行失败，耗时 ${entry.latency}ms。原因：${safe(entry.error)}。`,
    agent_input: () => `${identity}：收到 Agent 输入。${readable(agentInputSummary(eventData(entry)))}。`,
    agent_context_preparation_started: () => `${identity}：开始并行准备 Conversation Understanding 与初始 Relevant Memory。${readable(eventData(entry))}。`,
    agent_relevant_memory_prepared: () => `${identity}：Relevant Memory 准备完成。${readable(memorySummary(entry))}。`,
    agent_target_memory_retrieval: () => `${identity}：解析后的目标歌曲不同于当前播放歌曲，开始针对 targetTrack 重新召回 Memory。${readable(eventData(entry))}。`,
    agent_context_assembly: () => `${identity}：Agent Context 组装完成。${readable(contextSummary(entry))}。`,
    agent_conversation_understanding: () => `${identity}：LLM Conversation Understanding 完成。${readable(understandingSummary(entry))}。`,
    agent_conversation_understanding_raw: () => `${identity}：Conversation Understanding 原始结构化输出。${readable(eventData(entry))}。`,
    agent_emotion_evidence_dropped: () => `${identity}：emotion.evidence 不是用户原文中的连续片段，已丢弃可选 emotion 字段并继续本轮。${readable(eventData(entry))}。`,
    agent_grounding_evidence_dropped: () => `${identity}：eventFrame.evidence 不能在用户最新消息中找到，已丢弃未验证的事件框架；继续使用其余理解结果。${readable(eventData(entry))}。`,
    agent_action_grounding_dropped: () => `${identity}：本轮没有足够原文证据授权新的音乐动作，已丢弃从历史补出的 listeningRequest。${readable(eventData(entry))}。`,
    agent_decision_repair: () => `${identity}：Decision 首次输出不符合 Schema 或动作边界，执行一次受限修复。${readable(eventData(entry))}。`,
    agent_tools_available: () => `${identity}：本轮可用 Tool：${(entry.tools ?? []).map((tool) => tool.name ?? tool).join('、') || '无'}。`,
    agent_decision_model_call: () => `${identity}：开始调用 Decision Model。${readable(decisionBasisSummary(entry))}。`,
    agent_decision_raw: () => `${identity}：Agent Decision 原始结构化输出。${readable(eventData(entry))}。`,
    agent_decision_repair_raw: () => `${identity}：Agent Decision 修复后的原始结构化输出。${readable(eventData(entry))}。`,
    agent_decision_fallback: () => `${identity}：Decision 修复仍无效，执行确定性安全降级。${readable(eventData(entry))}。`,
    agent_decision_validated: () => `${identity}：Decision 校验通过。${readable(decisionSummary(entry))}。`,
    agent_direct_response_selected: () => `${identity}：Decision 选择直接回复，不进入 Tool Execution。回复：${quoted(entry.response)}。`,
    agent_response_quality_checked: () => entry.passed
      ? `${identity}：直接回复质量门检查通过，无需修订。${readable(eventData(entry))}。`
      : `${identity}：直接回复质量门发现问题，将执行一次 Response Repair。${readable(eventData(entry))}。`,
    agent_response_repair_raw: () => `${identity}：Response Repair Model 返回原始结构化输出。${readable(eventData(entry))}。`,
    agent_response_repair_validated: () => `${identity}：Response Repair 输出校验通过。${readable(eventData(entry))}。`,
    agent_response_repair_rechecked: () => entry.passed
      ? `${identity}：修订回复通过质量门复检。`
      : `${identity}：修订回复仍未通过质量门，将使用保守兜底。${readable(eventData(entry))}。`,
    agent_playback_fact_checked: () => entry.passed
      ? `${identity}：最终直接回复与真实 Playback State 一致。${readable(eventData(entry))}。`
      : `${identity}：Response Repair 后仍存在未经确认的播放状态声明。${readable(eventData(entry))}。`,
    agent_response_fact_fallback: () => `${identity}：播放事实修订仍不符合当前状态，使用自然语言安全兜底。${readable(eventData(entry))}。`,
    agent_track_reference_resolution: () => `${identity}：歌曲引用解析完成。${readable(trackResolutionSummary(entry))}。`,
    agent_state_before: () => `${identity}：决策前播放事实。${readable(playbackSummary(entry.playbackState))}。`,
    agent_model_decision: () => `${identity}：模型完成下一步决策。${readable(decisionSummary(entry))}。`,
    agent_tool_call: () => `${identity}：Agent 选择调用 Tool。${readable(eventData(entry))}。`,
    agent_tool_arguments: () => `${identity}：Tool 实际参数：${readable(withoutCorrelation(eventData(entry)))}。`,
    agent_tool_result: () => entry.result?.status === 'PENDING'
      ? `${identity}：Tool 已生成待客户端执行的动作计划，尚未完成真实操作。${readable(eventData(entry))}。`
      : `${identity}：Tool 执行完成。${readable(eventData(entry))}。`,
    agent_final_model_call: () => `${identity}：开始基于 Tool Result 生成最终回复。${readable(eventData(entry))}。`,
    agent_final_response_raw: () => `${identity}：Final Response Model 返回原始结构化输出。${readable(eventData(entry))}。`,
    agent_final_response_validated: () => `${identity}：Final Response Schema 校验通过。${readable(eventData(entry))}。`,
    agent_tool_response_safety_applied: () => `${identity}：Tool Result 仍处于待客户端确认状态，安全规则收敛了最终文案。${readable(eventData(entry))}。`,
    agent_state_after: () => `${identity}：本轮结束状态。${readable({ playback: playbackSummary(entry.playbackState), plannedAction: entry.plannedAction ?? null })}。`,
    agent_final_response: () => `${identity}：Agent 最终回复：${quoted(entry.response)}。`,
    agent_planned_response: () => `${identity}：服务端过渡文案（非用户最终回复）：${quoted(entry.response)}；待执行动作：${readable(entry.plannedAction)}。`,
    agent_client_action_started: () => `${identity}：客户端开始执行服务端规划的播放动作。${readable(eventData(entry))}。`,
    agent_client_action_completed: () => `${identity}：客户端已确认播放动作真实完成。${readable(eventData(entry))}。`,
    agent_client_action_failed: () => `${identity}：客户端播放动作执行失败。${readable(eventData(entry))}。`,
    agent_conversation_archived: () => `${identity}：本轮用户消息与 assistant 回复已写入 Conversation Store。${readable(eventData(entry))}。`,
    agent_post_turn_memory_deferred: () => `${identity}：Post-turn Memory 暂不执行，等待客户端动作真实结果。${readable(eventData(entry))}。`,
    agent_post_turn_memory_scheduled: () => `${identity}：最终对话事实已归档，Post-turn Memory Processing 已异步调度。${readable(eventData(entry))}。`,
    agent_action_result_received: () => `${identity}：收到 Extension 回写的客户端动作最终结果。${readable(eventData(entry))}。`,
    agent_user_visible_response: () => `${identity}：用户最终看到的回复：${quoted(entry.response)}；客户端状态：${safe(entry.status)}；确认歌曲：${readable(trackSummary(entry.currentTrack))}。`,
    agent_action_result_archived: () => `${identity}：客户端动作最终文案与确认歌曲已归档。${readable(eventData(entry))}。`,
    agent_error: () => `${identity}：Agent 执行失败。原因：${safe(entry.error)}。`,
    agent_route_received: () => `${identity}：收到正式聊天 HTTP 请求。Request ${safe(entry.requestId)}，Exchange ${safe(entry.exchangeId)}，用户输入：${safe(entry.userMessage)}。`,
    agent_route_completed: () => `${identity}：正式聊天 HTTP 响应已生成。Request ${safe(entry.requestId)}，Exchange ${safe(entry.exchangeId)}，Run ${safe(entry.runId)}，动作：${safe(entry.actionType)}，状态码：${safe(entry.httpStatus)}。`,
    agent_route_failed: () => `${identity}：正式聊天链路失败。Request ${safe(entry.requestId)}，Exchange ${safe(entry.exchangeId)}，状态码：${safe(entry.httpStatus)}，原因：${safe(entry.error)}。`,
  }
  return descriptions[entry.stage]?.() ?? `${identity}：进入阶段 ${entry.stage}。`
}

function capabilityName(value) {
  return ({ memory: '记忆候选检测', understanding: '用户表达理解', connection: '历史关联发现', reflection: '旧理解反思', companionship: '陪伴行动决策', conversation_agent: 'Mori 对话 Agent' })[value] ?? value
}
function eventData(entry) { const { timestamp, source, runId, capability, promptVersion, model, stage, ...data } = entry; return data }
function agentInputSummary(input) {
  // fakeMemory 可能包含多条记录。日志只保留排障需要的状态和数量，避免真正的错误
  // 被超长 JSON 淹没，也减少用户资料落盘范围。
  return {
    userMessage: input.userMessage,
    currentTrack: input.currentTrack
      ? { uri: input.currentTrack.uri, title: input.currentTrack.title, artist: input.currentTrack.artist }
      : null,
    playbackState: input.playbackState,
    worldState: input.worldState,
    conversationHistoryCount: Array.isArray(input.conversationHistory) ? input.conversationHistory.length : 0,
    conversationState: input.conversationState ? {
      activeTopic: input.conversationState.activeTopic ?? null,
      entityCount: Array.isArray(input.conversationState.entities) ? input.conversationState.entities.length : 0,
      factCount: Array.isArray(input.conversationState.facts) ? input.conversationState.facts.length : 0,
      hasUnresolvedContext: Boolean(input.conversationState.unresolvedContext),
    } : null,
    fakeMemoryCount: Array.isArray(input.fakeMemory) ? input.fakeMemory.length : 0,
  }
}
function understandingSummary(value) {
  return {
    scene: value.scene, meaning: compactText(value.meaning), turnRelation: value.turnRelation,
    communicativeAct: value.communicativeAct, topic: compactText(value.topic),
    reference: value.reference ?? null, listeningRequest: value.listeningRequest ?? null,
    emotion: value.emotion ? { description: value.emotion.description, evidence: value.emotion.evidence } : null,
    eventSubject: value.eventFrame ? { subject: value.eventFrame.subject, resolution: value.eventFrame.subjectResolution } : null,
    state: value.conversationState ? {
      activeTopic: value.conversationState.activeTopic ?? null,
      entityCount: value.conversationState.entities?.length ?? 0,
      factCount: value.conversationState.facts?.length ?? 0,
      hasUnresolvedContext: Boolean(value.conversationState.unresolvedContext),
    } : null,
    confidence: value.confidence, ambiguity: compactText(value.ambiguity),
  }
}
function contextSummary(value) {
  return {
    latestMessage: compactText(value.latestMessage), historyCount: value.conversationHistory?.length ?? 0,
    scene: value.understanding?.scene, topic: compactText(value.topic), communicativeAct: value.communicativeAct,
    playback: playbackSummary(value.playbackState), targetTrack: trackSummary(value.targetTrack),
    resolution: value.trackResolution ?? null,
    memory: { source: value.relevantMemory?.source, matchCount: value.relevantMemory?.matches?.length ?? 0, tasteCount: value.relevantMemory?.tasteProfile?.length ?? 0, associationCount: value.relevantMemory?.associations?.length ?? 0 },
  }
}
function memorySummary(value) {
  return {
    phase: value.phase, source: value.source, query: compactText(value.query), focusTrack: trackSummary(value.focusTrack),
    matches: (value.matches ?? []).map((item) => ({ id: item.id, kind: item.kind, status: item.status, score: item.score, reason: item.matchReason })),
    tasteCount: value.tasteProfileCount ?? 0, associationCount: value.associationCount ?? 0,
  }
}
function decisionBasisSummary(value) {
  return { scene: value.scene, listeningRequest: value.listeningRequest ?? null, reference: value.reference ?? null, targetTrack: trackSummary(value.targetTrack), topic: compactText(value.topic), communicativeAct: value.communicativeAct }
}
function decisionSummary(value) {
  return { action: value.action, intent: value.intent, move: value.conversationMove, response: compactText(value.response), tool: value.toolCall ? { name: value.toolCall.name, arguments: value.toolCall.arguments } : null }
}
function trackResolutionSummary(value) {
  return { referenceType: value.referenceType ?? null, currentTrack: trackSummary(value.currentTrack), targetTrack: trackSummary(value.targetTrack), source: value.source, resolved: value.resolved }
}
function playbackSummary(value) { return value ? { status: value.status, availability: value.availability, currentTrack: trackSummary(value.currentTrack), previousTrack: trackSummary(value.previousTrack) } : null }
function trackSummary(value) { return value ? { title: value.title, artist: value.artist, uri: value.uri } : null }
function withoutCorrelation(value) { const { requestId, exchangeId, ...rest } = value; return rest }
function compactText(value, limit = 180) { const text = typeof value === 'string' ? safe(value) : value ?? null; return typeof text === 'string' && text.length > limit ? `${text.slice(0, limit)}…` : text }
function quoted(value) { return `“${compactText(value, 240) ?? '—'}”` }
function tokens(value) { return value?.total_tokens ?? value?.totalTokens ?? '—' }
function readable(value) { try { return JSON.stringify(value) } catch { return safe(value) } }
function safe(value) { return String(value ?? '—').replaceAll(/\s+/g, ' ').trim() }
function localDate(timestamp) {
  const date = new Date(timestamp)
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((value, index) => index ? String(value).padStart(2, '0') : String(value)).join('-')
}
function localTime(timestamp) {
  const date = new Date(timestamp)
  const values = [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()]
  return values.map((value) => String(value).padStart(2, '0')).join('').replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/, '$1-$2-$3 $4:$5:$6')
}

function runtimeLogSource() {
  // node --test 为子进程设置 NODE_TEST_CONTEXT。测试日志必须物理隔离，不能再依赖模型名、
  // latency 等不可靠特征事后猜测，也不能污染开发者用来复盘真实对话的 capability 文件。
  return process.env.NODE_TEST_CONTEXT || process.env.NODE_ENV === 'test' ? 'test' : 'runtime'
}
