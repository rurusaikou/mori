/**
 * 作用：统一 Mori API 自身及 Extension 转发日志的结构化输出格式。
 * 输入：日志分类、事件、附加业务字段或错误。
 * 输出：apps/api/logs/api_YYYY-MM-DD.log 与 backend_YYYY-MM-DD.log 中的单行中文日志。
 */
import { appendFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const logsDirectory = fileURLToPath(new URL('../logs/', import.meta.url))
let apiWriteQueue = Promise.resolve()
let backendWriteQueue = Promise.resolve()

export function logInfo(category, event, data = {}) {
  const entry = { timestamp: new Date().toISOString(), level: 'info', source: 'api', category, event, ...data }
  apiWriteQueue = enqueue(apiWriteQueue, 'api', entry, entry.timestamp)
  return apiWriteQueue
}

export function logError(category, event, error, data = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level: 'error',
    source: 'api',
    category,
    event,
    ...data,
    error: error instanceof Error ? error.message : String(error),
  }
  apiWriteQueue = enqueue(apiWriteQueue, 'api', entry, entry.timestamp)
  return apiWriteQueue
}

export function logExtensionEntry(entry) {
  const backendEntry = { receivedAt: new Date().toISOString(), source: 'backend', ...entry }
  backendWriteQueue = enqueue(backendWriteQueue, 'backend', backendEntry, backendEntry.receivedAt)
  return backendWriteQueue
}

export function dailyLogFileName(prefix, timestamp) {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${prefix}_${year}-${month}-${day}.log`
}

export function formatLogLine(entry) {
  const timestamp = entry.timestamp ?? entry.receivedAt
  const time = formatLocalTime(timestamp)
  const level = entry.level === 'error' ? '错误' : '信息'
  const identity = `${entry.category ?? 'unknown'}/${entry.event ?? 'unknown'}`
  return `${time} [${level}] [${identity}] ${describe(entry)}`
}

function enqueue(queue, prefix, entry, timestamp) {
  return queue
    .catch(() => undefined)
    .then(async () => {
      // Resolve the path for every entry so a long-running API switches files at local midnight.
      const filePath = path.join(logsDirectory, dailyLogFileName(prefix, timestamp))
      await mkdir(logsDirectory, { recursive: true })
      await appendFile(filePath, `${formatLogLine(entry)}\n`, 'utf8')
    })
    .catch((error) => {
      // File logging is the primary sink; stderr is reserved for failures to write that sink.
      console.error(`[Mori API] Failed to write ${prefix} log:`, error)
    })
}

function formatLocalTime(timestamp) {
  const date = new Date(timestamp)
  const parts = [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((value) => String(value).padStart(2, '0'))
  return `${parts[0]}-${parts[1]}-${parts[2]} ${parts[3]}:${parts[4]}:${parts[5]}`
}

function describe(entry) {
  const key = `${entry.category}/${entry.event}`
  const descriptions = {
    'server/listening': () => `Mori API 已启动，监听地址 ${entry.url}，已加载 ${entry.cachedFeatures ?? 0} 首歌曲特征缓存。`,
    'music_preference/request_received': () => `收到音乐画像分析请求，共 ${entry.requestedTracks} 首歌曲，当前已有 ${entry.cachedFeatures} 首特征缓存。`,
    'music_preference/batch_completed': () => `音乐画像已处理 ${entry.processed}/${entry.total} 首；本批成功 ${entry.resolved} 首，缓存命中 ${entry.cacheHits} 首，新获取 ${entry.fetchedFeatures} 首。`,
    'music_preference/analysis_started': () => '音乐画像后台分析已开始。',
    'music_preference/analysis_reused': () => '音乐画像分析已在运行，本次操作继续等待现有任务。',
    'music_preference/library_sample_ready': () => `Spotify 曲库抽样完成，共选取 ${entry.sampledTracks} 首歌曲。`,
    'music_preference/analysis_completed': () => `音乐画像分析完成，成功分析 ${entry.analyzedTracks ?? entry.trackCount}/${entry.requestedTracks ?? entry.requestedCount} 首，当前缓存 ${entry.cachedFeatures ?? '—'} 首。`,
    'music_preference/analysis_failed': () => `音乐画像分析失败：${safe(entry.error)}。`,
    'music_preference/portrait_generated': () => `LLM 已生成用户听歌偏好与音乐画像（模型：${safe(entry.model)}）。`,
    'music_preference/portrait_fallback': () => 'LLM 未配置，本次使用本地规则生成听歌偏好与音乐画像。',
    'music_preference/portrait_generation_failed': () => `LLM 画像生成失败，本次使用本地规则回退：${safe(entry.error)}。`,
    'music_preference/melodata_retry': () => `MeloData 请求暂时失败，正在进行第 ${entry.attempt} 次重试（原因：${reason(entry.reason)}${entry.status ? `，HTTP ${entry.status}` : ''}）。`,
    'music_preference/track_skipped': () => `单曲特征多次请求失败，已跳过该歌曲（原因：${reason(entry.reason)}${entry.status ? `，HTTP ${entry.status}` : ''}）。`,
    'spotify/authorization_connected': () => 'Spotify 账号连接成功。',
    'spotify/authorization_disconnected': () => 'Spotify 账号已断开连接。',
    'spotify/playback_host_ready': () => 'Spotify 播放设备已准备就绪。',
    'playback/track_changed': () => `开始播放《${safe(entry.title)}》— ${safe(entry.artist)}。`,
    'user_event/presence_toggled': () => `用户${entry.visible ? '显示' : '隐藏'}了 Mori。`,
    'user_event/presence_moved': () => '用户移动了 Mori 的悬浮位置。',
    'user_event/mori_connect_spotify': () => '用户点击连接 Spotify。',
    'user_event/mori_disconnect_spotify': () => '用户点击断开 Spotify。',
    'user_event/mori_toggle_playback': () => '用户点击播放或暂停。',
    'user_event/mori_refresh_library': () => '用户手动刷新 Spotify 曲库。',
    'user_event/mori_save_memory': () => '用户点击保存音乐瞬间。',
    'user_event/mori_analyze_music_preference': () => '用户点击开始或重新分析音乐画像。',
    'user_event/playback_command': () => `用户点击${entry.command === 'previous' ? '上一首' : '下一首'}。`,
    'user_event/playback_mode_changed': () => `用户将播放模式切换为 ${safe(entry.mode)}。`,
    'user_event/track_selected': () => `用户选择播放歌曲 ${safe(entry.uri)}。`,
    'user_event/chat_submitted': () => `用户提交对话：“${safe(entry.text)}”。`,
    'memory/moment_saved': () => `音乐瞬间已保存${entry.track?.title ? `，歌曲《${safe(entry.track.title)}》` : ''}。`,
    'conversation/message_exchange': () => `对话完成：用户“${safe(entry.userText)}”，Mori“${safe(entry.moriText)}”。`,
    'extension/content_contexts_reinjected': () => `扩展更新后已恢复 ${entry.restoredTabs}/${entry.attemptedTabs} 个网页。`,
    'extension/content_reinjection_failed': () => `扩展网页恢复失败：${safe(entry.error)}。`,
    'runtime/request_failed': () => `扩展请求 ${safe(entry.type)} 处理失败：${safe(entry.error)}。`,
    'diagnostic/daily_log_probe_first': () => '日志按日期创建测试（第一次写入）。',
    'diagnostic/daily_log_probe_second': () => '日志追加测试（第二次写入）。',
    'diagnostic/file_log_probe': () => '日志文件写入诊断测试。',
  }
  return descriptions[key]?.() ?? `记录事件“${safe(entry.event)}”。${entry.error ? ` 错误：${safe(entry.error)}。` : ''}`
}

function reason(value) {
  return ({ network: '网络异常', server_error: '服务端异常', network_retries_exhausted: '网络重试已耗尽', server_retries_exhausted: '服务端重试已耗尽' })[value] ?? safe(value)
}

function safe(value) {
  if (value === null || value === undefined) return '—'
  return String(value).replaceAll(/\s+/g, ' ').trim()
}
