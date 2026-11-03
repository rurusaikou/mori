/**
 * 作用：按 ISRC 读取和原子持久化 MeloData 歌曲特征缓存。
 * 输入：缓存目录和新增 MusicFeatures。
 * 输出：内存查询结果、缓存规模及写入 apps/api/data 的 JSON 文件。
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

export async function createFeatureStore(dataDirectory) {
  const featuresPath = path.join(dataDirectory, 'music-features.json')
  const cache = new Map(Object.entries(await readJson(featuresPath, {})))

  return {
    get: (isrc) => cache.get(isrc),
    has: (isrc) => cache.has(isrc),
    set: (isrc, features) => cache.set(isrc, features),
    get size() { return cache.size },
    async persist() {
      await mkdir(dataDirectory, { recursive: true })
      const temporaryPath = `${featuresPath}.${process.pid}.${randomUUID()}.tmp`
      await writeFile(temporaryPath, `${JSON.stringify(Object.fromEntries(cache), null, 2)}\n`, 'utf8')
      await rename(temporaryPath, featuresPath)
    },
  }
}

async function readJson(filePath, fallback) {
  try { return JSON.parse(await readFile(filePath, 'utf8')) } catch { return fallback }
}
