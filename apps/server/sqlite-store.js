const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const { MemoryTournamentStore } = require('./memory-store');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function entriesFromMap(map) {
  return Array.from((map || new Map()).entries()).map(([key, value]) => [key, clone(value)]);
}

function mapFromEntries(entries) {
  return new Map((Array.isArray(entries) ? entries : []).map(([key, value]) => [String(key), clone(value)]));
}

class SqliteTournamentStore extends MemoryTournamentStore {
  constructor(options = {}) {
    super({ dataFile: '', sessionTtlMs: options.sessionTtlMs, maxRooms: options.maxRooms });
    const sqliteFile = String(options.sqliteFile || process.env.HEXCORE_SQLITE_FILE || '').trim();
    if (!sqliteFile) throw new Error('HEXCORE_SQLITE_FILE 不能为空');
    this.sqliteFile = path.resolve(sqliteFile);
    fs.mkdirSync(path.dirname(this.sqliteFile), { recursive: true });
    this.db = new DatabaseSync(this.sqliteFile);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS hexcore_store (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    this.loadFromSqlite();
  }

  storageLabel() {
    return 'memory+sqlite';
  }

  close() {
    if (this.db) this.db.close();
  }

  loadFromSqlite() {
    const select = this.db.prepare('SELECT value FROM hexcore_store WHERE key = ?');
    this.tournaments = mapFromEntries(readJsonValue(select, 'tournaments'));
    this.roomAccess = mapFromEntries(readJsonValue(select, 'roomAccess'));
    this.sessions = mapFromEntries(readJsonValue(select, 'sessions'));
    const systemConfig = readJsonObject(select, 'systemConfig');
    if (systemConfig) this.systemConfig = systemConfig;
    this.systemAdmin = readJsonObject(select, 'systemAdmin');
    this.systemAdminSessions = mapFromEntries(readJsonValue(select, 'systemAdminSessions'));
    const securityEvents = readJsonValue(select, 'securityEvents');
    this.securityEvents = Array.isArray(securityEvents) ? securityEvents : [];
    this.initialRoomAccess = new Map();
    this.applySystemConfigRuntime();
  }

  persistToDisk() {
    if (!this.db) return;
    const now = new Date().toISOString();
    const upsert = this.db.prepare(`
      INSERT INTO hexcore_store (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      upsert.run('tournaments', JSON.stringify(entriesFromMap(this.tournaments)), now);
      upsert.run('roomAccess', JSON.stringify(entriesFromMap(this.roomAccess)), now);
      upsert.run('sessions', JSON.stringify(entriesFromMap(this.sessions)), now);
      upsert.run('systemConfig', JSON.stringify(this.systemConfig || {}), now);
      upsert.run('systemAdmin', JSON.stringify(this.systemAdmin || null), now);
      upsert.run('systemAdminSessions', JSON.stringify(entriesFromMap(this.systemAdminSessions)), now);
      upsert.run('securityEvents', JSON.stringify(this.securityEvents || []), now);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

function readJsonValue(statement, key) {
  const row = statement.get(key);
  if (!row || !row.value) return [];
  return JSON.parse(row.value);
}

function readJsonObject(statement, key) {
  const row = statement.get(key);
  if (!row || !row.value) return null;
  const parsed = JSON.parse(row.value);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
}

module.exports = {
  SqliteTournamentStore,
};
