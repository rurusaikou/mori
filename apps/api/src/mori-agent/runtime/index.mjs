import { createMoriGraphAgent } from './mori-graph-runtime.mjs'
import { createLegacyMoriAgent } from './mori-runtime.mjs'

/**
 * Graph 是默认正式 Runtime；设置 MORI_AGENT_RUNTIME=legacy 可无代码回退。
 * 不做“Graph 失败后自动重跑 Legacy”，因为那会重复 LLM、Tool 甚至播放计划。
 */
export function createMoriAgent(llm, options = {}) {
  const runtime = options.runtime ?? process.env.MORI_AGENT_RUNTIME ?? 'graph'
  if (runtime === 'graph') return createMoriGraphAgent(llm, options)
  if (runtime === 'legacy') return createLegacyMoriAgent(llm, options)
  throw new Error(`不支持的 MORI_AGENT_RUNTIME：${runtime}`)
}

export { createLegacyMoriAgent, createMoriGraphAgent }
