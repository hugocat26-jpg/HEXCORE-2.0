const RULES_VERSION = 'hexcore-2.0-gold-shop-v1';
const STATE_SCHEMA_VERSION = 1;

const ROLES = Object.freeze({
  SUPER_ADMIN: 'super_admin',
  TOURNAMENT_ADMIN: 'tournament_admin',
  REFEREE: 'referee',
  SUPERVISOR: 'supervisor',
  CAPTAIN: 'captain',
  VIEWER: 'viewer',
  DISPLAY: 'display',
});

const COMMAND_TYPES = Object.freeze({
  CREATE_TOURNAMENT: 'CreateTournament',
  IMPORT_STATE: 'ImportState',
  START_HEXCORE_DRAW: 'StartHexcoreDraw',
  REFRESH_HEXCORE_CANDIDATE: 'RefreshHexcoreCandidate',
  PICK_HEXCORE: 'PickHexcore',
  OPEN_SHOP: 'OpenShop',
  REFRESH_SHOP: 'RefreshShop',
  PURCHASE_SHOP_CARD: 'PurchaseShopCard',
  USE_HEXCORE: 'UseHexcore',
  SKIP_TURN: 'SkipTurn',
  PAUSE_TOURNAMENT: 'PauseTournament',
  RESUME_TOURNAMENT: 'ResumeTournament',
  FORCE_REFEREE_RULING: 'ForceRefereeRuling',
  RECORD_MATCH_SCORE: 'RecordMatchScore',
});

const EVENT_TYPES = Object.freeze({
  TOURNAMENT_CREATED: 'TournamentCreated',
  STATE_IMPORTED: 'StateImported',
  HEXCORE_CANDIDATES_CREATED: 'HexcoreCandidatesCreated',
  HEXCORE_CANDIDATE_REFRESHED: 'HexcoreCandidateRefreshed',
  HEXCORE_PICKED: 'HexcorePicked',
  SHOP_OPENED: 'ShopOpened',
  SHOP_REFRESHED: 'ShopRefreshed',
  SHOP_CARD_PURCHASED: 'ShopCardPurchased',
  HEXCORE_USED: 'HexcoreUsed',
  TURN_SKIPPED: 'TurnSkipped',
  TOURNAMENT_PAUSED: 'TournamentPaused',
  TOURNAMENT_RESUMED: 'TournamentResumed',
  REFEREE_RULING_FORCED: 'RefereeRulingForced',
  MATCH_SCORE_RECORDED: 'MatchScoreRecorded',
});

const ROLE_COMMANDS = Object.freeze({
  [ROLES.SUPER_ADMIN]: Object.values(COMMAND_TYPES),
  [ROLES.TOURNAMENT_ADMIN]: [
    COMMAND_TYPES.CREATE_TOURNAMENT,
    COMMAND_TYPES.IMPORT_STATE,
    COMMAND_TYPES.PAUSE_TOURNAMENT,
    COMMAND_TYPES.RESUME_TOURNAMENT,
  ],
  [ROLES.REFEREE]: [
    COMMAND_TYPES.IMPORT_STATE,
    COMMAND_TYPES.START_HEXCORE_DRAW,
    COMMAND_TYPES.REFRESH_HEXCORE_CANDIDATE,
    COMMAND_TYPES.PICK_HEXCORE,
    COMMAND_TYPES.OPEN_SHOP,
    COMMAND_TYPES.REFRESH_SHOP,
    COMMAND_TYPES.PURCHASE_SHOP_CARD,
    COMMAND_TYPES.USE_HEXCORE,
    COMMAND_TYPES.SKIP_TURN,
    COMMAND_TYPES.PAUSE_TOURNAMENT,
    COMMAND_TYPES.RESUME_TOURNAMENT,
    COMMAND_TYPES.FORCE_REFEREE_RULING,
    COMMAND_TYPES.RECORD_MATCH_SCORE,
  ],
  [ROLES.SUPERVISOR]: [],
  [ROLES.CAPTAIN]: [
    COMMAND_TYPES.START_HEXCORE_DRAW,
    COMMAND_TYPES.REFRESH_HEXCORE_CANDIDATE,
    COMMAND_TYPES.PICK_HEXCORE,
    COMMAND_TYPES.REFRESH_SHOP,
    COMMAND_TYPES.PURCHASE_SHOP_CARD,
    COMMAND_TYPES.USE_HEXCORE,
    COMMAND_TYPES.SKIP_TURN,
  ],
  [ROLES.VIEWER]: [],
  [ROLES.DISPLAY]: [],
});

const REQUIRED_PAYLOAD_FIELDS = Object.freeze({
  [COMMAND_TYPES.CREATE_TOURNAMENT]: ['name', 'rulesVersion'],
  [COMMAND_TYPES.IMPORT_STATE]: ['checksum', 'sourceVersion'],
  [COMMAND_TYPES.START_HEXCORE_DRAW]: ['teamId'],
  [COMMAND_TYPES.REFRESH_HEXCORE_CANDIDATE]: ['teamId', 'candidateSlot'],
  [COMMAND_TYPES.PICK_HEXCORE]: ['teamId', 'hexcoreId'],
  [COMMAND_TYPES.OPEN_SHOP]: ['teamId'],
  [COMMAND_TYPES.REFRESH_SHOP]: ['teamId'],
  [COMMAND_TYPES.PURCHASE_SHOP_CARD]: ['teamId', 'slotId'],
  [COMMAND_TYPES.USE_HEXCORE]: ['teamId', 'hexcoreId'],
  [COMMAND_TYPES.SKIP_TURN]: ['teamId'],
  [COMMAND_TYPES.PAUSE_TOURNAMENT]: ['reason'],
  [COMMAND_TYPES.RESUME_TOURNAMENT]: ['reason'],
  [COMMAND_TYPES.FORCE_REFEREE_RULING]: ['reason', 'patchSummary'],
  [COMMAND_TYPES.RECORD_MATCH_SCORE]: ['matchId', 'scoreA', 'scoreB'],
});

function valuesOf(map) {
  return Object.keys(map).map(key => map[key]);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function safeText(value, fallback = '', maxLength = 120) {
  return String(value ?? fallback).trim().slice(0, maxLength);
}

function safeId(value, fieldName) {
  const text = safeText(value, '', 80);
  if (!/^[A-Za-z0-9._:-]{1,80}$/.test(text)) {
    throw new Error(`${fieldName} 必须是 1-80 位安全标识`);
  }
  return text;
}

function normalizeBaseVersion(value) {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 0) {
    throw new Error('baseVersion 必须是非负整数');
  }
  return version;
}

function canRoleExecute(role, commandType) {
  const allowed = ROLE_COMMANDS[role] || [];
  return allowed.includes(commandType);
}

function validatePayloadFields(commandType, payload) {
  const required = REQUIRED_PAYLOAD_FIELDS[commandType] || [];
  const missing = required.filter(field => !hasOwn(payload, field) || payload[field] === '');
  if (missing.length) {
    throw new Error(`${commandType} 缺少 payload 字段：${missing.join(', ')}`);
  }
  return true;
}

function createCommand(input) {
  const command = {
    commandId: safeId(input && input.commandId, 'commandId'),
    tournamentId: safeId(input && input.tournamentId, 'tournamentId'),
    type: safeText(input && input.type, '', 80),
    actorId: safeId(input && input.actorId, 'actorId'),
    role: safeText(input && input.role, '', 40),
    teamId: input && input.teamId ? safeId(input.teamId, 'teamId') : '',
    baseVersion: normalizeBaseVersion(input && input.baseVersion),
    payload: input && input.payload && typeof input.payload === 'object' ? { ...input.payload } : {},
    createdAt: safeText(input && input.createdAt, new Date().toISOString(), 40),
  };
  validateCommand(command);
  return command;
}

function validateCommand(command) {
  if (!command || typeof command !== 'object') throw new Error('command 必须是对象');
  if (!valuesOf(COMMAND_TYPES).includes(command.type)) throw new Error(`未知 command 类型：${command.type}`);
  if (!valuesOf(ROLES).includes(command.role)) throw new Error(`未知角色：${command.role}`);
  if (!canRoleExecute(command.role, command.type)) {
    throw new Error(`${command.role} 无权执行 ${command.type}`);
  }
  validatePayloadFields(command.type, command.payload || {});
  return true;
}

function createEventEnvelope(input) {
  const event = {
    eventSeq: normalizeBaseVersion(input && input.eventSeq),
    tournamentId: safeId(input && input.tournamentId, 'tournamentId'),
    type: safeText(input && input.type, '', 80),
    actorId: safeId(input && input.actorId, 'actorId'),
    sourceCommandId: input && input.sourceCommandId ? safeId(input.sourceCommandId, 'sourceCommandId') : '',
    stateVersion: normalizeBaseVersion(input && input.stateVersion),
    payload: input && input.payload && typeof input.payload === 'object' ? { ...input.payload } : {},
    createdAt: safeText(input && input.createdAt, new Date().toISOString(), 40),
  };
  validateEventEnvelope(event);
  return event;
}

function validateEventEnvelope(event) {
  if (!event || typeof event !== 'object') throw new Error('event 必须是对象');
  if (!valuesOf(EVENT_TYPES).includes(event.type)) throw new Error(`未知 event 类型：${event.type}`);
  return true;
}

module.exports = {
  COMMAND_TYPES,
  EVENT_TYPES,
  REQUIRED_PAYLOAD_FIELDS,
  ROLE_COMMANDS,
  ROLES,
  RULES_VERSION,
  STATE_SCHEMA_VERSION,
  canRoleExecute,
  createCommand,
  createEventEnvelope,
  safeId,
  validateCommand,
  validateEventEnvelope,
};
