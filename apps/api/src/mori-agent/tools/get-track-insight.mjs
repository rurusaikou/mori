/** Tool：把当前 Recording 交给 Song Understanding Agent，返回带证据与缺失层的结构化洞察。 */
export function createGetTrackInsightTool(state, songUnderstandingAgent) {
  return {
    name: 'get_track_insight',
    description: '从声音、歌词主题、创作关系和社会理解四层分析当前歌曲；只有真实证据可用时才给出对应结论',
    async execute() {
      if (!state.currentTrack) return { available: false, reason: '没有当前歌曲' }
      return { available: true, insight: await songUnderstandingAgent.analyze(state.currentTrack) }
    },
  }
}
