CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  stage smallint NOT NULL DEFAULT 1 CHECK (stage BETWEEN 1 AND 4),
  confirmed boolean NOT NULL DEFAULT false,
  knowledge_links_skipped boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id uuid NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  input_type text NOT NULL CHECK (input_type IN ('text', 'pdf')),
  original_name text,
  mime_type text,
  storage_path text,
  raw_text text NOT NULL DEFAULT '',
  extracted_text text NOT NULL DEFAULT '',
  processing_status text NOT NULL DEFAULT 'ready'
    CHECK (processing_status IN ('pending', 'processing', 'ready', 'failed')),
  processing_error text,
  sha256 text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id uuid NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN (
    'learning',
    'viewpoint_revision',
    'integration_comparison',
    'integration_revision'
  )),
  role text NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
  content text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE viewpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id uuid NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  version integer NOT NULL,
  content text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'superseded')),
  source_message_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  UNIQUE (record_id, version)
);

CREATE TABLE integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id uuid NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  related_record_id uuid NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('challenge', 'draft', 'confirmed')),
  comparison_answer text NOT NULL DEFAULT '',
  challenge text NOT NULL DEFAULT '',
  challenge_answer text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  relation_type text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  CHECK (record_id <> related_record_id)
);

CREATE TABLE knowledge_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_record_id uuid NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  target_record_id uuid NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  integration_id uuid REFERENCES integrations(id) ON DELETE SET NULL,
  relation_type text NOT NULL CHECK (relation_type IN (
    'causal',
    'contradictory',
    'complementary',
    'supporting',
    'revision',
    'conditional'
  )),
  is_directional boolean NOT NULL DEFAULT false,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_record_id <> target_record_id),
  UNIQUE (source_record_id, target_record_id, relation_type)
);

CREATE INDEX records_updated_at_idx ON records (updated_at DESC);
CREATE INDEX records_title_trgm_idx ON records USING gin (title gin_trgm_ops);
CREATE INDEX materials_record_id_idx ON materials (record_id);
CREATE INDEX messages_record_channel_created_idx ON messages (record_id, channel, created_at);
CREATE INDEX viewpoints_record_status_idx ON viewpoints (record_id, status);
CREATE INDEX integrations_record_status_idx ON integrations (record_id, status);
CREATE INDEX knowledge_links_source_idx ON knowledge_links (source_record_id);
CREATE INDEX knowledge_links_target_idx ON knowledge_links (target_record_id);
