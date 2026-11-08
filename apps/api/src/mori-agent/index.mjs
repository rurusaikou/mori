/**
 * 作用：在 API composition 中注册五个彼此隔离的 Capability，并提供 Lab 默认示例。
 * 输入：LLM transport 配置。
 * 输出：可按名称访问的 Capability Registry；这里不负责模块编排或自动串联。
 */
import { createCapabilityLlm } from './shared/llm.mjs'
import { createMemoryCapability } from './capabilities/memory/memory.service.mjs'
import { createUnderstandingCapability } from './capabilities/understanding/understanding.service.mjs'
import { createConnectionCapability } from './capabilities/connection/connection.service.mjs'
import { createReflectionCapability } from './capabilities/reflection/reflection.service.mjs'
import { createCompanionshipCapability } from './capabilities/companionship/companionship.service.mjs'

export function createCapabilityRegistry(options = {}) {
  const llm = createCapabilityLlm(options)
  return {
    memory: createMemoryCapability(llm), understanding: createUnderstandingCapability(llm),
    connection: createConnectionCapability(llm), reflection: createReflectionCapability(llm),
    companionship: createCompanionshipCapability(llm),
  }
}

export const CAPABILITY_EXAMPLES = {
  memory: { userMessage: '我第一次听这首歌是在毕业旅行。' },
  understanding: { userMessage: '最近越来越喜欢这种安静的歌。' },
  connection: { current: { message: '现在觉得一个人在外面生活其实也挺自由。' }, candidates: [{ id: 'm1', content: '一个人在国外生活有时候挺孤独。' }] },
  reflection: { previousBelief: { content: '用户喜欢安静音乐。', confidence: 0.8 }, newEvidence: { content: '我只是工作的时候喜欢安静，平时还是很喜欢摇滚。' } },
  companionship: { userMessage: '今天不想讲话，就陪我听吧。' },
}
