import { createMoriGraphAgent } from './mori-graph-runtime.mjs'
import { createLegacyMoriAgent } from './mori-runtime.mjs'
import { createUnifiedMoriAgent } from './unified-runtime.mjs'

/**
 * Unified 是默认正式 Runtime；Graph/Legacy 仅作显式人工回退。
 * 不做 Runtime 失败后自动重跑，因为那会重复 LLM、Tool 甚至播放计划。
 */
export function createMoriAgent(llm, options = {}) {
  const runtime = options.runtime ?? process.env.MORI_AGENT_RUNTIME ?? 'unified'
  if (runtime === 'graph') return createMoriGraphAgent(llm, options)
  if (runtime === 'legacy') return createLegacyMoriAgent(llm, options)
  if (runtime === 'unified') return createUnifiedMoriAgent(options.agentLlm ?? llm, options)
  throw new Error(`不支持的 MORI_AGENT_RUNTIME：${runtime}`)
}

export { createLegacyMoriAgent, createMoriGraphAgent, createUnifiedMoriAgent }
