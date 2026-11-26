export function completedActionResponse(action, track) {
  if (action.type === 'music_request') {
    if (!track) return action.intent === 'SEARCH'
      ? '我查了你的完整曲库和 Spotify，暂时没有找到这首歌。'
      : '这次没有找到合适且可播放的歌曲。'
    return action.intent === 'RECOMMEND'
      ? `给你选了《${track.title}》— ${track.artist}，现在开始播放。`
      : `找到了《${track.title}》— ${track.artist}，现在开始播放。`
  }
  if (action.command === 'PAUSE') return '好，先停在这里。'
  if (action.command === 'RESUME') return track ? `好，继续听《${track.title}》。` : '好，继续听。'
  if (action.command === 'NEXT') return track ? `切好了，现在是《${track.title}》— ${track.artist}。` : '切到下一首了。'
  if (action.command === 'PREVIOUS') return track ? `回到《${track.title}》— ${track.artist}了。` : '回到上一首了。'
  return '这次播放操作已经完成。'
}
