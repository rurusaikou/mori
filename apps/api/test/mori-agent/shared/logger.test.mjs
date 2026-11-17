/** 验证 Capability 阶段日志对开发者可读，避免退回纯 JSON 串。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { formatCapabilityLogLine } from '../../../src/mori-agent/shared/logger.mjs'

test('formats a completed capability run as readable Chinese text', () => {
  const line = formatCapabilityLogLine({ source: 'test', timestamp: '2026-11-08T12:00:00.000Z', runId: 'run-1', capability: 'memory', promptVersion: 'memory-v0.1', stage: 'completed', latency: 238, output: { shouldCreate: false } })
  assert.match(line, /\[测试\] \[信息\] \[mori_agent\/memory\/completed\]/)
  assert.match(line, /执行成功，耗时 238ms/)
  assert.match(line, /输出：{"shouldCreate":false}/)
})

test('formats a failed capability stage as readable Chinese error', () => {
  const line = formatCapabilityLogLine({ timestamp: '2026-11-08T12:00:00.000Z', runId: 'run-2', capability: 'reflection', promptVersion: 'reflection-v0.1', stage: 'failed', latency: 4, error: '临时状态不得覆盖长期理解' })
  assert.match(line, /\[错误\]/)
  assert.match(line, /原因：临时状态不得覆盖长期理解/)
})

test('formats agent tool stages as readable Chinese text', () => {
  const line = formatCapabilityLogLine({ timestamp: '2026-11-09T12:00:00.000Z', runId: 'agent-1', capability: 'conversation_agent', promptVersion: 'mori-agent-v0.2', model: 'test', stage: 'agent_tool_call', name: 'search_memory' })
  assert.match(line, /Agent 选择调用 Tool/)
  assert.match(line, /search_memory/)
})

test('marks runtime capability logs separately from test logs', () => {
  const line = formatCapabilityLogLine({ source: 'runtime', timestamp: '2026-11-17T12:00:00.000Z', runId: 'real-1', capability: 'conversation_agent', promptVersion: 'mori-agent-v0.6', stage: 'agent_final_response', response: '真实回复' })
  assert.match(line, /\[真实\] \[信息\]/)
  assert.doesNotMatch(line, /\[测试\]/)
})

test('marks playground and lab logs as debug', () => {
  const line = formatCapabilityLogLine({ source: 'debug', timestamp: '2026-11-17T12:00:00.000Z', runId: 'debug-1', capability: 'conversation_agent', promptVersion: 'mori-agent-v0.6', stage: 'agent_input' })
  assert.match(line, /\[调试\] \[信息\]/)
})
