/**
 * 作用：为 Extension 后台输出统一、可筛选的结构化业务日志。
 * 输入：日志分类、事件名称和不包含凭据的业务字段。
 * 输出：Service Worker 控制台中的单行 JSON 日志。
 */
export function logInfo(category: string, event: string, data: Record<string, unknown> = {}) {
  console.info('[Mori]', JSON.stringify({ timestamp: new Date().toISOString(), level: 'info', category, event, ...data }))
}

export function logError(category: string, event: string, cause: unknown, data: Record<string, unknown> = {}) {
  console.error('[Mori]', JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'error',
    category,
    event,
    ...data,
    error: cause instanceof Error ? cause.message : String(cause),
  }))
}
