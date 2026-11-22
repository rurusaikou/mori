/**
 * Mori 的 LangGraph Runtime。
 * 第一阶段刻意保持与 Legacy Runtime 相同的单 Tool 流程；引入 Graph 是为了显式 State、
 * Node 和 Edge，不是立即开放多轮自主循环或改变产品行为。
 */
import { randomUUID } from 'node:crypto'
import { END, START, StateGraph } from '@langchain/langgraph'
import { agentStep } from '../shared/agent-types.mjs'
import { capabilityStage } from '../shared/logger.mjs'
import { MORI_AGENT_PROMPT_VERSION } from '../expression/prompts.mjs'
import { MoriGraphState } from './graph-state.mjs'
import { createMoriGraphNodes, routeAfterDecision } from './graph-nodes.mjs'
import { completeRun, validateRuntimeOptions } from './runtime-support.mjs'

export function createMoriGraphAgent(llm, options = {}) {
  const { musicSearchMode, resolveMusicFeatures } = validateRuntimeOptions(options)
  return {
    async execute(input) {
      const runId = randomUUID()
      const started = Date.now()
      const logRun = { runId, capability: 'conversation_agent', promptVersion: MORI_AGENT_PROMPT_VERSION, model: 'unresolved', logSource: options.logSource }
      let latest = { input, runId, started, trace: [] }
      try {
        // 每次 Run 独立编译，使节点闭包只持有本轮 logger metadata；业务 State 仍全部显式
        // 存在 MoriGraphState 中。启用持久 Checkpointer 前会再将依赖迁入 RunnableConfig。
        const nodes = createMoriGraphNodes({ llm, options, musicSearchMode, resolveMusicFeatures, logRun })
        const graph = new StateGraph(MoriGraphState)
          .addNode('perception', nodes.perception)
          .addNode('understanding', nodes.understanding)
          // LangGraph 不允许 Node 与 State channel 同名；使用动词节点名区分执行步骤和结果字段。
          .addNode('decide', nodes.decision)
          .addNode('direct_response', nodes.directResponse)
          .addNode('tool', nodes.tool)
          .addNode('final_response', nodes.finalResponse)
          .addEdge(START, 'perception')
          .addEdge('perception', 'understanding')
          .addEdge('understanding', 'decide')
          .addConditionalEdges('decide', routeAfterDecision, ['direct_response', 'tool'])
          .addEdge('direct_response', END)
          .addEdge('tool', 'final_response')
          .addEdge('final_response', END)
          .compile()

        // 使用 values stream 而不是一次 invoke：每次 State 更新都成为最新错误快照，节点异常时
        // 可以返回已完成阶段的 Trace，而不是只留下一个脱离上下文的 ERROR。
        for await (const state of await graph.stream(latest, { streamMode: 'values' })) latest = state
        return completeRun(logRun, runId, started, latest.model, latest.tokenUsage, latest.finalResponse, latest.trace, latest.action)
      } catch (cause) {
        const error = cause instanceof Error ? cause.message : String(cause)
        const trace = [...(latest.trace ?? []), agentStep(runId, 'ERROR', { error })]
        const meta = { runId, version: MORI_AGENT_PROMPT_VERSION, model: logRun.model, latency: Date.now() - started }
        // Graph 可能在任意 Node 失败；错误只记录并返回，不能在这里自动重跑 Legacy，
        // 因为此前的 Tool 或播放计划可能已经产生，重跑会破坏副作用至多一次的约束。
        capabilityStage(logRun, 'agent_error', { error })
        capabilityStage(logRun, 'failed', { input, latency: meta.latency, error })
        return { success: false, error, trace, meta }
      }
    },
  }
}
