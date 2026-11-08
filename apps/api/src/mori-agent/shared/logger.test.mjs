/** 验证 Capability 阶段日志对开发者可读，避免退回纯 JSON 串。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { formatCapabilityLogLine } from './logger.mjs'

test('formats a completed capability run as readable Chinese text', () => {
  const line = formatCapabilityLogLine({ timestamp: '2026-11-08T12:00:00.000Z', runId: 'run-1', capability: 'memory', promptVersion: 'memory-v0.1', stage: 'completed', latency: 238, output: { shouldCreate: false } })
  assert.match(line, /\[信息\] \[mori_agent\/memory\/completed\]/)
  assert.match(line, /执行成功，耗时 238ms/)
  assert.match(line, /输出：{"shouldCreate":false}/)
})

test('formats a failed capability stage as readable Chinese error', () => {
  const line = formatCapabilityLogLine({ timestamp: '2026-11-08T12:00:00.000Z', runId: 'run-2', capability: 'reflection', promptVersion: 'reflection-v0.1', stage: 'failed', latency: 4, error: '临时状态不得覆盖长期理解' })
  assert.match(line, /\[错误\]/)
  assert.match(line, /原因：临时状态不得覆盖长期理解/)
})
