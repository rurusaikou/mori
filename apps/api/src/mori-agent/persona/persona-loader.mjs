import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const personaPath = fileURLToPath(new URL('./mori-persona.md', import.meta.url))
let cachedPersona

export async function loadMoriPersona() {
  cachedPersona ??= await readFile(personaPath, 'utf8')
  return cachedPersona
}