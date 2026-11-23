/** Action Tool：只返回 Context Assembly 已确定的目标歌曲，不自行猜测或回退当前歌曲。 */
export function createGetMusicContextTool(context) {
  return { name: 'get_music_context', description: '获取本轮已解析目标歌曲的基础信息', async execute() { return { available: Boolean(context?.targetTrack), track: context?.targetTrack ?? null, resolution: context?.trackResolution ?? null } } }
}
