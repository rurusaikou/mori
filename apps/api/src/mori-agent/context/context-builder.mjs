import { DEFAULT_CONTEXT_BUDGET, clipContextText, fitHistoryToBudget, measureContext } from './context-budget.mjs'

/** Build layered system context while keeping the actual conversation as role messages. */
export function buildMoriContext({ persona, state, relevantMemory, budget = DEFAULT_CONTEXT_BUDGET }) {
  const system = [
    clipContextText(persona.trim(), budget.personaChars),
    clipContextText(buildRuntimeContext(state), budget.runtimeChars),
    clipContextText(buildMemoryContext(relevantMemory), budget.memoryChars),
    clipContextText('最近对话中的方括号音乐快照是系统提供的事实注记，不是用户说出的文字。以最新用户消息和最近一条 assistant 回复为主要交流位置；不要把未验证的推断写成事实。', budget.instructionsChars),
  ].filter(Boolean).join('\n\n')

  const history = fitHistoryToBudget(state.conversationHistory.map((message) => ({
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: `${message.content}${formatMessageMusicContext(message)}`,
  })), budget)
  const latestUserMessage = clipContextText(state.userMessage, budget.latestMessageChars)
  const messages = [{ role: 'system', content: system }, ...history, { role: 'user', content: latestUserMessage }]
  return {
    system,
    messages,
    budget: measureContext(messages),
  }
}

function buildRuntimeContext(state) {
  const lines = ['【当前运行环境】', `当前时间：${new Date().toISOString()}`, `时区：${state.worldState.timeZone}`]
  lines.push(`播放状态：${state.playbackState.status}`)
  lines.push(`当前歌曲：${describeTrack(state.playbackState.currentTrack)}`)
  lines.push(`上一首：${describeTrack(state.playbackState.previousTrack)}`)
  lines.push(`播放能力：${state.playbackState.availability ?? 'ready'}`)
  if (state.conversationFocus) lines.push(`最近讨论的歌曲：${describeTrack(state.conversationFocus)}`)
  return lines.join('\n')
}

function buildMemoryContext(memory) {
  const matches = (memory?.matches ?? []).slice(0, 5)
  const profile = (memory?.tasteProfile ?? []).slice(0, 4)
  const associations = (memory?.associations ?? []).slice(0, 4)
  if (!matches.length && !profile.length && !associations.length) return '【相关记忆】本轮没有召回到相关记忆。'
  const lines = ['【相关记忆，仅作有来源的背景】']
  for (const item of matches) {
    const confirmed = item.status === 'confirmed' || item.status === 'CONFIRMED'
    const provenance = [
      `类型=${item.kind ?? 'unknown'}`, `状态=${confirmed ? 'confirmed' : 'candidate'}`,
      `来源=${item.source ?? 'unknown'}`, `匹配=${item.matchReason ?? 'unknown'}`,
      Number.isFinite(item.confidence) ? `置信度=${item.confidence}` : null,
    ].filter(Boolean).join('；')
    const track = item.track ? `；关联歌曲=${item.track.title} — ${item.track.artist}` : ''
    const evidence = formatEvidence(item.evidence)
    lines.push(`- [${provenance}] ${clip(item.content, 280)}${item.context ? `（${clip(item.context, 100)}）` : ''}${track}${evidence ? `；证据=${evidence}` : ''}`)
  }
  for (const item of profile) lines.push(`- [音乐偏好派生；证据 ID=${(item.evidenceIds ?? []).join(',') || 'none'}] ${item.dimension} ${item.stance}${item.attribute ? ` ${item.attribute}` : ''}（置信度 ${item.confidence ?? '未知'}）：${clip(item.summary ?? '', 220)}`)
  for (const item of associations) lines.push(`- [关联索引，不单独作为事实] ${item.relation ?? '相关'} ${item.source?.label ?? item.source?.key ?? ''} → ${item.target?.label ?? item.target?.key ?? ''}（权重 ${item.weight ?? '未知'}）`)
  return lines.join('\n')
}

function formatEvidence(value) {
  if (!Array.isArray(value)) return ''
  return value.slice(0, 3).map((item) => typeof item === 'string' ? item : item?.content ?? item?.summary ?? '').filter(Boolean).map((item) => clip(item, 120)).join('；')
}

function formatMessageMusicContext(message) {
  const discussed = message.discussionTrack
  const played = message.playbackTrack ?? message.track
  if (!discussed && !played) return ''
  const parts = []
  if (played) parts.push(`发言时播放：${describeTrack(played)}`)
  if (discussed) parts.push(`当时讨论：${describeTrack(discussed)}`)
  return `\n[音乐上下文快照：${parts.join('；')}]`
}

function describeTrack(track) {
  return track ? `${track.title} — ${track.artist}` : '无'
}

function clip(value, maxLength) {
  return clipContextText(String(value ?? '').replaceAll(/\s+/gu, ' ').trim(), maxLength, '…')
}