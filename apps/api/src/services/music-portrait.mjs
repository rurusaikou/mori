/**
 * 作用：把四项标准化音乐维度交给 LLM，生成克制、可读的音乐画像叙事。
 * 输入：MusicPreferenceProfile、服务端 LLM 配置；不接收歌曲列表或用户身份。
 * 输出：符合 JSON Schema 的 MusicProfileInsight；未配置或生成失败时返回 null。
 */
const MUSIC_INSIGHT_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', minLength: 25, maxLength: 45 },
    traits: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['name', 'description'],
        additionalProperties: false,
      },
    },
    listeningStyle: { type: 'string', minLength: 40, maxLength: 70 },
    keywords: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: { type: 'string' },
    },
  },
  required: ['summary', 'traits', 'listeningStyle', 'keywords'],
  additionalProperties: false,
}

export function createMusicPortraitService({ logInfo, logError, fetchImpl = fetch, env = process.env }) {
  return async function generateMusicPortrait(profile) {
    const endpoint = env.MORI_LLM_ENDPOINT?.trim()
    const apiKey = env.MORI_LLM_API_KEY?.trim()
    const model = env.MORI_LLM_MODEL?.trim()
    if (!endpoint || !apiKey || !model) {
      logInfo('music_preference', 'portrait_fallback', { reason: 'llm_not_configured' })
      return null
    }

    try {
      const scores = profileScores(profile)
      logInfo('music_preference', 'portrait_generation_started', { model, ...scores })
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0.55,
          max_output_tokens: 900,
          input: [
            { role: 'system', content: systemPrompt() },
            { role: 'user', content: inputPrompt(scores) },
          ],
          text: {
            format: {
              type: 'json_schema',
              name: 'music_profile_insight',
              schema: MUSIC_INSIGHT_SCHEMA,
            },
          },
        }),
        signal: AbortSignal.timeout(30_000),
      })
      const result = await response.json().catch(() => null)
      if (!response.ok) throw new Error(result?.error?.message || `LLM 请求失败（${response.status}）`)
      if (result?.status && result.status !== 'completed') {
        const detail = result?.incomplete_details?.reason || result?.error?.message
        throw new Error(`LLM 响应未完成（${result.status}${detail ? `：${detail}` : ''}）`)
      }
      const content = extractOutputText(result)
      if (typeof content !== 'string') throw new Error('LLM 未返回画像内容')
      const insight = validateInsight(JSON.parse(content))
      logInfo('music_preference', 'portrait_generated', {
        model,
        summary: insight.summary,
        traits: insight.traits.map((trait) => trait.name),
        keywords: insight.keywords,
      })
      return insight
    } catch (error) {
      logError('music_preference', 'portrait_generation_failed', error)
      return null
    }
  }
}

function systemPrompt() {
  return `你是一名「音乐偏好分析师」。请根据用户长期听歌数据计算出的 4 个音乐维度，生成一份简洁、自然、用户容易理解的「音乐画像」。

分析原则：
1. 不要简单逐项复述数值，需要结合四个维度之间的关系进行综合判断。
2. 低能量与高律动的组合更接近松弛、轻盈、有 Groove，不要直接判断为“喜欢安静的歌”。
3. 高能量与偏内省不等于快乐，可能代表情绪浓度高、爆发力强。
4. 重点分析用户“如何感受音乐”，而不仅仅是喜欢什么音乐类型。
5. 像 Spotify Wrapped 的音乐洞察，而不是心理测试。
6. 不使用“根据数据显示”“你的数值表明”等机械表达。
7. 不把音乐偏好上升为人格、心理状态或性格诊断。
8. 避免绝对判断，使用“更偏向”“通常会被……吸引”等表达。
9. 不重复四个维度名称，要把数据翻译成真实的听觉体验。
10. 语言温柔、克制、有一点 editorial 感，但不要过度文艺。
11. summary 必须是综合结论，而不是四个指标的罗列。

严格遵守给定 JSON Schema：summary 为 25～45 字；traits 恰好 3 项；listeningStyle 为 40～70 字；keywords 恰好 3 项。只输出 Schema 要求的内容。`
}

function inputPrompt(scores) {
  return `请分析以下长期听歌维度：
- 节奏倾向：${scores.rhythm} / 100（0 更舒缓慢速，100 更快速强节奏）
- 能量倾向：${scores.energy} / 100（0 安静柔和，100 强烈饱满）
- 律动倾向：${scores.groove} / 100（0 自由氛围化，100 节拍明显、身体感强）
- 情绪倾向：${scores.mood} / 100（0 内省深沉，100 明亮轻快）`
}

function profileScores(profile) {
  return {
    rhythm: profile.averageBpm === null ? 50 : Math.round(clamp((profile.averageBpm - 60) / 100) * 100),
    energy: score(profile.energy),
    groove: score(profile.danceability),
    mood: score(profile.valence),
  }
}

function extractOutputText(result) {
  if (typeof result?.output_text === 'string') return result.output_text
  for (const item of result?.output ?? []) {
    if (item?.type !== 'message') continue
    for (const part of item.content ?? []) {
      if (part?.type === 'output_text' && typeof part.text === 'string') return part.text
    }
  }
  return null
}

function validateInsight(value) {
  if (!value || typeof value !== 'object') throw new Error('LLM 音乐画像不是对象')
  if (!validText(value.summary, 25, 45)) throw new Error('LLM summary 长度或格式无效')
  if (!validText(value.listeningStyle, 40, 70)) throw new Error('LLM listeningStyle 长度或格式无效')
  if (!Array.isArray(value.traits) || value.traits.length !== 3 || value.traits.some((trait) => !validText(trait?.name, 2, 16) || !validText(trait?.description, 4, 60))) {
    throw new Error('LLM traits 格式无效')
  }
  if (!Array.isArray(value.keywords) || value.keywords.length !== 3 || value.keywords.some((keyword) => !validText(keyword, 1, 12))) {
    throw new Error('LLM keywords 格式无效')
  }
  return {
    summary: value.summary.trim(),
    traits: value.traits.map((trait) => ({ name: trait.name.trim(), description: trait.description.trim() })),
    listeningStyle: value.listeningStyle.trim(),
    keywords: value.keywords.map((keyword) => keyword.trim()),
  }
}

function validText(value, minimum, maximum) {
  const length = typeof value === 'string' ? [...value.trim()].length : 0
  return length >= minimum && length <= maximum && !/[\r\n]/.test(value)
}

function score(value) { return value === null ? 50 : Math.round(clamp(value) * 100) }
function clamp(value) { return Math.min(1, Math.max(0, value)) }
