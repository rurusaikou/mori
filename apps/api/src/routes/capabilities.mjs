/**
 * 作用：提供仅非生产环境可用的 Capability 独立运行 API、Debug Log 查询和 Lab 静态页。
 * 输入：HTTP 请求、Capability Registry 与运行环境。
 * 输出：结构化执行结果或 Lab 资源；生产环境不注册这些开发入口。
 */
import { json, readRequestJson } from '../http.mjs'
import { CAPABILITY_EXAMPLES } from '../mori-agent/index.mjs'
import { recentCapabilityLogs } from '../mori-agent/shared/logger.mjs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const labDirectory = fileURLToPath(new URL('../mori-agent/lab/', import.meta.url))
const contentTypes = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8' }

export function createCapabilityRoutes(registry, env = process.env) {
  const enabled = env.NODE_ENV !== 'production'
  return async function handleCapabilityRequest(request, response) {
    if (!enabled) return false
    if (request.method === 'POST' && request.url?.startsWith('/agent/capabilities/')) {
      const name = request.url.split('/').filter(Boolean).at(-1)
      const capability = registry[name]
      if (!capability) { json(request, response, 404, { error: 'Unknown capability' }); return true }
      try {
        const input = await readRequestJson(request)
        const result = await capability.execute(input)
        json(request, response, result.success ? 200 : 400, result)
      } catch (error) {
        json(request, response, error?.statusCode ?? 400, { success: false, error: error instanceof Error ? error.message : 'Invalid request' })
      }
      return true
    }
    if (request.method === 'GET' && request.url === '/agent/capabilities') { json(request, response, 200, { capabilities: Object.keys(registry), examples: CAPABILITY_EXAMPLES }); return true }
    if (request.method === 'GET' && request.url === '/agent/capability-logs') { json(request, response, 200, { logs: recentCapabilityLogs() }); return true }
    const labFiles = { '/capability-lab': 'index.html', '/capability-lab/': 'index.html', '/capability-lab/lab.css': 'lab.css', '/capability-lab/lab.js': 'lab.js' }
    const file = labFiles[request.url]
    if (request.method === 'GET' && file) {
      const extension = file.split('.').at(-1)
      response.writeHead(200, { 'Content-Type': contentTypes[extension], 'Cache-Control': 'no-store' })
      response.end(await readFile(`${labDirectory}${file}`, 'utf8')); return true
    }
    return false
  }
}
