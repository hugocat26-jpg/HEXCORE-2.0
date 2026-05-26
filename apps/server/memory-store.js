const crypto = require('crypto');
const { createAuthorityState } = require('../../packages/rules');
const { ROLES } = require('../../packages/shared');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class MemoryTournamentStore {
  constructor() {
    this.tournaments = new Map();
    this.subscribers = new Map();
    this.roomAccess = new Map();
    this.initialRoomAccess = new Map();
    this.sessions = new Map();
  }

  createTournament(input = {}) {
    const id = String(input.id || input.tournamentId || `tournament-${Date.now()}`).trim();
    if (!/^[A-Za-z0-9._:-]{1,80}$/.test(id)) throw new Error('赛事 ID 必须是 1-80 位安全标识');
    if (this.tournaments.has(id)) throw new Error(`赛事已存在：${id}`);
    const state = createAuthorityState({
      tournamentId: id,
      rulesVersion: input.rulesVersion,
      snapshot: {
        name: String(input.name || 'HEXCORE 多人测试赛事').trim().slice(0, 80),
        createdAt: new Date().toISOString(),
        currentTeamId: teamIdFromInput(input),
        teams: normalizeTeams(input),
      },
    });
    this.tournaments.set(id, state);
    this.subscribers.set(id, new Set());
    const roomAccess = createRoomAccess(id, input);
    this.roomAccess.set(id, roomAccess.stored);
    this.initialRoomAccess.set(id, roomAccess.initial);
    return clone(state);
  }

  getTournament(id) {
    const state = this.tournaments.get(id);
    return state ? clone(state) : null;
  }

  replaceTournament(id, nextState) {
    if (!this.tournaments.has(id)) throw new Error(`赛事不存在：${id}`);
    this.tournaments.set(id, clone(nextState));
    const event = nextState.events[nextState.events.length - 1] || null;
    if (event) this.publish(id, event);
    return clone(nextState);
  }

  subscribe(id, res, projectEvent = event => event) {
    if (!this.tournaments.has(id)) throw new Error(`赛事不存在：${id}`);
    const bucket = this.subscribers.get(id) || new Set();
    const subscriber = { res, projectEvent };
    bucket.add(subscriber);
    this.subscribers.set(id, bucket);
    return () => {
      bucket.delete(subscriber);
    };
  }

  publish(id, event) {
    const bucket = this.subscribers.get(id);
    if (!bucket || !bucket.size) return;
    for (const subscriber of bucket) {
      try {
        const projected = subscriber.projectEvent(event);
        if (!projected) continue;
        const message = `event: ${projected.type}\nid: ${projected.eventSeq}\ndata: ${JSON.stringify(projected)}\n\n`;
        subscriber.res.write(message);
      } catch (error) {
        bucket.delete(subscriber);
      }
    }
  }

  consumeInitialRoomAccess(id) {
    const access = this.initialRoomAccess.get(id);
    this.initialRoomAccess.delete(id);
    return access ? clone(access) : null;
  }

  getRoomAccess(id, sessionToken) {
    const access = this.roomAccess.get(id);
    if (!access) return null;
    const session = this.getSession(sessionToken, id);
    if (!session) {
      const error = new Error('需要有效裁判或管理员 sessionToken 才能查看房间码管理信息');
      error.statusCode = 401;
      throw error;
    }
    if (![ROLES.REFEREE, ROLES.TOURNAMENT_ADMIN, ROLES.SUPER_ADMIN].includes(session.role)) {
      const error = new Error('当前身份无权查看房间码管理信息');
      error.statusCode = 403;
      throw error;
    }
    return roomAccessSummary(access);
  }

  joinTournament(id, input = {}) {
    const access = this.roomAccess.get(id);
    if (!access) throw new Error(`赛事不存在：${id}`);
    const code = String(input.code || '').trim();
    const displayName = String(input.displayName || '未命名用户').trim().slice(0, 40);
    const binding = bindingFromCode(access, code);
    if (!binding) throw new Error('房间码无效');
    const actorId = `user-${crypto.randomUUID()}`;
    const sessionToken = generateSecret('sess');
    const session = {
      sessionTokenHash: hashSecret(sessionToken),
      tournamentId: id,
      actorId,
      displayName,
      role: binding.role,
      teamId: binding.teamId || '',
      joinedAt: new Date().toISOString(),
    };
    this.sessions.set(session.sessionTokenHash, session);
    return clone({ ...session, sessionToken, sessionTokenHash: undefined });
  }

  getSession(sessionToken, tournamentId) {
    const session = this.sessions.get(hashSecret(String(sessionToken || '')));
    if (!session || session.tournamentId !== tournamentId) return null;
    return clone(session);
  }

  getSessionBinding(sessionToken, tournamentId) {
    const session = this.getSession(sessionToken, tournamentId);
    if (!session || session.tournamentId !== tournamentId) return null;
    return {
      actorId: session.actorId,
      role: session.role,
      teamId: session.teamId,
    };
  }
}

function normalizeTeams(input = {}) {
  const teams = Array.isArray(input.teams) && input.teams.length
    ? input.teams
    : Array.from({ length: 10 }, (_, index) => ({ teamId: `team-${index + 1}`, name: `队伍${index + 1}` }));
  return teams.map((team, index) => ({
    teamId: String(team.teamId || team.id || `team-${index + 1}`).trim(),
    name: String(team.name || `队伍${index + 1}`).trim().slice(0, 40),
    renameUsed: Boolean(team.renameUsed),
  }));
}

function teamIdFromInput(input = {}) {
  if (input.currentTeamId) return String(input.currentTeamId).trim();
  const teams = normalizeTeams(input);
  return teams[0] ? teams[0].teamId : '';
}

function createRoomAccess(id, input = {}) {
  const teams = Array.isArray(input.teams) && input.teams.length
    ? input.teams
    : normalizeTeams(input);
  const refereeCode = safeProvidedCode(input.refereeCode) || generateSecret('ref');
  const viewerCode = safeProvidedCode(input.viewerCode) || generateSecret('view');
  const captainCodes = teams.map((team, index) => ({
    teamId: String(team.teamId || team.id || `team-${index + 1}`).trim(),
    teamName: String(team.name || `队伍${index + 1}`).trim().slice(0, 40),
    code: safeProvidedCode(team.code) || generateSecret(`cap${index + 1}`),
  }));
  return {
    initial: {
      tournamentId: id,
      refereeCode,
      viewerCode,
      captainCodes,
    },
    stored: {
      tournamentId: id,
      refereeCodeHash: hashSecret(refereeCode),
      viewerCodeHash: hashSecret(viewerCode),
      captainCodes: captainCodes.map(item => ({
        teamId: item.teamId,
        teamName: item.teamName,
        codeHash: hashSecret(item.code),
      })),
      createdAt: new Date().toISOString(),
    },
  };
}

function bindingFromCode(access, code) {
  if (!code) return null;
  const codeHash = hashSecret(code);
  if (codeHash === access.refereeCodeHash) return { role: ROLES.REFEREE };
  if (codeHash === access.viewerCodeHash) return { role: ROLES.VIEWER };
  const captain = access.captainCodes.find(item => item.codeHash === codeHash);
  if (captain) return { role: ROLES.CAPTAIN, teamId: captain.teamId };
  return null;
}

function generateSecret(prefix) {
  return `${prefix}_${crypto.randomBytes(24).toString('base64url')}`;
}

function hashSecret(secret) {
  return crypto.createHash('sha256').update(String(secret || ''), 'utf8').digest('hex');
}

function safeProvidedCode(value) {
  const text = String(value || '').trim();
  return text ? text.slice(0, 120) : '';
}

function roomAccessSummary(access) {
  return clone({
    tournamentId: access.tournamentId,
    refereeCode: { issued: Boolean(access.refereeCodeHash) },
    viewerCode: { issued: Boolean(access.viewerCodeHash) },
    captainCodes: access.captainCodes.map(item => ({
      teamId: item.teamId,
      teamName: item.teamName,
      codeIssued: Boolean(item.codeHash),
    })),
    createdAt: access.createdAt,
  });
}

module.exports = {
  MemoryTournamentStore,
  bindingFromCode,
  createRoomAccess,
  generateSecret,
  hashSecret,
  roomAccessSummary,
};
