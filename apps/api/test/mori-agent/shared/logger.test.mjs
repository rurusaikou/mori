/** 验证 Capability 阶段日志对开发者可读，避免退回纯 JSON 串。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { formatCapabilityLogLine } from '../../../src/mori-agent/shared/logger.mjs'

test('formats a completed capability run as readable Chinese text', () => {
  const line = formatCapabilityLogLine({ source: 'test', timestamp: '2026-11-08T12:00:00.000Z', runId: 'run-1', capability: 'memory', promptVersion: 'memory-v0.2', stage: 'completed', latency: 238, output: { facts: [], moments: [] } })
  assert.match(line, /\[测试\] \[信息\] \[mori_agent\/memory\/completed\]/)
  assert.match(line, /执行成功，耗时 238ms/)
  assert.match(line, /输出：{"facts":\[\],"moments":\[\]}/)
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

test('makes deterministic response fact fallbacks observable', () => {
  const line = formatCapabilityLogLine({ timestamp: '2026-11-25T11:13:16.000Z', runId: 'agent-repair-1', capability: 'conversation_agent', promptVersion: 'mori-agent-v1.0', stage: 'agent_response_fact_fallback', issue: '未确认播放状态变化', rejectedResponse: '音乐已经暂停了。', response: '音乐还在继续。' })
  assert.match(line, /自然语言安全兜底/)
  assert.match(line, /音乐已经暂停了/)
  assert.match(line, /音乐还在继续/)
})

test('marks pending playback control as a client action plan instead of completed execution', () => {
  const toolLine = formatCapabilityLogLine({ timestamp: '2026-11-23T09:39:39.000Z', runId: 'agent-control-1', capability: 'conversation_agent', promptVersion: 'mori-agent-v1.0', stage: 'agent_tool_result', name: 'playback_control', result: { status: 'PENDING', operation: 'playback_control', command: 'NEXT' } })
  assert.match(toolLine, /待客户端执行的动作计划/)
  assert.match(toolLine, /尚未完成真实操作/)

  const completedLine = formatCapabilityLogLine({ timestamp: '2026-11-23T09:39:43.000Z', runId: 'agent-control-1', capability: 'conversation_agent', promptVersion: 'mori-agent-v1.0', stage: 'completed', latency: 15383, output: { finalResponse: '正在切换。', plannedAction: { type: 'playback_control', command: 'NEXT' } } })
  assert.match(completedLine, /服务端决策与动作规划完成/)
  assert.match(completedLine, /仍待客户端执行和确认/)
})

test('formats the client playback result under the original Agent run', () => {
  const line = formatCapabilityLogLine({ source: 'runtime', timestamp: '2026-11-23T09:39:50.000Z', runId: 'agent-control-1', capability: 'conversation_agent', promptVersion: 'mori-agent-v1.0', stage: 'agent_client_action_failed', command: 'NEXT', status: 'FAILED', error: 'Spotify 未确认歌曲已经切换' })
  assert.match(line, /Run agent-control-1/)
  assert.match(line, /\[错误\]/)
  assert.match(line, /客户端播放动作执行失败/)
  assert.match(line, /Spotify 未确认歌曲已经切换/)
})

test('distinguishes a planned response from the user-visible client result', () => {
  const base = { source: 'runtime', timestamp: '2026-11-26T12:50:35.000Z', runId: 'agent-two-phase', capability: 'conversation_agent', promptVersion: 'mori-agent-v1.1' }
  const planned = formatCapabilityLogLine({ ...base, stage: 'agent_planned_response', response: '好，我先试着切到下一首，等播放器确认一下。', plannedAction: { type: 'playback_control', command: 'NEXT' } })
  const visible = formatCapabilityLogLine({ ...base, stage: 'agent_user_visible_response', response: '切到下一首。', status: 'COMPLETED', currentTrack: { uri: 'spotify:track:b', title: 'B', artist: '歌手 B' } })
  assert.match(planned, /非用户最终回复/)
  assert.match(visible, /用户最终看到的回复/)
  assert.match(visible, /切到下一首/)
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

test('summarizes large agent input instead of logging memory contents', () => {
  const line = formatCapabilityLogLine({
    source: 'runtime',
    timestamp: '2026-11-18T12:00:00.000Z',
    runId: 'real-2',
    capability: 'conversation_agent',
    promptVersion: 'mori-agent-v0.6',
    stage: 'agent_input',
    userMessage: '随便听首歌吧',
    currentTrack: null,
    playbackState: { status: 'none', currentTrack: null },
    conversationHistory: [{ role: 'user', content: '旧消息正文' }],
    fakeMemory: [{ id: 'm1', content: '不应写入日志的记忆正文' }],
  })
  assert.match(line, /"conversationHistoryCount":1/)
  assert.match(line, /"fakeMemoryCount":1/)
  assert.doesNotMatch(line, /不应写入日志/)
  assert.doesNotMatch(line, /旧消息正文/)
})

test('formats context, decision, response and archive diagnostics as explicit stages', () => {
  const base = { source: 'runtime', timestamp: '2026-11-26T01:00:00.000Z', runId: 'run-flow', requestId: 'request-flow', exchangeId: 'exchange-flow', capability: 'conversation_agent', promptVersion: 'mori-agent-v1.1' }
  const stages = [
    ['agent_context_preparation_started', /开始并行准备/],
    ['agent_relevant_memory_prepared', /Relevant Memory 准备完成/],
    ['agent_decision_model_call', /开始调用 Decision Model/],
    ['agent_decision_validated', /Decision 校验通过/],
    ['agent_direct_response_selected', /不进入 Tool Execution/],
    ['agent_response_quality_checked', /质量门/],
    ['agent_conversation_archived', /Conversation Store/],
    ['agent_post_turn_memory_scheduled', /异步调度/],
  ]
  for (const [stage, expected] of stages) {
    const line = formatCapabilityLogLine({ ...base, stage, passed: true })
    assert.match(line, expected)
  }
})

test('summarizes assembled context without dumping conversation history or full state facts', () => {
  const line = formatCapabilityLogLine({
    source: 'runtime', timestamp: '2026-11-26T01:00:00.000Z', runId: 'run-summary', capability: 'conversation_agent', promptVersion: 'mori-agent-v1.1', stage: 'agent_context_assembly',
    latestMessage: '我很迷茫',
    conversationHistory: [{ role: 'assistant', content: '不应重复写入摘要的长历史回复' }],
    understanding: { scene: 'DAILY_CHAT' }, topic: '当前心情', communicativeAct: 'SHARE_UPDATE',
    playbackState: { status: 'none', availability: 'needs-auth', currentTrack: null, previousTrack: null },
    targetTrack: null, trackResolution: { source: 'NO_REFERENCE', resolved: false },
    conversationState: { facts: [{ subject: '用户', relation: '喜欢', object: '某首歌', evidence: '旧事实正文' }] },
    relevantMemory: { source: 'SERVER_MEMORY', matches: [], tasteProfile: [], associations: [] },
  })
  assert.match(line, /"historyCount":1/)
  assert.match(line, /"scene":"DAILY_CHAT"/)
  assert.match(line, /"matchCount":0/)
  assert.doesNotMatch(line, /不应重复写入摘要/)
  assert.doesNotMatch(line, /旧事实正文/)
})
