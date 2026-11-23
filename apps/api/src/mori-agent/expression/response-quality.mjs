/**
 * 表达质量门：检查回复是否重复，或是否为随机推荐编造了不存在的因果关系。
 * 这里只判断“表达能否发出”，不参与场景识别、意图判断或 Tool 选择。
 */
export function responseQualityIssue(decision, state) {
  if (decision.action !== 'respond') return null
  if (isUnsupportedRandomRecommendationExplanation(state, decision.response)) {
    return '回复为随机推荐编造了输入和 Tool Result 中不存在的因果关系'
  }
  const recentAssistant = state.conversationHistory
    .filter((item) => item.role === 'assistant')
    .slice(-3)
    .map((item) => item.content)
  const repetitive = recentAssistant.some((previous) => isRepeatedMeaning(previous, decision.response))
  return repetitive ? '回复与最近三条 assistant 消息表达了高度相似的核心意思，没有推进对话' : null
}

export function enforcePlaybackFact(response, state) {
  const value = String(response ?? '')
  const status = state.playbackState?.status
  if (status === 'playing' && /(已经|已|现在)?暂停(?:了|播放)?/u.test(value)) {
    return '我还没有暂停播放。'
  }
  // direct-response 分支没有客户端动作，任何“已经切歌”都不可能由本轮确认。
  if (/(已经|已|现在)?(?:切到|换到).{0,12}(下一首|上一首)/u.test(value)) {
    return '我还没有完成切歌。'
  }
  return value
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
  const left = normalize(previous)
  const right = normalize(next)
  if (!left || !right) return false
  if (left.includes(right) || right.includes(left)) return true
  const bothApology = /(抱歉|对不起|不好意思)/u.test(previous) && /(抱歉|对不起|不好意思)/u.test(next)
  if (bothApology && (/(啰嗦|人机|机械)/u.test(previous) || /(啰嗦|人机|机械)/u.test(next))) return true
  return ngramSimilarity(left, right) >= 0.58 || longestCommonRatio(left, right) >= 0.3
}

function longestCommonRatio(left, right) {
  const a = [...left]
  const b = [...right]
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
  const grams = (value) => {
    const characters = [...value]
    return new Set(characters.slice(0, -1).map((char, index) => `${char}${characters[index + 1]}`))
  }
  const a = grams(left)
  const b = grams(right)
  if (!a.size || !b.size) return 0
  const overlap = [...a].filter((gram) => b.has(gram)).length
  return overlap / new Set([...a, ...b]).size
}
