/**
 * 作用：接收 Extension 产生的用户主动 Moment 与播放事实，并暴露 Memory 健康检查。
 * 身份只由服务端注入，绝不接受请求体中的 userId，避免跨用户写入。
 */
import { json, readRequestJson } from '../http.mjs'

export function createMemoryRoutes({ repository, userId }) {
  return async function handleMemoryRequest(request, response) {
    if (request.method === 'GET' && request.url === '/memory/health') {
      json(request, response, 200, await repository.health())
      return true
    }
    if (!request.url?.startsWith('/memory/')) return false
    if (!repository.available) {
      json(request, response, 503, { error: repository.reason ?? 'Memory repository is unavailable' })
      return true
    }
    if (!userId) {
      json(request, response, 503, { error: 'Memory identity is not configured' })
      return true
    }
    try {
      if (request.method === 'GET' && request.url === '/memory/memories') {
        json(request, response, 200, { memories: await repository.list({ userId, limit: 100 }) })
        return true
      }
      const deleteMatch = request.method === 'DELETE' && request.url?.match(/^\/memory\/memories\/([0-9a-f-]+)$/i)
      if (deleteMatch) {
        const deleted = await repository.softDelete({ userId, id: deleteMatch[1] })
        json(request, response, deleted ? 200 : 404, { deleted })
        return true
      }
      const body = await readRequestJson(request)
      if (request.method === 'POST' && request.url === '/memory/moments') {
        const result = await repository.createMoment({ ...body, userId })
        json(request, response, 201, { stored: true, id: result.id })
        return true
      }
      if (request.method === 'POST' && request.url === '/memory/events/listening') {
        const result = await repository.appendListeningEvent({ ...body, userId })
        json(request, response, 202, { stored: true, eventId: result.eventId })
        return true
      }
    } catch (error) {
      json(request, response, error?.statusCode ?? 400, { error: error instanceof Error ? error.message : 'Invalid memory request' })
      return true
    }
    return false
  }
}
