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
        currentRound: safePositiveNumber(input.currentRound, 1, 8),
        teams: normalizeTeams(input),
        players: normalizePlayers(input),
        tournament: normalizeTournament(input.tournament || (input.snapshot && input.snapshot.tournament)),
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
    this.requireManagementSession(id, sessionToken, '房间码管理信息');
    return roomAccessSummary(access);
  }

  getAuditLog(id, sessionToken) {
    const state = this.tournaments.get(id);
    if (!state) return null;
    this.requireManagementSession(id, sessionToken, '裁判审计日志');
    return clone(Array.isArray(state.auditLog) ? state.auditLog : []);
  }

  getTournamentBackup(id, sessionToken) {
    const state = this.tournaments.get(id);
    if (!state) return null;
    this.requireManagementSession(id, sessionToken, '赛事备份');
    const tournament = clone(state);
    return {
      backupVersion: 'hexcore-multiplayer-backup-v1',
      exportedAt: new Date().toISOString(),
      storage: 'memory',
      checksum: checksumJson(tournament),
      tournament,
    };
  }

  publicStats() {
    const subscriberCount = Array.from(this.subscribers.values()).reduce((sum, bucket) => sum + bucket.size, 0);
    return {
      storage: 'memory',
      tournamentCount: this.tournaments.size,
      roomCount: this.roomAccess.size,
      subscriberCount,
    };
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

  requireManagementSession(tournamentId, sessionToken, resourceName) {
    const session = this.getSession(sessionToken, tournamentId);
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
}

function normalizeTeams(input = {}) {
  const teams = Array.isArray(input.teams) && input.teams.length
    ? input.teams
    : Array.from({ length: 10 }, (_, index) => ({ teamId: `team-${index + 1}`, name: `队伍${index + 1}` }));
  return teams.map((team, index) => ({
    teamId: String(team.teamId || team.id || `team-${index + 1}`).trim(),
    name: String(team.name || `队伍${index + 1}`).trim().slice(0, 40),
    camp: String(team.camp || '').trim().slice(0, 40),
    playerId: String(team.playerId || team.captainPlayerId || '').trim().slice(0, 80),
    playerGameId: String(team.playerGameId || '').trim().slice(0, 80),
    team: Array.isArray(team.team)
      ? team.team.map(playerId => String(playerId || '').trim().slice(0, 80)).filter(Boolean).slice(0, 8)
      : (Array.isArray(team.memberIds) ? team.memberIds.map(playerId => String(playerId || '').trim().slice(0, 80)).filter(Boolean).slice(0, 8) : []),
    renameUsed: Boolean(team.renameUsed),
  }));
}

function normalizePlayers(input = {}) {
  const players = Array.isArray(input.players)
    ? input.players
    : (input.snapshot && Array.isArray(input.snapshot.players) ? input.snapshot.players : []);
  return players.map((player, index) => ({
    id: String(player.id || player.playerId || `player-${index + 1}`).trim().slice(0, 80),
    name: String(player.name || `选手${index + 1}`).trim().slice(0, 40),
    gameId: String(player.gameId || player.id || '').trim().slice(0, 80),
    camp: String(player.camp || '').trim().slice(0, 40),
    lane: String(player.lane || '').trim().slice(0, 40),
    tier: safePositiveNumber(player.tier || player.price || player.score, 1, 5),
    score: safePositiveNumber(player.score || player.tier, 0, 999),
    heroes: Array.isArray(player.heroes) ? player.heroes.map(hero => String(hero || '').trim().slice(0, 24)).filter(Boolean).slice(0, 3) : [],
    status: String(player.status || 'available').trim().slice(0, 40),
    teamId: String(player.teamId || '').trim().slice(0, 80),
    isCaptain: Boolean(player.isCaptain),
  })).filter(player => player.id);
}

function normalizeTournament(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const rounds = Array.isArray(source.rounds)
    ? source.rounds.map((round, roundIndex) => ({
      id: String(round.id || `r${roundIndex + 1}`).trim().slice(0, 80),
      name: String(round.name || `第 ${roundIndex + 1} 轮`).trim().slice(0, 40),
      index: safePositiveNumber(round.index || roundIndex + 1, roundIndex + 1, 99),
      pairingMode: String(round.pairingMode || source.pairingMode || '').trim().slice(0, 40),
      matches: Array.isArray(round.matches) ? round.matches.map((match, matchIndex) => normalizeTournamentMatch(match, roundIndex, matchIndex)) : [],
    })).filter(round => round.id)
    : [];
  return {
    type: String(source.type || '').trim().slice(0, 40),
    status: String(source.status || (rounds.length ? 'running' : 'empty')).trim().slice(0, 40),
    pairingMode: String(source.pairingMode || '').trim().slice(0, 40),
    championId: String(source.championId || '').trim().slice(0, 80),
    winnerCamp: String(source.winnerCamp || '').trim().slice(0, 40),
    winnerReason: String(source.winnerReason || '').trim().slice(0, 80),
    finalBandlePoints: safePositiveNumber(source.finalBandlePoints, 0, 999),
    finalInvaderPoints: safePositiveNumber(source.finalInvaderPoints, 0, 999),
    finalBattle: normalizeFinalBattle(source.finalBattle),
    rounds,
  };
}

function normalizeTournamentMatch(match = {}, roundIndex = 0, matchIndex = 0) {
  return {
    id: String(match.id || `r${roundIndex + 1}m${matchIndex + 1}`).trim().slice(0, 80),
    status: String(match.status || 'pending').trim().slice(0, 40),
    teamAId: String(match.teamAId || '').trim().slice(0, 80),
    teamBId: String(match.teamBId || '').trim().slice(0, 80),
    scoreA: normalizeScore(match.scoreA),
    scoreB: normalizeScore(match.scoreB),
    winnerId: String(match.winnerId || '').trim().slice(0, 80),
    byeConfirmed: Boolean(match.byeConfirmed),
    pairingMode: String(match.pairingMode || '').trim().slice(0, 40),
    expectedCampA: String(match.expectedCampA || '').trim().slice(0, 40),
    expectedCampB: String(match.expectedCampB || '').trim().slice(0, 40),
    yordleCount: safePositiveNumber(match.yordleCount, 0, 5),
    bandlePoints: safePositiveNumber(match.bandlePoints, 0, 99),
    invaderPoints: safePositiveNumber(match.invaderPoints, 0, 99),
  };
}

function normalizeFinalBattle(finalBattle = {}) {
  const source = finalBattle && typeof finalBattle === 'object' ? finalBattle : {};
  return {
    enabled: Boolean(source.enabled),
    bonusPoints: safePositiveNumber(source.bonusPoints, 10, 99),
    bandleTeamId: String(source.bandleTeamId || '').trim().slice(0, 80),
    invaderTeamId: String(source.invaderTeamId || '').trim().slice(0, 80),
    winnerCamp: String(source.winnerCamp || '').trim().slice(0, 40),
    games: Array.isArray(source.games) ? source.games.map((game, index) => ({
      id: String(game.id || `bo5-${index + 1}`).trim().slice(0, 80),
      bandleScore: normalizeScore(game.bandleScore),
      invaderScore: normalizeScore(game.invaderScore),
      winnerCamp: String(game.winnerCamp || '').trim().slice(0, 40),
      status: String(game.status || 'pending').trim().slice(0, 40),
    })).slice(0, 5) : [],
  };
}

function normalizeScore(value) {
  if (value === '' || value === null || typeof value === 'undefined') return '';
  return safePositiveNumber(value, 0, 999);
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

function checksumJson(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function safeProvidedCode(value) {
  const text = String(value || '').trim();
  return text ? text.slice(0, 120) : '';
}

function safePositiveNumber(value, fallback = 0, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(max, Math.round(number)));
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
