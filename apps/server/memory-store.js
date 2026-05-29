const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createAuthorityState } = require('../../packages/rules');
const { ROLES } = require('../../packages/shared');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class MemoryTournamentStore {
  constructor(options = {}) {
    this.dataFile = options.dataFile || process.env.HEXCORE_DATA_FILE || '';
    this.sessionTtlMs = normalizeSessionTtlMs(options.sessionTtlMs);
    this.maxRooms = normalizeMaxRooms(options.maxRooms);
    this.tournaments = new Map();
    this.subscribers = new Map();
    this.roomAccess = new Map();
    this.initialRoomAccess = new Map();
    this.sessions = new Map();
    this.loadFromDisk();
  }

  createTournament(input = {}) {
    const id = String(input.id || input.tournamentId || `tournament-${Date.now()}`).trim();
    if (!/^[A-Za-z0-9._:-]{1,80}$/.test(id)) throw new Error('赛事 ID 必须是 1-80 位安全标识');
    if (this.tournaments.has(id)) throw new Error(`赛事已存在：${id}`);
    if (this.activeRoomCount() >= this.maxRooms) {
      const error = new Error(`active 房间数量已达上限：${this.maxRooms}`);
      error.statusCode = 400;
      throw error;
    }
    const state = createAuthorityState({
      tournamentId: id,
      rulesVersion: input.rulesVersion,
      snapshot: {
        tournamentId: id,
        name: String(input.name || 'HEXCORE 多人测试赛事').trim().slice(0, 80),
        createdAt: new Date().toISOString(),
        roomStatus: 'active',
        currentTeamId: teamIdFromInput(input),
        currentRound: safePositiveNumber(input.currentRound, 1, 8),
        settings: normalizeSettings(input.settings),
        teams: normalizeTeams(input),
        players: normalizePlayers(input),
        playerProfiles: normalizePlayerProfiles(input),
        hexcoreAssignments: normalizeHexcoreAssignments(input),
        hungryWaveRound: normalizeHungryWaveRound(input),
        tournament: normalizeTournament(input.tournament || (input.snapshot && input.snapshot.tournament)),
      },
    });
    this.tournaments.set(id, state);
    this.subscribers.set(id, new Set());
    const roomAccess = createRoomAccess(id, input);
    this.roomAccess.set(id, roomAccess.stored);
    this.initialRoomAccess.set(id, roomAccess.initial);
    this.persistToDisk();
    return clone(state);
  }

  getTournament(id) {
    const state = this.tournaments.get(id);
    return state ? clone(state) : null;
  }

  replaceTournament(id, nextState) {
    if (!this.tournaments.has(id)) throw new Error(`赛事不存在：${id}`);
    this.assertRoomWritable(id);
    this.tournaments.set(id, clone(nextState));
    this.persistToDisk();
    const event = nextState.events[nextState.events.length - 1] || null;
    if (event) this.publish(id, event, nextState);
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

  publish(id, event, state = null) {
    const bucket = this.subscribers.get(id);
    if (!bucket || !bucket.size) return;
    for (const subscriber of bucket) {
      try {
        const projected = subscriber.projectEvent(event, state);
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
      storage: this.storageLabel(),
      checksum: checksumJson(tournament),
      tournament,
    };
  }

  storageLabel() {
    return this.dataFile ? 'memory+file' : 'memory';
  }

  activeRoomCount() {
    return Array.from(this.roomAccess.values()).filter(access => roomStatus(access) === 'active').length;
  }

  publicStats() {
    const subscriberCount = Array.from(this.subscribers.values()).reduce((sum, bucket) => sum + bucket.size, 0);
    return {
      storage: this.storageLabel(),
      tournamentCount: this.tournaments.size,
      roomCount: this.roomAccess.size,
      activeRoomCount: this.activeRoomCount(),
      maxRooms: this.maxRooms,
      postgresConnected: false,
      sessionTtlSeconds: Math.max(1, Math.ceil(this.sessionTtlMs / 1000)),
      subscriberCount,
    };
  }

  listRooms() {
    return Array.from(this.roomAccess.entries()).map(([id, access]) => {
      const state = this.tournaments.get(id) || {};
      const snapshot = state.snapshot || {};
      const teams = Array.isArray(snapshot.teams) ? snapshot.teams : [];
      const settings = snapshot.settings && typeof snapshot.settings === 'object' ? snapshot.settings : {};
      const subscriberBucket = this.subscribers.get(id);
      return {
        tournamentId: id,
        name: String(snapshot.name || id).trim().slice(0, 80),
        status: roomStatus(access),
        createdAt: String(access.createdAt || snapshot.createdAt || '').trim(),
        updatedAt: String(access.updatedAt || access.createdAt || snapshot.createdAt || '').trim(),
        archivedAt: String(access.archivedAt || '').trim(),
        teamCount: safePositiveNumber(settings.teamCount || settings.totalTeams || teams.length, teams.length || 0, 20),
        campMode: String(settings.campMode || 'dual_camp').trim(),
        pairingMode: String(settings.pairingMode || '').trim(),
        storage: this.storageLabel(),
        subscriberCount: subscriberBucket ? subscriberBucket.size : 0,
      };
    }).filter(room => room.status !== 'deleted');
  }

  joinTournament(id, input = {}) {
    const access = this.roomAccess.get(id);
    if (!access) throw new Error(`赛事不存在：${id}`);
    if (roomStatus(access) === 'archived') {
      const error = new Error('房间已归档，不能加入');
      error.statusCode = 403;
      throw error;
    }
    const code = String(input.code || '').trim();
    const displayName = String(input.displayName || '未命名用户').trim().slice(0, 40);
    const binding = bindingFromCode(access, code);
    if (!binding) throw new Error('房间码无效');
    const actorId = `user-${crypto.randomUUID()}`;
    const sessionToken = generateSecret('sess');
    const issuedAt = new Date();
    const session = {
      sessionTokenHash: hashSecret(sessionToken),
      tournamentId: id,
      actorId,
      displayName,
      role: binding.role,
      teamId: binding.teamId || '',
      joinedAt: issuedAt.toISOString(),
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + this.sessionTtlMs).toISOString(),
    };
    this.sessions.set(session.sessionTokenHash, session);
    this.persistToDisk();
    return clone({ ...session, sessionToken, sessionTokenHash: undefined });
  }

  assertRoomWritable(id) {
    const access = this.roomAccess.get(id);
    if (!access) {
      const error = new Error('赛事不存在');
      error.statusCode = 404;
      throw error;
    }
    if (roomStatus(access) === 'archived') {
      const error = new Error('房间已归档，不能执行操作');
      error.statusCode = 403;
      throw error;
    }
    return true;
  }

  archiveTournament(id, sessionToken) {
    const access = this.roomAccess.get(id);
    const state = this.tournaments.get(id);
    if (!access || !state) return null;
    this.requireManagementSession(id, sessionToken, '房间生命周期管理');
    const now = new Date().toISOString();
    const nextAccess = {
      ...access,
      status: 'archived',
      archivedAt: access.archivedAt || now,
      updatedAt: now,
    };
    const nextState = clone(state);
    nextState.snapshot = nextState.snapshot && typeof nextState.snapshot === 'object' ? nextState.snapshot : {};
    nextState.snapshot.roomStatus = 'archived';
    this.roomAccess.set(id, nextAccess);
    this.tournaments.set(id, nextState);
    this.persistToDisk();
    return roomLifecycleSummary(id, nextAccess);
  }

  deleteTournament(id, sessionToken) {
    const access = this.roomAccess.get(id);
    if (!access || !this.tournaments.has(id)) return null;
    const session = this.requireManagementSession(id, sessionToken, '房间生命周期管理');
    const now = new Date().toISOString();
    this.tournaments.delete(id);
    this.roomAccess.delete(id);
    this.initialRoomAccess.delete(id);
    this.subscribers.delete(id);
    for (const [hash, current] of Array.from(this.sessions.entries())) {
      if (current && current.tournamentId === id) this.sessions.delete(hash);
    }
    this.persistToDisk();
    return {
      tournamentId: id,
      status: 'deleted',
      deletedAt: now,
      deletedBy: session.actorId || '',
    };
  }

  getSession(sessionToken, tournamentId) {
    const sessionHash = hashSecret(String(sessionToken || ''));
    const session = this.sessions.get(sessionHash);
    if (!session || session.tournamentId !== tournamentId) return null;
    if (this.isSessionExpired(session)) {
      this.sessions.delete(sessionHash);
      this.persistToDisk();
      return null;
    }
    return clone(session);
  }

  isSessionExpired(session) {
    const expiresAtMs = Date.parse(session && session.expiresAt);
    if (Number.isFinite(expiresAtMs)) return Date.now() >= expiresAtMs;
    const issuedAtMs = Date.parse((session && (session.issuedAt || session.joinedAt)) || '');
    return Number.isFinite(issuedAtMs) ? Date.now() >= issuedAtMs + this.sessionTtlMs : true;
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

  loadFromDisk() {
    if (!this.dataFile) return;
    try {
      if (!fs.existsSync(this.dataFile)) return;
      const parsed = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
      if (!parsed || parsed.storeVersion !== 'hexcore-memory-store-v1') return;
      this.tournaments = mapFromEntries(parsed.tournaments);
      this.roomAccess = mapFromEntries(parsed.roomAccess);
      this.sessions = mapFromEntries(parsed.sessions);
      this.initialRoomAccess = new Map();
    } catch (error) {
      throw new Error(`读取多人端持久化文件失败：${error.message}`);
    }
  }

  persistToDisk() {
    if (!this.dataFile) return;
    const payload = {
      storeVersion: 'hexcore-memory-store-v1',
      savedAt: new Date().toISOString(),
      tournaments: entriesFromMap(this.tournaments),
      roomAccess: entriesFromMap(this.roomAccess),
      sessions: entriesFromMap(this.sessions),
    };
    const target = path.resolve(this.dataFile);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(tmp, target);
  }
}

function entriesFromMap(map) {
  return Array.from((map || new Map()).entries()).map(([key, value]) => [key, clone(value)]);
}

function mapFromEntries(entries) {
  return new Map((Array.isArray(entries) ? entries : []).map(([key, value]) => [String(key), clone(value)]));
}

function normalizeSessionTtlMs(value) {
  const configuredMs = Number(value);
  if (Number.isFinite(configuredMs) && configuredMs >= 1) return Math.round(configuredMs);
  const envHours = Number(process.env.HEXCORE_SESSION_TTL_HOURS);
  const hours = Number.isFinite(envHours) && envHours > 0 ? envHours : 24;
  return Math.round(hours * 60 * 60 * 1000);
}

function normalizeMaxRooms(value) {
  const configured = Number(value ?? process.env.HEXCORE_MAX_ROOMS);
  if (Number.isInteger(configured) && configured >= 1 && configured <= 500) return configured;
  return 20;
}

function roomStatus(access = {}) {
  const status = String(access.status || 'active').trim();
  return ['active', 'archived', 'deleted'].includes(status) ? status : 'active';
}

function normalizeTeams(input = {}) {
  const settings = normalizeSettings(input.settings);
  const teamCount = safePositiveNumber(settings.teamCount, 10, 20);
  const teams = Array.isArray(input.teams) && input.teams.length
    ? input.teams
    : Array.from({ length: teamCount }, (_, index) => ({ teamId: `team-${index + 1}`, name: `队伍${index + 1}` }));
  return teams.slice(0, 20).map((team, index) => ({
    teamId: String(team.teamId || team.id || `team-${index + 1}`).trim(),
    name: String(team.name || `队伍${index + 1}`).trim().slice(0, 40),
    camp: String(team.camp || '').trim().slice(0, 40),
    playerId: String(team.playerId || team.captainPlayerId || '').trim().slice(0, 80),
    playerGameId: String(team.playerGameId || '').trim().slice(0, 80),
    team: Array.isArray(team.team)
      ? team.team.map(playerId => String(playerId || '').trim().slice(0, 80)).filter(Boolean).slice(0, 8)
      : (Array.isArray(team.memberIds) ? team.memberIds.map(playerId => String(playerId || '').trim().slice(0, 80)).filter(Boolean).slice(0, 8) : []),
    economy: normalizeTeamEconomy(input, team),
    renameUsed: Boolean(team.renameUsed),
  }));
}

function normalizeTeamEconomy(input = {}, team = {}) {
  const settings = input.settings && typeof input.settings === 'object' ? input.settings : {};
  const source = team.economy && typeof team.economy === 'object' ? team.economy : {};
  const initialGold = safePositiveNumber(settings.initialGold, 6, 99);
  const roundState = source.roundState && typeof source.roundState === 'object'
    ? Object.fromEntries(Object.entries(source.roundState).map(([round, state]) => [
      String(safePositiveNumber(round, 1, 8)),
      {
        freeShopUsed: Boolean(state && state.freeShopUsed),
        refreshCount: safePositiveNumber(state && state.refreshCount, 0, 99),
        purchaseUsed: Boolean(state && state.purchaseUsed),
        skipped: Boolean(state && state.skipped),
        photographerRefreshUsed: Boolean(state && state.photographerRefreshUsed),
        hungryWaveFreeRefreshes: safePositiveNumber(state && state.hungryWaveFreeRefreshes, 0, 9),
      },
    ]))
    : {};
  return {
    gold: safePositiveNumber(source.gold ?? team.gold, initialGold, 999),
    roundState,
  };
}

function normalizeSettings(settings = {}) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const teamCount = Math.max(6, safePositiveNumber(source.teamCount || source.totalTeams, 10, 20));
  const campMode = ['dual_camp', 'no_camp'].includes(String(source.campMode || '').trim()) ? String(source.campMode).trim() : 'dual_camp';
  if (campMode === 'dual_camp' && teamCount % 2 !== 0) {
    throw new Error('双阵营模式队伍数量必须为偶数');
  }
  const pairingMode = ['camp_versus', 'random', 'manual'].includes(String(source.pairingMode || '').trim())
    ? String(source.pairingMode).trim()
    : (campMode === 'no_camp' ? 'random' : 'camp_versus');
  const refreshCosts = Array.isArray(source.refreshCosts) && source.refreshCosts.length
    ? source.refreshCosts.slice(0, 4).map(cost => safePositiveNumber(cost, 1, 9))
    : [1, 2, 3, 4];
  return {
    minTeams: 6,
    maxTeams: 20,
    teamCount,
    totalTeams: teamCount,
    playersPerTeam: Math.max(2, safePositiveNumber(source.playersPerTeam, 5, 8)),
    teamSizeIncludesCaptain: true,
    campMode,
    pairingMode,
    allowSubstitutes: source.allowSubstitutes !== false,
    initialGold: safePositiveNumber(source.initialGold, 6, 99),
    roundIncome: safePositiveNumber(source.roundIncome, 3, 99),
    refreshCosts,
    turnTimers: {
      hexcoreSeconds: safePositiveNumber(source.turnTimers && source.turnTimers.hexcoreSeconds, 0, 3600),
      shopSeconds: safePositiveNumber(source.turnTimers && source.turnTimers.shopSeconds, 0, 3600),
    },
  };
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
    profileId: String(player.profileId || '').trim().slice(0, 80),
    tournamentName: String(player.tournamentName || '').trim().slice(0, 80),
    region: String(player.region || '').trim().slice(0, 40),
    attendanceStatus: normalizeAttendanceStatus(player.attendanceStatus),
    drawWeight: normalizeDrawWeight(player.drawWeight, player.attendanceStatus),
    teamId: String(player.teamId || '').trim().slice(0, 80),
    isCaptain: Boolean(player.isCaptain),
  })).filter(player => player.id);
}

function normalizeAttendanceStatus(value) {
  const text = String(value || '').trim().toLowerCase();
  if (['confirmed', 'confirm', 'ok', '已确认', '确认', '正常'].includes(text)) return 'confirmed';
  if (['pending', 'wait', '待确认', '未确认', '待定'].includes(text)) return 'pending';
  if (['high_risk', 'high-risk', 'risk', '高风险', '风险', '可能缺席'].includes(text)) return 'high_risk';
  if (['substitute', 'sub', '替补', '候补'].includes(text)) return 'substitute';
  if (['unavailable', 'absent', 'missing', '缺席', '不可用', '禁用'].includes(text)) return 'unavailable';
  return 'confirmed';
}

function normalizeDrawWeight(value, status) {
  const defaults = {
    confirmed: 1,
    pending: 0.7,
    high_risk: 0.4,
    substitute: 0,
    unavailable: 0,
  };
  const fallback = defaults[normalizeAttendanceStatus(status)] ?? 1;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, Math.round(number * 100) / 100));
}

function normalizePlayerProfiles(input = {}) {
  const profiles = Array.isArray(input.playerProfiles)
    ? input.playerProfiles
    : (input.snapshot && Array.isArray(input.snapshot.playerProfiles) ? input.snapshot.playerProfiles : []);
  return profiles.map((profile, index) => ({
    id: String(profile.id || profile.profileId || `profile-${index + 1}`).trim().slice(0, 80),
    commonName: String(profile.commonName || profile.name || `选手档案${index + 1}`).trim().slice(0, 40),
    aliases: Array.isArray(profile.aliases)
      ? profile.aliases.map(alias => String(alias || '').trim().slice(0, 40)).filter(Boolean).slice(0, 12)
      : [],
    historicalIdentities: Array.isArray(profile.historicalIdentities)
      ? profile.historicalIdentities.map(identity => ({
        tournamentName: String(identity && identity.tournamentName || '').trim().slice(0, 80),
        region: String(identity && identity.region || '').trim().slice(0, 40),
        gameId: String(identity && identity.gameId || '').trim().slice(0, 80),
        name: String(identity && identity.name || '').trim().slice(0, 40),
      })).filter(identity => identity.tournamentName || identity.region || identity.gameId || identity.name).slice(0, 30)
      : [],
    attendanceReliability: normalizeAttendanceStatus(profile.attendanceReliability || profile.attendanceStatus),
    refereeNotes: String(profile.refereeNotes || profile.notes || '').trim().slice(0, 240),
    updatedAt: String(profile.updatedAt || '').trim().slice(0, 40),
  })).filter(profile => profile.id);
}

function normalizeHexcoreAssignments(input = {}) {
  const source = input.hexcoreAssignments && typeof input.hexcoreAssignments === 'object'
    ? input.hexcoreAssignments
    : (input.snapshot && input.snapshot.hexcoreAssignments && typeof input.snapshot.hexcoreAssignments === 'object' ? input.snapshot.hexcoreAssignments : {});
  return Object.fromEntries(Object.entries(source).map(([teamId, list]) => [
    String(teamId || '').trim().slice(0, 80),
    (Array.isArray(list) ? list : []).map(item => ({
      id: String((item && (item.id || item.hexcoreId)) || item || '').trim().slice(0, 80),
      status: String((item && item.status) || 'available').trim().slice(0, 40),
    })).filter(item => item.id).slice(0, 4),
  ]).filter(([teamId]) => teamId));
}

function normalizeHungryWaveRound(input = {}) {
  const source = input.hungryWaveRound && typeof input.hungryWaveRound === 'object'
    ? input.hungryWaveRound
    : (input.snapshot && input.snapshot.hungryWaveRound && typeof input.snapshot.hungryWaveRound === 'object' ? input.snapshot.hungryWaveRound : null);
  if (!source) return null;
  const captainId = String(source.captainId || source.teamId || '').trim().slice(0, 80);
  const round = safePositiveNumber(source.round, 1, 8);
  if (!captainId || !round) return null;
  return {
    type: 'hungry_wave_round',
    captainId,
    round,
    active: source.active === false ? false : true,
    consumed: Boolean(source.consumed),
    triggered: Boolean(source.triggered),
    pendingRoundReward: Boolean(source.pendingRoundReward),
    roundRewardResolved: Boolean(source.roundRewardResolved),
    roundRewardPlayerId: String(source.roundRewardPlayerId || '').trim().slice(0, 80),
    roundRewardFailedReason: String(source.roundRewardFailedReason || '').trim().slice(0, 80),
    checkedTeamIds: Array.isArray(source.checkedTeamIds)
      ? source.checkedTeamIds.map(teamId => String(teamId || '').trim().slice(0, 80)).filter(Boolean).slice(0, 20)
      : [],
    resolvedAt: String(source.resolvedAt || '').trim().slice(0, 40),
  };
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
  const createdAt = new Date().toISOString();
  const captainCodes = teams.map((team, index) => ({
    teamId: String(team.teamId || team.id || `team-${index + 1}`).trim(),
    teamName: String(team.name || `队伍${index + 1}`).trim().slice(0, 40),
    code: safeProvidedCode(team.code) || generateSecret(`cap${index + 1}`),
  }));
  return {
    initial: {
      tournamentId: id,
      status: 'active',
      refereeCode,
      viewerCode,
      captainCodes,
      createdAt,
    },
    stored: {
      tournamentId: id,
      status: 'active',
      refereeCodeHash: hashSecret(refereeCode),
      viewerCodeHash: hashSecret(viewerCode),
      captainCodes: captainCodes.map(item => ({
        teamId: item.teamId,
        teamName: item.teamName,
        codeHash: hashSecret(item.code),
      })),
      createdAt,
      updatedAt: createdAt,
      archivedAt: '',
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
    status: roomStatus(access),
    refereeCode: { issued: Boolean(access.refereeCodeHash) },
    viewerCode: { issued: Boolean(access.viewerCodeHash) },
    captainCodes: access.captainCodes.map(item => ({
      teamId: item.teamId,
      teamName: item.teamName,
      codeIssued: Boolean(item.codeHash),
    })),
    createdAt: access.createdAt,
    updatedAt: access.updatedAt || access.createdAt || '',
    archivedAt: access.archivedAt || '',
  });
}

function roomLifecycleSummary(id, access = {}) {
  return {
    tournamentId: id,
    status: roomStatus(access),
    createdAt: String(access.createdAt || '').trim(),
    updatedAt: String(access.updatedAt || access.createdAt || '').trim(),
    archivedAt: String(access.archivedAt || '').trim(),
  };
}

module.exports = {
  MemoryTournamentStore,
  bindingFromCode,
  createRoomAccess,
  generateSecret,
  hashSecret,
  roomLifecycleSummary,
  roomAccessSummary,
};
