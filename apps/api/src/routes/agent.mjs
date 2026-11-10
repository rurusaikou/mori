/**
 * 作用：统一承载正式 Agent API 与仅开发环境开放的 Playground 页面/API。
 * 输入：POST /agent/run、POST /agent/playground/run 或 GET /agent-playground 资源请求。
 * 输出：Agent 执行结果；正式与调试 Agent 由 composition root 分别注入。
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { json, readRequestJson } from '../http.mjs'

const directory = fileURLToPath(new URL('../mori-agent/playground/', import.meta.url))
const contentTypes = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8' }

export function createAgentRoutes({ productAgent, playgroundAgent }, env = process.env) {
  const playgroundEnabled = env.NODE_ENV !== 'production'
  return async function handleAgentRequest(request, response) {
    if (request.method === 'POST' && request.url === '/agent/run') {
      await runAgent(request, response, productAgent)
      return true
    }
    if (!playgroundEnabled) return false
    if (request.method === 'POST' && request.url === '/agent/playground/run') {
      await runAgent(request, response, playgroundAgent)
      return true
    }
    const files = { '/agent-playground': 'index.html', '/agent-playground/': 'index.html', '/agent-playground/playground.css': 'playground.css', '/agent-playground/playground.js': 'playground.js' }
    const file = files[request.url]
    if (request.method === 'GET' && file) {
      response.writeHead(200, { 'Content-Type': contentTypes[file.split('.').at(-1)], 'Cache-Control': 'no-store' })
      response.end(await readFile(`${directory}${file}`, 'utf8'))
      return true
    }
    return false
  }
}

async function runAgent(request, response, agent) {
  try {
    const result = await agent.execute(await readRequestJson(request))
    json(request, response, result.success ? 200 : 400, result)
  } catch (error) {
    json(request, response, error?.statusCode ?? 400, { success: false, error: error instanceof Error ? error.message : 'Invalid request' })
  }
}
