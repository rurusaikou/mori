import { context } from 'esbuild'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const projectRoot = process.cwd()
const sourceRoot = path.join(projectRoot, 'apps/extension')
const outdir = path.join(sourceRoot, 'build')
const watch = process.argv.includes('--watch')

// Extension contexts have different script constraints: content scripts must be a classic script,
// while the Manifest V3 service worker may be an ES module. Building them separately keeps those
// runtime boundaries explicit instead of relying on fragile post-build rewriting.
const targets = [
  { entry: 'src/background/service-worker.ts', outfile: 'src/background/service-worker.js', format: 'esm' },
  { entry: 'src/content/index.tsx', outfile: 'src/content/content.js', format: 'iife' },
  { entry: 'src/offscreen/offscreen.ts', outfile: 'src/offscreen/offscreen.js', format: 'iife' },
  { entry: 'src/options/options.ts', outfile: 'src/options/options.js', format: 'esm' },
]

const inlineTextPlugin = {
  name: 'inline-text',
  setup(build) {
    build.onResolve({ filter: /\?inline$/ }, ({ path: importPath, resolveDir }) => ({ path: path.resolve(resolveDir, importPath.replace(/\?inline$/, '')), namespace: 'inline-text' }))
    build.onLoad({ filter: /.*/, namespace: 'inline-text' }, async ({ path: filePath }) => ({ contents: await readFile(filePath, 'utf8'), loader: 'text' }))
  },
}

await rm(outdir, { recursive: true, force: true })
await mkdir(outdir, { recursive: true })

const contexts = []
for (const target of targets) {
  const buildContext = await context({
    entryPoints: [path.join(sourceRoot, target.entry)],
    outfile: path.join(outdir, target.outfile),
    bundle: true,
    format: target.format,
    platform: 'browser',
    target: 'chrome116',
    jsx: 'automatic',
    sourcemap: watch,
    minify: !watch,
    plugins: [inlineTextPlugin],
    logLevel: 'info',
  })
  contexts.push(buildContext)
  if (watch) await buildContext.watch()
  else await buildContext.rebuild()
}

if (watch) {
  console.log(`Mori Extension is watching. Load unpacked: ${sourceRoot}`)
  await new Promise(() => {})
} else {
  await Promise.all(contexts.map((buildContext) => buildContext.dispose()))
  await writeFile(path.join(outdir, '.built-at'), `${new Date().toISOString()}\n`)
}
