import { spawn } from 'node:child_process'

const projectDir = process.cwd()
const rendererUrl = 'http://127.0.0.1:3210'

function run(command, args, env = process.env) {
  return spawn(command, args, { cwd: projectDir, env, stdio: 'inherit' })
}

async function waitForRenderer() {
  // Electron 只有在 Next Route Handlers 和页面均可用后再打开，避免启动时出现空白或连接失败页。
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(rendererUrl)
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('Mori renderer did not start in time')
}

const renderer = run('pnpm', ['exec', 'next', 'dev', '--hostname', '127.0.0.1', '--port', '3210'])
let electron
let stopping = false

function stopChildren(exitCode) {
  if (stopping) return
  stopping = true
  electron?.kill('SIGTERM')
  renderer.kill('SIGTERM')
  process.exit(exitCode)
}

// 终端中断不会执行 try/finally；显式接管信号，避免本地 Next 服务继续占用端口。
process.once('SIGINT', () => stopChildren(130))
process.once('SIGTERM', () => stopChildren(143))

try {
  await waitForRenderer()
  const electronEnv = { ...process.env, MORI_RENDERER_URL: rendererUrl }
  // Node-based launchers may set this flag; Electron must run in browser mode for the desktop shell.
  delete electronEnv.ELECTRON_RUN_AS_NODE
  electron = run('pnpm', ['exec', 'electron', 'electron-main.mjs'], electronEnv)
  const exitCode = await new Promise((resolve) => electron.once('exit', resolve))
  process.exitCode = typeof exitCode === 'number' ? exitCode : 0
} finally {
  if (!stopping) {
    electron?.kill('SIGTERM')
    renderer.kill('SIGTERM')
  }
}
