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
  const entry = { timestamp: new Date().toISOString(), runId: run.runId, capability: run.capability, promptVersion: run.promptVersion, model: run.model, stage, ...data }
  debugRuns.push(entry)
  if (debugRuns.length > 500) debugRuns.splice(0, debugRuns.length - 500)
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    await mkdir(directory, { recursive: true })
    const date = localDate(entry.timestamp)
    await appendFile(path.join(directory, `capability_${date}.log`), `${formatCapabilityLogLine(entry)}\n`, 'utf8')
  }).catch((error) => console.error('[Mori Capability] Failed to write debug log:', error))
}

export function recentCapabilityLogs() { return debugRuns.slice(-100) }

export function formatCapabilityLogLine(entry) {
  const time = localTime(entry.timestamp)
  const level = entry.stage === 'failed' ? '错误' : '信息'
  return `${time} [${level}] [mori_agent/${entry.capability}/${entry.stage}] ${describeStage(entry)}`
}

function describeStage(entry) {
  const identity = `Run ${entry.runId}，Prompt ${entry.promptVersion}`
  const descriptions = {
    received: () => `${identity}：收到 ${capabilityName(entry.capability)} 输入。输入：${readable(entry.input)}。`,
    input_validated: () => `${identity}：输入格式与业务边界校验通过。`,
    llm_started: () => `${identity}：开始调用 LLM 生成结构化结果。`,
    llm_completed: () => `${identity}：LLM 返回完成（模型：${entry.model}；Token：${tokens(entry.tokenUsage)}）。`,
    output_validated: () => `${identity}：模型输出 Schema 与业务边界校验通过。`,
    completed: () => `${identity}：Capability 执行成功，耗时 ${entry.latency}ms。输出：${readable(entry.output)}。`,
    failed: () => `${identity}：Capability 执行失败，耗时 ${entry.latency}ms。原因：${safe(entry.error)}。`,
  }
  return descriptions[entry.stage]?.() ?? `${identity}：进入阶段 ${entry.stage}。`
}

function capabilityName(value) {
  return ({ memory: '记忆候选检测', understanding: '用户表达理解', connection: '历史关联发现', reflection: '旧理解反思', companionship: '陪伴行动决策' })[value] ?? value
}
function tokens(value) { return value?.total_tokens ?? value?.totalTokens ?? '—' }
function readable(value) { try { return JSON.stringify(value) } catch { return safe(value) } }
function safe(value) { return String(value ?? '—').replaceAll(/\s+/g, ' ').trim() }
function localDate(timestamp) { const date = new Date(timestamp); return [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((value, index) => index ? String(value).padStart(2, '0') : String(value)).join('-') }
function localTime(timestamp) { const date = new Date(timestamp); const values = [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()]; return values.map((value) => String(value).padStart(2, '0')).join('').replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/, '$1-$2-$3 $4:$5:$6') }
