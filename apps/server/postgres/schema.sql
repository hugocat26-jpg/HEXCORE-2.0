-- HEXCORE 2.0 多人端 PostgreSQL 正式持久化 schema 第一版。
-- 设计目标：保存服务端权威状态、房间凭据摘要、session 摘要、公开事件、
-- 审计摘要和回滚检查点；不保存房间码明文或 sessionToken 明文。

CREATE TABLE IF NOT EXISTS hexcore_schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  checksum TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hexcore_tournaments (
  tournament_id VARCHAR(80) PRIMARY KEY,
  state_version INTEGER NOT NULL DEFAULT 0,
  state_json JSONB NOT NULL,
  state_checksum TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT hexcore_tournaments_id_safe
    CHECK (tournament_id ~ '^[A-Za-z0-9._:-]{1,80}$')
);

CREATE TABLE IF NOT EXISTS hexcore_room_access (
  tournament_id VARCHAR(80) PRIMARY KEY
    REFERENCES hexcore_tournaments(tournament_id) ON DELETE CASCADE,
  access_json JSONB NOT NULL,
  access_checksum TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT hexcore_room_access_no_plain_codes
    CHECK (
      access_json::TEXT NOT LIKE '%"refereeCode":%'
      AND access_json::TEXT NOT LIKE '%"viewerCode":%'
      AND access_json::TEXT NOT LIKE '%"code":%'
    )
);

CREATE TABLE IF NOT EXISTS hexcore_sessions (
  session_token_hash TEXT PRIMARY KEY,
  tournament_id VARCHAR(80) NOT NULL
    REFERENCES hexcore_tournaments(tournament_id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL,
  team_id TEXT NOT NULL DEFAULT '',
  joined_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  session_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT hexcore_sessions_role
    CHECK (role IN ('referee', 'tournament_admin', 'super_admin', 'captain', 'viewer')),
  CONSTRAINT hexcore_sessions_no_plain_token
    CHECK (
      session_json::TEXT NOT LIKE '%"sessionToken"%'
      AND session_json::TEXT NOT LIKE '%"streamToken"%'
    )
);

CREATE INDEX IF NOT EXISTS hexcore_sessions_tournament_idx
  ON hexcore_sessions(tournament_id);

CREATE INDEX IF NOT EXISTS hexcore_sessions_expiry_idx
  ON hexcore_sessions(expires_at);

CREATE TABLE IF NOT EXISTS hexcore_events (
  tournament_id VARCHAR(80) NOT NULL
    REFERENCES hexcore_tournaments(tournament_id) ON DELETE CASCADE,
  event_seq BIGINT NOT NULL,
  event_type TEXT NOT NULL,
  public_event_json JSONB NOT NULL,
  private_event_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, event_seq)
);

CREATE INDEX IF NOT EXISTS hexcore_events_type_idx
  ON hexcore_events(tournament_id, event_type);

CREATE TABLE IF NOT EXISTS hexcore_audit_log (
  tournament_id VARCHAR(80) NOT NULL
    REFERENCES hexcore_tournaments(tournament_id) ON DELETE CASCADE,
  audit_seq BIGINT NOT NULL,
  event_type TEXT NOT NULL,
  actor_id TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  summary_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, audit_seq),
  CONSTRAINT hexcore_audit_no_plain_token
    CHECK (
      summary_json::TEXT NOT LIKE '%sessionToken%'
      AND summary_json::TEXT NOT LIKE '%streamToken%'
      AND summary_json::TEXT NOT LIKE '%refereeCode%'
      AND summary_json::TEXT NOT LIKE '%viewerCode%'
    )
);

CREATE TABLE IF NOT EXISTS hexcore_checkpoints (
  tournament_id VARCHAR(80) NOT NULL
    REFERENCES hexcore_tournaments(tournament_id) ON DELETE CASCADE,
  state_version INTEGER NOT NULL,
  checkpoint_json JSONB NOT NULL,
  checkpoint_checksum TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, state_version)
);

CREATE INDEX IF NOT EXISTS hexcore_checkpoints_latest_idx
  ON hexcore_checkpoints(tournament_id, state_version DESC);

INSERT INTO hexcore_schema_migrations (version, checksum)
VALUES ('001_initial_postgres_schema', 'manual-schema-v1')
ON CONFLICT (version) DO NOTHING;
