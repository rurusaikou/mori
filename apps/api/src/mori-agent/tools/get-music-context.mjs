/** Tool：返回 AgentState 中由 Playground 手动提供的当前歌曲，不连接 Spotify。 */
export function createGetMusicContextTool(state) {
  return { name: 'get_music_context', description: '获取当前正在播放的歌曲信息', async execute() { return { available: Boolean(state.currentTrack), track: state.currentTrack } } }
}
