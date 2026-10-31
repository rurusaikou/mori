import type { RuntimeRequest, RuntimeResponse } from './messages'

/** Typed request boundary used by content and options pages. */
export async function sendRuntimeRequest<T>(message: RuntimeRequest): Promise<T> {
  const response = await chrome.runtime.sendMessage<RuntimeRequest, RuntimeResponse<T>>(message)
  if (!response?.ok) throw new Error(response?.error || 'Mori 后台没有响应')
  return response.result
}
