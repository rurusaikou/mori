import { spawn } from 'node:child_process'

const projectDir = process.cwd()
const rendererUrl = 'http://127.0.0.1:3210'

function run(command, args, env = process.env) {
  return spawn(command, args, { cwd: projectDir, env, stdio: 'inherit' })
}

async function waitForRenderer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(rendererUrl)
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('Mori renderer did not start in time')
}

const desktopEnv = { ...process.env, MORI_DESKTOP_BUILD: '1' }
const next = run('pnpm', ['exec', 'next', 'dev', '--hostname', '127.0.0.1', '--port', '3210'], desktopEnv)
let electron

try {
  await waitForRenderer()
  const electronEnv = { ...desktopEnv, MORI_DESKTOP_URL: rendererUrl }
  // Codex/Node-based launchers may set this flag; Electron must run in browser mode for the desktop shell.
  delete electronEnv.ELECTRON_RUN_AS_NODE
  electron = run('pnpm', ['exec', 'electron', 'desktop/main.mjs'], electronEnv)
  const exitCode = await new Promise((resolve) => electron.once('exit', resolve))
  process.exitCode = typeof exitCode === 'number' ? exitCode : 0
} finally {
  electron?.kill('SIGTERM')
  next.kill('SIGTERM')
}
