import { context } from 'esbuild'
import { createServer } from 'node:http'
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const projectRoot = process.cwd()
const hostRoot = path.join(projectRoot, 'apps/player-host')
const outdir = path.join(hostRoot, 'dist')
const watch = process.argv.includes('--watch')
const serve = process.argv.includes('--serve')

await rm(outdir, { recursive: true, force: true })
await mkdir(outdir, { recursive: true })
await Promise.all([
  copyFile(path.join(hostRoot, 'index.html'), path.join(outdir, 'index.html')),
  copyFile(path.join(hostRoot, 'player.css'), path.join(outdir, 'player.css')),
])

const buildContext = await context({
  entryPoints: [path.join(hostRoot, 'src/player.ts')],
  outfile: path.join(outdir, 'player.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome116',
  sourcemap: watch,
  minify: !watch,
  logLevel: 'info',
})

if (watch) await buildContext.watch()
else await buildContext.rebuild()

if (serve) {
  const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.map': 'application/json' }
  createServer(async (request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    const relativePath = pathname === '/' || pathname === '/playback-host' || pathname === '/playback-host/' ? 'index.html' : pathname.replace(/^\/playback-host\//, '')
    const filePath = path.join(outdir, relativePath)
    // Resolve and validate the final path before reading so URL traversal cannot escape dist/.
    if (!filePath.startsWith(`${outdir}${path.sep}`)) { response.writeHead(403).end(); return }
    try {
      const body = await readFile(filePath)
      response.writeHead(200, {
        'Content-Type': contentTypes[path.extname(filePath)] ?? 'application/octet-stream',
        // The Web Playback SDK creates https://sdk.scdn.co/embedded/index.html internally.
        // Without frame-src the default self policy blocks that iframe, so connect() waits until
        // Mori reports a misleading device timeout even though spotify-player.js loaded.
        'Content-Security-Policy': "default-src 'self'; script-src 'self' https://sdk.scdn.co; style-src 'self'; frame-src https://sdk.scdn.co; connect-src 'self' http://127.0.0.1:3210 http://localhost:3210 https://*.spotify.com https://*.scdn.co wss://*.spotify.com; media-src https://*.scdn.co blob:; worker-src blob:; frame-ancestors chrome-extension:",
        'Cache-Control': 'no-store',
      }).end(body)
    } catch { response.writeHead(404).end('Not found') }
  }).listen(3210, '127.0.0.1', () => console.log('Mori Playback Host: http://127.0.0.1:3210/playback-host/'))
}

if (watch || serve) await new Promise(() => {})
else await buildContext.dispose()
