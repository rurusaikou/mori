import type { PlaybackState } from '@mori/domain'

export function MoriCharacter({ playback }: { playback: PlaybackState }) {
  return <span className="character-frame" aria-hidden="true">
    <span className="character">
      <span className="headband" />
      <span className="face">
        <i className="eye left" /><i className="eye right" />
        <i className="cheek left" /><i className="cheek right" />
        <i className="mouth" />
      </span>
      <span className="ear left" /><span className="ear right" />
    </span>
    {playback.isPlaying && <span className="note">♪</span>}
  </span>
}
