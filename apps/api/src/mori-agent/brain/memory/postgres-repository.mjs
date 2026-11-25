/**
 * 作用：使用 PostgreSQL + pgvector 持久化 Mori Memory，并提供带用户隔离的混合检索与初始 Graph 写入。
 * 输入：认证 userId、对话/播放/Moment 事件及 Memory 查询。
 * 输出：可追溯的持久化结果；所有写入幂等，Agent 不直接接触 SQL。
 */
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { consolidateTasteProfile } from './taste-profile.mjs'

const schemaPath = fileURLToPath(new URL('./schema.sql', import.meta.url))

export async function createPostgresMemoryRepository({ connectionString, embeddingProvider = null, logInfo = () => {}, logError = () => {}, pool: injectedPool } = {}) {
  if (!connectionString && !injectedPool) return createUnavailableMemoryRepository('MORI_MEMORY_DATABASE_URL 未配置')
  const dimensions = embeddingProvider?.dimensions ?? 768
  if (!Number.isInteger(dimensions) || dimensions < 1) throw new Error('Memory Embedding 维度无效')
  const pool = injectedPool ?? new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 })
  const schema = (await readFile(schemaPath, 'utf8')).replaceAll('__EMBEDDING_DIMENSIONS__', String(dimensions))
  await pool.query(schema)
  logInfo('memory', 'repository_ready', { backend: 'postgres_pgvector', embeddingModel: embeddingProvider?.model ?? null, dimensions })

  return {
    available: true,
    backend: 'postgres_pgvector',
    async appendConversationMessage(input) {
      const value = conversationInput(input)
      await pool.query(`
        INSERT INTO conversation_messages
          (id, user_id, local_date, time_zone, exchange_id, role, content, status, track_uri, track_title, track_artist, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (user_id, exchange_id, role) DO UPDATE SET
          content = EXCLUDED.content, status = EXCLUDED.status,
          track_uri = EXCLUDED.track_uri, track_title = EXCLUDED.track_title,
          track_artist = EXCLUDED.track_artist
      `, [value.id, value.userId, value.localDate, value.timeZone, value.exchangeId, value.role, value.content, value.status,
        value.track?.uri ?? null, value.track?.title ?? null, value.track?.artist ?? null, value.createdAt])
      await markDayDirty(pool, value.userId, value.localDate, value.timeZone)
      logInfo('memory', 'conversation_stored', { userId: value.userId, localDate: value.localDate, exchangeId: value.exchangeId, role: value.role, status: value.status })
      return value
    },
    async appendListeningEvent(input) {
      const value = listeningInput(input)
      await pool.query(`
        INSERT INTO listening_events
          (event_id, user_id, local_date, time_zone, track_uri, track_isrc, track_title, track_artist, event_type, position_ms, duration_ms, source, occurred_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (event_id) DO NOTHING
      `, [value.eventId, value.userId, value.localDate, value.timeZone, value.track.uri, value.track.isrc ?? null, value.track.title,
        value.track.artist, value.type, value.positionMs, value.durationMs, value.source, value.occurredAt])
      await markDayDirty(pool, value.userId, value.localDate, value.timeZone)
      // 只有完整听完才增加“经常听”的证据，progress/paused/skipped 不能被误算为一次有效播放。
      // Graph 是可重建的派生索引；刷新失败只记录错误，不回滚已经落库的原始听歌事实。
      if (value.type === 'completed') await refreshFrequentTrackGraph(pool, value.userId, value.track)
        .catch((error) => logError('memory', 'listening_graph_refresh_failed', error, { userId: value.userId, trackUri: value.track.uri }))
      logInfo('memory', 'listening_event_stored', { userId: value.userId, localDate: value.localDate, eventId: value.eventId, type: value.type, trackUri: value.track.uri })
      return value
    },
    async createMoment(input) {
      const value = momentInput(input)
      const vector = await optionalEmbedding(embeddingProvider, value.content, logError)
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query(`
          INSERT INTO agent_memories
            (id, user_id, kind, content, status, confidence, source, track_uri, track_title, track_artist, mood, tags, embedding, embedding_model, created_at, updated_at)
          VALUES ($1,$2,'moment',$3,'confirmed',1,'user_moment',$4,$5,$6,$7,$8,$9::vector,$10,$11,$11)
          ON CONFLICT (id) DO NOTHING
        `, [value.id, value.userId, value.content, value.track?.uri ?? null, value.track?.title ?? null, value.track?.artist ?? null,
          value.mood, value.tags, vector ? vectorLiteral(vector) : null, vector ? embeddingProvider.model : null, value.createdAt])
        const evidenceId = value.evidenceId ?? randomUUID()
        await client.query(`
          INSERT INTO memory_evidence (id, user_id, memory_id, evidence_type, source_id, content, occurred_at)
          VALUES ($1,$2,$3,'moment',$3,$4,$5)
          ON CONFLICT (user_id, memory_id, evidence_type, source_id) DO NOTHING
        `, [evidenceId, value.userId, value.id, value.content, value.createdAt])
        const userNode = await upsertNode(client, value.userId, 'USER', value.userId, 'Mori 用户', {})
        const momentNode = await upsertNode(client, value.userId, 'MOMENT', value.id, value.content, { mood: value.mood })
        await connect(client, value.userId, userNode, 'SAVED_MOMENT', momentNode, evidenceId, 1, {})
        if (value.track) {
          const trackNode = await upsertNode(client, value.userId, 'CATALOG_TRACK', value.track.uri, value.track.title, { artist: value.track.artist, isrc: value.track.isrc ?? null })
          await connect(client, value.userId, momentNode, 'ABOUT_TRACK', trackNode, evidenceId, 1, {})
        }
        const moodNode = await upsertNode(client, value.userId, 'MOOD', value.mood, value.mood, {})
        await connect(client, value.userId, momentNode, 'FELT', moodNode, evidenceId, 1, {})
        await client.query('COMMIT')
        logInfo('memory', 'moment_persisted', { userId: value.userId, memoryId: value.id, mood: value.mood, trackUri: value.track?.uri ?? null })
        return { ...value, evidenceId }
      } catch (error) {
        await client.query('ROLLBACK')
        logError('memory', 'moment_persist_failed', error, { userId: value.userId, memoryId: value.id })
        throw error
      } finally { client.release() }
    },
    async upsertMusicFact(input) {
      const value = musicFactInput(input)
      const vector = await optionalEmbedding(embeddingProvider, value.content, logError)
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        if (value.supersedesId) {
          const superseded = await client.query(`UPDATE agent_memories SET status='superseded',updated_at=now() WHERE user_id=$1 AND id=$2 AND status IN ('candidate','confirmed') RETURNING id`, [value.userId, value.supersedesId])
          if (!superseded.rowCount) throw new Error('需要修正的 Music Fact 不存在')
        } else {
          const factKey = musicFactKey(value)
          const duplicate = await client.query(`
            SELECT id,status,confidence FROM agent_memories
            WHERE user_id=$1 AND kind='preference' AND status IN ('candidate','confirmed')
              AND track_uri IS NOT DISTINCT FROM $3
              AND (lower(content)=lower($2) OR ($4::text IS NOT NULL AND $4=ANY(tags)))
            ORDER BY updated_at DESC LIMIT 1
          `, [value.userId, value.content, value.track?.uri ?? null, factKey])
          if (duplicate.rows[0]) {
            const existing = duplicate.rows[0]
            await client.query(`UPDATE agent_memories SET confidence=GREATEST(confidence,$3),status=CASE WHEN $4 THEN 'confirmed' ELSE status END,updated_at=now() WHERE user_id=$1 AND id=$2`, [value.userId, existing.id, value.confidence, value.confirmed])
            await insertEvidence(client, { userId: value.userId, memoryId: existing.id, type: 'message', sourceId: value.sourceMessageId, content: value.evidence, occurredAt: value.createdAt })
            await client.query('COMMIT')
            return { id: existing.id, ...value, status: value.confirmed ? 'confirmed' : existing.status, deduplicated: true }
          }
        }
        const id = randomUUID()
        await client.query(`
          INSERT INTO agent_memories
            (id,user_id,kind,content,status,confidence,source,track_uri,track_title,track_artist,tags,embedding,embedding_model,supersedes_id,created_at,updated_at)
          VALUES ($1,$2,'preference',$3,$4,$5,'user_statement',$6,$7,$8,$9,$10::vector,$11,$12,$13,$13)
        `, [id, value.userId, value.content, value.confirmed ? 'confirmed' : 'candidate', value.confidence,
          value.track?.uri ?? null, value.track?.title ?? null, value.track?.artist ?? null,
          [value.category, ...(value.dimension ? [`dimension:${value.dimension}`] : []), ...(value.attribute ? [`attribute:${value.attribute}`] : []), ...(musicFactKey(value) ? [musicFactKey(value)] : [])], vector ? vectorLiteral(vector) : null,
          vector ? embeddingProvider.model : null, value.supersedesId, value.createdAt])
        const evidenceId = await insertEvidence(client, { userId: value.userId, memoryId: id, type: 'message', sourceId: value.sourceMessageId, content: value.evidence, occurredAt: value.createdAt })
        await indexMemoryAssociations(client, {
          userId: value.userId, memoryId: id, kind: 'FACT', label: value.content, track: value.track,
          dimension: value.dimension, evidenceId,
        })
        await client.query('COMMIT')
        logInfo('memory', 'music_fact_upserted', { userId: value.userId, memoryId: id, category: value.category, supersedesId: value.supersedesId })
        return { id, ...value, status: value.confirmed ? 'confirmed' : 'candidate', deduplicated: false }
      } catch (error) {
        await client.query('ROLLBACK'); throw error
      } finally { client.release() }
    },
    async createMusicMoment(input) {
      const value = musicMomentInput(input)
      const content = [value.summary, value.userReflection].filter(Boolean).join('；')
      const vector = await optionalEmbedding(embeddingProvider, content, logError)
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query(`
          INSERT INTO agent_memories
            (id,user_id,kind,content,status,confidence,source,track_uri,track_title,track_artist,tags,embedding,embedding_model,created_at,updated_at)
          VALUES ($1,$2,'moment',$3,$4,1,'user_moment',$5,$6,$7,$8,$9::vector,$10,$11,$11)
          ON CONFLICT (id) DO NOTHING
        `, [value.id, value.userId, content, value.confirmed ? 'confirmed' : 'candidate', value.track?.uri ?? null,
          value.track?.title ?? null, value.track?.artist ?? null, ['music_moment'], vector ? vectorLiteral(vector) : null,
          vector ? embeddingProvider.model : null, value.occurredAt])
        let associationEvidenceId = null
        for (const sourceId of value.sourceMessageIds) associationEvidenceId = await insertEvidence(client, { userId: value.userId, memoryId: value.id, type: 'message', sourceId, content, occurredAt: value.occurredAt })
        await indexMemoryAssociations(client, {
          userId: value.userId, memoryId: value.id, kind: 'MOMENT', label: content, track: value.track,
          evidenceId: associationEvidenceId,
        })
        await client.query('COMMIT')
        logInfo('memory', 'music_moment_persisted', { userId: value.userId, memoryId: value.id, trackUri: value.track?.uri ?? null, sourceCount: value.sourceMessageIds.length })
        return { ...value, content, status: value.confirmed ? 'confirmed' : 'candidate' }
      } catch (error) {
        await client.query('ROLLBACK'); throw error
      } finally { client.release() }
    },
    async retrieveRelevant({ userId, query, trackUri = null, trackTitle = null, trackArtist = null, limit = 20 }) {
      required(userId, 'userId'); required(query, 'query')
      const boundedLimit = Math.max(1, Math.min(Number(limit) || 20, 50))
      const result = await pool.query(`
        SELECT m.id,m.kind,m.content,m.status,m.confidence,m.source,m.track_uri,m.track_title,m.track_artist,m.mood,m.tags,m.created_at,
          CASE WHEN m.track_uri=$2 THEN 1
            WHEN ($3::text IS NOT NULL AND lower(m.track_title)=lower($3)) OR ($4::text IS NOT NULL AND lower(m.track_artist)=lower($4)) THEN 0.9
            ELSE similarity(m.content,$5) END AS keyword_score,
          CASE WHEN m.track_uri=$2 THEN 'TRACK_URI'
            WHEN ($3::text IS NOT NULL AND lower(m.track_title)=lower($3)) OR ($4::text IS NOT NULL AND lower(m.track_artist)=lower($4)) THEN 'TRACK_IDENTITY'
            ELSE 'KEYWORD' END AS match_reason,
          0::double precision AS semantic_score, evidence.items AS evidence
        FROM agent_memories m
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(jsonb_build_object('id',e.id,'type',e.evidence_type,'content',e.content,'occurredAt',e.occurred_at) ORDER BY e.occurred_at) AS items
          FROM memory_evidence e WHERE e.user_id=m.user_id AND e.memory_id=m.id
        ) evidence ON true
        WHERE m.user_id=$1 AND m.status IN ('candidate','confirmed')
          AND (($2::text IS NOT NULL AND m.track_uri=$2)
            OR ($3::text IS NOT NULL AND lower(m.track_title)=lower($3))
            OR ($4::text IS NOT NULL AND lower(m.track_artist)=lower($4))
            OR m.content % $5 OR m.content ILIKE '%' || $5 || '%')
        ORDER BY CASE WHEN m.track_uri=$2 THEN 0
          WHEN ($3::text IS NOT NULL AND lower(m.track_title)=lower($3)) OR ($4::text IS NOT NULL AND lower(m.track_artist)=lower($4)) THEN 1
          ELSE 2 END, keyword_score DESC, m.updated_at DESC
        LIMIT $6
      `, [userId, trackUri, trackTitle, trackArtist, query, boundedLimit])
      return result.rows.map(memoryRow)
    },
    async listActiveMusicFacts({ userId, trackUri = null, limit = 20 }) {
      required(userId, 'userId')
      const result = await pool.query(`
        SELECT id,kind,content,status,confidence,source,track_uri,track_title,track_artist,tags,created_at,
          0::double precision AS semantic_score,0::double precision AS keyword_score,'[]'::jsonb AS evidence
        FROM agent_memories
        WHERE user_id=$1 AND kind='preference' AND source='user_statement' AND status IN ('candidate','confirmed')
        ORDER BY CASE WHEN $2::text IS NOT NULL AND track_uri=$2 THEN 0 ELSE 1 END,updated_at DESC
        LIMIT $3
      `, [userId, trackUri, Math.max(1, Math.min(Number(limit) || 20, 50))])
      return result.rows.map(memoryRow)
    },
    async refreshTasteProfile({ userId, updatedAt = new Date().toISOString() }) {
      required(userId, 'userId')
      const factRows = await pool.query(`
        SELECT id,content,status,confidence,tags,created_at
        FROM agent_memories
        WHERE user_id=$1 AND kind='preference' AND source='user_statement' AND status IN ('candidate','confirmed')
        ORDER BY updated_at DESC
      `, [userId])
      const profile = consolidateTasteProfile(factRows.rows, iso(updatedAt, 'updatedAt'))
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const activeProfiles = await client.query(`
          SELECT id,content,confidence,tags FROM agent_memories
          WHERE user_id=$1 AND kind='preference' AND source='derived_profile' AND status='confirmed'
        `, [userId])
        const profilesByDimension = new Map(activeProfiles.rows.map((row) => [profileIdentity(row.tags), row]))
        for (const dimension of profile) {
          const identity = profileIdentity([`dimension:${dimension.dimension}`, ...(dimension.attribute ? [`attribute:${dimension.attribute}`] : [])])
          const existing = profilesByDimension.get(identity)
          const content = `${dimension.stance}:${dimension.summary}`
          if (existing?.content === content && Number(existing?.confidence) === dimension.confidence) {
            dimension.id = existing.id
            profilesByDimension.delete(identity)
            continue
          }
          if (existing) await client.query(`UPDATE agent_memories SET status='superseded',updated_at=$3 WHERE user_id=$1 AND id=$2`, [userId, existing.id, dimension.updatedAt])
          const id = randomUUID()
          await client.query(`
            INSERT INTO agent_memories (id,user_id,kind,content,status,confidence,source,tags,created_at,updated_at)
            VALUES ($1,$2,'preference',$3,'confirmed',$4,'derived_profile',$5,$6,$6)
          `, [id, userId, content, dimension.confidence, ['taste_profile', `dimension:${dimension.dimension}`, ...(dimension.attribute ? [`attribute:${dimension.attribute}`] : []), `stance:${dimension.stance}`], dimension.updatedAt])
          for (const factId of dimension.evidenceIds) await insertEvidence(client, {
            userId, memoryId: id, type: 'profile', sourceId: factId,
            content: `Taste Profile 由 Music Fact ${factId} 支持`, occurredAt: dimension.updatedAt,
          })
          dimension.id = id
          profilesByDimension.delete(identity)
        }
        // 删除或修正最后一条支撑 Fact 后，旧画像不能继续留在正式 Context。
        for (const stale of profilesByDimension.values()) await client.query(`UPDATE agent_memories SET status='superseded',updated_at=$3 WHERE user_id=$1 AND id=$2`, [userId, stale.id, iso(updatedAt, 'updatedAt')])
        await client.query('COMMIT')
        logInfo('memory', 'taste_profile_refreshed', { userId, dimensionCount: profile.length })
        return profile
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally { client.release() }
    },
    async listTasteProfile({ userId, limit = 3 }) {
      required(userId, 'userId')
      const result = await pool.query(`
        SELECT id,content,confidence,tags,updated_at,
          COALESCE((SELECT jsonb_agg(e.source_id ORDER BY e.occurred_at) FROM memory_evidence e
            WHERE e.user_id=m.user_id AND e.memory_id=m.id AND e.evidence_type='profile'),'[]'::jsonb) AS evidence_ids
        FROM agent_memories m
        WHERE user_id=$1 AND kind='preference' AND source='derived_profile' AND status='confirmed'
        ORDER BY confidence DESC,updated_at DESC LIMIT $2
      `, [userId, Math.max(1, Math.min(Number(limit) || 3, 10))])
      return result.rows.map(profileRow)
    },
    async retrieveAssociations({ userId, trackUri = null, memoryId = null, limit = 10 }) {
      required(userId, 'userId')
      if (!trackUri && !memoryId) return []
      const result = await pool.query(`
        WITH seed AS (
          SELECT id FROM memory_nodes
          WHERE user_id=$1 AND status='active'
            AND (($2::text IS NOT NULL AND node_type='CATALOG_TRACK' AND entity_key=$2)
              OR ($3::text IS NOT NULL AND node_type IN ('FACT','MOMENT') AND entity_key=$3))
        )
        SELECT e.relation,e.weight,e.properties,
          source.node_type AS source_type,source.entity_key AS source_key,source.label AS source_label,
          target.node_type AS target_type,target.entity_key AS target_key,target.label AS target_label
        FROM memory_edges e
        JOIN memory_nodes source ON source.id=e.from_node_id AND source.status='active'
        JOIN memory_nodes target ON target.id=e.to_node_id AND target.status='active'
        WHERE e.user_id=$1 AND e.status='active'
          AND (e.from_node_id IN (SELECT id FROM seed) OR e.to_node_id IN (SELECT id FROM seed))
        ORDER BY e.weight DESC,e.updated_at DESC LIMIT $4
      `, [userId, trackUri, memoryId, Math.max(1, Math.min(Number(limit) || 10, 25))])
      return result.rows.map(associationRow)
    },
    async rebuildAssociations({ userId }) {
      required(userId, 'userId')
      const memories = await pool.query(`
        SELECT id,kind,content,track_uri,track_title,track_artist,tags
        FROM agent_memories
        WHERE user_id=$1 AND status IN ('candidate','confirmed') AND source IN ('user_statement','user_moment')
      `, [userId])
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        for (const memory of memories.rows) await indexMemoryAssociations(client, {
          userId, memoryId: memory.id, kind: memory.kind === 'moment' ? 'MOMENT' : 'FACT', label: memory.content,
          track: memory.track_uri ? { uri: memory.track_uri, title: memory.track_title, artist: memory.track_artist } : null,
          dimension: memory.tags?.find((tag) => tag.startsWith('dimension:'))?.slice('dimension:'.length) ?? null,
          evidenceId: null,
        })
        await client.query('COMMIT')
        logInfo('memory', 'associations_rebuilt', { userId, memoryCount: memories.rows.length })
        return { indexed: memories.rows.length }
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally { client.release() }
    },
    async search({ userId, query, limit = 5 }) {
      required(userId, 'userId'); required(query, 'query')
      const boundedLimit = Math.max(1, Math.min(Number(limit) || 5, 10))
      const vector = await optionalEmbedding(embeddingProvider, query, logError)
      const result = vector
        ? await pool.query(`
            SELECT m.id, m.kind, m.content, m.status, m.confidence, m.source, m.track_uri, m.track_title, m.track_artist, m.mood, m.tags, m.created_at,
              GREATEST(0, 1 - (m.embedding <=> $2::vector)) AS semantic_score,
              similarity(m.content, $3) AS keyword_score, evidence.items AS evidence
            FROM agent_memories m
            LEFT JOIN LATERAL (
              SELECT jsonb_agg(jsonb_build_object('id',e.id,'type',e.evidence_type,'content',e.content,'occurredAt',e.occurred_at) ORDER BY e.occurred_at) AS items
              FROM memory_evidence e WHERE e.user_id=m.user_id AND e.memory_id=m.id
            ) evidence ON true
            WHERE m.user_id = $1 AND m.status IN ('candidate','confirmed')
            ORDER BY (0.75 * CASE WHEN m.embedding IS NULL THEN 0 ELSE GREATEST(0, 1 - (m.embedding <=> $2::vector)) END + 0.25 * similarity(m.content, $3)) DESC, m.updated_at DESC
            LIMIT $4
          `, [userId, vectorLiteral(vector), query, boundedLimit])
        : await pool.query(`
            SELECT m.id, m.kind, m.content, m.status, m.confidence, m.source, m.track_uri, m.track_title, m.track_artist, m.mood, m.tags, m.created_at,
              0::double precision AS semantic_score, similarity(m.content, $2) AS keyword_score, evidence.items AS evidence
            FROM agent_memories m
            LEFT JOIN LATERAL (
              SELECT jsonb_agg(jsonb_build_object('id',e.id,'type',e.evidence_type,'content',e.content,'occurredAt',e.occurred_at) ORDER BY e.occurred_at) AS items
              FROM memory_evidence e WHERE e.user_id=m.user_id AND e.memory_id=m.id
            ) evidence ON true
            WHERE m.user_id = $1 AND m.status IN ('candidate','confirmed')
              AND (m.content % $2 OR m.content ILIKE '%' || $2 || '%')
            ORDER BY similarity(m.content, $2) DESC, m.updated_at DESC
            LIMIT $3
          `, [userId, query, boundedLimit])
      const matches = result.rows.map(memoryRow)
      if (matches.length) await pool.query('UPDATE agent_memories SET last_accessed_at = now() WHERE user_id = $1 AND id = ANY($2::uuid[])', [userId, matches.map((item) => item.id)])
      logInfo('memory', 'search_completed', { userId, query, matchCount: matches.length, mode: vector ? 'hybrid' : 'keyword' })
      return matches
    },
    async list({ userId, limit = 50 }) {
      required(userId, 'userId')
      const boundedLimit = Math.max(1, Math.min(Number(limit) || 50, 200))
      const result = await pool.query(`
        SELECT id,kind,content,status,confidence,source,track_uri,track_title,track_artist,mood,tags,created_at,
          0::double precision semantic_score, 0::double precision keyword_score, '[]'::jsonb evidence
        FROM agent_memories WHERE user_id=$1 AND status <> 'deleted' ORDER BY updated_at DESC LIMIT $2
      `, [userId, boundedLimit])
      return result.rows.map(memoryRow)
    },
    async softDelete({ userId, id }) {
      required(userId, 'userId'); required(id, 'id')
      const result = await pool.query(`UPDATE agent_memories SET status='deleted',embedding=NULL,updated_at=now() WHERE user_id=$1 AND id=$2 AND status<>'deleted' RETURNING id`, [userId, id])
      await pool.query(`UPDATE memory_nodes SET status='deleted',updated_at=now() WHERE user_id=$1 AND entity_key=$2`, [userId, id])
      logInfo('memory', 'memory_deleted', { userId, memoryId: id, deleted: result.rowCount > 0 })
      return result.rowCount > 0
    },
    async confirmMemory({ userId, id }) {
      required(userId, 'userId'); required(id, 'id')
      const result = await pool.query(`
        UPDATE agent_memories SET status='confirmed',updated_at=now()
        WHERE user_id=$1 AND id=$2 AND status='candidate'
        RETURNING id,kind,source
      `, [userId, id])
      const confirmed = result.rows[0] ?? null
      logInfo('memory', 'memory_confirmed', { userId, memoryId: id, confirmed: Boolean(confirmed) })
      return confirmed
    },
    async health() {
      const result = await pool.query('SELECT current_database() AS database, extversion FROM pg_extension WHERE extname = $1', ['vector'])
      return { available: true, backend: 'postgres_pgvector', database: result.rows[0]?.database ?? null, pgvectorVersion: result.rows[0]?.extversion ?? null, embeddingModel: embeddingProvider?.model ?? null }
    },
    close: () => injectedPool ? Promise.resolve() : pool.end(),
  }
}

export function createUnavailableMemoryRepository(reason) {
  return {
    available: false,
    backend: 'unavailable',
    reason,
    appendConversationMessage: async () => ({ stored: false, reason }),
    appendListeningEvent: async () => ({ stored: false, reason }),
    createMoment: async () => ({ stored: false, reason }),
    upsertMusicFact: async () => ({ stored: false, reason }),
    createMusicMoment: async () => ({ stored: false, reason }),
    retrieveRelevant: async () => [],
    listActiveMusicFacts: async () => [],
    refreshTasteProfile: async () => [],
    listTasteProfile: async () => [],
    retrieveAssociations: async () => [],
    rebuildAssociations: async () => ({ indexed: 0 }),
    search: async () => [],
    list: async () => [],
    softDelete: async () => false,
    confirmMemory: async () => null,
    health: async () => ({ available: false, backend: 'unavailable', reason }),
    close: async () => {},
  }
}

async function markDayDirty(client, userId, localDate, timeZone) {
  await client.query(`
    INSERT INTO daily_analyses (user_id, local_date, time_zone, analysis_status, updated_at)
    VALUES ($1,$2,$3,'dirty',now())
    ON CONFLICT (user_id, local_date) DO UPDATE SET analysis_status = 'dirty', time_zone = EXCLUDED.time_zone, updated_at = now()
  `, [userId, localDate, timeZone])
}

async function upsertNode(client, userId, nodeType, entityKey, label, properties) {
  const result = await client.query(`
    INSERT INTO memory_nodes (id, user_id, node_type, entity_key, label, properties)
    VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (user_id, node_type, entity_key) DO UPDATE SET label = EXCLUDED.label, properties = memory_nodes.properties || EXCLUDED.properties, updated_at = now()
    RETURNING id
  `, [randomUUID(), userId, nodeType, entityKey, label, properties])
  return result.rows[0].id
}

async function connect(client, userId, fromNodeId, relation, toNodeId, evidenceId, weight, properties) {
  await client.query(`
    INSERT INTO memory_edges (id, user_id, from_node_id, relation, to_node_id, evidence_id, weight, properties)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (user_id, from_node_id, relation, to_node_id, evidence_id)
    DO UPDATE SET weight = EXCLUDED.weight, properties = memory_edges.properties || EXCLUDED.properties, status = 'active', updated_at = now()
  `, [randomUUID(), userId, fromNodeId, relation, toNodeId, evidenceId, weight, properties])
}

async function refreshFrequentTrackGraph(pool, userId, track) {
  const count = await pool.query(`
    SELECT count(*)::integer AS plays FROM listening_events
    WHERE user_id = $1 AND track_uri = $2 AND event_type = 'completed'
  `, [userId, track.uri])
  const plays = count.rows[0]?.plays ?? 0
  // “经常听”必须由重复行为支持；单次播放只保留为事实，不提前上升为偏好关系。
  if (plays < 3) return
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const userNode = await upsertNode(client, userId, 'USER', userId, 'Mori 用户', {})
    const trackNode = await upsertNode(client, userId, 'CATALOG_TRACK', track.uri, track.title, { artist: track.artist, isrc: track.isrc ?? null, completedPlays: plays })
    const artistNode = await upsertNode(client, userId, 'ARTIST', track.artist, track.artist, {})
    await connectAggregate(client, userId, userNode, 'LISTENS_OFTEN', trackNode, Math.min(1, plays / 10), { completedPlays: plays })
    await connectAggregate(client, userId, trackNode, 'PERFORMED_BY', artistNode, 1, {})
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}

async function connectAggregate(client, userId, fromNodeId, relation, toNodeId, weight, properties) {
  const existing = await client.query(`
    SELECT id FROM memory_edges
    WHERE user_id=$1 AND from_node_id=$2 AND relation=$3 AND to_node_id=$4 AND evidence_id IS NULL
    LIMIT 1
  `, [userId, fromNodeId, relation, toNodeId])
  if (existing.rows[0]) {
    await client.query('UPDATE memory_edges SET weight=$2, properties=$3, status=\'active\', updated_at=now() WHERE id=$1', [existing.rows[0].id, weight, properties])
  } else {
    await client.query(`INSERT INTO memory_edges (id,user_id,from_node_id,relation,to_node_id,weight,properties) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [randomUUID(), userId, fromNodeId, relation, toNodeId, weight, properties])
  }
}

async function optionalEmbedding(provider, text, logError) {
  if (!provider) return null
  try { return await provider.embed(text) }
  catch (error) { logError('memory', 'embedding_failed', error, { model: provider.model }); return null }
}

async function insertEvidence(client, { userId, memoryId, type, sourceId, content, occurredAt }) {
  const id = randomUUID()
  const inserted = await client.query(`
    INSERT INTO memory_evidence (id,user_id,memory_id,evidence_type,source_id,content,occurred_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (user_id,memory_id,evidence_type,source_id) DO NOTHING
    RETURNING id
  `, [id, userId, memoryId, type, sourceId, content, occurredAt])
  if (inserted.rows?.[0]?.id) return inserted.rows[0].id
  const existing = await client.query(`SELECT id FROM memory_evidence WHERE user_id=$1 AND memory_id=$2 AND evidence_type=$3 AND source_id=$4`, [userId, memoryId, type, sourceId])
  return existing.rows[0]?.id ?? null
}

async function indexMemoryAssociations(client, { userId, memoryId, kind, label, track, dimension = null, evidenceId = null }) {
  const userNode = await upsertNode(client, userId, 'USER', userId, 'Mori 用户', {})
  const memoryNode = await upsertNode(client, userId, kind, memoryId, label, {})
  await connectAggregate(client, userId, userNode, kind === 'MOMENT' ? 'SAVED_MOMENT' : 'HAS_FACT', memoryNode, 1, {})
  if (track) {
    const trackNode = await upsertNode(client, userId, 'CATALOG_TRACK', track.uri, track.title, { artist: track.artist })
    if (evidenceId) await connect(client, userId, memoryNode, 'ABOUT_TRACK', trackNode, evidenceId, 1, {})
    else await connectAggregate(client, userId, memoryNode, 'ABOUT_TRACK', trackNode, 1, {})
  }
  if (dimension) {
    const dimensionNode = await upsertNode(client, userId, 'TASTE_DIMENSION', dimension, dimension, {})
    if (evidenceId) await connect(client, userId, memoryNode, 'DESCRIBES_TASTE', dimensionNode, evidenceId, 1, {})
    else await connectAggregate(client, userId, memoryNode, 'DESCRIBES_TASTE', dimensionNode, 1, {})
  }
}

function conversationInput(input) {
  const createdAt = iso(input.createdAt, 'createdAt'); const timeZone = validTimeZone(input.timeZone)
  return { id: input.id ?? randomUUID(), userId: required(input.userId, 'userId'), exchangeId: required(input.exchangeId, 'exchangeId'),
    role: oneOf(input.role, ['user', 'assistant'], 'role'), content: required(input.content, 'content'), status: oneOf(input.status, ['pending', 'completed', 'failed'], 'status'),
    track: optionalTrack(input.track), timeZone, createdAt, localDate: localDate(createdAt, timeZone) }
}
function listeningInput(input) {
  const occurredAt = iso(input.occurredAt, 'occurredAt'); const timeZone = validTimeZone(input.timeZone)
  return { eventId: input.eventId ?? randomUUID(), userId: required(input.userId, 'userId'), type: oneOf(input.type, ['started', 'progress', 'paused', 'completed', 'skipped'], 'type'),
    source: oneOf(input.source ?? 'unknown', ['user_selected', 'agent_selected', 'autoplay', 'unknown'], 'source'), track: requiredTrack(input.track),
    positionMs: nonNegative(input.positionMs, 'positionMs'), durationMs: nonNegative(input.durationMs, 'durationMs'), timeZone, occurredAt, localDate: localDate(occurredAt, timeZone) }
}
function momentInput(input) {
  return { id: required(input.id, 'id'), userId: required(input.userId, 'userId'), content: required(input.content, 'content'), mood: required(input.mood, 'mood'),
    tags: Array.isArray(input.tags) ? input.tags.map(String).slice(0, 20) : [], track: optionalTrack(input.track), createdAt: iso(input.createdAt, 'createdAt'), evidenceId: input.evidenceId }
}
function musicFactInput(input) {
  const confidence = Number(input.confidence ?? 1)
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error('confidence 无效')
  return {
    userId: required(input.userId, 'userId'),
    category: oneOf(input.category, ['preference', 'dislike', 'music_fact'], 'category'),
    content: required(input.content, 'content'),
    dimension: input.dimension ? required(input.dimension, 'dimension') : null,
    attribute: input.attribute ? required(input.attribute, 'attribute') : null,
    sourceMessageId: required(input.sourceMessageId, 'sourceMessageId'),
    evidence: required(input.evidence, 'evidence'),
    track: optionalTrack(input.track),
    confidence,
    confirmed: input.confirmed === true,
    supersedesId: input.supersedesId ? required(input.supersedesId, 'supersedesId') : null,
    createdAt: iso(input.createdAt, 'createdAt'),
  }
}
function musicFactKey(value) {
  if (!value.dimension || !value.attribute) return null
  return `fact_key:${value.category}:${value.dimension}:${value.attribute}`.toLowerCase()
}
function musicMomentInput(input) {
  if (!Array.isArray(input.sourceMessageIds) || input.sourceMessageIds.length === 0) throw new Error('sourceMessageIds 不能为空')
  return {
    id: input.id ? required(input.id, 'id') : randomUUID(),
    userId: required(input.userId, 'userId'),
    summary: required(input.summary, 'summary'),
    userReflection: input.userReflection ? required(input.userReflection, 'userReflection') : null,
    sourceMessageIds: [...new Set(input.sourceMessageIds.map((value) => required(value, 'sourceMessageIds[]')))].slice(0, 50),
    track: optionalTrack(input.track),
    confirmed: input.confirmed === true,
    occurredAt: iso(input.occurredAt, 'occurredAt'),
  }
}
function memoryRow(row) { return { id: row.id, kind: row.kind, content: row.content, status: row.status, confidence: Number(row.confidence), source: row.source,
  score: Math.max(Number(row.semantic_score) || 0, Number(row.keyword_score) || 0), mood: row.mood ?? undefined, tags: row.tags ?? [], createdAt: row.created_at,
  ...(row.match_reason ? { matchReason: row.match_reason } : {}),
  evidence: row.evidence ?? [],
  ...(row.track_uri ? { track: { uri: row.track_uri, title: row.track_title, artist: row.track_artist } } : {}) } }
function profileRow(row) {
  const tags = row.tags ?? []
  return {
    id: row.id,
    dimension: tags.find((tag) => tag.startsWith('dimension:'))?.slice('dimension:'.length) ?? 'unknown',
    attribute: tags.find((tag) => tag.startsWith('attribute:'))?.slice('attribute:'.length) ?? null,
    stance: tags.find((tag) => tag.startsWith('stance:'))?.slice('stance:'.length) ?? 'mixed',
    summary: String(row.content).replace(/^[^:]+:/u, ''),
    confidence: Number(row.confidence),
    evidenceIds: row.evidence_ids ?? [],
    updatedAt: row.updated_at,
  }
}
function profileIdentity(tags = []) {
  const dimension = tags.find((tag) => tag.startsWith('dimension:'))?.slice('dimension:'.length) ?? 'unknown'
  const attribute = tags.find((tag) => tag.startsWith('attribute:'))?.slice('attribute:'.length) ?? ''
  return `${dimension}\u0000${attribute}`
}
function associationRow(row) {
  return {
    relation: row.relation,
    weight: Number(row.weight),
    source: { type: row.source_type, key: row.source_key, label: row.source_label },
    target: { type: row.target_type, key: row.target_key, label: row.target_label },
    properties: row.properties ?? {},
  }
}
function optionalTrack(value) { return value ? requiredTrack(value) : null }
function requiredTrack(value) { if (!value || typeof value !== 'object') throw new Error('track 必须是对象'); return { uri: required(value.uri, 'track.uri'), title: required(value.title, 'track.title'), artist: required(value.artist, 'track.artist'), ...(value.isrc ? { isrc: String(value.isrc) } : {}) } }
function required(value, name) { if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} 不能为空`); return value.trim() }
function oneOf(value, values, name) { if (!values.includes(value)) throw new Error(`${name} 无效`); return value }
function nonNegative(value, name) { const number = Number(value); if (!Number.isFinite(number) || number < 0) throw new Error(`${name} 无效`); return Math.round(number) }
function iso(value, name) { const date = new Date(value); if (!value || Number.isNaN(date.valueOf())) throw new Error(`${name} 无效`); return date.toISOString() }
function validTimeZone(value) { const zone = required(value, 'timeZone'); try { new Intl.DateTimeFormat('en', { timeZone: zone }).format() } catch { throw new Error('timeZone 无效') } return zone }
function localDate(value, timeZone) { const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value)); const get = (type) => parts.find((part) => part.type === type)?.value; return `${get('year')}-${get('month')}-${get('day')}` }
function vectorLiteral(vector) { return `[${vector.join(',')}]` }
