import assert from 'node:assert/strict'
import test from 'node:test'
import { completedActionResponse } from '../../../../extension/src/companion/action-response.mjs'

const track = { uri: 'spotify:track:new', title: '身骑白马', artist: '徐佳莹' }

test('P2 confirmed playback responses use real facts and Mori natural voice', () => {
  assert.equal(completedActionResponse({ type: 'playback_control', command: 'PAUSE' }, track), '好，先停在这里。')
  assert.equal(completedActionResponse({ type: 'playback_control', command: 'NEXT' }, track), '切好了，现在是《身骑白马》— 徐佳莹。')
  assert.equal(completedActionResponse({ type: 'playback_control', command: 'RESUME' }, track), '好，继续听《身骑白马》。')
})

test('exact search failure never claims another track was selected', () => {
  assert.match(completedActionResponse({ type: 'music_request', intent: 'SEARCH' }, null), /没有找到这首歌/)
})
