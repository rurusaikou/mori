CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS conversation_messages (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  local_date date NOT NULL,
  time_zone text NOT NULL,
  exchange_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
  track_uri text,
  track_title text,
  track_artist text,
  created_at timestamptz NOT NULL,
  UNIQUE (user_id, exchange_id, role)
);
CREATE INDEX IF NOT EXISTS conversation_messages_user_day_idx ON conversation_messages (user_id, local_date, created_at);

CREATE TABLE IF NOT EXISTS listening_events (
  event_id uuid PRIMARY KEY,
  user_id text NOT NULL,
  local_date date NOT NULL,
  time_zone text NOT NULL,
  track_uri text NOT NULL,
  track_isrc text,
  track_title text NOT NULL,
  track_artist text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('started', 'progress', 'paused', 'completed', 'skipped')),
  position_ms integer NOT NULL CHECK (position_ms >= 0),
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  source text NOT NULL CHECK (source IN ('user_selected', 'agent_selected', 'autoplay', 'unknown')),
  occurred_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS listening_events_user_day_idx ON listening_events (user_id, local_date, occurred_at);
CREATE INDEX IF NOT EXISTS listening_events_user_track_idx ON listening_events (user_id, track_uri, occurred_at);

CREATE TABLE IF NOT EXISTS daily_analyses (
  user_id text NOT NULL,
  local_date date NOT NULL,
  time_zone text NOT NULL,
  analysis_status text NOT NULL DEFAULT 'dirty' CHECK (analysis_status IN ('dirty', 'analyzing', 'completed', 'failed')),
  source_digest text NOT NULL DEFAULT '',
  summary text,
  analysis jsonb,
  embedding vector(__EMBEDDING_DIMENSIONS__),
  embedding_model text,
  analysis_version text,
  analyzed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, local_date)
);

CREATE TABLE IF NOT EXISTS agent_memories (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('conversation', 'moment', 'listening', 'preference')),
  content text NOT NULL,
  status text NOT NULL CHECK (status IN ('candidate', 'confirmed', 'superseded', 'deleted')),
  confidence double precision NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  source text NOT NULL CHECK (source IN ('user_statement', 'user_moment', 'playback_event', 'derived_profile')),
  track_uri text,
  track_title text,
  track_artist text,
  mood text,
  tags text[] NOT NULL DEFAULT '{}',
  embedding vector(__EMBEDDING_DIMENSIONS__),
  embedding_model text,
  supersedes_id uuid REFERENCES agent_memories(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_accessed_at timestamptz
);
CREATE INDEX IF NOT EXISTS agent_memories_user_status_idx ON agent_memories (user_id, kind, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS agent_memories_search_idx ON agent_memories USING gin (to_tsvector('simple', content));
CREATE INDEX IF NOT EXISTS agent_memories_trgm_idx ON agent_memories USING gin (content gin_trgm_ops);
CREATE INDEX IF NOT EXISTS agent_memories_embedding_idx ON agent_memories USING hnsw (embedding vector_cosine_ops) WHERE embedding IS NOT NULL;

CREATE TABLE IF NOT EXISTS memory_evidence (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  memory_id uuid NOT NULL REFERENCES agent_memories(id) ON DELETE CASCADE,
  evidence_type text NOT NULL CHECK (evidence_type IN ('message', 'moment', 'playback', 'profile')),
  source_id text NOT NULL,
  content text NOT NULL,
  occurred_at timestamptz NOT NULL,
  UNIQUE (user_id, memory_id, evidence_type, source_id)
);
CREATE INDEX IF NOT EXISTS memory_evidence_memory_idx ON memory_evidence (user_id, memory_id, occurred_at);

CREATE TABLE IF NOT EXISTS memory_nodes (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  node_type text NOT NULL,
  entity_key text NOT NULL,
  label text NOT NULL,
  properties jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, node_type, entity_key)
);

CREATE TABLE IF NOT EXISTS memory_edges (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  from_node_id uuid NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
  relation text NOT NULL,
  to_node_id uuid NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
  evidence_id uuid REFERENCES memory_evidence(id) ON DELETE SET NULL,
  weight double precision NOT NULL DEFAULT 1 CHECK (weight >= 0 AND weight <= 1),
  properties jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, from_node_id, relation, to_node_id, evidence_id)
);
CREATE INDEX IF NOT EXISTS memory_edges_from_idx ON memory_edges (user_id, from_node_id, relation, status);
CREATE INDEX IF NOT EXISTS memory_edges_to_idx ON memory_edges (user_id, to_node_id, relation, status);
