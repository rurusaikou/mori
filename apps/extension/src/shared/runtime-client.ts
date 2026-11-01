/**
 * 作用：封装 Chrome runtime 请求并统一解析后台响应和错误。
 * 输入：类型化 RuntimeRequest。
 * 输出：解析后的泛型结果；失败时抛出统一 Error。
 */
import type { RuntimeRequest, RuntimeResponse } from './messages'

/** Typed request boundary used by content and options pages. */
export async function sendRuntimeRequest<T>(message: RuntimeRequest): Promise<T> {
  const response = await chrome.runtime.sendMessage<RuntimeRequest, RuntimeResponse<T>>(message)
  // Convert transport and background failures into one exception contract so React callers do not
  // need to understand Chrome's response envelope.
  if (!response?.ok) throw new Error(response?.error || 'Mori 后台没有响应')
  return response.result
}
