/**
 * Ackem 风格的 Post-turn Memory Processing：检索旧事实 → 双提取 → 校验 → 存储 → 画像更新。
 * 原始对话先落库；本流程属于可重试派生任务，失败不得影响用户已经收到的回复。
 */
export function createPostTurnMemoryProcessor({ extractor, repository, userId, logInfo = () => {}, logError = () => {} }) {
  return {
    async process({ input, userMessage, assistantMessage, agentRunId = null }) {
      if (!repository?.available || !userId || !extractor || !userMessage?.id || !assistantMessage?.id) return { processed: false, reason: 'unavailable' }
      const track = normalizedTrack(input.currentTrack)
      try {
        const existingFacts = typeof repository.listActiveMusicFacts === 'function'
          ? (await repository.listActiveMusicFacts({ userId, trackUri: track?.uri ?? null, limit: 20 }))
            .map(({ id, content, status, confidence, tags, track: factTrack }) => ({ id, content, status, confidence, tags, track: factTrack ?? null }))
          : typeof repository.retrieveRelevant === 'function'
            ? (await repository.retrieveRelevant({ userId, query: input.userMessage, trackUri: track?.uri ?? null, limit: 5 }))
            .filter((item) => item.kind === 'preference' && item.source !== 'derived_profile')
            .map(({ id, content, status, confidence, tags, track: factTrack }) => ({ id, content, status, confidence, tags, track: factTrack ?? null }))
            : []
        const extracted = await extractor({
          userMessage: input.userMessage,
          assistantResponse: assistantMessage.content,
          conversationContext: input.conversationHistory ?? [],
          currentTrack: track,
          existingFacts,
        })
        if (!extracted?.success) {
          logError('memory', 'post_turn_extraction_failed', new Error(extracted?.error ?? 'Memory extraction failed'), { userId, exchangeId: userMessage.exchangeId, agentRunId })
          return { processed: false, reason: 'extraction_failed' }
        }
        const facts = []
        for (const fact of extracted.data.facts) facts.push(await repository.upsertMusicFact({
          userId, ...fact, sourceMessageId: userMessage.id, track,
          confirmed: fact.confidence >= 0.9, createdAt: userMessage.createdAt,
        }))
        const moments = []
        for (const moment of extracted.data.moments) moments.push(await repository.createMusicMoment({
          userId, summary: moment.summary, userReflection: moment.userReflection,
          sourceMessageIds: [userMessage.id, assistantMessage.id], track,
          // 自动 Episode 只作为候选；用户主动保存的 Moment 才能直接 confirmed。
          confirmed: false, occurredAt: userMessage.createdAt,
        }))
        const tasteProfile = facts.length && typeof repository.refreshTasteProfile === 'function'
          ? await repository.refreshTasteProfile({ userId, updatedAt: assistantMessage.createdAt }) : []
        const result = { processed: true, factCount: facts.length, momentCount: moments.length, tasteDimensionCount: tasteProfile.length }
        logInfo('memory', 'post_turn_processing_completed', { userId, exchangeId: userMessage.exchangeId, agentRunId, ...result })
        return result
      } catch (error) {
        logError('memory', 'post_turn_processing_failed', error, { userId, exchangeId: userMessage.exchangeId, agentRunId })
        return { processed: false, reason: 'processing_failed' }
      }
    },
  }
}

function normalizedTrack(track) {
  if (!track?.title || !track?.artist) return null
  return { uri: track.uri ?? `local:${track.artist}:${track.title}`, title: track.title, artist: track.artist }
}
