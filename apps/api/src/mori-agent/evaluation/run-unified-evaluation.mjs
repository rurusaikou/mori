import { createAgentLlm } from '../shared/agent-llm.mjs'
import { createCapabilityLlm } from '../shared/llm.mjs'
import { loadMoriPersona } from '../persona/persona-loader.mjs'
import { createUnifiedMoriAgent } from '../runtime/unified-runtime.mjs'
import { UNIFIED_CONVERSATION_CASES } from './conversation-cases.mjs'
import { evaluateConversationCase } from './conversation-evaluator.mjs'

const agent = createUnifiedMoriAgent(createAgentLlm(), {
  actionAuthorizationLlm: createCapabilityLlm(),
  musicSearchMode: 'none',
  persona: await loadMoriPersona(),
  logSource: 'debug',
})

const results = []
for (const testCase of UNIFIED_CONVERSATION_CASES) {
  const result = await agent.execute(testCase.input)
  const evaluation = evaluateConversationCase(testCase, result)
  results.push(evaluation)
  console.log(JSON.stringify({ ...evaluation, model: result.meta?.model, latencyMs: result.meta?.latency }))
}

const failed = results.filter((result) => !result.passed)
console.log(`Unified conversation evaluation: ${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exitCode = 1