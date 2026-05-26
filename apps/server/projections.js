const { ROLES } = require('../../packages/shared');

const SNAPSHOT_PUBLIC_FIELDS = [
  'name',
  'createdAt',
  'mode',
  'status',
  'currentRound',
  'currentPhase',
  'currentTeamId',
  'currentTeamName',
  'teams',
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
    perspectiveTeamId: resolvePerspectiveTeamId(snapshot, options.teamId),
  };
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
};
