/**
 * 作用：为 Extension 后台输出统一、可筛选的结构化业务日志。
 * 输入：日志分类、事件名称和不包含凭据的业务字段。
 * 输出：Service Worker 控制台中的单行 JSON 日志。
 */
import { extensionStorage } from '../storage/extension-storage'

export function logInfo(category: string, event: string, data: Record<string, unknown> = {}) {
  const entry = { timestamp: new Date().toISOString(), level: 'info', category, event, ...data }
  console.info('[Mori]', JSON.stringify(entry))
  void forwardToBackend(entry)
}

export function logError(category: string, event: string, cause: unknown, data: Record<string, unknown> = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level: 'error',
    category,
    event,
    ...data,
    error: cause instanceof Error ? cause.message : String(cause),
  }
  console.error('[Mori]', JSON.stringify(entry))
  void forwardToBackend(entry)
}

async function forwardToBackend(entry: Record<string, unknown>) {
  try {
    const apiBaseUrl = (await extensionStorage.getApiBaseUrl()).replace(/\/$/, '')
    await fetch(`${apiBaseUrl}/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    })
  } catch {
    // Logging is best-effort: an unavailable development API must never break user actions.
  }
}
