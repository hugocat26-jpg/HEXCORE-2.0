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
  return Array.isArray(snapshot.teams) ? snapshot.teams.map(team => ({
    teamId: team.teamId || team.id || '',
    name: team.name || '',
  })) : [];
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
  return [ROLES.SUPER_ADMIN, ROLES.TOURNAMENT_ADMIN, ROLES.REFEREE].includes(payload.commandRole);
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
};
