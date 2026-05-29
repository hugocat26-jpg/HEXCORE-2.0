const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { MemoryTournamentStore, hashSecret, roomAccessSummary } = require('./memory-store');
const { ROLES } = require('../../packages/shared');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function checksumJson(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function loadPg() {
  try {
    return require('pg');
  } catch (error) {
    const wrapped = new Error('启用 HEXCORE_POSTGRES_URL 需要先安装 pg 依赖');
    wrapped.cause = error;
    throw wrapped;
  }
}

class PostgresTournamentStore extends MemoryTournamentStore {
  constructor(options = {}) {
    super({ dataFile: '', sessionTtlMs: options.sessionTtlMs });
    const connectionString = String(options.connectionString || process.env.HEXCORE_POSTGRES_URL || '').trim();
    if (!connectionString) throw new Error('HEXCORE_POSTGRES_URL 不能为空');
    const { Pool } = loadPg();
    this.pool = new Pool({
      connectionString,
      max: Number(options.maxConnections || process.env.HEXCORE_POSTGRES_POOL_SIZE || 4),
      application_name: 'hexcore-multiplayer',
    });
    this.eventPollMs = Math.max(250, Number(options.eventPollMs || process.env.HEXCORE_POSTGRES_EVENT_POLL_MS || 1000));
    this.eventWatermarks = new Map();
    this.eventPollTimer = null;
    this.eventPollRunning = false;
  }

  static async create(options = {}) {
    const store = new PostgresTournamentStore(options);
    await store.ensureSchema();
    await store.loadFromPostgres();
    return store;
  }

  storageLabel() {
    return 'postgres';
  }

  async publicStats() {
    const subscriberCount = Array.from(this.subscribers.values()).reduce((sum, bucket) => sum + bucket.size, 0);
    return {
      storage: this.storageLabel(),
      tournamentCount: this.tournaments.size,
      roomCount: this.roomAccess.size,
      sessionTtlSeconds: Math.max(1, Math.ceil(this.sessionTtlMs / 1000)),
      subscriberCount,
      crossInstanceEventPolling: true,
      eventPollMs: this.eventPollMs,
    };
  }

  async ensureSchema() {
    const schemaPath = path.join(__dirname, 'postgres', 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    await this.pool.query(schema);
  }

  async loadFromPostgres() {
    const [tournaments, roomAccess, sessions] = await Promise.all([
      this.pool.query('SELECT tournament_id, state_json FROM hexcore_tournaments'),
      this.pool.query('SELECT tournament_id, access_json FROM hexcore_room_access'),
      this.pool.query('SELECT session_token_hash, session_json FROM hexcore_sessions'),
    ]);
    this.tournaments = new Map(tournaments.rows.map(row => [String(row.tournament_id), clone(row.state_json)]));
    this.roomAccess = new Map(roomAccess.rows.map(row => [String(row.tournament_id), clone(row.access_json)]));
    this.sessions = new Map(sessions.rows.map(row => [String(row.session_token_hash), clone(row.session_json)]));
    this.initialRoomAccess = new Map();
    this.subscribers = new Map(Array.from(this.tournaments.keys()).map(id => [id, new Set()]));
    for (const [id, state] of this.tournaments.entries()) {
      this.eventWatermarks.set(id, latestEventSeq(state));
    }
  }

  async refreshTournamentFromPostgres(id) {
    const result = await this.pool.query('SELECT state_json FROM hexcore_tournaments WHERE tournament_id = $1', [id]);
    const row = result.rows[0];
    if (!row || !row.state_json) return null;
    const state = clone(row.state_json);
    this.tournaments.set(id, state);
    if (!this.eventWatermarks.has(id)) this.eventWatermarks.set(id, latestEventSeq(state));
    return clone(state);
  }

  persistToDisk() {
    // PostgreSQL 持久化必须由显式 await 的方法完成，避免请求链路里出现未等待写入。
  }

  async persistToPostgres() {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const [id, state] of this.tournaments.entries()) {
        await client.query(
          `INSERT INTO hexcore_tournaments (tournament_id, state_version, state_json, state_checksum, updated_at)
           VALUES ($1, $2, $3::jsonb, $4, now())
           ON CONFLICT (tournament_id) DO UPDATE
           SET state_version = excluded.state_version,
               state_json = excluded.state_json,
               state_checksum = excluded.state_checksum,
               updated_at = excluded.updated_at`,
          [id, Number(state.stateVersion) || 0, JSON.stringify(state), checksumJson(state)]
        );
        await this.persistTournamentDetailRows(client, id, state);
      }

      for (const [id, access] of this.roomAccess.entries()) {
        await client.query(
          `INSERT INTO hexcore_room_access (tournament_id, access_json, access_checksum, updated_at)
           VALUES ($1, $2::jsonb, $3, now())
           ON CONFLICT (tournament_id) DO UPDATE
           SET access_json = excluded.access_json,
               access_checksum = excluded.access_checksum,
               updated_at = excluded.updated_at`,
          [id, JSON.stringify(access), checksumJson(access)]
        );
      }

      for (const [hash, session] of this.sessions.entries()) {
        await client.query(
          `INSERT INTO hexcore_sessions
             (session_token_hash, tournament_id, actor_id, display_name, role, team_id, joined_at, expires_at, session_json, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now())
           ON CONFLICT (session_token_hash) DO UPDATE
           SET display_name = excluded.display_name,
               role = excluded.role,
               team_id = excluded.team_id,
               expires_at = excluded.expires_at,
               session_json = excluded.session_json,
               updated_at = excluded.updated_at`,
          [
            hash,
            session.tournamentId,
            session.actorId,
            session.displayName || '',
            session.role,
            session.teamId || '',
            session.joinedAt || session.issuedAt || new Date().toISOString(),
            session.expiresAt,
            JSON.stringify(session),
          ]
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async persistTournamentDetailRows(client, id, state) {
    await client.query('DELETE FROM hexcore_events WHERE tournament_id = $1', [id]);
    const events = Array.isArray(state.events) ? state.events : [];
    for (const event of events) {
      await client.query(
        `INSERT INTO hexcore_events (tournament_id, event_seq, event_type, public_event_json, private_event_json, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)`,
        [
          id,
          Number(event.eventSeq) || 0,
          String(event.type || ''),
          JSON.stringify(publicEventSummary(event)),
          JSON.stringify(event),
          event.createdAt || new Date().toISOString(),
        ]
      );
    }

    await client.query('DELETE FROM hexcore_audit_log WHERE tournament_id = $1', [id]);
    const auditLog = Array.isArray(state.auditLog) ? state.auditLog : [];
    for (let index = 0; index < auditLog.length; index += 1) {
      const audit = auditLog[index];
      await client.query(
        `INSERT INTO hexcore_audit_log (tournament_id, audit_seq, event_type, actor_id, role, summary_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
        [
          id,
          Number(audit.auditSeq || audit.eventSeq || index + 1),
          String(audit.eventType || audit.type || ''),
          String(audit.actorId || ''),
          String(audit.role || ''),
          JSON.stringify(audit),
          audit.createdAt || new Date().toISOString(),
        ]
      );
    }

    await client.query('DELETE FROM hexcore_checkpoints WHERE tournament_id = $1', [id]);
    const checkpoints = state.checkpoints && typeof state.checkpoints === 'object' ? state.checkpoints : {};
    for (const [version, checkpoint] of Object.entries(checkpoints)) {
      await client.query(
        `INSERT INTO hexcore_checkpoints (tournament_id, state_version, checkpoint_json, checkpoint_checksum)
         VALUES ($1, $2, $3::jsonb, $4)`,
        [id, Number(version) || 0, JSON.stringify(checkpoint), checksumJson(checkpoint)]
      );
    }
  }

  async createTournament(input = {}) {
    const state = super.createTournament(input);
    try {
      await this.persistToPostgres();
      return state;
    } catch (error) {
      this.tournaments.delete(state.tournamentId);
      this.roomAccess.delete(state.tournamentId);
      this.initialRoomAccess.delete(state.tournamentId);
      this.subscribers.delete(state.tournamentId);
      throw error;
    }
  }

  async replaceTournament(id, nextState) {
    if (!this.tournaments.has(id)) throw new Error(`赛事不存在：${id}`);
    const previous = this.tournaments.get(id);
    this.tournaments.set(id, clone(nextState));
    let state = null;
    try {
      await this.persistToPostgres();
      state = clone(nextState);
    } catch (error) {
      this.tournaments.set(id, previous);
      throw error;
    }
    const event = nextState.events[nextState.events.length - 1] || null;
    if (event) {
      this.eventWatermarks.set(id, Math.max(Number(this.eventWatermarks.get(id)) || 0, Number(event.eventSeq) || 0));
      this.publish(id, event, nextState);
    }
    return state;
  }

  async consumeInitialRoomAccess(id) {
    return super.consumeInitialRoomAccess(id);
  }

  async getTournament(id) {
    return this.refreshTournamentFromPostgres(id);
  }

  async getRoomAccess(id, sessionToken) {
    const access = this.roomAccess.get(id);
    if (!access) return null;
    await this.requireManagementSession(id, sessionToken, '房间码管理信息');
    return roomAccessSummary(access);
  }

  async getAuditLog(id, sessionToken) {
    const state = this.tournaments.get(id);
    if (!state) return null;
    await this.requireManagementSession(id, sessionToken, '裁判审计日志');
    return clone(Array.isArray(state.auditLog) ? state.auditLog : []);
  }

  async getTournamentBackup(id, sessionToken) {
    const state = this.tournaments.get(id);
    if (!state) return null;
    await this.requireManagementSession(id, sessionToken, '赛事备份');
    const tournament = clone(state);
    return {
      backupVersion: 'hexcore-multiplayer-backup-v1',
      exportedAt: new Date().toISOString(),
      storage: this.storageLabel(),
      checksum: checksumJson(tournament),
      tournament,
    };
  }

  async joinTournament(id, input = {}) {
    const session = super.joinTournament(id, input);
    try {
      await this.persistToPostgres();
      return session;
    } catch (error) {
      this.sessions.delete(hashSecret(session.sessionToken));
      throw error;
    }
  }

  async getSession(sessionToken, tournamentId) {
    const sessionHash = hashSecret(String(sessionToken || ''));
    const session = this.sessions.get(sessionHash);
    if (!session || session.tournamentId !== tournamentId) return null;
    if (this.isSessionExpired(session)) {
      this.sessions.delete(sessionHash);
      await this.pool.query('DELETE FROM hexcore_sessions WHERE session_token_hash = $1', [sessionHash]);
      return null;
    }
    return clone(session);
  }

  async getSessionBinding(sessionToken, tournamentId) {
    const session = await this.getSession(sessionToken, tournamentId);
    if (!session || session.tournamentId !== tournamentId) return null;
    return {
      actorId: session.actorId,
      role: session.role,
      teamId: session.teamId,
    };
  }

  async requireManagementSession(tournamentId, sessionToken, resourceName) {
    const session = await this.getSession(sessionToken, tournamentId);
    if (!session) {
      const error = new Error(`需要有效裁判或管理员 sessionToken 才能查看${resourceName}`);
      error.statusCode = 401;
      throw error;
    }
    if (![ROLES.REFEREE, ROLES.TOURNAMENT_ADMIN, ROLES.SUPER_ADMIN].includes(session.role)) {
      const error = new Error(`当前身份无权查看${resourceName}`);
      error.statusCode = 403;
      throw error;
    }
    return session;
  }

  async subscribe(id, res, projectEvent = event => event) {
    const state = await this.refreshTournamentFromPostgres(id);
    if (state && !this.eventWatermarks.has(id)) this.eventWatermarks.set(id, latestEventSeq(state));
    const unsubscribe = super.subscribe(id, res, projectEvent);
    this.ensureEventPoller();
    return () => {
      unsubscribe();
      this.stopEventPollerIfIdle();
    };
  }

  async close() {
    if (this.eventPollTimer) clearInterval(this.eventPollTimer);
    this.eventPollTimer = null;
    if (this.pool) await this.pool.end();
  }

  ensureEventPoller() {
    if (this.eventPollTimer) return;
    this.eventPollTimer = setInterval(() => {
      this.pollExternalEvents().catch(() => {});
    }, this.eventPollMs);
    if (this.eventPollTimer.unref) this.eventPollTimer.unref();
  }

  stopEventPollerIfIdle() {
    const subscriberCount = Array.from(this.subscribers.values()).reduce((sum, bucket) => sum + bucket.size, 0);
    if (subscriberCount > 0 || !this.eventPollTimer) return;
    clearInterval(this.eventPollTimer);
    this.eventPollTimer = null;
  }

  async pollExternalEvents() {
    if (this.eventPollRunning) return;
    this.eventPollRunning = true;
    try {
      for (const [id, bucket] of this.subscribers.entries()) {
        if (!bucket || !bucket.size) continue;
        await this.pollTournamentEvents(id);
      }
    } finally {
      this.eventPollRunning = false;
    }
  }

  async pollTournamentEvents(id) {
    const afterSeq = Number(this.eventWatermarks.get(id)) || 0;
    const result = await this.pool.query(
      `SELECT e.event_seq, e.private_event_json, t.state_json
       FROM hexcore_events e
       JOIN hexcore_tournaments t ON t.tournament_id = e.tournament_id
       WHERE e.tournament_id = $1 AND e.event_seq > $2
       ORDER BY e.event_seq ASC
       LIMIT 50`,
      [id, afterSeq]
    );
    if (!result.rows.length) return;
    let watermark = afterSeq;
    for (const row of result.rows) {
      const event = row.private_event_json;
      const state = row.state_json;
      if (!event || !state) continue;
      this.tournaments.set(id, clone(state));
      watermark = Math.max(watermark, Number(row.event_seq) || Number(event.eventSeq) || 0);
      this.publish(id, event, state);
    }
    this.eventWatermarks.set(id, watermark);
  }
}

function publicEventSummary(event = {}) {
  return {
    type: String(event.type || ''),
    eventSeq: Number(event.eventSeq) || 0,
    actorId: String(event.actorId || ''),
    createdAt: String(event.createdAt || ''),
    payload: event.payload && typeof event.payload === 'object' ? event.payload : {},
  };
}

function latestEventSeq(state = {}) {
  const events = Array.isArray(state.events) ? state.events : [];
  return events.reduce((max, event) => Math.max(max, Number(event && event.eventSeq) || 0), 0);
}

module.exports = {
  PostgresTournamentStore,
};
