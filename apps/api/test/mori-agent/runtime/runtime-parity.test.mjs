/**
 * Runtime 迁移契约：同一输入和确定性 LLM 输出必须产生相同的外部行为。
 * Trace 的 runId/timestamp 属于观测元数据，因此只比较产品真正依赖的语义字段。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createLegacyMoriAgent, createMoriGraphAgent } from '../../../src/mori-agent/runtime/index.mjs'

const base = {
  userMessage: '你好',
  currentTrack: { uri: 'spotify:track:current', title: '当前歌曲', artist: '歌手' },
  conversationHistory: [],
  fakeMemory: [],
}
const response = (data) => ({ data, model: 'parity-model', tokenUsage: { total_tokens: 10 } })

function contract(result) {
  const step = (type) => result.trace.find((item) => item.type === type)?.data
  return {
    success: result.success,
    intent: step('INTENT_ROUTED'),
    toolCall: step('TOOL_CALL') ?? null,
    toolArguments: step('TOOL_ARGUMENTS') ?? null,
    finalResponse: result.finalResponse,
    action: result.action ?? null,
  }
}

async function runBoth(createLlm, input = base, options = {}) {
  const legacy = await createLegacyMoriAgent(createLlm(), options).execute(input)
  const graph = await createMoriGraphAgent(createLlm(), options).execute(input)
  return { legacy, graph }
}

test('Legacy and Graph preserve the direct-response contract', async () => {
  const { legacy, graph } = await runBoth(() => async () => response({
    action: 'respond',
    reason: '无需外部事实',
    response: '你好，我在。',
    toolCall: null,
  }))
  assert.deepEqual(contract(graph), contract(legacy))
})

test('Legacy and Graph preserve tool arguments, response, and playback action', async () => {
  const createLlm = () => {
    let calls = 0
    return async () => ++calls === 1
      ? response({ action: 'tool', reason: '用户指定歌曲', response: null, toolCall: { name: 'search_music', arguments: { query: '言不由衷' } } })
      : response({ response: '找到了《言不由衷》。' })
  }
  const { legacy, graph } = await runBoth(createLlm, {
    ...base,
    userMessage: '我想听言不由衷',
    musicCatalog: [{ uri: 'spotify:track:target', title: '言不由衷', artist: '徐佳莹' }],
  }, { musicSearchMode: 'library' })
  assert.deepEqual(contract(graph), contract(legacy))
})
