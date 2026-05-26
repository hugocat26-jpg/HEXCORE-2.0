const http = require('http');
const { URL } = require('url');
const { MemoryTournamentStore } = require('./memory-store');
const {
  COMMAND_TYPES,
  EVENT_TYPES,
  ROLES,
  RULES_VERSION,
  createCommand,
} = require('../../packages/shared');
const { acceptCommandAsEvent, appendEvent } = require('../../packages/rules');

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.MULTIPLAYER_API_PORT || process.env.PORT || 4196);

const commandEventMap = {
  [COMMAND_TYPES.IMPORT_STATE]: EVENT_TYPES.STATE_IMPORTED,
  [COMMAND_TYPES.START_HEXCORE_DRAW]: EVENT_TYPES.HEXCORE_CANDIDATES_CREATED,
  [COMMAND_TYPES.REFRESH_HEXCORE_CANDIDATE]: EVENT_TYPES.HEXCORE_CANDIDATE_REFRESHED,
  [COMMAND_TYPES.PICK_HEXCORE]: EVENT_TYPES.HEXCORE_PICKED,
  [COMMAND_TYPES.OPEN_SHOP]: EVENT_TYPES.SHOP_OPENED,
  [COMMAND_TYPES.REFRESH_SHOP]: EVENT_TYPES.SHOP_REFRESHED,
  [COMMAND_TYPES.PURCHASE_SHOP_CARD]: EVENT_TYPES.SHOP_CARD_PURCHASED,
  [COMMAND_TYPES.USE_HEXCORE]: EVENT_TYPES.HEXCORE_USED,
  [COMMAND_TYPES.SKIP_TURN]: EVENT_TYPES.TURN_SKIPPED,
  [COMMAND_TYPES.PAUSE_TOURNAMENT]: EVENT_TYPES.TOURNAMENT_PAUSED,
  [COMMAND_TYPES.RESUME_TOURNAMENT]: EVENT_TYPES.TOURNAMENT_RESUMED,
  [COMMAND_TYPES.FORCE_REFEREE_RULING]: EVENT_TYPES.REFEREE_RULING_FORCED,
  [COMMAND_TYPES.RECORD_MATCH_SCORE]: EVENT_TYPES.MATCH_SCORE_RECORDED,
};

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
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
  const binding = body.roleBinding || {};
  return {
    actorId: String(binding.actorId || (body.command && body.command.actorId) || '').trim(),
    role: String(binding.role || (body.command && body.command.role) || ROLES.VIEWER).trim(),
    teamId: String(binding.teamId || (body.command && body.command.teamId) || '').trim(),
  };
}

function publicSnapshot(state) {
  return {
    tournamentId: state.tournamentId,
    rulesVersion: state.rulesVersion,
    schemaVersion: state.schemaVersion,
    stateVersion: state.stateVersion,
    eventSeq: state.eventSeq,
    paused: state.paused,
    snapshot: state.snapshot,
    events: state.events.slice(-20),
  };
}

function createServer(options = {}) {
  const store = options.store || new MemoryTournamentStore();
  return http.createServer(async (req, res) => {
    try {
      const parsed = new URL(req.url, `http://${host}:${port}`);
      const pathname = parsed.pathname;

      if (req.method === 'GET' && pathname === '/health') {
        sendJson(res, 200, { ok: true, service: 'hexcore-multiplayer-server', rulesVersion: RULES_VERSION });
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
        sendJson(res, 201, { ok: true, tournament: publicSnapshot(next) });
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

      const eventTournamentId = req.method === 'GET' ? matchTournamentRoute(pathname, '/events') : null;
      if (eventTournamentId) {
        const state = store.getTournament(eventTournamentId);
        if (!state) {
          sendJson(res, 404, { ok: false, error: '赛事不存在' });
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
          'X-Content-Type-Options': 'nosniff',
        });
        res.write(`event: snapshot\ndata: ${JSON.stringify(publicSnapshot(state))}\n\n`);
        const unsubscribe = store.subscribe(eventTournamentId, res);
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
        const command = createCommand({ ...body.command, tournamentId: commandTournamentId });
        const eventType = commandEventMap[command.type];
        if (!eventType) throw new Error(`暂不支持 command 类型：${command.type}`);
        const result = acceptCommandAsEvent(
          state,
          command,
          roleBindingFromRequest(body),
          eventType,
          command.payload
        );
        if (!result.duplicate) store.replaceTournament(commandTournamentId, result.state);
        sendJson(res, 200, {
          ok: true,
          duplicate: result.duplicate,
          event: result.event,
          tournament: publicSnapshot(result.state),
        });
        return;
      }

      sendJson(res, 404, { ok: false, error: 'not found' });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error && error.message ? error.message : String(error) });
    }
  });
}

if (require.main === module) {
  const server = createServer();
  server.listen(port, host, () => {
    console.log(`HEXCORE 多人端服务已启动：http://${host}:${port}/health`);
  });
}

module.exports = {
  commandEventMap,
  createServer,
  publicSnapshot,
};
