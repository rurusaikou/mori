/**
 * 作用：为五个 Capability 提供一致的 execute 协议、错误封装和阶段日志，不共享业务判断。
 * 输入：模块自己的 Prompt、Schema、输入/输出校验器和 LLM transport。
 * 输出：{ success, data/error, meta }，并记录 received 到 completed/failed 的完整阶段。
 */
import { randomUUID } from 'node:crypto'
import { capabilityStage } from './logger.mjs'

export function createCapabilityExecutor({ capability, promptVersion, prompt, schema, validateInput, validateOutput, llm }) {
  return {
    capability,
    promptVersion,
    async execute(input) {
      const runId = randomUUID()
      const started = Date.now()
      const run = { runId, capability, promptVersion, model: 'unresolved' }
      capabilityStage(run, 'received', { input })
      try {
        // Prompt 不能替代边界校验：坏输入在消耗模型配额前就应失败。
        validateInput(input)
        capabilityStage(run, 'input_validated')
        capabilityStage(run, 'llm_started')
        const result = await llm({ prompt, input, schema, schemaName: `${capability}_v0_1` })
        run.model = result.model
        capabilityStage(run, 'llm_completed', { tokenUsage: result.tokenUsage })
        // Provider 的 JSON Schema 只保证形状；Capability 仍需验证业务禁区。
        const data = validateOutput(result.data, input)
        capabilityStage(run, 'output_validated')
        const meta = { runId, capability, promptVersion, model: result.model, latency: Date.now() - started, tokenUsage: result.tokenUsage }
        capabilityStage(run, 'completed', { input, output: data, latency: meta.latency, tokenUsage: result.tokenUsage })
        return { success: true, data, meta }
      } catch (cause) {
        const error = cause instanceof Error ? cause.message : String(cause)
        const meta = { runId, capability, promptVersion, model: run.model, latency: Date.now() - started }
        capabilityStage(run, 'failed', { input, latency: meta.latency, error })
        return { success: false, error, meta }
      }
    },
  }
}

export function object(value, name = 'input') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} 必须是对象`)
  return value
}
export function text(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} 必须是非空字符串`)
  return value.trim()
}
export function confidence(value, name = 'confidence') {
  if (typeof value !== 'number' || value < 0 || value > 1) throw new Error(`${name} 必须在 0 到 1 之间`)
  return value
}
export function noExtra(value, keys, name) {
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`${name} 包含未知字段：${key}`)
}
