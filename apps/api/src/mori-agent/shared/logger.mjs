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
  const entry = { timestamp: new Date().toISOString(), source, runId: run.runId, capability: run.capability, promptVersion: run.promptVersion, model: run.model, stage, ...data }
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
      ? `${identity}：服务端决策与动作规划完成，耗时 ${entry.latency}ms；动作仍待客户端执行和确认。输出：${readable(entry.output)}。`
      : `${identity}：Capability 执行成功，耗时 ${entry.latency}ms。输出：${readable(entry.output)}。`,
    failed: () => `${identity}：Capability 执行失败，耗时 ${entry.latency}ms。原因：${safe(entry.error)}。`,
    agent_input: () => `${identity}：收到 Agent 输入。${readable(agentInputSummary(eventData(entry)))}。`,
    agent_context_preparation_started: () => `${identity}：开始并行准备 Conversation Understanding 与初始 Relevant Memory。${readable(eventData(entry))}。`,
    agent_relevant_memory_prepared: () => `${identity}：Relevant Memory 准备完成；记录召回阶段、目标歌曲、匹配原因、证据等级与预算结果，不写入完整记忆正文。${readable(eventData(entry))}。`,
    agent_target_memory_retrieval: () => `${identity}：解析后的目标歌曲不同于当前播放歌曲，开始针对 targetTrack 重新召回 Memory。${readable(eventData(entry))}。`,
    agent_context_assembly: () => `${identity}：Agent Context 组装完成。${readable(eventData(entry))}。`,
    agent_conversation_understanding: () => `${identity}：LLM Conversation Understanding 完成。${readable(eventData(entry))}。`,
    agent_conversation_understanding_raw: () => `${identity}：Conversation Understanding 原始结构化输出。${readable(eventData(entry))}。`,
    agent_decision_repair: () => `${identity}：Decision 首次输出不符合 Schema 或动作边界，执行一次受限修复。${readable(eventData(entry))}。`,
    agent_tools_available: () => `${identity}：本轮可用 Tool 注册完成。${readable(eventData(entry))}。`,
    agent_decision_model_call: () => `${identity}：开始调用 Decision Model；记录动作判断所依据的 scene、listeningRequest、reference 与 targetTrack。${readable(eventData(entry))}。`,
    agent_decision_raw: () => `${identity}：Agent Decision 原始结构化输出。${readable(eventData(entry))}。`,
    agent_decision_repair_raw: () => `${identity}：Agent Decision 修复后的原始结构化输出。${readable(eventData(entry))}。`,
    agent_decision_fallback: () => `${identity}：Decision 修复仍无效，执行确定性安全降级。${readable(eventData(entry))}。`,
    agent_decision_validated: () => `${identity}：Decision Schema、Understanding 约束与 Tool 边界校验通过。${readable(eventData(entry))}。`,
    agent_direct_response_selected: () => `${identity}：Decision 选择直接回复，不进入 Tool Execution。${readable(eventData(entry))}。`,
    agent_response_quality_checked: () => entry.passed
      ? `${identity}：直接回复质量门检查通过，无需修订。${readable(eventData(entry))}。`
      : `${identity}：直接回复质量门发现问题，将执行一次 Response Repair。${readable(eventData(entry))}。`,
    agent_response_repair_raw: () => `${identity}：Response Repair Model 返回原始结构化输出。${readable(eventData(entry))}。`,
    agent_response_repair_validated: () => `${identity}：Response Repair 输出校验通过。${readable(eventData(entry))}。`,
    agent_playback_fact_checked: () => entry.passed
      ? `${identity}：最终直接回复与真实 Playback State 一致。${readable(eventData(entry))}。`
      : `${identity}：Response Repair 后仍存在未经确认的播放状态声明。${readable(eventData(entry))}。`,
    agent_response_fact_fallback: () => `${identity}：播放事实修订仍不符合当前状态，使用自然语言安全兜底。${readable(eventData(entry))}。`,
    agent_track_reference_resolution: () => `${identity}：歌曲引用解析完成。${readable(eventData(entry))}。`,
    agent_state_before: () => `${identity}：记录决策前的 World State 与 Playback State。${readable(eventData(entry))}。`,
    agent_model_decision: () => `${identity}：模型完成下一步决策。${readable(eventData(entry))}。`,
    agent_tool_call: () => `${identity}：Agent 选择调用 Tool。${readable(eventData(entry))}。`,
    agent_tool_arguments: () => `${identity}：Tool 参数已生成。${readable(eventData(entry))}。`,
    agent_tool_result: () => entry.result?.status === 'PENDING'
      ? `${identity}：Tool 已生成待客户端执行的动作计划，尚未完成真实操作。${readable(eventData(entry))}。`
      : `${identity}：Tool 执行完成。${readable(eventData(entry))}。`,
    agent_final_model_call: () => `${identity}：开始基于 Tool Result 生成最终回复。${readable(eventData(entry))}。`,
    agent_final_response_raw: () => `${identity}：Final Response Model 返回原始结构化输出。${readable(eventData(entry))}。`,
    agent_final_response_validated: () => `${identity}：Final Response Schema 校验通过。${readable(eventData(entry))}。`,
    agent_tool_response_safety_applied: () => `${identity}：Tool Result 仍处于待客户端确认状态，安全规则收敛了最终文案。${readable(eventData(entry))}。`,
    agent_state_after: () => `${identity}：记录本轮事实状态与待执行动作。${readable(eventData(entry))}。`,
    agent_final_response: () => `${identity}：Agent 最终回复生成完成。${readable(eventData(entry))}。`,
    agent_client_action_started: () => `${identity}：客户端开始执行服务端规划的播放动作。${readable(eventData(entry))}。`,
    agent_client_action_completed: () => `${identity}：客户端已确认播放动作真实完成。${readable(eventData(entry))}。`,
    agent_client_action_failed: () => `${identity}：客户端播放动作执行失败。${readable(eventData(entry))}。`,
    agent_conversation_archived: () => `${identity}：本轮用户消息与 assistant 回复已写入 Conversation Store。${readable(eventData(entry))}。`,
    agent_post_turn_memory_deferred: () => `${identity}：Post-turn Memory 暂不执行，等待客户端动作真实结果。${readable(eventData(entry))}。`,
    agent_post_turn_memory_scheduled: () => `${identity}：最终对话事实已归档，Post-turn Memory Processing 已异步调度。${readable(eventData(entry))}。`,
    agent_action_result_received: () => `${identity}：收到 Extension 回写的客户端动作最终结果。${readable(eventData(entry))}。`,
    agent_action_result_archived: () => `${identity}：客户端动作最终文案与确认歌曲已归档。${readable(eventData(entry))}。`,
    agent_error: () => `${identity}：Agent 执行失败。原因：${safe(entry.error)}。`,
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
    fakeMemoryCount: Array.isArray(input.fakeMemory) ? input.fakeMemory.length : 0,
  }
}
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
