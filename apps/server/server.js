const http = require('http');
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
const { acceptCommandAsEvent, appendEvent } = require('../../packages/rules');
const { createAuthoritativeCommandPayload } = require('./shop-service');

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.MULTIPLAYER_API_PORT || process.env.PORT || 4196);

const commandEventMap = {
  [COMMAND_TYPES.IMPORT_STATE]: EVENT_TYPES.STATE_IMPORTED,
  [COMMAND_TYPES.START_HEXCORE_DRAW]: EVENT_TYPES.HEXCORE_CANDIDATES_CREATED,
  [COMMAND_TYPES.REFRESH_HEXCORE_CANDIDATE]: EVENT_TYPES.HEXCORE_CANDIDATE_REFRESHED,
  [COMMAND_TYPES.PICK_HEXCORE]: EVENT_TYPES.HEXCORE_PICKED,
  [COMMAND_TYPES.OPEN_SHOP]: EVENT_TYPES.SHOP_OPENED,
  [COMMAND_TYPES.REFRESH_SHOP]: EVENT_TYPES.SHOP_REFRESHED,
  [COMMAND_TYPES.PURCHASE_SHOP_CARD]: EVENT_TYPES.SHOP_CARD_PURCHASED,
  [COMMAND_TYPES.RENAME_TEAM]: EVENT_TYPES.TEAM_RENAMED,
  [COMMAND_TYPES.USE_HEXCORE]: EVENT_TYPES.HEXCORE_USED,
  [COMMAND_TYPES.SKIP_TURN]: EVENT_TYPES.TURN_SKIPPED,
  [COMMAND_TYPES.PAUSE_TOURNAMENT]: EVENT_TYPES.TOURNAMENT_PAUSED,
  [COMMAND_TYPES.RESUME_TOURNAMENT]: EVENT_TYPES.TOURNAMENT_RESUMED,
  [COMMAND_TYPES.FORCE_REFEREE_RULING]: EVENT_TYPES.REFEREE_RULING_FORCED,
  [COMMAND_TYPES.ROLLBACK_TO_VERSION]: EVENT_TYPES.STATE_ROLLED_BACK,
  [COMMAND_TYPES.RECORD_MATCH_SCORE]: EVENT_TYPES.MATCH_SCORE_RECORDED,
};

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
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

function createTournamentStore(options = {}) {
  if (options.store) return options.store;
  const sqliteFile = String(options.sqliteFile || process.env.HEXCORE_SQLITE_FILE || '').trim();
  if (sqliteFile) {
    const { SqliteTournamentStore } = require('./sqlite-store');
    return new SqliteTournamentStore({ sqliteFile });
  }
  return new MemoryTournamentStore({ dataFile: options.dataFile || process.env.HEXCORE_DATA_FILE || '' });
}

function projectionOptionsFromRequest(req, parsed, store, tournamentId, view) {
  if (view !== 'captain') return {};
  const sessionToken = sessionTokenFromRequest(req, parsed);
  const binding = store.getSessionBinding(sessionToken, tournamentId);
  if (!binding) {
    const error = new Error('需要有效队长 sessionToken 才能读取队长投影');
    error.statusCode = 401;
    throw error;
  }
  if (binding.role !== ROLES.CAPTAIN || !binding.teamId) {
    const error = new Error('当前身份无权读取队长投影');
    error.statusCode = 403;
    throw error;
  }
  return { teamId: binding.teamId };
}

function createServer(options = {}) {
  const store = createTournamentStore(options);
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const server = http.createServer(async (req, res) => {
    try {
      const parsed = new URL(req.url, `http://${host}:${port}`);
      const pathname = parsed.pathname;

      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
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
          runtime: store.publicStats ? store.publicStats() : { storage: 'unknown' },
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/tournaments') {
        const body = await readJson(req);
        const state = store.createTournament(body);
        const next = appendEvent(state, {
          type: EVENT_TYPES.TOURNAMENT_CREATED,
          actorId: String(body.actorId || 'system'),
          payload: { name: state.snapshot.name, rulesVersion: state.rulesVersion },
        });
        store.replaceTournament(state.tournamentId, next);
        sendJson(res, 201, {
          ok: true,
          tournament: publicSnapshot(next),
          room: store.consumeInitialRoomAccess(state.tournamentId),
        });
        return;
      }

      const snapshotTournamentId = req.method === 'GET' ? matchTournamentRoute(pathname, '/snapshot') : null;
      if (snapshotTournamentId) {
        const state = store.getTournament(snapshotTournamentId);
        if (!state) {
          sendJson(res, 404, { ok: false, error: '赛事不存在' });
          return;
        }
        sendJson(res, 200, { ok: true, tournament: publicSnapshot(state) });
        return;
      }

      const projectionTournamentId = req.method === 'GET' ? matchTournamentRoute(pathname, '/projection') : null;
      if (projectionTournamentId) {
        const state = store.getTournament(projectionTournamentId);
        if (!state) {
          sendJson(res, 404, { ok: false, error: '赛事不存在' });
          return;
        }
        const view = normalizeProjectionView(parsed.searchParams.get('view') || 'public');
        const projectionOptions = projectionOptionsFromRequest(req, parsed, store, projectionTournamentId, view);
        sendJson(res, 200, { ok: true, tournament: createReadOnlyProjection(state, view, projectionOptions) });
        return;
      }

      const roomTournamentId = req.method === 'GET' ? matchTournamentRoute(pathname, '/room') : null;
      if (roomTournamentId) {
        const access = store.getRoomAccess(roomTournamentId, sessionTokenFromRequest(req, parsed));
        if (!access) {
          sendJson(res, 404, { ok: false, error: '赛事不存在' });
          return;
        }
        sendJson(res, 200, { ok: true, room: access });
        return;
      }

      const auditTournamentId = req.method === 'GET' ? matchTournamentRoute(pathname, '/audit') : null;
      if (auditTournamentId) {
        const auditLog = store.getAuditLog(auditTournamentId, sessionTokenFromRequest(req, parsed));
        if (!auditLog) {
          sendJson(res, 404, { ok: false, error: '赛事不存在' });
          return;
        }
        sendJson(res, 200, { ok: true, auditLog });
        return;
      }

      const exportTournamentId = req.method === 'GET' ? matchTournamentRoute(pathname, '/export') : null;
      if (exportTournamentId) {
        const backup = store.getTournamentBackup(exportTournamentId, bearerSessionTokenFromRequest(req));
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
        const session = store.joinTournament(joinTournamentId, body);
        const state = store.getTournament(joinTournamentId);
        sendJson(res, 200, { ok: true, session, tournament: publicSnapshot(state) });
        return;
      }

      const eventTournamentId = req.method === 'GET' ? matchTournamentRoute(pathname, '/events') : null;
      if (eventTournamentId) {
        const state = store.getTournament(eventTournamentId);
        if (!state) {
          sendJson(res, 404, { ok: false, error: '赛事不存在' });
          return;
        }
        const view = normalizeProjectionView(parsed.searchParams.get('view') || 'public');
        const projectionOptions = projectionOptionsFromRequest(req, parsed, store, eventTournamentId, view);
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
          'X-Content-Type-Options': 'nosniff',
          'Access-Control-Allow-Origin': '*',
        });
        res.write(`event: snapshot\ndata: ${JSON.stringify(createReadOnlyProjection(state, view, projectionOptions))}\n\n`);
        const unsubscribe = store.subscribe(eventTournamentId, res, event => projectEvent(event, view));
        req.on('close', unsubscribe);
        return;
      }

      const commandTournamentId = req.method === 'POST' ? matchTournamentRoute(pathname, '/commands') : null;
      if (commandTournamentId) {
        const state = store.getTournament(commandTournamentId);
        if (!state) {
          sendJson(res, 404, { ok: false, error: '赛事不存在' });
          return;
        }
        const body = await readJson(req);
        const binding = store.getSessionBinding(body.sessionToken, commandTournamentId);
        if (!binding) throw new Error('sessionToken 无效或已过期');
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
        if (!result.duplicate) store.replaceTournament(commandTournamentId, result.state);
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
  if (store && typeof store.close === 'function') {
    server.on('close', () => store.close());
  }
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
