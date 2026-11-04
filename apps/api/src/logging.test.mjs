import assert from 'node:assert/strict'
import test from 'node:test'
import { dailyLogFileName, formatLogLine } from './logging.mjs'

test('builds a dated log filename from the local calendar date', () => {
  const localNoon = new Date(2026, 10, 3, 12).toISOString()
  assert.equal(dailyLogFileName('api', localNoon), 'api_2026-11-03.log')
  assert.equal(dailyLogFileName('backend', localNoon), 'backend_2026-11-03.log')
})

test('formats music profile progress as readable Chinese text', () => {
  const line = formatLogLine({
    timestamp: new Date(2026, 10, 3, 12, 30).toISOString(),
    level: 'info',
    category: 'music_preference',
    event: 'batch_completed',
    processed: 120,
    total: 394,
    resolved: 2,
    cacheHits: 1,
    fetchedFeatures: 1,
  })
  assert.match(line, /\[信息\] \[music_preference\/batch_completed\]/)
  assert.match(line, /已处理 120\/394 首/)
  assert.match(line, /缓存命中 1 首/)
})

test('formats LLM portrait inputs and result as readable Chinese text', () => {
  const started = formatLogLine({
    timestamp: '2026-11-04T12:00:00.000Z', level: 'info', category: 'music_preference',
    event: 'portrait_generation_started', model: 'deepseek-flash', rhythm: 63, energy: 72, groove: 39, mood: 50,
  })
  const generated = formatLogLine({
    timestamp: '2026-11-04T12:00:01.000Z', level: 'info', category: 'music_preference',
    event: 'portrait_generated', model: 'deepseek-flash', summary: '偏爱有推动力但不过分躁动的声音。',
    traits: ['稳步推进', '沉浸聆听', '情绪开放'], keywords: ['推进感', '沉浸', '开放'],
  })
  assert.match(started, /节奏 63\/100，能量 72\/100，律动 39\/100，情绪 50\/100/)
  assert.match(generated, /偏爱有推动力但不过分躁动/)
  assert.match(generated, /稳步推进、沉浸聆听、情绪开放/)
})

test('keeps one physical line when user text contains a newline', () => {
  const line = formatLogLine({ timestamp: new Date().toISOString(), level: 'info', category: 'user_event', event: 'chat_submitted', text: '第一行\n第二行' })
  assert.equal(line.includes('\n'), false)
  assert.match(line, /第一行 第二行/)
})
