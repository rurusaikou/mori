/**
 * Conversation Agent 的确定性语言规则。
 *
 * 这些规则同时服务 Scene Understanding 和 Intent Router，因此必须保持无状态：
 * 只识别 latestMessage 中明确出现的信号，不读取 History，也不决定是否执行 Tool。
 * 模糊表达仍交给 Scene、上下文和模型综合判断，避免关键词规则取代语义理解。
 */

const NEGATIVE_PLAYBACK_PATTERN = /(不想|不要|别|先别|没有|没在|并未).{0,6}(听|放|播放)|没有在听/u
const CONTROL_PATTERN = /^(暂停|停一下|继续播放|继续听|下一首|上一首|快进|后退)/u
const RECOMMEND_PATTERN = /(?:给我|帮我|你)?(?:随便)?(?:推|推荐)(?:一首|点|一些)?.{0,8}(歌|音乐)|有什么歌推荐|不知道.{0,5}听什么|安排.{0,5}(歌|音乐)|换一首|来一首|来点.{0,5}(歌|音乐)|想听(?:点|一些).{1,24}|想听.{0,10}(有节奏|律动|动感|带劲|高能|安静|舒缓|放松|明亮|开心|快乐|深沉|忧郁|伤感|原声|电子)/u
const SEARCH_PATTERN = /(?:帮我)?(?:找|搜|找点|搜点).{0,16}(歌|音乐|听的|《)|播放《|想听.{2,24}/u
const REFERENCE_CONTINUATION_PATTERN = /^(对啊|是啊|不是|所以|那|这|你(?:的)?意思是|然后|为什么|怎么会)/u

export function isNegativePlaybackStatement(text) {
  return NEGATIVE_PLAYBACK_PATTERN.test(text)
}

/** 返回当前消息中优先级最高的明确音乐动作；否定表达永远不是请求。 */
export function explicitMusicRequestKind(text) {
  if (isNegativePlaybackStatement(text)) return null
  if (CONTROL_PATTERN.test(text)) return 'CONTROL'
  if (RECOMMEND_PATTERN.test(text)) return 'RECOMMEND'
  if (SEARCH_PATTERN.test(text)) return 'SEARCH'
  return null
}

export function isReferenceContinuation(text) {
  return REFERENCE_CONTINUATION_PATTERN.test(text)
}
