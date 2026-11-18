/**
 * Intent 之前的场景理解层。它只整理当前对话事实和证据，不决定 Tool 或动作。
 * 目的：先回答“现在在聊什么、评价谁、是否承接上一句”，再讨论音乐意图。
 */
import { explicitMusicRequestKind, isReferenceContinuation } from './conversation-rules.mjs'

export function understandConversation(state) {
  const message = state.userMessage.trim()
  const recent = state.conversationHistory.slice(-6)
  const previousUserMessage = [...recent].reverse().find((item) => item.role === 'user')?.content ?? null
  const previousAssistantMessage = [...recent].reverse().find((item) => item.role === 'assistant')?.content ?? null
  const explicitMusicRequest = explicitMusicRequestKind(message) !== null
  const currentTrackReference = Boolean(state.playbackState.currentTrack) && /(这首|这歌|当前|现在这首|正在听)/u.test(message)
  const explicitMusicTopic = /(歌曲?|音乐|歌手|专辑|歌词|旋律|节奏|编曲|作词|作曲|播放|推荐)/u.test(message)
  const recentMusicTopic = recent.slice(-4).some((item) => /(歌曲?|音乐|歌手|专辑|歌词|播放|推荐|《[^》]+》)/u.test(item.content))
  const evaluationTarget = targetOf(message, currentTrackReference)
  const referenceRelation = referenceOf(message, previousUserMessage, previousAssistantMessage, recent)
  const scene = explicitMusicRequest
    ? 'MUSIC_REQUEST'
    : (currentTrackReference || (explicitMusicTopic && recentMusicTopic))
      ? 'MUSIC_CHAT'
      : explicitCompanionSignal(message)
        ? 'COMPANION'
        : 'SOCIAL_CHAT'

  return {
    scene,
    currentTopic: semanticTopic(message, previousAssistantMessage, referenceRelation, explicitMusicRequest),
    evaluationTarget,
    referenceRelation,
    musicEvidence: {
      explicitRequest: explicitMusicRequest,
      currentTrackReference,
      recentMusicTopic,
      sufficient: explicitMusicRequest || currentTrackReference || (explicitMusicTopic && recentMusicTopic),
    },
  }
}

/**
 * 将已校验的 State 整理成模型上下文。历史只用于解释本轮输入，不能覆盖 latestMessage。
 */
export function assembleConversationContext(state, understanding) {
  const history = deduplicateHistory(state.conversationHistory)
  const previousAssistant = [...history].reverse().find((item) => item.role === 'assistant')?.content ?? null
  const previousUser = [...history].reverse().find((item) => item.role === 'user')?.content ?? null
  return {
    latestMessage: state.userMessage,
    conversationFocus: {
      currentTopic: understanding.currentTopic,
      previousUserMessage: previousUser,
      previousAssistantMessage: previousAssistant,
      referenceContinuation: understanding.referenceRelation.type === 'CONTINUES_PREVIOUS' || isReferenceContinuation(state.userMessage),
    },
    recentHistory: history.slice(-6),
    emotionSignal: explicitEmotion(state.userMessage),
    worldState: state.worldState,
    playbackState: state.playbackState,
  }
}

/** 质量门只报告问题，不生成文案；具体 Bad Case 留在测试，避免业务代码积累场景话术。 */
export function responseQualityIssue(decision, state) {
  if (decision.action !== 'respond') return null
  if (isUnsupportedRandomRecommendationExplanation(state, decision.response)) {
    return '回复为随机推荐编造了输入和 Tool Result 中不存在的因果关系'
  }
  const recentAssistant = state.conversationHistory.filter((item) => item.role === 'assistant').slice(-3).map((item) => item.content)
  const repetitive = recentAssistant.some((previous) => isRepeatedMeaning(previous, decision.response))
  return repetitive ? '回复与最近三条 assistant 消息表达了高度相似的核心意思，没有推进对话' : null
}

function isUnsupportedRandomRecommendationExplanation(state, response) {
  const recent = state.conversationHistory.slice(-6)
  const askedWhyThisTrack = /为什么(?:是|选|推荐|给我).{0,12}/u.test(state.userMessage)
  const hadOpenRequest = recent.some((item) => item.role === 'user' && /(随便|随机|任意).{0,8}(推|推荐|来|放|听)/u.test(item.content))
  const recommendationWasShown = recent.some((item) => item.role === 'assistant' && /(给你选了|推荐|找到).{0,8}《/u.test(item.content))
  const inventedConnection = /(因为|主题|歌词|共鸣|心情|状态|适合你|符合你)/u.test(response)
  return askedWhyThisTrack && hadOpenRequest && recommendationWasShown && inventedConnection
}

function isRepeatedMeaning(previous, next) {
  const normalize = (value) => value.replaceAll(/[\s，。！？、,.!?…]/g, '')
  const left = normalize(previous); const right = normalize(next)
  if (!left || !right) return false
  if (left.includes(right) || right.includes(left)) return true
  const bothApology = /(抱歉|对不起|不好意思)/u.test(previous) && /(抱歉|对不起|不好意思)/u.test(next)
  if (bothApology && (/(啰嗦|人机|机械)/u.test(previous) || /(啰嗦|人机|机械)/u.test(next))) return true
  return ngramSimilarity(left, right) >= 0.58 || longestCommonRatio(left, right) >= 0.3
}

function longestCommonRatio(left, right) {
  const a = [...left]; const b = [...right]
  const previous = Array(b.length + 1).fill(0)
  let longest = 0
  for (const leftChar of a) {
    const current = Array(b.length + 1).fill(0)
    for (let index = 1; index <= b.length; index += 1) {
      if (leftChar === b[index - 1]) current[index] = previous[index - 1] + 1
      longest = Math.max(longest, current[index])
    }
    for (let index = 0; index < current.length; index += 1) previous[index] = current[index]
  }
  return longest >= 6 ? longest / Math.min(a.length, b.length) : 0
}

function ngramSimilarity(left, right) {
  const grams = (value) => new Set([...value].slice(0, -1).map((char, index) => `${char}${[...value][index + 1]}`))
  const a = grams(left); const b = grams(right)
  if (!a.size || !b.size) return 0
  const overlap = [...a].filter((gram) => b.has(gram)).length
  return overlap / new Set([...a, ...b]).size
}

function explicitEmotion(message) {
  const signals = [
    ['sad', /我(?:很|好)?(?:难过|伤心|低落|压抑)/u],
    ['tired', /我.{0,4}(?:很|好)?累|我累了/u],
    ['happy', /我(?:很|好)?(?:开心|高兴|快乐)/u],
    ['angry', /我(?:很|好)?(?:生气|愤怒|火大)/u],
  ]
  const match = signals.find(([, pattern]) => pattern.test(message))
  return match ? { label: match[0], confidence: 0.98, evidence: message } : null
}

function deduplicateHistory(history) {
  const seen = new Set()
  return history.filter((item) => {
    const key = `${item.role}:${item.content.replaceAll(/\s+/g, ' ').trim()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function explicitCompanionSignal(text) {
  return /我.{0,5}(难过|伤心|低落|压抑|孤独|好累|很累|累了|生气|开心)|想找你聊|陪我/u.test(text)
}
function targetOf(text, currentTrackReference) {
  if (/(为什么(?:你)?推荐|你推荐的|你说|你的意思|你理解|你弄错|Mori)/iu.test(text)) return 'MORI'
  if (currentTrackReference) return 'CURRENT_TRACK'
  const person = text.match(/([p{Script=Han}]{1,8}(?:姐|哥|老师|前辈|同事|朋友|她|他))/u)?.[1]
  return person ? `PERSON:${person}` : 'GENERAL'
}
function referenceOf(text, previousUserMessage, previousAssistantMessage, recent) {
  const shortAnswer = /^(一般|还行|对啊|是啊|不知道|嗯+|没有|没呢|还好|不太好|挺好)[。.!！?？…]*$/u.test(text)
  const previousWasQuestion = Boolean(previousAssistantMessage && /[?？]|怎么样|吗|呢|什么|如何|要不要/u.test(previousAssistantMessage))
  if ((shortAnswer && previousWasQuestion) || isReferenceContinuation(text)) {
    return { type: 'CONTINUES_PREVIOUS', refersTo: previousAssistantMessage ?? previousUserMessage ?? recent.at(-1)?.content ?? null }
  }
  return { type: 'NEW_TOPIC', refersTo: null }
}

function semanticTopic(text, previousAssistantMessage, referenceRelation, explicitMusicRequest) {
  if (explicitMusicRequest) return '音乐查找、推荐或播放请求'
  if (/日语课|日语学习|上完.{0,4}课/u.test(text)) return '日语课程与刚结束的学习经历'
  if (/(像人机|说话方式|太啰嗦|机械)/u.test(text)) return '对 Mori 对话方式的反馈'
  if (/(没有|没在).{0,5}(听歌|听音乐|播放)/u.test(text)) return '当前没有播放音乐'
  if (referenceRelation.type === 'CONTINUES_PREVIOUS') return `回应上一轮问题：${topicHint(previousAssistantMessage)}`
  if (/(前辈|同事|朋友|老师|姐姐|哥哥|她|他)/u.test(text)) return '人物相关的日常分享'
  if (/[?？]/u.test(text)) return '用户当前提出的问题'
  return '用户当前的日常分享'
}
function topicHint(value) {
  if (!value) return '上一轮话题'
  if (/今天过得怎么样|今天怎么样/u.test(value)) return '今天过得怎么样'
  return value.replaceAll(/\s+/g, ' ').slice(0, 36)
}
