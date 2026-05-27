const {
  COMMAND_TYPES,
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

function safeText(value, fallback = '', maxLength = 120) {
  return String(value ?? fallback).trim().slice(0, maxLength);
}

function safePositiveNumber(value, fallback = 0, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(max, Math.round(number)));
}

function safeBoolean(value) {
  return Boolean(value);
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

function commandTeamId(command) {
  return command.teamId || (command.payload && command.payload.teamId) || '';
}

function isCaptainTurnCommandAllowed(state, command, binding) {
  if (binding.role !== ROLES.CAPTAIN) return true;
  if (command.type === COMMAND_TYPES.RENAME_TEAM) return true;
  const teamId = commandTeamId(command);
  if (!teamId) return true;
  const currentTeamId = String((state.snapshot && state.snapshot.currentTeamId) || '').trim();
  if (currentTeamId && currentTeamId === teamId) return true;
  if (command.type === COMMAND_TYPES.USE_HEXCORE) {
    const hexcoreId = String((command.payload && command.payload.hexcoreId) || '').trim();
    const windows = Array.isArray(state.snapshot && state.snapshot.hexcoreActionWindows)
      ? state.snapshot.hexcoreActionWindows
      : [];
    return windows.some(window => {
      return window
        && window.active !== false
        && String(window.teamId || '').trim() === teamId
        && String(window.hexcoreId || '').trim() === hexcoreId;
    });
  }
  return false;
}

function assertCaptainTurnWindow(state, command, binding) {
  if (isCaptainTurnCommandAllowed(state, command, binding)) return true;
  throw new Error('队长非自己回合不可进行普通操作');
}

function assertRenameAvailable(state, command, binding) {
  if (binding.role !== ROLES.CAPTAIN || command.type !== COMMAND_TYPES.RENAME_TEAM) return true;
  const teamId = commandTeamId(command);
  const teams = Array.isArray(state.snapshot && state.snapshot.teams) ? state.snapshot.teams : [];
  const team = teams.find(item => String(item.teamId || item.id || '').trim() === teamId);
  if (team && team.renameUsed) throw new Error('队长仅拥有一次主动改名权');
  return true;
}

function normalizeShopCard(card = {}, index = 0) {
  return {
    slotId: safeText(card.slotId, `slot_${index + 1}`, 64),
    playerId: safeText(card.playerId, '', 80),
    displayPlayerId: safeText(card.displayPlayerId, '', 80),
    tier: safePositiveNumber(card.tier, 1, 5),
    price: safePositiveNumber(card.price, card.tier || 1, 99),
    camp: safeText(card.camp, '', 40),
    purchased: safeBoolean(card.purchased),
    purchasedAt: safeText(card.purchasedAt, '', 40),
    snowCatShuffled: safeBoolean(card.snowCatShuffled),
  };
}

function normalizeCurrentShop(input = {}, fallback = {}) {
  const cards = Array.isArray(input.cards) ? input.cards.map(normalizeShopCard) : [];
  return {
    id: safeText(input.id, `shop_${Date.now()}`, 80),
    teamId: safeText(input.teamId || input.captainId || fallback.teamId, '', 80),
    captainId: safeText(input.captainId || input.teamId || fallback.teamId, '', 80),
    round: safePositiveNumber(input.round || fallback.round, 1, 8),
    generatedBy: safeText(input.generatedBy, fallback.generatedBy || 'room_command', 40),
    reason: safeText(input.reason || fallback.reason, '', 160),
    refreshCostPaid: safePositiveNumber(input.refreshCostPaid, 0, 99),
    selectedSlot: safePositiveNumber(input.selectedSlot, 0, 12),
    pickedThisTurn: safeBoolean(input.pickedThisTurn),
    cards,
  };
}

function normalizeRoundState(input = {}) {
  return {
    freeShopUsed: safeBoolean(input.freeShopUsed),
    refreshCount: safePositiveNumber(input.refreshCount, 0, 99),
    purchaseUsed: safeBoolean(input.purchaseUsed),
    skipped: safeBoolean(input.skipped),
    photographerRefreshUsed: safeBoolean(input.photographerRefreshUsed),
  };
}

function setRoundState(snapshot, teamId, round, patch = {}) {
  const cleanTeamId = safeText(teamId, '', 80);
  if (!cleanTeamId) return snapshot;
  const roundKey = String(safePositiveNumber(round || snapshot.currentRound, 1, 8));
  snapshot.roundStates = snapshot.roundStates && typeof snapshot.roundStates === 'object' ? snapshot.roundStates : {};
  const teamStates = snapshot.roundStates[cleanTeamId] && typeof snapshot.roundStates[cleanTeamId] === 'object'
    ? snapshot.roundStates[cleanTeamId]
    : {};
  teamStates[roundKey] = normalizeRoundState({
    ...(teamStates[roundKey] || {}),
    ...patch,
  });
  snapshot.roundStates[cleanTeamId] = teamStates;
  return snapshot;
}

function normalizeHexcoreActionWindow(input = {}) {
  return {
    windowId: safeText(input.windowId || input.id, '', 80),
    teamId: safeText(input.teamId || input.captainId, '', 80),
    hexcoreId: safeText(input.hexcoreId, '', 80),
    round: safePositiveNumber(input.round, 1, 8),
    active: input.active === false ? false : true,
    sourceTeamId: safeText(input.sourceTeamId, '', 80),
    slotId: safeText(input.slotId, '', 64),
    expiresAt: safePositiveNumber(input.expiresAt, 0),
  };
}

function applyHexcoreWindows(snapshot, windows) {
  if (!Array.isArray(windows)) return snapshot;
  snapshot.hexcoreActionWindows = windows.map(normalizeHexcoreActionWindow)
    .filter(window => window.teamId && window.hexcoreId);
  return snapshot;
}

function canApplyClientProjection(payload = {}) {
  return [ROLES.SUPER_ADMIN, ROLES.TOURNAMENT_ADMIN, ROLES.REFEREE].includes(payload.commandRole);
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
  assertCaptainTurnWindow(state, command, binding);
  assertRenameAvailable(state, command, binding);
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

function applyEventToSnapshot(snapshot, event) {
  const next = clone(snapshot || {});
  const payload = event.payload || {};
  if (event.type === EVENT_TYPES.TEAM_RENAMED) {
    const teamId = String((payload && payload.teamId) || '').trim();
    const name = String((payload && payload.name) || '').trim().slice(0, 12);
    next.teams = Array.isArray(next.teams) ? next.teams.map(team => {
      const currentId = String(team.teamId || team.id || '').trim();
      if (currentId !== teamId) return team;
      return { ...team, name, renameUsed: true };
    }) : [];
  }
  if (event.type === EVENT_TYPES.SHOP_OPENED || event.type === EVENT_TYPES.SHOP_REFRESHED) {
    const teamId = safeText(payload.teamId, '', 80);
    const round = safePositiveNumber(payload.round || next.currentRound, 1, 8);
    const trustedProjection = canApplyClientProjection(payload);
    next.currentTeamId = teamId || next.currentTeamId;
    next.currentRound = round;
    next.currentPhase = 'gold_shop';
    next.currentShop = normalizeCurrentShop(trustedProjection ? (payload.currentShop || payload.shop || {}) : {}, {
      teamId,
      round,
      generatedBy: event.type === EVENT_TYPES.SHOP_OPENED ? 'free_shop' : 'refresh_shop',
      reason: event.type === EVENT_TYPES.SHOP_OPENED ? '服务端确认开店' : '服务端确认刷新',
    });
    setRoundState(next, teamId, round, {
      freeShopUsed: true,
      purchaseUsed: false,
      skipped: false,
      refreshCount: event.type === EVENT_TYPES.SHOP_REFRESHED ? safePositiveNumber(payload.refreshCount, 1, 99) : 0,
    });
    if (trustedProjection) applyHexcoreWindows(next, payload.hexcoreActionWindows);
  }
  if (event.type === EVENT_TYPES.SHOP_CARD_PURCHASED) {
    const teamId = safeText(payload.teamId, '', 80);
    const round = safePositiveNumber(payload.round || next.currentRound, 1, 8);
    const slotId = safeText(payload.slotId, '', 64);
    if (next.currentShop && Array.isArray(next.currentShop.cards)) {
      next.currentShop.cards = next.currentShop.cards.map(card => {
        if (String(card.slotId || '') !== slotId && String(card.index ?? '') !== slotId) return card;
        return {
          ...card,
          purchased: true,
          purchasedAt: safeText(payload.purchasedAt, event.createdAt || new Date().toISOString(), 40),
        };
      });
      next.currentShop.pickedThisTurn = true;
    }
    next.lastPurchase = {
      teamId,
      slotId,
      playerId: safeText(payload.playerId, '', 80),
      displayPlayerId: safeText(payload.displayPlayerId, '', 80),
      round,
      resolvedAt: event.createdAt,
    };
    setRoundState(next, teamId, round, { freeShopUsed: true, purchaseUsed: true, skipped: false });
    if (canApplyClientProjection(payload)) applyHexcoreWindows(next, payload.hexcoreActionWindows);
  }
  if (event.type === EVENT_TYPES.TURN_SKIPPED) {
    const teamId = safeText(payload.teamId, '', 80);
    const round = safePositiveNumber(payload.round || next.currentRound, 1, 8);
    setRoundState(next, teamId, round, { freeShopUsed: true, purchaseUsed: false, skipped: true });
    next.currentShop = null;
    if (payload.nextTeamId) next.currentTeamId = safeText(payload.nextTeamId, '', 80);
    if (payload.nextRound) next.currentRound = safePositiveNumber(payload.nextRound, round, 8);
    if (canApplyClientProjection(payload)) applyHexcoreWindows(next, payload.hexcoreActionWindows);
  }
  if (event.type === EVENT_TYPES.HEXCORE_USED) {
    if (canApplyClientProjection(payload)) applyHexcoreWindows(next, payload.hexcoreActionWindows);
    if (!Array.isArray(payload.hexcoreActionWindows) && Array.isArray(next.hexcoreActionWindows)) {
      const teamId = safeText(payload.teamId, '', 80);
      const hexcoreId = safeText(payload.hexcoreId, '', 80);
      next.hexcoreActionWindows = next.hexcoreActionWindows.map(window => {
        if (window.teamId === teamId && window.hexcoreId === hexcoreId) return { ...window, active: false };
        return window;
      });
    }
  }
  return next;
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
  next.snapshot = applyEventToSnapshot(next.snapshot, event);
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
      commandRole: command.role,
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
