const { createAuthorityState } = require('../../packages/rules');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class MemoryTournamentStore {
  constructor() {
    this.tournaments = new Map();
    this.subscribers = new Map();
    this.roomAccess = new Map();
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
      },
    });
    this.tournaments.set(id, state);
    this.subscribers.set(id, new Set());
    this.roomAccess.set(id, createRoomAccess(id, input));
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

  subscribe(id, res) {
    if (!this.tournaments.has(id)) throw new Error(`赛事不存在：${id}`);
    const bucket = this.subscribers.get(id) || new Set();
    bucket.add(res);
    this.subscribers.set(id, bucket);
    return () => {
      bucket.delete(res);
    };
  }

  publish(id, event) {
    const bucket = this.subscribers.get(id);
    if (!bucket || !bucket.size) return;
    const message = `event: ${event.type}\nid: ${event.eventSeq}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const res of bucket) {
      try {
        res.write(message);
      } catch (error) {
        bucket.delete(res);
      }
    }
  }

  getRoomAccess(id) {
    const access = this.roomAccess.get(id);
    return access ? clone(access) : null;
  }

  joinTournament(id, input = {}) {
    const access = this.roomAccess.get(id);
    if (!access) throw new Error(`赛事不存在：${id}`);
    const code = String(input.code || '').trim();
    const displayName = String(input.displayName || '未命名用户').trim().slice(0, 40);
    const binding = bindingFromCode(access, code);
    if (!binding) throw new Error('房间码无效');
    const actorId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const sessionToken = `session-${Math.random().toString(36).slice(2)}-${Date.now()}`;
    const session = {
      sessionToken,
      tournamentId: id,
      actorId,
      displayName,
      role: binding.role,
      teamId: binding.teamId || '',
      joinedAt: new Date().toISOString(),
    };
    this.sessions.set(sessionToken, session);
    return clone(session);
  }

  getSessionBinding(sessionToken, tournamentId) {
    const session = this.sessions.get(String(sessionToken || ''));
    if (!session || session.tournamentId !== tournamentId) return null;
    return {
      actorId: session.actorId,
      role: session.role,
      teamId: session.teamId,
    };
  }
}

function createRoomAccess(id, input = {}) {
  const teams = Array.isArray(input.teams) && input.teams.length
    ? input.teams
    : Array.from({ length: 10 }, (_, index) => ({ teamId: `team-${index + 1}`, name: `队伍${index + 1}` }));
  return {
    tournamentId: id,
    refereeCode: String(input.refereeCode || `${id}-referee`).trim(),
    viewerCode: String(input.viewerCode || `${id}-viewer`).trim(),
    displayCode: String(input.displayCode || `${id}-display`).trim(),
    captainCodes: teams.map((team, index) => ({
      teamId: String(team.teamId || team.id || `team-${index + 1}`).trim(),
      teamName: String(team.name || `队伍${index + 1}`).trim().slice(0, 40),
      code: String(team.code || `${id}-captain-${index + 1}`).trim(),
    })),
  };
}

function bindingFromCode(access, code) {
  if (!code) return null;
  if (code === access.refereeCode) return { role: 'referee' };
  if (code === access.viewerCode) return { role: 'viewer' };
  if (code === access.displayCode) return { role: 'display' };
  const captain = access.captainCodes.find(item => item.code === code);
  if (captain) return { role: 'captain', teamId: captain.teamId };
  return null;
}

module.exports = {
  MemoryTournamentStore,
  bindingFromCode,
  createRoomAccess,
};
