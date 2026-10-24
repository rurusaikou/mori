import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { MusicFeatures, MusicPreferenceProfile } from '@/lib/music-profile'

const dataDirectory = path.join(process.cwd(), 'data')
const featuresPath = path.join(dataDirectory, 'music-features.json')
const profilesPath = path.join(dataDirectory, 'music-profiles.json')

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(filePath, 'utf8')) as T } catch { return fallback }
}

async function writeJson(filePath: string, value: unknown) {
  await mkdir(dataDirectory, { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, filePath)
}

export async function getFeatureCache() {
  return readJson<Record<string, MusicFeatures>>(featuresPath, {})
}

export async function saveFeatures(features: MusicFeatures[]) {
  const cache = await getFeatureCache()
  for (const feature of features) cache[feature.isrc] = feature
  await writeJson(featuresPath, cache)
}

export async function getMusicProfile(userId: string) {
  const profiles = await readJson<Record<string, MusicPreferenceProfile>>(profilesPath, {})
  return profiles[userId] ?? null
}

export async function saveMusicProfile(userId: string, profile: MusicPreferenceProfile) {
  const profiles = await readJson<Record<string, MusicPreferenceProfile>>(profilesPath, {})
  profiles[userId] = profile
  await writeJson(profilesPath, profiles)
}
