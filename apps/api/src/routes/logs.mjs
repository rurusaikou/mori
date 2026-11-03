/**
 * 作用：接收 Extension 转发的结构化业务日志并输出到 API 终端。
 * 输入：POST /logs JSON 日志对象。
 * 输出：202 accepted 或可读的 400 JSON 错误。
 */
import { json, readRequestJson } from '../http.mjs'
import { logExtensionEntry } from '../logging.mjs'

export async function handleLogsRoute(request, response) {
  try {
    const entry = await readRequestJson(request)
    if (!entry || typeof entry.category !== 'string' || typeof entry.event !== 'string') {
      json(request, response, 400, { error: 'Invalid log entry' }); return
    }
    await logExtensionEntry(entry)
    json(request, response, 202, { accepted: true })
  } catch (error) {
    json(request, response, error?.statusCode ?? 400, { error: error?.statusCode === 413 ? 'Request body is too large' : 'Invalid JSON' })
  }
}
