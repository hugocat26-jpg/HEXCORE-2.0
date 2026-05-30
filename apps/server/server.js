const http = require('http');
const crypto = require('crypto');
const os = require('os');
const { URL } = require('url');
const { MemoryTournamentStore } = require('./memory-store');
const {
  createReadOnlyProjection,
  normalizeProjectionView,
  projectEvent,
} = require('./projections');
const {
  COMMAND_TYPES,
  EVENT_TYPES,
  ROLES,
  RULES_VERSION,
  createCommand,
} = require('../../packages/shared');
const { acceptCommandAsEvent, appendEvent, resolveExpiredTurnTimer } = require('../../packages/rules');
const { createAuthoritativeCommandPayload } = require('./shop-service');

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.MULTIPLAYER_API_PORT || process.env.PORT || 4196);
const STREAM_TOKEN_TTL_MS = Math.max(30, Number(process.env.HEXCORE_STREAM_TOKEN_TTL_SECONDS || 120)) * 1000;

const commandEventMap = {
  [COMMAND_TYPES.IMPORT_STATE]: EVENT_TYPES.STATE_IMPORTED,
  [COMMAND_TYPES.SET_HEXCORE_DRAW_ORDER]: EVENT_TYPES.HEXCORE_DRAW_ORDER_SET,
  [COMMAND_TYPES.START_HEXCORE_DRAW]: EVENT_TYPES.HEXCORE_CANDIDATES_CREATED,
  [COMMAND_TYPES.REFRESH_HEXCORE_CANDIDATE]: EVENT_TYPES.HEXCORE_CANDIDATE_REFRESHED,
  [COMMAND_TYPES.PICK_HEXCORE]: EVENT_TYPES.HEXCORE_PICKED,
  [COMMAND_TYPES.OPEN_SHOP]: EVENT_TYPES.SHOP_OPENED,
  [COMMAND_TYPES.REFRESH_SHOP]: EVENT_TYPES.SHOP_REFRESHED,
  [COMMAND_TYPES.PURCHASE_SHOP_CARD]: EVENT_TYPES.SHOP_CARD_PURCHASED,
  [COMMAND_TYPES.RENAME_TEAM]: EVENT_TYPES.TEAM_RENAMED,
  [COMMAND_TYPES.USE_HEXCORE]: EVENT_TYPES.HEXCORE_USED,
  [COMMAND_TYPES.SKIP_TURN]: EVENT_TYPES.TURN_SKIPPED,
  [COMMAND_TYPES.UPDATE_TURN_TIMERS]: EVENT_TYPES.TURN_TIMERS_UPDATED,
  [COMMAND_TYPES.PAUSE_TOURNAMENT]: EVENT_TYPES.TOURNAMENT_PAUSED,
  [COMMAND_TYPES.RESUME_TOURNAMENT]: EVENT_TYPES.TOURNAMENT_RESUMED,
  [COMMAND_TYPES.FORCE_REFEREE_RULING]: EVENT_TYPES.REFEREE_RULING_FORCED,
  [COMMAND_TYPES.ROLLBACK_TO_VERSION]: EVENT_TYPES.STATE_ROLLED_BACK,
  [COMMAND_TYPES.RECORD_MATCH_SCORE]: EVENT_TYPES.MATCH_SCORE_RECORDED,
  [COMMAND_TYPES.ACTIVATE_SUBSTITUTE]: EVENT_TYPES.SUBSTITUTE_ACTIVATED,
  [COMMAND_TYPES.REPLACE_WITH_SUBSTITUTE]: EVENT_TYPES.PLAYER_REPLACED_BY_SUBSTITUTE,
};

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 256) {
        reject(new Error('请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('请求体必须是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

function matchTournamentRoute(pathname, suffix) {
  const match = pathname.match(/^\/api\/tournaments\/([A-Za-z0-9._:-]{1,80})(.*)$/);
  if (!match) return null;
  if (match[2] !== suffix) return null;
  return match[1];
}

function matchAdminTournamentRoute(pathname, suffix) {
  const match = pathname.match(/^\/api\/admin\/tournaments\/([A-Za-z0-9._:-]{1,80})(.*)$/);
  if (!match) return null;
  if (match[2] !== suffix) return null;
  return match[1];
}

function roleBindingFromRequest(body) {
  const binding = body.resolvedRoleBinding || {};
  if (!binding.actorId || !binding.role) throw new Error('缺少有效 sessionToken 或角色绑定');
  return {
    actorId: String(binding.actorId).trim(),
    role: String(binding.role).trim(),
    teamId: String(binding.teamId || '').trim(),
  };
}

function statusFromError(error) {
  return Number.isInteger(error && error.statusCode) ? error.statusCode : 400;
}

function hashStreamToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function createStreamTokenStore(ttlMs = STREAM_TOKEN_TTL_MS) {
  const tokens = new Map();
  let currentTtlMs = ttlMs;
  function cleanup(now = Date.now()) {
    for (const [hash, record] of tokens.entries()) {
      if (!record || Number(record.expiresAtMs) <= now) tokens.delete(hash);
    }
  }
  return {
    issue(tournamentId, binding) {
      cleanup();
      const streamToken = `stream_${crypto.randomBytes(24).toString('base64url')}`;
      const expiresAtMs = Date.now() + currentTtlMs;
      tokens.set(hashStreamToken(streamToken), {
        tournamentId: String(tournamentId || ''),
        actorId: binding.actorId,
        role: binding.role,
        teamId: binding.teamId || '',
        expiresAtMs,
      });
      return {
        streamToken,
        expiresAt: new Date(expiresAtMs).toISOString(),
        ttlSeconds: Math.max(1, Math.ceil(currentTtlMs / 1000)),
      };
    },
    resolve(tournamentId, streamToken) {
      cleanup();
      const record = tokens.get(hashStreamToken(streamToken));
      if (!record || record.tournamentId !== tournamentId) return null;
      return { actorId: record.actorId, role: record.role, teamId: record.teamId || '' };
    },
    setTtlMs(nextTtlMs) {
      const value = Number(nextTtlMs);
      if (Number.isFinite(value) && value >= 30 * 1000 && value <= 3600 * 1000) {
        currentTtlMs = Math.round(value);
      }
    },
    ttlMs() {
      return currentTtlMs;
    },
  };
}

function sessionTokenFromRequest(req, parsed, body = {}) {
  const auth = String(req.headers.authorization || '').trim();
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return String(body.sessionToken || parsed.searchParams.get('sessionToken') || '').trim();
}

function bearerSessionTokenFromRequest(req) {
  const auth = String(req.headers.authorization || '').trim();
  return auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
}

function publicSnapshot(state) {
  return createReadOnlyProjection(state, 'public');
}

function isManagementRole(role) {
  return [ROLES.REFEREE, ROLES.TOURNAMENT_ADMIN, ROLES.SUPER_ADMIN].includes(role);
}

async function systemLoadSnapshot(store, startedAtMs, startedAt) {
  const runtime = store.publicStats ? await store.publicStats() : {};
  const storeLoad = store.systemLoadStats ? await store.systemLoadStats() : {};
  const memory = process.memoryUsage();
  const cpus = os.cpus ? os.cpus() : [];
  return {
    sampledAt: new Date().toISOString(),
    startedAt,
    uptimeSeconds: Math.max(0, Math.round((Date.now() - startedAtMs) / 1000)),
    storage: runtime.storage || storeLoad.storage || 'unknown',
    tournamentCount: Number(storeLoad.tournamentCount ?? runtime.tournamentCount ?? 0),
    roomCount: Number(storeLoad.roomCount ?? runtime.roomCount ?? 0),
    activeRoomCount: Number(storeLoad.activeRoomCount ?? runtime.activeRoomCount ?? 0),
    maxRooms: Number(storeLoad.maxRooms ?? runtime.maxRooms ?? 0),
    sessionCount: Number(storeLoad.sessionCount ?? 0),
    systemAdminSessionCount: Number(storeLoad.systemAdminSessionCount ?? 0),
    subscriberCount: Number(storeLoad.subscriberCount ?? runtime.subscriberCount ?? 0),
    postgresConnected: Boolean(runtime.postgresConnected),
    crossInstanceEventPolling: Boolean(runtime.crossInstanceEventPolling),
    eventPollMs: Number(runtime.eventPollMs || 0),
    process: {
      pid: process.pid,
      node: process.version,
      platform: process.platform,
      rssMb: Math.round(memory.rss / 1024 / 1024),
      heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(memory.heapTotal / 1024 / 1024),
      externalMb: Math.round(memory.external / 1024 / 1024),
    },
    cpu: {
      count: cpus.length,
      loadAverage: typeof os.loadavg === 'function' ? os.loadavg().map(value => Math.round(value * 100) / 100) : [],
    },
  };
}

async function resolveTimerBeforeRead(store, tournamentId, state = null, now = new Date().toISOString()) {
  const current = state || await store.getTournament(tournamentId);
  if (!current) return null;
  if (current.snapshot && current.snapshot.roomStatus === 'archived') return current;
  const resolved = resolveExpiredTurnTimer(current, now);
  if (resolved && resolved.stateVersion !== current.stateVersion) {
    return store.replaceTournament(tournamentId, resolved);
  }
  return current;
}

function createTournamentStore(options = {}) {
  if (options.store) return options.store;
  const postgresUrl = String(options.postgresUrl || process.env.HEXCORE_POSTGRES_URL || '').trim();
  if (postgresUrl) {
    const { PostgresTournamentStore } = require('./postgres-store');
    return PostgresTournamentStore.create({ connectionString: postgresUrl, sessionTtlMs: options.sessionTtlMs, maxRooms: options.maxRooms });
  }
  const sqliteFile = String(options.sqliteFile || process.env.HEXCORE_SQLITE_FILE || '').trim();
  if (sqliteFile) {
    const { SqliteTournamentStore } = require('./sqlite-store');
    return new SqliteTournamentStore({ sqliteFile, sessionTtlMs: options.sessionTtlMs, maxRooms: options.maxRooms });
  }
  return new MemoryTournamentStore({
    dataFile: options.dataFile || process.env.HEXCORE_DATA_FILE || '',
    sessionTtlMs: options.sessionTtlMs,
    maxRooms: options.maxRooms,
  });
}

async function projectionOptionsFromRequest(req, parsed, store, tournamentId, view, options = {}) {
  if (view !== 'captain' && view !== 'referee') return {};
  const streamToken = String(parsed.searchParams.get('streamToken') || '').trim();
  let binding = null;
  if (options.requireStreamToken) {
    binding = streamToken && options.streamTokens
      ? options.streamTokens.resolve(tournamentId, streamToken)
      : null;
  } else {
    binding = streamToken && options.streamTokens
      ? options.streamTokens.resolve(tournamentId, streamToken)
      : await store.getSessionBinding(sessionTokenFromRequest(req, parsed), tournamentId);
  }
  if (!binding) {
    const error = new Error(options.requireStreamToken || streamToken ? 'streamToken 无效或已过期，请重新加入房间' : `需要有效${view === 'referee' ? '裁判' : '队长'} sessionToken 才能读取${view === 'referee' ? '裁判' : '队长'}投影`);
    error.statusCode = 401;
    throw error;
  }
  if (view === 'referee') {
    if (![ROLES.REFEREE, ROLES.TOURNAMENT_ADMIN, ROLES.SUPER_ADMIN].includes(binding.role)) {
      const error = new Error('当前身份无权读取裁判投影');
      error.statusCode = 403;
      throw error;
    }
    return { teamId: binding.teamId || '' };
  }
  if (binding.role !== ROLES.CAPTAIN || !binding.teamId) {
    const error = new Error('当前身份无权读取队长投影');
    error.statusCode = 403;
    throw error;
  }
  return { teamId: binding.teamId };
}

function createServer(options = {}) {
  const storePromise = Promise.resolve(createTournamentStore(options));
  const streamTokens = createStreamTokenStore(options.streamTokenTtlMs || STREAM_TOKEN_TTL_MS);
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const server = http.createServer(async (req, res) => {
    try {
      const store = await storePromise;
      if (store.publicSystemConfig && streamTokens.setTtlMs) {
        const config = store.publicSystemConfig();
        streamTokens.setTtlMs(Number(config.streamTokenTtlSeconds || 120) * 1000);
      }
      const parsed = new URL(req.url, `http://${host}:${port}`);
      const pathname = parsed.pathname;

      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        });
        res.end();
        return;
      }

      if (req.method === 'GET' && pathname === '/health') {
        sendJson(res, 200, {
          ok: true,
          service: 'hexcore-multiplayer-server',
          rulesVersion: RULES_VERSION,
          startedAt,
          uptimeSeconds: Math.max(0, Math.round((Date.now() - startedAtMs) / 1000)),
          runtime: store.publicStats ? await store.publicStats() : { storage: 'unknown' },
        });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/admin/status') {
        sendJson(res, 200, {
          ok: true,
          admin: store.getSystemAdminStatus ? await store.getSystemAdminStatus() : { setupRequired: true },
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/admin/setup') {
        const body = await readJson(req);
        const session = await store.setupSystemAdmin(body);
        sendJson(res, 201, {
          ok: true,
          session,
          admin: store.getSystemAdminStatus ? await store.getSystemAdminStatus() : null,
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/admin/login') {
        const body = await readJson(req);
        const session = await store.loginSystemAdmin(body);
        sendJson(res, 200, {
          ok: true,
          session,
          admin: store.getSystemAdminStatus ? await store.getSystemAdminStatus() : null,
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/admin/logout') {
        await store.logoutSystemAdmin(bearerSessionTokenFromRequest(req));
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/admin/tournaments') {
        const token = bearerSessionTokenFromRequest(req);
        sendJson(res, 200, {
          ok: true,
          rooms: store.listAdminTournaments ? await store.listAdminTournaments(token) : [],
          runtime: store.publicStats ? await store.publicStats() : { storage: 'unknown' },
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/admin/tournaments') {
        const token = bearerSessionTokenFromRequest(req);
        const adminSession = await store.requireSystemAdminSession(token, '创建赛事');
        const body = await readJson(req);
        const state = await store.createTournament(body);
        const next = appendEvent(state, {
          type: EVENT_TYPES.TOURNAMENT_CREATED,
          actorId: adminSession.actorId || 'system-admin',
          payload: { name: state.snapshot.name, rulesVersion: state.rulesVersion },
        });
        await store.replaceTournament(state.tournamentId, next);
        if (store.recordSecurityEvent) {
          store.recordSecurityEvent('admin_tournament_created', {
            actorId: adminSession.actorId || 'system-admin',
            tournamentId: state.tournamentId,
          }, { persist: true });
          if (store.persistToPostgres) await store.persistToPostgres();
        }
        sendJson(res, 201, {
          ok: true,
          tournament: publicSnapshot(next),
          room: await store.consumeInitialRoomAccess(state.tournamentId),
        });
        return;
      }

      const adminArchiveTournamentId = req.method === 'POST' ? matchAdminTournamentRoute(pathname, '/archive') : null;
      if (adminArchiveTournamentId) {
        const room = store.archiveTournamentAsAdmin
          ? await store.archiveTournamentAsAdmin(adminArchiveTournamentId, bearerSessionTokenFromRequest(req))
          : null;
        if (!room) {
          sendJson(res, 404, { ok: false, error: '赛事不存在' });
          return;
        }
        sendJson(res, 200, { ok: true, room });
        return;
      }

      const adminDeleteTournamentMatch = req.method === 'DELETE' ? pathname.match(/^\/api\/admin\/tournaments\/([A-Za-z0-9._:-]{1,80})$/) : null;
      if (adminDeleteTournamentMatch) {
        const room = store.deleteTournamentAsAdmin
          ? await store.deleteTournamentAsAdmin(adminDeleteTournamentMatch[1], bearerSessionTokenFromRequest(req))
          : null;
        if (!room) {
          sendJson(res, 404, { ok: false, error: '赛事不存在' });
          return;
        }
        sendJson(res, 200, { ok: true, room });
        return;
      }

      const adminExportTournamentId = req.method === 'GET' ? matchAdminTournamentRoute(pathname, '/export') : null;
      if (adminExportTournamentId) {
        const backup = store.getTournamentBackupAsAdmin
          ? await store.getTournamentBackupAsAdmin(adminExportTournamentId, bearerSessionTokenFromRequest(req))
          : null;
        if (!backup) {
          sendJson(res, 404, { ok: false, error: '赛事不存在' });
          return;
        }
        sendJson(res, 200, { ok: true, backup });
        return;
      }

      const adminSessionTournamentId = req.method === 'POST' ? matchAdminTournamentRoute(pathname, '/session') : null;
      if (adminSessionTournamentId) {
        const session = store.createTournamentSessionAsAdmin
          ? await store.createTournamentSessionAsAdmin(adminSessionTournamentId, bearerSessionTokenFromRequest(req))
          : null;
        if (!session) {
          sendJson(res, 404, { ok: false, error: '赛事不存在' });
          return;
        }
        const state = await resolveTimerBeforeRead(store, adminSessionTournamentId);
        sendJson(res, 200, {
          ok: true,
          session,
          tournament: state ? createReadOnlyProjection(state, 'referee') : null,
        });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/admin/config') {
        sendJson(res, 200, {
          ok: true,
          config: store.getSystemConfig ? await store.getSystemConfig(bearerSessionTokenFromRequest(req)) : {},
        });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/admin/system-load') {
        if (store.requireSystemAdminSession) await store.requireSystemAdminSession(bearerSessionTokenFromRequest(req), '系统负荷');
        sendJson(res, 200, {
          ok: true,
          load: await systemLoadSnapshot(store, startedAtMs, startedAt),
        });
        return;
      }

      if (req.method === 'PUT' && pathname === '/api/admin/config') {
        const body = await readJson(req);
        const config = await store.updateSystemConfig(bearerSessionTokenFromRequest(req), body);
        if (streamTokens.setTtlMs) streamTokens.setTtlMs(Number(config.streamTokenTtlSeconds || 120) * 1000);
        sendJson(res, 200, { ok: true, config });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/admin/security-events') {
        const events = store.getSecurityEvents
          ? await store.getSecurityEvents(bearerSessionTokenFromRequest(req), parsed.searchParams.get('limit') || 50)
          : [];
        sendJson(res, 200, { ok: true, events });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/tournaments') {
        sendJson(res, 200, {
          ok: true,
          rooms: store.listRooms ? await store.listRooms() : [],
          runtime: store.publicStats ? await store.publicStats() : { storage: 'unknown' },
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/tournaments') {
        const body = await readJson(req);
        const state = await store.createTournament(body);
        const next = appendEvent(state, {
          type: EVENT_TYPES.TOURNAMENT_CREATED,
          actorId: String(body.actorId || 'system'),
          payload: { name: state.snapshot.name, rulesVersion: state.rulesVersion },
        });
        await store.replaceTournament(state.tournamentId, next);
        sendJson(res, 201, {
          ok: true,
          tournament: publicSnapshot(next),
          room: await store.consumeInitialRoomAccess(state.tournamentId),
        });
        return;
      }

      const archiveTournamentId = req.method === 'POST' ? matchTournamentRoute(pathname, '/archive') : null;
      if (archiveTournamentId) {
        const body = await readJson(req);
        const sessionToken = bearerSessionTokenFromRequest(req) || String(body.sessionToken || '').trim();
        const room = store.archiveTournament ? await store.archiveTournament(archiveTournamentId, sessionToken) : null;
        if (!room) {
          sendJson(res, 404, { ok: false, error: '赛事不存在' });
          return;
        }
        sendJson(res, 200, { ok: true, room });
        return;
      }

      const deleteTournamentMatch = req.method === 'DELETE' ? pathname.match(/^\/api\/tournaments\/([A-Za-z0-9._:-]{1,80})$/) : null;
      if (deleteTournamentMatch) {
        const body = await readJson(req);
        const sessionToken = bearerSessionTokenFromRequest(req) || String(body.sessionToken || '').trim();
        const room = store.deleteTournament ? await store.deleteTournament(deleteTournamentMatch[1], sessionToken) : null;
        if (!room) {
          sendJson(res, 404, { ok: false, error: '赛事不存在' });
          return;
        }
        sendJson(res, 200, { ok: true, room });
        return;
      }

      const snapshotTournamentId = req.method === 'GET' ? matchTournamentRoute(pathname, '/snapshot') : null;
      if (snapshotTournamentId) {
        const state = await resolveTimerBeforeRead(store, snapshotTournamentId);
        if (!state) {
          sendJson(res, 404, { ok: false, error: '赛事不存在' });
          return;
        }
        sendJson(res, 200, { ok: true, tournament: publicSnapshot(state) });
        return;
      }

      const projectionTournamentId = req.method === 'GET' ? matchTournamentRoute(pathname, '/projection') : null;
      if (projectionTournamentId) {
        const state = await resolveTimerBeforeRead(store, projectionTournamentId);
        if (!state) {
          sendJson(res, 404, { ok: false, error: '赛事不存在' });
          return;
        }
        const view = normalizeProjectionView(parsed.searchParams.get('view') || 'public');
        const projectionOptions = await projectionOptionsFromRequest(req, parsed, store, projectionTournamentId, view);
        sendJson(res, 200, { ok: true, tournament: createReadOnlyProjection(state, view, projectionOptions) });
        return;
      }

      const timerResolveTournamentId = req.method === 'POST' ? matchTournamentRoute(pathname, '/timers/resolve') : null;
      if (timerResolveTournamentId) {
        const body = await readJson(req);
        const sessionToken = bearerSessionTokenFromRequest(req) || String(body.sessionToken || '').trim();
        const binding = await store.getSessionBinding(sessionToken, timerResolveTournamentId);
        if (!binding) throw new Error('sessionToken 无效或已过期');
        const state = await resolveTimerBeforeRead(store, timerResolveTournamentId);
        const view = isManagementRole(binding.role) ? 'referee' : (binding.role === ROLES.CAPTAIN ? 'captain' : 'viewer');
        sendJson(res, 200, {
          ok: true,
          tournament: createReadOnlyProjection(state, view, { teamId: binding.teamId || '' }),
        });
        return;
      }

      const roomTournamentId = req.method === 'GET' ? matchTournamentRoute(pathname, '/room') : null;
      if (roomTournamentId) {
        const access = await store.getRoomAccess(roomTournamentId, sessionTokenFromRequest(req, parsed));
        if (!access) {
          sendJson(res, 404, { ok: false, error: '赛事不存在' });
          return;
        }
        sendJson(res, 200, { ok: true, room: access });
        return;
      }

      const auditTournamentId = req.method === 'GET' ? matchTournamentRoute(pathname, '/audit') : null;
      if (auditTournamentId) {
        const auditLog = await store.getAuditLog(auditTournamentId, sessionTokenFromRequest(req, parsed));
        if (!auditLog) {
          sendJson(res, 404, { ok: false, error: '赛事不存在' });
          return;
        }
        sendJson(res, 200, { ok: true, auditLog });
        return;
      }

      const exportTournamentId = req.method === 'GET' ? matchTournamentRoute(pathname, '/export') : null;
      if (exportTournamentId) {
        const backup = await store.getTournamentBackup(exportTournamentId, bearerSessionTokenFromRequest(req));
        if (!backup) {
          sendJson(res, 404, { ok: false, error: '赛事不存在' });
          return;
        }
        sendJson(res, 200, { ok: true, backup });
        return;
      }

      const joinTournamentId = req.method === 'POST' ? matchTournamentRoute(pathname, '/join') : null;
      if (joinTournamentId) {
        const body = await readJson(req);
        const session = await store.joinTournament(joinTournamentId, body);
        const state = await resolveTimerBeforeRead(store, joinTournamentId);
        sendJson(res, 200, { ok: true, session, tournament: publicSnapshot(state) });
        return;
      }

      const streamTokenTournamentId = req.method === 'POST' ? matchTournamentRoute(pathname, '/stream-token') : null;
      if (streamTokenTournamentId) {
        const body = await readJson(req);
        const sessionToken = bearerSessionTokenFromRequest(req) || String(body.sessionToken || '').trim();
        const binding = await store.getSessionBinding(sessionToken, streamTokenTournamentId);
        if (!binding) {
          const error = new Error('sessionToken 无效或已过期，无法创建实时订阅凭据');
          error.statusCode = 401;
          throw error;
        }
        sendJson(res, 200, { ok: true, ...streamTokens.issue(streamTokenTournamentId, binding) });
        return;
      }

      const eventTournamentId = req.method === 'GET' ? matchTournamentRoute(pathname, '/events') : null;
      if (eventTournamentId) {
        const state = await resolveTimerBeforeRead(store, eventTournamentId);
        if (!state) {
          sendJson(res, 404, { ok: false, error: '赛事不存在' });
          return;
        }
        const view = normalizeProjectionView(parsed.searchParams.get('view') || 'public');
        const projectionOptions = await projectionOptionsFromRequest(req, parsed, store, eventTournamentId, view, { streamTokens, requireStreamToken: true });
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
          'X-Content-Type-Options': 'nosniff',
          'Access-Control-Allow-Origin': '*',
        });
        res.write(`event: snapshot\ndata: ${JSON.stringify(createReadOnlyProjection(state, view, projectionOptions))}\n\n`);
        const unsubscribe = await store.subscribe(eventTournamentId, res, (event, nextState) => ({
          ...projectEvent(event, view),
          tournament: nextState ? createReadOnlyProjection(nextState, view, projectionOptions) : null,
        }));
        req.on('close', unsubscribe);
        return;
      }

      const commandTournamentId = req.method === 'POST' ? matchTournamentRoute(pathname, '/commands') : null;
      if (commandTournamentId) {
        const state = await resolveTimerBeforeRead(store, commandTournamentId);
        if (!state) {
          sendJson(res, 404, { ok: false, error: '赛事不存在' });
          return;
        }
        const body = await readJson(req);
        const binding = await store.getSessionBinding(body.sessionToken, commandTournamentId);
        if (!binding) throw new Error('sessionToken 无效或已过期');
        if (store.assertRoomWritable) await store.assertRoomWritable(commandTournamentId);
        const command = createCommand({
          ...body.command,
          tournamentId: commandTournamentId,
          actorId: binding.actorId,
          role: binding.role,
          teamId: binding.teamId || (body.command && body.command.teamId) || '',
        });
        const eventType = commandEventMap[command.type];
        if (!eventType) throw new Error(`暂不支持 command 类型：${command.type}`);
        const roleBinding = roleBindingFromRequest({ ...body, resolvedRoleBinding: binding });
        const result = acceptCommandAsEvent(
          state,
          command,
          roleBinding,
          eventType,
          createAuthoritativeCommandPayload(state, command, roleBinding)
        );
        if (!result.duplicate) await store.replaceTournament(commandTournamentId, result.state);
        sendJson(res, 200, {
          ok: true,
          duplicate: result.duplicate,
          event: projectEvent(result.event, 'public'),
          tournament: publicSnapshot(result.state),
        });
        return;
      }

      sendJson(res, 404, { ok: false, error: 'not found' });
    } catch (error) {
      sendJson(res, statusFromError(error), { ok: false, error: error && error.message ? error.message : String(error) });
    }
  });
  server.on('close', () => {
    storePromise.then(store => {
      if (store && typeof store.close === 'function') return store.close();
      return null;
    }).catch(() => {});
  });
  return server;
}

if (require.main === module) {
  const server = createServer();
  server.listen(port, host, () => {
    console.log(`HEXCORE 多人端服务已启动：http://${host}:${port}/health`);
  });
}

module.exports = {
  commandEventMap,
  createTournamentStore,
  createServer,
  createReadOnlyProjection,
  publicSnapshot,
};
