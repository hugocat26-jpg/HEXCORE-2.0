const { COMMAND_TYPES, ROLES } = require('../../packages/shared');

const SNAPSHOT_PUBLIC_FIELDS = [
  'name',
  'createdAt',
  'mode',
  'status',
  'currentRound',
  'currentPhase',
  'currentTeamId',
  'currentTeamName',
  'championTeamId',
  'championTeamName',
];

const EVENT_PUBLIC_PAYLOAD_FIELDS = [
  'commandType',
  'teamId',
  'teamName',
  'hexcoreId',
  'hexcoreName',
  'slotId',
  'matchId',
  'scoreA',
  'scoreB',
  'winnerTeamId',
  'winnerTeamName',
  'round',
  'phase',
  'summary',
  'message',
  'targetStateVersion',
  'restoredStateVersion',
];

const VIEW_TYPES = Object.freeze({
  PUBLIC: 'public',
  VIEWER: 'viewer',
  CAPTAIN: 'captain',
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function pickFields(source, fields) {
  const result = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(source || {}, field)) {
      result[field] = source[field];
    }
  }
  return result;
}

function normalizeProjectionView(view) {
  const normalized = String(view || VIEW_TYPES.PUBLIC).trim().toLowerCase();
  if (normalized === ROLES.VIEWER || normalized === VIEW_TYPES.VIEWER) return VIEW_TYPES.VIEWER;
  if (normalized === ROLES.CAPTAIN || normalized === VIEW_TYPES.CAPTAIN) return VIEW_TYPES.CAPTAIN;
  if (normalized === VIEW_TYPES.PUBLIC) return VIEW_TYPES.PUBLIC;
  throw new Error('未知只读投影视图');
}

function publicTeams(snapshot = {}) {
  return Array.isArray(snapshot.teams) ? snapshot.teams.map(team => {
    const projected = {
      teamId: team.teamId || team.id || '',
      name: team.name || '',
      camp: team.camp || '',
    };
    if (team.playerId || team.captainPlayerId) projected.playerId = team.playerId || team.captainPlayerId || '';
    if (Array.isArray(team.team)) projected.team = team.team.map(playerId => String(playerId || '').trim()).filter(Boolean);
    if (team.economy && typeof team.economy === 'object') {
      projected.economy = {
        gold: Math.max(0, Number(team.economy.gold) || 0),
      };
    }
    return projected;
  }) : [];
}

function publicShopCard(card = {}) {
  const realPlayerId = String(card.playerId || '').trim();
  const displayPlayerId = String(card.displayPlayerId || '').trim();
  const masked = Boolean(displayPlayerId && realPlayerId && displayPlayerId !== realPlayerId);
  const visiblePlayerId = masked ? displayPlayerId : realPlayerId;
  return {
    slotId: String(card.slotId || '').trim(),
    playerId: visiblePlayerId,
    displayPlayerId: displayPlayerId || visiblePlayerId,
    name: String(masked ? (card.displayName || '') : (card.name || card.playerName || '')).trim(),
    gameId: String(masked ? (card.displayGameId || '') : (card.gameId || '')).trim(),
    lane: String(masked ? (card.displayLane || '') : (card.lane || '')).trim(),
    score: Number(masked ? card.displayScore : card.score) || 0,
    heroes: Array.isArray(masked ? card.displayHeroes : card.heroes)
      ? (masked ? card.displayHeroes : card.heroes).map(hero => String(hero || '').trim()).filter(Boolean).slice(0, 3)
      : [],
    tier: Number(card.tier) || 1,
    price: Number(card.price) || Number(card.tier) || 1,
    camp: String(card.camp || '').trim(),
    purchased: Boolean(card.purchased),
    purchasedAt: String(card.purchasedAt || '').trim(),
    masked,
  };
}

function publicCurrentShop(shop = null) {
  if (!shop || typeof shop !== 'object') return null;
  return {
    id: String(shop.id || '').trim(),
    teamId: String(shop.teamId || shop.captainId || '').trim(),
    captainId: String(shop.captainId || shop.teamId || '').trim(),
    round: Number(shop.round) || 1,
    generatedBy: String(shop.generatedBy || '').trim(),
    reason: String(shop.reason || '').trim(),
    refreshCostPaid: Number(shop.refreshCostPaid) || 0,
    selectedSlot: Number(shop.selectedSlot) || 0,
    pickedThisTurn: Boolean(shop.pickedThisTurn),
    cards: Array.isArray(shop.cards) ? shop.cards.map(publicShopCard) : [],
  };
}

function publicLastPurchase(purchase = null) {
  if (!purchase || typeof purchase !== 'object') return null;
  const realPlayerId = String(purchase.playerId || '').trim();
  const displayPlayerId = String(purchase.displayPlayerId || '').trim();
  const masked = Boolean(displayPlayerId && realPlayerId && displayPlayerId !== realPlayerId);
  const visiblePlayerId = masked ? displayPlayerId : realPlayerId;
  return {
    teamId: String(purchase.teamId || '').trim(),
    slotId: String(purchase.slotId || '').trim(),
    playerId: visiblePlayerId,
    displayPlayerId: displayPlayerId || visiblePlayerId,
    round: Number(purchase.round) || 1,
    resolvedAt: String(purchase.resolvedAt || '').trim(),
    pricePaid: Math.max(0, Number(purchase.pricePaid) || 0),
    goldAfter: Math.max(0, Number(purchase.goldAfter) || 0),
    hungryWave: publicHungryWaveSummary(purchase.hungryWave),
    masked,
  };
}

function publicHungryWaveSummary(summary = null) {
  if (!summary || typeof summary !== 'object') return null;
  return {
    type: String(summary.type || '').trim().slice(0, 40),
    sourceTeamId: String(summary.sourceTeamId || '').trim().slice(0, 80),
    buyerTeamId: String(summary.buyerTeamId || '').trim().slice(0, 80),
    playerId: String(summary.playerId || '').trim().slice(0, 80),
    round: Number(summary.round) || 1,
    priceRefunded: Math.max(0, Number(summary.priceRefunded) || 0),
    pendingRoundReward: Boolean(summary.pendingRoundReward),
    resolvedAt: String(summary.resolvedAt || '').trim().slice(0, 40),
  };
}

function publicRoundStates(roundStates = {}) {
  if (!roundStates || typeof roundStates !== 'object') return {};
  return Object.fromEntries(Object.entries(roundStates).map(([teamId, rounds]) => [
    String(teamId || '').trim(),
    Object.fromEntries(Object.entries(rounds || {}).map(([round, state]) => [
      String(round || '').trim(),
      {
        freeShopUsed: Boolean(state && state.freeShopUsed),
        refreshCount: Number(state && state.refreshCount) || 0,
        purchaseUsed: Boolean(state && state.purchaseUsed),
        skipped: Boolean(state && state.skipped),
        photographerRefreshUsed: Boolean(state && state.photographerRefreshUsed),
      },
    ])),
  ]).filter(([teamId]) => teamId));
}

function publicHexcoreWindows(windows = []) {
  if (!Array.isArray(windows)) return [];
  return windows.map(window => ({
    windowId: String(window.windowId || window.id || '').trim(),
    teamId: String(window.teamId || window.captainId || '').trim(),
    hexcoreId: String(window.hexcoreId || '').trim(),
    round: Number(window.round) || 1,
    active: window.active !== false,
    sourceTeamId: String(window.sourceTeamId || '').trim(),
    slotId: String(window.slotId || '').trim(),
    expiresAt: Number(window.expiresAt) || 0,
  })).filter(window => window.teamId && window.hexcoreId);
}

function publicRefereeRuling(ruling = null) {
  if (!ruling || typeof ruling !== 'object') return null;
  return {
    eventSeq: Number(ruling.eventSeq) || 0,
    reason: String(ruling.reason || '').trim().slice(0, 160),
    patchSummary: String(ruling.patchSummary || '').trim().slice(0, 240),
    createdAt: String(ruling.createdAt || '').trim().slice(0, 40),
  };
}

function publicRollback(rollback = null) {
  if (!rollback || typeof rollback !== 'object') return null;
  return {
    eventSeq: Number(rollback.eventSeq) || 0,
    targetStateVersion: Number(rollback.targetStateVersion) || 0,
    restoredStateVersion: Number(rollback.restoredStateVersion) || 0,
    reason: String(rollback.reason || '').trim().slice(0, 160),
    createdAt: String(rollback.createdAt || '').trim().slice(0, 40),
  };
}

function publicRoundIncome(income = null) {
  if (!income || typeof income !== 'object') return null;
  return {
    round: Math.max(1, Number(income.round) || 1),
    income: Math.max(0, Number(income.income) || 0),
  };
}

function publicTournament(tournament = null, view = VIEW_TYPES.PUBLIC, options = {}) {
  if (view !== VIEW_TYPES.CAPTAIN || !options.teamId || !tournament || typeof tournament !== 'object') return undefined;
  const teamId = String(options.teamId || '').trim();
  const rounds = Array.isArray(tournament.rounds) ? tournament.rounds.map(round => {
    const matches = Array.isArray(round.matches)
      ? round.matches
        .filter(match => tournamentMatchTouchesTeam(match, teamId))
        .map(publicTournamentMatch)
      : [];
    if (!matches.length) return null;
    return {
      id: String(round.id || '').trim().slice(0, 80),
      name: String(round.name || '').trim().slice(0, 40),
      index: Number(round.index) || 0,
      pairingMode: String(round.pairingMode || tournament.pairingMode || '').trim().slice(0, 40),
      matches,
    };
  }).filter(Boolean) : [];
  return {
    type: String(tournament.type || '').trim().slice(0, 40),
    status: String(tournament.status || (rounds.length ? 'running' : 'empty')).trim().slice(0, 40),
    pairingMode: String(tournament.pairingMode || '').trim().slice(0, 40),
    championId: tournament.championId === teamId ? teamId : '',
    rounds,
  };
}

function tournamentMatchTouchesTeam(match = {}, teamId = '') {
  if (!teamId || !match || typeof match !== 'object') return false;
  return [match.teamAId, match.teamBId, match.winnerId].some(value => String(value || '').trim() === teamId);
}

function publicTournamentMatch(match = {}) {
  return {
    id: String(match.id || '').trim().slice(0, 80),
    status: String(match.status || 'pending').trim().slice(0, 40),
    teamAId: String(match.teamAId || '').trim().slice(0, 80),
    teamBId: String(match.teamBId || '').trim().slice(0, 80),
    scoreA: publicScore(match.scoreA),
    scoreB: publicScore(match.scoreB),
    winnerId: String(match.winnerId || '').trim().slice(0, 80),
    byeConfirmed: Boolean(match.byeConfirmed),
    pairingMode: String(match.pairingMode || '').trim().slice(0, 40),
    expectedCampA: String(match.expectedCampA || '').trim().slice(0, 40),
    expectedCampB: String(match.expectedCampB || '').trim().slice(0, 40),
  };
}

function publicScore(value) {
  if (value === '' || value === null || typeof value === 'undefined') return '';
  const score = Number(value);
  if (!Number.isFinite(score) || score < 0) return '';
  return Math.round(score);
}

function resolvePerspectiveTeamId(snapshot = {}, requestedTeamId = '') {
  const currentTeamId = String(snapshot.currentTeamId || '').trim();
  const teamId = String(requestedTeamId || '').trim();
  return teamId || currentTeamId;
}

function projectSnapshotData(snapshot = {}, view = VIEW_TYPES.PUBLIC, options = {}) {
  const publicSnapshot = pickFields(snapshot, SNAPSHOT_PUBLIC_FIELDS);
  return {
    ...publicSnapshot,
    teams: publicTeams(snapshot),
    currentShop: publicCurrentShop(snapshot.currentShop),
    lastPurchase: publicLastPurchase(snapshot.lastPurchase),
    lastHungryWave: publicHungryWaveSummary(snapshot.lastHungryWave),
    lastRefereeRuling: publicRefereeRuling(snapshot.lastRefereeRuling),
    lastRollback: publicRollback(snapshot.lastRollback),
    lastRoundIncome: publicRoundIncome(snapshot.lastRoundIncome),
    tournament: publicTournament(snapshot.tournament, view, options),
    roundStates: publicRoundStates(snapshot.roundStates),
    hexcoreActionWindows: publicHexcoreWindows(snapshot.hexcoreActionWindows),
    perspectiveTeamId: resolvePerspectiveTeamId(snapshot, options.teamId),
  };
}

function projectedRoundStateForCommand(payload = {}) {
  const teamId = String(payload.teamId || '').trim();
  if (!teamId) return null;
  const round = String(Number(payload.round) || 1);
  const commandType = payload.commandType;
  if (commandType === COMMAND_TYPES.OPEN_SHOP) {
    return publicRoundStates({ [teamId]: { [round]: { freeShopUsed: true, refreshCount: 0, purchaseUsed: false, skipped: false } } });
  }
  if (commandType === COMMAND_TYPES.REFRESH_SHOP) {
    return publicRoundStates({ [teamId]: { [round]: { freeShopUsed: true, refreshCount: Number(payload.refreshCount) || 1, purchaseUsed: false, skipped: false } } });
  }
  if (commandType === COMMAND_TYPES.PURCHASE_SHOP_CARD) {
    return publicRoundStates({ [teamId]: { [round]: { freeShopUsed: true, purchaseUsed: true, skipped: false } } });
  }
  if (commandType === COMMAND_TYPES.SKIP_TURN) {
    return publicRoundStates({ [teamId]: { [round]: { freeShopUsed: true, purchaseUsed: false, skipped: true } } });
  }
  return null;
}

function canProjectCommandPayload(payload = {}) {
  return payload._serverGeneratedProjection === true
    || [ROLES.SUPER_ADMIN, ROLES.TOURNAMENT_ADMIN, ROLES.REFEREE].includes(payload.commandRole);
}

function projectEventPayload(payload = {}) {
  const publicPayload = pickFields(payload || {}, EVENT_PUBLIC_PAYLOAD_FIELDS);
  const trustedProjection = canProjectCommandPayload(payload);
  if (trustedProjection && (payload.currentShop || payload.shop)) {
    publicPayload.currentShop = publicCurrentShop(payload.currentShop || payload.shop);
  } else if (payload.commandType === COMMAND_TYPES.OPEN_SHOP || payload.commandType === COMMAND_TYPES.REFRESH_SHOP) {
    publicPayload.currentShop = publicCurrentShop({
      teamId: payload.teamId,
      round: payload.round || 1,
      generatedBy: payload.commandType === COMMAND_TYPES.OPEN_SHOP ? 'free_shop' : 'refresh_shop',
      reason: payload.commandType === COMMAND_TYPES.OPEN_SHOP ? '服务端确认开店' : '服务端确认刷新',
      cards: [],
    });
  } else if (payload.commandType === COMMAND_TYPES.SKIP_TURN) {
    publicPayload.currentShop = null;
  }
  if (payload.roundState) {
    publicPayload.roundState = publicRoundStates({ [payload.teamId || 'team']: { [payload.round || 1]: payload.roundState } });
  } else {
    const projectedRoundState = projectedRoundStateForCommand(payload);
    if (projectedRoundState) publicPayload.roundState = projectedRoundState;
  }
  if (trustedProjection && Array.isArray(payload.hexcoreActionWindows)) publicPayload.hexcoreActionWindows = publicHexcoreWindows(payload.hexcoreActionWindows);
  return publicPayload;
}

function projectEvent(event, view = VIEW_TYPES.PUBLIC) {
  if (!event) return null;
  return {
    eventSeq: event.eventSeq,
    tournamentId: event.tournamentId,
    type: event.type,
    stateVersion: event.stateVersion,
    createdAt: event.createdAt,
    payload: projectEventPayload(event.payload || {}),
    view,
  };
}

function createReadOnlyProjection(state, viewInput = VIEW_TYPES.PUBLIC, options = {}) {
  const view = normalizeProjectionView(viewInput);
  const perspectiveTeamId = resolvePerspectiveTeamId(state.snapshot || {}, options.teamId);
  return {
    view,
    role: view === VIEW_TYPES.CAPTAIN ? ROLES.CAPTAIN : ROLES.VIEWER,
    readonly: true,
    canSubmitCommands: false,
    perspective: {
      teamId: perspectiveTeamId,
      source: options.teamId ? 'session-team' : 'current-turn',
    },
    tournamentId: state.tournamentId,
    rulesVersion: state.rulesVersion,
    schemaVersion: state.schemaVersion,
    stateVersion: state.stateVersion,
    eventSeq: state.eventSeq,
    paused: state.paused,
    snapshot: projectSnapshotData(state.snapshot || {}, view, { teamId: perspectiveTeamId }),
    events: state.events.slice(-20).map(event => projectEvent(event, view)),
  };
}

module.exports = {
  VIEW_TYPES,
  createReadOnlyProjection,
  normalizeProjectionView,
  projectEvent,
  projectSnapshotData,
  publicCurrentShop,
  publicLastPurchase,
};
