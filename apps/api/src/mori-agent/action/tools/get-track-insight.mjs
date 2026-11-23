/** Action Tool：把当前 Recording 交给 Perception 的 Song Understanding，返回带证据与缺失层的结构化洞察。 */
export function createGetTrackInsightTool(context, songUnderstandingAgent) {
  return {
    name: 'get_track_insight',
    description: '从声音、歌词主题、创作关系和社会理解四层分析本轮已解析的目标歌曲；只有真实证据可用时才给出对应结论',
    async execute() {
      if (!context?.targetTrack) return { available: false, reason: '没有解析到目标歌曲', resolution: context?.trackResolution ?? null }
      return { available: true, track: context.targetTrack, insight: await songUnderstandingAgent.analyze(context.targetTrack), resolution: context.trackResolution }
    },
  }
}
