const { ROLES } = require('../../packages/shared');

const SNAPSHOT_PUBLIC_FIELDS = [
  'name',
  'createdAt',
  'mode',
  'status',
  'currentRound',
  'currentPhase',
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
  DISPLAY: 'display',
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
  if (normalized === ROLES.DISPLAY || normalized === VIEW_TYPES.DISPLAY) return VIEW_TYPES.DISPLAY;
  if (normalized === VIEW_TYPES.PUBLIC) return VIEW_TYPES.PUBLIC;
  throw new Error('未知只读投影视图');
}

function projectSnapshotData(snapshot = {}, view = VIEW_TYPES.PUBLIC) {
  const publicSnapshot = pickFields(snapshot, SNAPSHOT_PUBLIC_FIELDS);
  if (view === VIEW_TYPES.DISPLAY) {
    return {
      ...publicSnapshot,
      displayTitle: snapshot.displayTitle || snapshot.championTeamName || snapshot.name || 'HEXCORE 2.0',
    };
  }
  return publicSnapshot;
}

function projectEvent(event, view = VIEW_TYPES.PUBLIC) {
  if (!event) return null;
  return {
    eventSeq: event.eventSeq,
    tournamentId: event.tournamentId,
    type: event.type,
    stateVersion: event.stateVersion,
    createdAt: event.createdAt,
    payload: pickFields(event.payload || {}, EVENT_PUBLIC_PAYLOAD_FIELDS),
    view,
  };
}

function createReadOnlyProjection(state, viewInput = VIEW_TYPES.PUBLIC) {
  const view = normalizeProjectionView(viewInput);
  return {
    view,
    tournamentId: state.tournamentId,
    rulesVersion: state.rulesVersion,
    schemaVersion: state.schemaVersion,
    stateVersion: state.stateVersion,
    eventSeq: state.eventSeq,
    paused: state.paused,
    snapshot: projectSnapshotData(state.snapshot || {}, view),
    events: state.events.slice(-20).map(event => projectEvent(event, view)),
  };
}

module.exports = {
  VIEW_TYPES,
  createReadOnlyProjection,
  normalizeProjectionView,
  projectEvent,
  projectSnapshotData,
};
