const {
  EVENT_TYPES,
  ROLES,
  RULES_VERSION,
  STATE_SCHEMA_VERSION,
  createEventEnvelope,
  validateCommand,
} = require('../shared');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createAuthorityState(input = {}) {
  const tournamentId = String(input.tournamentId || 'tournament-local-dev').trim();
  if (!tournamentId) throw new Error('tournamentId 不能为空');
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    rulesVersion: input.rulesVersion || RULES_VERSION,
    tournamentId,
    stateVersion: 0,
    eventSeq: 0,
    paused: false,
    processedCommands: {},
    events: [],
    snapshot: input.snapshot ? clone(input.snapshot) : {},
  };
}

function normalizeRoleBinding(binding = {}) {
  return {
    actorId: String(binding.actorId || '').trim(),
    role: String(binding.role || '').trim(),
    teamId: String(binding.teamId || '').trim(),
  };
}

function assertAuthorityState(state) {
  if (!state || typeof state !== 'object') throw new Error('authority state 必须是对象');
  if (state.schemaVersion !== STATE_SCHEMA_VERSION) {
    throw new Error(`状态 schema 版本不匹配：${state.schemaVersion}`);
  }
  if (state.rulesVersion !== RULES_VERSION) {
    throw new Error(`规则版本不匹配：${state.rulesVersion}`);
  }
  if (!Number.isInteger(state.stateVersion) || state.stateVersion < 0) {
    throw new Error('stateVersion 必须是非负整数');
  }
  if (!state.tournamentId) throw new Error('authority state 缺少 tournamentId');
  return true;
}

function assertCommandTargetsOwnTeam(command, binding) {
  if (binding.role !== ROLES.CAPTAIN) return true;
  const commandTeamId = command.teamId || (command.payload && command.payload.teamId) || '';
  if (!commandTeamId) return true;
  if (binding.teamId !== commandTeamId) {
    throw new Error('队长只能操作自己的队伍');
  }
  return true;
}

function preflightCommand(state, command, roleBinding) {
  assertAuthorityState(state);
  validateCommand(command);
  const binding = normalizeRoleBinding(roleBinding);
  if (binding.actorId && binding.actorId !== command.actorId) {
    throw new Error('角色绑定与 command.actorId 不一致');
  }
  if (binding.role && binding.role !== command.role) {
    throw new Error('角色绑定与 command.role 不一致');
  }
  assertCommandTargetsOwnTeam(command, binding);
  if (state.paused && command.role === ROLES.CAPTAIN) {
    throw new Error('赛事已暂停，队长端暂不可操作');
  }
  if (state.processedCommands[command.commandId]) {
    return {
      ok: true,
      duplicate: true,
      event: clone(state.processedCommands[command.commandId]),
    };
  }
  if (command.baseVersion !== state.stateVersion) {
    throw new Error(`状态版本过期：客户端 ${command.baseVersion}，服务端 ${state.stateVersion}`);
  }
  return { ok: true, duplicate: false };
}

function appendEvent(state, eventInput) {
  assertAuthorityState(state);
  const next = clone(state);
  const event = createEventEnvelope({
    ...eventInput,
    eventSeq: next.eventSeq + 1,
    stateVersion: next.stateVersion + 1,
    tournamentId: next.tournamentId,
  });
  next.eventSeq = event.eventSeq;
  next.stateVersion = event.stateVersion;
  next.events.push(event);
  if (event.sourceCommandId) {
    next.processedCommands[event.sourceCommandId] = event;
  }
  if (event.type === EVENT_TYPES.TOURNAMENT_PAUSED) next.paused = true;
  if (event.type === EVENT_TYPES.TOURNAMENT_RESUMED) next.paused = false;
  return next;
}

function acceptCommandAsEvent(state, command, roleBinding, eventType, payload = {}) {
  if (!roleBinding || typeof roleBinding !== 'object') {
    throw new Error('acceptCommandAsEvent 必须传入服务端角色绑定，不能信任客户端自报角色');
  }
  const preflight = preflightCommand(state, command, roleBinding);
  if (preflight.duplicate) return { state, event: preflight.event, duplicate: true };
  const next = appendEvent(state, {
    type: eventType,
    actorId: command.actorId,
    sourceCommandId: command.commandId,
    payload: {
      commandType: command.type,
      ...payload,
    },
  });
  return {
    state: next,
    event: next.events[next.events.length - 1],
    duplicate: false,
  };
}

module.exports = {
  acceptCommandAsEvent,
  appendEvent,
  assertAuthorityState,
  createAuthorityState,
  normalizeRoleBinding,
  preflightCommand,
};
