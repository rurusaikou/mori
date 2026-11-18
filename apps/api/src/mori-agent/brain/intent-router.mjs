/**
 * 对明确表达做确定性路由，避免小模型仅凭“听/歌/播放”等关键词触发有副作用的 Tool。
 * 模糊聊天仍交给模型理解；否定、推荐和控制等高风险边界由代码兜底。
 */
import { explicitMusicRequestKind, isNegativePlaybackStatement } from '../perception/conversation-rules.mjs'

export function routeIntent(message, playbackState, understanding) {
  const text = message.trim()
  if (/^说善恶[。.!！?？]*$/u.test(text)) {
    return { ...intent('CHAT', 0.98, '当前输入疑似错字，不能回退到旧话题'), ambiguity: { needsClarification: true, possibleMeaning: '说什么' } }
  }
  if (isNegativePlaybackStatement(text)) {
    return intent('CHAT', 0.99, '用户在否定或陈述播放状态，不是找歌请求')
  }
  if (/(为什么(?:你)?推荐|你推荐的.{0,8}(不|错|不合适)|你理解错|你弄错|不是这个意思|别再推荐|这首不适合|这首我不喜欢)/u.test(text)) {
    return intent('FEEDBACK', 0.94, '用户正在纠正或评价 Mori 的理解与推荐')
  }
  // latestMessage 的明确意图优先于 Scene。即使场景层误判，也不能漏掉本轮音乐请求。
  const musicRequestKind = explicitMusicRequestKind(text)
  if (musicRequestKind) return explicitMusicIntent(musicRequestKind)
  // 没有音乐证据时，音乐先验不得把普通“喜欢、说、听”等词解释成音乐动作。
  if (understanding?.scene === 'SOCIAL_CHAT' || understanding?.scene === 'COMPANION') {
    return intent('CHAT', 0.96, `当前场景为 ${understanding.scene}，没有充分音乐意图证据`)
  }
  if (/现在(是|放的|听的).{0,4}(什么|哪首)|当前.{0,3}(歌曲|音乐)/u.test(text)) {
    return intent('CHAT', 0.96, `当前播放事实可直接回答（${playbackState.status}）`)
  }
  return intent('CHAT', 0.6, '没有明确的搜索、推荐或控制指令')
}

function explicitMusicIntent(kind) {
  const reasons = {
    CONTROL: '当前消息明确要求播放控制',
    RECOMMEND: '当前消息明确要求音乐推荐',
    SEARCH: '当前消息明确要求查找音乐',
  }
  return intent(kind, kind === 'CONTROL' ? 0.99 : 0.98, reasons[kind])
}

function intent(name, confidence, reason) { return { intent: name, confidence, reason } }

export function enforceIntentBoundary(decision, routed, tools) {
  // Router 是本轮 Intent 的唯一真值。Decision 只能选择动作，不能二次改写 Intent。
  const normalized = { ...decision, intent: routed.intent }
  if (routed.ambiguity?.needsClarification) {
    return { action: 'respond', intent: routed.intent, conversationMove: 'CLARIFY', reason: routed.reason, response: `我不太确定这句话。你是想说“${routed.ambiguity.possibleMeaning}”吗？`, toolCall: null }
  }
  // CHAT/FEEDBACK/CONTROL 不能被模型仅凭音乐关键词升级为找歌或推荐。
  // CONTROL 未来应进入独立播放控制 Tool，在该 Tool 落地前也不能错误借道 search_music。
  if (['CHAT', 'FEEDBACK', 'CONTROL'].includes(routed.intent) && ['search_music', 'recommend_music'].includes(normalized.toolCall?.name)) {
    const response = routed.intent === 'CONTROL'
      ? '我明白你想控制播放，但这次没有执行找歌或推荐。'
      : routed.confidence >= 0.95 ? '嗯，现在没有音乐在播放。你想安静待一会儿，还是聊点别的？' : '我在听，你可以继续说。'
    return { action: 'respond', intent: routed.intent, conversationMove: 'ACKNOWLEDGE', reason: routed.reason, response, toolCall: null }
  }
  if (normalized.intent === 'RECOMMEND' && normalized.action === 'tool' && tools.recommend_music) {
    return { ...normalized, toolCall: { ...normalized.toolCall, name: 'recommend_music' } }
  }
  if (normalized.intent === 'SEARCH' && normalized.action === 'tool' && normalized.toolCall?.name === 'recommend_music' && tools.search_music) {
    return { ...normalized, toolCall: { ...normalized.toolCall, name: 'search_music' } }
  }
  return normalized
}

/**
 * Router 已确定音乐意图时，将模型的纯文本回退修正为对应 Tool 动作。
 * 这里集中维护查询抽取边界，避免编排器理解业务语义。
 */
export function ensureRoutedAction(decision, routed, tools, state) {
  if (decision.action === 'tool') {
    if (routed.intent !== 'RECOMMEND' || decision.toolCall?.name !== 'recommend_music') return decision
    return withRecommendationExclusions(decision, state)
  }
  if (routed.intent === 'RECOMMEND' && tools.recommend_music) {
    return withRecommendationExclusions({ action: 'tool', intent: 'RECOMMEND', conversationMove: 'ANSWER', reason: routed.reason, response: null, toolCall: { name: 'recommend_music', arguments: { query: recommendationQuery(state.userMessage), excludeUris: [] } } }, state)
  }
  if (routed.intent === 'SEARCH' && tools.search_music) {
    const query = searchQuery(state.userMessage)
    if (query) return { action: 'tool', intent: 'SEARCH', conversationMove: 'ANSWER', reason: routed.reason, response: null, toolCall: { name: 'search_music', arguments: { query, excludeUris: [] } } }
  }
  return decision
}

function withRecommendationExclusions(decision, state) {
  const recentAssistantText = state.conversationHistory
    .filter((item) => item.role === 'assistant')
    .slice(-8)
    .map((item) => item.content)
    .join('\n')
  const recentUris = state.musicCatalog
    .filter((track) => recentAssistantText.includes(`《${track.title}》`))
    .map((track) => track.uri)
  const exclusions = new Set([
    ...(decision.toolCall.arguments.excludeUris ?? []),
    ...(state.currentTrack?.uri ? [state.currentTrack.uri] : []),
    ...recentUris,
  ])
  return { ...decision, toolCall: { ...decision.toolCall, arguments: { ...decision.toolCall.arguments, excludeUris: [...exclusions] } } }
}

function searchQuery(text) {
  const query = text.replace(/[《》「」“”]/gu, ' ').replace(/(?:我)?(?:想听|要听|播放|帮我找|帮我搜|搜索|查找|给我放)/gu, ' ').replace(/(?:的)?(?:歌曲?|音乐)$/u, ' ').replace(/\s+/gu, ' ').trim()
  return query.length > 1 ? query : null
}

function recommendationQuery(text) {
  const traits = text.match(/有节奏|节奏感|律动|动感|带劲|有能量|高能|安静|舒缓|放松|轻柔|明亮|开心|快乐|深沉|忧郁|伤感|原声|自然|电子|现代制作/gu)
  return traits ? [...new Set(traits)].join(' ') : ''
}
