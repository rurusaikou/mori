/**
 * 作用：提供 Mori API 的请求体限制、Extension Origin 校验和 JSON 响应工具。
 * 输入：Node HTTP request/response 与 JSON 数据。
 * 输出：受大小和 Origin 约束的解析结果及 HTTP JSON 响应。
 */
const MAX_JSON_BYTES = 2 * 1024 * 1024

export function isAllowedOrigin(request) {
  const origin = request.headers.origin
  // Requests without Origin support local CLI diagnostics. Browser callers must be an Extension
  // origin so arbitrary websites cannot consume MeloData quota through the localhost service.
  return !origin || origin.startsWith('chrome-extension://')
}

export function json(request, response, status, body) {
  const origin = request.headers.origin
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Headers': 'content-type',
    'Vary': 'Origin',
  }
  if (origin?.startsWith('chrome-extension://')) headers['Access-Control-Allow-Origin'] = origin
  response.writeHead(status, headers).end(status === 204 ? undefined : JSON.stringify(body))
}

export async function readRequestJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_JSON_BYTES) {
      const error = new Error('Request body is too large')
      error.statusCode = 413
      throw error
    }
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
