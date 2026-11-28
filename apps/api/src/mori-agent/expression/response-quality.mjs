/**
 * 表达质量门：检查回复是否重复，或是否为随机推荐编造了不存在的因果关系。
 * 这里只判断“表达能否发出”，不参与场景识别、意图判断或 Tool 选择。
 */
export function responseQualityIssue(decision, state) {
  if (decision.action !== 'respond') return null
  const playbackIssue = playbackFactIssue(decision.response, state)
  if (playbackIssue) return playbackIssue
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

export function playbackFactIssue(response, state) {
  const value = String(response ?? '')
  const status = state.playbackState?.status
  if (status === 'playing' && claimsPlaybackPaused(value)) {
    return '当前播放器仍在播放，回复不能声称正在暂停或已经暂停；保留原本的情绪承接，只修正播放状态表述'
  }
  // direct-response 分支没有客户端动作，任何“已经切歌”都不可能由本轮确认。
  if (claimsTrackChanged(value)) {
    return '本轮没有客户端切歌动作，回复不能声称正在切歌或已经切歌；保留原本的对话内容，只修正动作表述'
  }
  if (claimsPlaybackStarted(value)) {
    return '本轮没有客户端播放动作，回复不能声称已经为用户启动了新音乐'
  }
  return null
}

export function safePlaybackFallback(issue) {
  if (issue.includes('暂停')) return '音乐还在继续。你想安静一下的话，告诉我一声，我可以替你暂停。'
  if (issue.includes('启动了新音乐')) return '我还没有开始新的播放。你想听什么，可以直接告诉我。'
  return '音乐还没有切换。你想换一首的话，告诉我你现在想听什么。'
}

export function safeResponseFallback(issue) {
  if (issue.includes('高度相似')) return '我刚才重复回应了。你刚提到的内容，我先不替你下结论，继续听你说。'
  if (issue.includes('推荐理由')) return '这首歌的推荐理由我没有足够依据，刚才不该说得那么确定。'
  return '我刚才的回复没有贴合你刚说的内容。你愿意告诉我最想聊哪一部分吗？'
}

function claimsPlaybackPaused(value) {
  if (/(?:没有|没|尚未|还未|还没|不能|无法|不会|并未).{0,10}暂停/u.test(value)) return false
  return /(?:已经|刚刚|刚才)(?:为你|帮你)?暂停(?:了|播放|音乐)?/u.test(value)
    || /已暂停(?:了|播放|音乐)?/u.test(value)
    || /正在(?:为你|帮你)?暂停/u.test(value)
    || /(?:音乐|歌曲|播放|它).{0,4}(?:已经|已)?暂停(?:了|成功|下来)/u.test(value)
    || /暂停(?:好了|完成了?|成功了?|下来了)/u.test(value)
}

function claimsTrackChanged(value) {
  if (/(?:没有|没|尚未|还未|还没|不能|无法|不会|并未).{0,10}(?:切到|换到)/u.test(value)) return false
  return /(?:已经|刚刚|刚才)(?:为你|帮你)?(?:切到|换到).{0,12}(?:下一首|上一首)/u.test(value)
    || /已(?:切到|换到).{0,12}(?:下一首|上一首)/u.test(value)
    || /正在(?:为你|帮你)?(?:切歌|切换|切到|换到)/u.test(value)
    || /(?:下一首|上一首).{0,6}(?:已经|已)开始播放/u.test(value)
}

function claimsPlaybackStarted(value) {
  if (/(?:没有|没|尚未|还未|还没|不能|无法|并未).{0,12}(?:播放|开始播放)/u.test(value)) return false
  return /(?:已经|已|刚刚)(?:为你|给你|帮你)?(?:播放|放)(?:了|上了|.{1,16}(?:了|起来了))/u.test(value)
    || /(?:已经|已)(?:为你|给你|帮你)?.{0,10}开始播放/u.test(value)
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
