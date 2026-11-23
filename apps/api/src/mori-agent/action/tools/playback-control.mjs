/** Playback Control 只生成客户端动作计划；Spotify 真实状态由 Extension 确认。 */
export function createPlaybackControlTool() {
  return {
    name: 'playback_control',
    description: '暂停、继续播放、切到下一首或返回上一首；只在用户明确提出播放控制时使用',
    async execute(args) {
      const command = args?.command
      if (!['PAUSE', 'RESUME', 'NEXT', 'PREVIOUS'].includes(command)) throw new Error('playback_control.command 无效')
      return { status: 'PENDING', operation: 'playback_control', command }
    },
  }
}
