const crypto = require('crypto');
const {
  COMMAND_TYPES,
  EVENT_TYPES,
  HEXCORE_IDS,
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

function normalizeTurnTimerSettings(input = {}) {
  return {
    hexcorePrepareSeconds: safePositiveNumber(input.hexcorePrepareSeconds, 10, 300),
    hexcoreSeconds: safePositiveNumber(input.hexcoreSeconds, 0, 3600),
    shopPrepareSeconds: safePositiveNumber(input.shopPrepareSeconds, 10, 300),
    shopSeconds: safePositiveNumber(input.shopSeconds, 0, 3600),
  };
}

function turnTimerSettings(snapshot = {}) {
  const settings = snapshot.settings && typeof snapshot.settings === 'object' ? snapshot.settings : {};
  return normalizeTurnTimerSettings(settings.turnTimers || {});
}

function clearActiveTurnTimer(snapshot) {
  delete snapshot.activeTurnTimer;
  return snapshot;
}

function isPrepareTimerPhase(phase) {
  return ['hexcore_prepare', 'gold_shop_prepare'].includes(safeText(phase, '', 40));
}

function timerSecondsForPhase(settings, phase) {
  const cleanPhase = safeText(phase, '', 40);
  if (cleanPhase === 'hexcore_prepare') return settings.hexcorePrepareSeconds;
  if (cleanPhase === 'hexcore_draw') return settings.hexcoreSeconds;
  if (cleanPhase === 'gold_shop_prepare') return settings.shopPrepareSeconds;
  if (cleanPhase === 'gold_shop') return settings.shopSeconds;
  return 0;
}

function startActiveTurnTimer(snapshot, phase, teamId, createdAt) {
  const cleanPhase = safeText(phase, '', 40);
  const cleanTeamId = safeText(teamId, '', 80);
  if (!cleanPhase || !cleanTeamId) return clearActiveTurnTimer(snapshot);
  const settings = turnTimerSettings(snapshot);
  const seconds = timerSecondsForPhase(settings, cleanPhase);
  if (!seconds) return clearActiveTurnTimer(snapshot);
  const startedMs = Date.parse(createdAt || '') || Date.now();
  const durationMs = seconds * 1000;
  const deadlineMs = startedMs + durationMs;
  snapshot.activeTurnTimer = {
    timerId: `${cleanPhase}:${cleanTeamId}:${startedMs}`,
    phase: cleanPhase,
    teamId: cleanTeamId,
    round: safePositiveNumber(snapshot.currentRound, 1, 8),
    startedAt: new Date(startedMs).toISOString(),
    deadlineAt: new Date(deadlineMs).toISOString(),
    graceDeadlineAt: new Date(deadlineMs + 3000).toISOString(),
    durationMs,
  };
  return snapshot;
}

function startPrepareTimerOrOpenPhase(snapshot, preparePhase, readyPhase, teamId, createdAt) {
  const cleanTeamId = safeText(teamId, '', 80);
  if (!cleanTeamId) {
    snapshot.currentTeamId = '';
    snapshot.currentPhase = readyPhase;
    return clearActiveTurnTimer(snapshot);
  }
  snapshot.currentTeamId = cleanTeamId;
  const settings = turnTimerSettings(snapshot);
  if (timerSecondsForPhase(settings, preparePhase) > 0) {
    snapshot.currentPhase = preparePhase;
    return startActiveTurnTimer(snapshot, preparePhase, cleanTeamId, createdAt);
  }
  snapshot.currentPhase = readyPhase;
  return clearActiveTurnTimer(snapshot);
}

function normalizeTurnTimerPayload(payload = {}) {
  return normalizeTurnTimerSettings({
    hexcorePrepareSeconds: payload.hexcorePrepareSeconds,
    hexcoreSeconds: payload.hexcoreSeconds,
    shopPrepareSeconds: payload.shopPrepareSeconds,
    shopSeconds: payload.shopSeconds,
  });
}

function createAuthorityState(input = {}) {
  const tournamentId = String(input.tournamentId || 'tournament-local-dev').trim();
  if (!tournamentId) throw new Error('tournamentId 不能为空');
  const createdAt = safeText(input.createdAt, new Date().toISOString(), 40);
  const state = {
    schemaVersion: STATE_SCHEMA_VERSION,
    rulesVersion: input.rulesVersion || RULES_VERSION,
    tournamentId,
    stateVersion: 0,
    eventSeq: 0,
    paused: false,
    processedCommands: {},
    events: [],
    auditLog: [],
    snapshot: input.snapshot ? clone(input.snapshot) : {},
  };
  state.checkpoints = [checkpointFromState(state, {
    eventSeq: 0,
    type: 'InitialState',
    createdAt,
  })];
  return state;
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
  const snapshot = state.snapshot || {};
  const phase = safeText(snapshot.currentPhase, '', 40);
  const currentTeamId = String((state.snapshot && state.snapshot.currentTeamId) || '').trim();
  if (command.type === COMMAND_TYPES.USE_HEXCORE) {
    const hexcoreId = String((command.payload && command.payload.hexcoreId) || '').trim();
    const windows = Array.isArray(snapshot.hexcoreActionWindows)
      ? snapshot.hexcoreActionWindows
      : [];
    const hasActiveWindow = windows.some(window => {
      return window
        && window.active !== false
        && String(window.teamId || '').trim() === teamId
        && String(window.hexcoreId || '').trim() === hexcoreId;
    });
    if (hasActiveWindow) return true;
  }
  if (isPrepareTimerPhase(phase)) {
    throw new Error('准备倒计时未结束，队长暂不可进行普通操作');
  }
  if (currentTeamId && currentTeamId === teamId) return true;
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
    name: safeText(card.name || card.playerName, '', 40),
    gameId: safeText(card.gameId, '', 80),
    lane: safeText(card.lane, '', 40),
    score: safePositiveNumber(card.score, 0, 999),
    heroes: Array.isArray(card.heroes) ? card.heroes.map(hero => safeText(hero, '', 24)).filter(Boolean).slice(0, 3) : [],
    displayName: safeText(card.displayName, '', 40),
    displayGameId: safeText(card.displayGameId, '', 80),
    displayLane: safeText(card.displayLane, '', 40),
    displayScore: safePositiveNumber(card.displayScore, 0, 999),
    displayHeroes: Array.isArray(card.displayHeroes) ? card.displayHeroes.map(hero => safeText(hero, '', 24)).filter(Boolean).slice(0, 3) : [],
    tier: safePositiveNumber(card.tier, 1, 5),
    price: safePositiveNumber(card.price, card.tier || 1, 99),
    camp: safeText(card.camp, '', 40),
    purchased: safeBoolean(card.purchased),
    purchasedAt: safeText(card.purchasedAt, '', 40),
    snowCatShuffled: safeBoolean(card.snowCatShuffled),
    weatherFogged: safeBoolean(card.weatherFogged),
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
    hungryWaveFreeRefreshes: safePositiveNumber(input.hungryWaveFreeRefreshes, 0, 9),
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

function roundStateFor(snapshot, teamId, round) {
  const cleanTeamId = safeText(teamId, '', 80);
  const roundKey = String(safePositiveNumber(round || snapshot.currentRound, 1, 8));
  snapshot.roundStates = snapshot.roundStates && typeof snapshot.roundStates === 'object' ? snapshot.roundStates : {};
  snapshot.roundStates[cleanTeamId] = snapshot.roundStates[cleanTeamId] && typeof snapshot.roundStates[cleanTeamId] === 'object'
    ? snapshot.roundStates[cleanTeamId]
    : {};
  snapshot.roundStates[cleanTeamId][roundKey] = normalizeRoundState(snapshot.roundStates[cleanTeamId][roundKey] || {});
  return snapshot.roundStates[cleanTeamId][roundKey];
}

function teamIndex(snapshot = {}, teamId = '') {
  const cleanTeamId = safeText(teamId, '', 80);
  return Array.isArray(snapshot.teams)
    ? snapshot.teams.findIndex(team => safeText(team && (team.teamId || team.id), '', 80) === cleanTeamId)
    : -1;
}

function ensureTeamEconomy(snapshot, teamId) {
  const index = teamIndex(snapshot, teamId);
  if (index < 0) return null;
  const team = snapshot.teams[index];
  const source = team.economy && typeof team.economy === 'object' ? team.economy : {};
  const defaultGold = safePositiveNumber(snapshot.settings && snapshot.settings.initialGold, 6, 999);
  const economy = {
    gold: safePositiveNumber(source.gold, defaultGold, 999),
    roundState: source.roundState && typeof source.roundState === 'object' ? source.roundState : {},
  };
  snapshot.teams[index] = { ...team, economy };
  return snapshot.teams[index].economy;
}

function refreshCostFor(snapshot, teamId, round) {
  const state = roundStateFor(snapshot, teamId, round);
  if (safePositiveNumber(state.hungryWaveFreeRefreshes, 0, 9) > 0) return 0;
  const costs = snapshot.settings && Array.isArray(snapshot.settings.refreshCosts) && snapshot.settings.refreshCosts.length
    ? snapshot.settings.refreshCosts
    : [1, 2, 3, 4];
  return safePositiveNumber(costs[Math.min(safePositiveNumber(state.refreshCount, 0, 99), costs.length - 1)], 1, 99);
}

function deductTeamGold(snapshot, teamId, amount, reason) {
  const economy = ensureTeamEconomy(snapshot, teamId);
  if (!economy) throw new Error('未找到队伍经济状态');
  const cost = safePositiveNumber(amount, 0, 999);
  if (economy.gold < cost) throw new Error(`${reason || '操作'}金币不足，需要 ${cost} 金币`);
  economy.gold -= cost;
  return economy.gold;
}

function purchasedCardFromShop(snapshot, teamId, slotId) {
  const shop = snapshot.currentShop && typeof snapshot.currentShop === 'object' ? snapshot.currentShop : null;
  if (!shop || safeText(shop.teamId || shop.captainId, '', 80) !== safeText(teamId, '', 80)) return null;
  if (!Array.isArray(shop.cards)) return null;
  return shop.cards.find(card => {
    return safeText(card && (card.slotId || card.index), '', 64) === safeText(slotId, '', 64);
  }) || null;
}

function roundStateSnapshot(snapshot, teamId, round) {
  const cleanTeamId = safeText(teamId, '', 80);
  const roundKey = String(safePositiveNumber(round || snapshot.currentRound, 1, 8));
  const roundStates = snapshot.roundStates && typeof snapshot.roundStates === 'object' ? snapshot.roundStates : {};
  const teamStates = roundStates[cleanTeamId] && typeof roundStates[cleanTeamId] === 'object' ? roundStates[cleanTeamId] : {};
  return normalizeRoundState(teamStates[roundKey] || {});
}

function nextTurnPointer(snapshot, teamId) {
  const teams = Array.isArray(snapshot.teams) ? snapshot.teams : [];
  if (!teams.length) return { nextTeamId: '', nextRound: safePositiveNumber(snapshot.currentRound, 1, 8) };
  const currentIndex = Math.max(0, teamIndex(snapshot, teamId));
  const currentRound = safePositiveNumber(snapshot.currentRound, 1, 8);
  let nextIndex = (currentIndex + 1) % teams.length;
  let nextRound = nextIndex === 0 ? currentRound + 1 : currentRound;
  let nextTeam = teams[nextIndex] || {};
  for (let checked = 0; checked < teams.length * 2; checked += 1) {
    const nextTeamId = safeText(nextTeam.teamId || nextTeam.id, '', 80);
    if (nextTeamId && !roundStateSnapshot(snapshot, nextTeamId, nextRound).skipped) break;
    nextIndex = (nextIndex + 1) % teams.length;
    if (nextIndex === 0) nextRound += 1;
    nextTeam = teams[nextIndex] || {};
    if (nextRound > 8) break;
  }
  return {
    nextTeamId: safeText(nextTeam.teamId || nextTeam.id, '', 80),
    nextRound: Math.min(8, nextRound),
  };
}

function normalizeHungryWaveRound(input = {}) {
  if (!input || typeof input !== 'object') return null;
  const captainId = safeText(input.captainId || input.teamId, '', 80);
  const round = safePositiveNumber(input.round, 1, 8);
  if (!captainId || !round) return null;
  return {
    type: 'hungry_wave_round',
    captainId,
    round,
    active: input.active === false ? false : true,
    consumed: safeBoolean(input.consumed),
    triggered: safeBoolean(input.triggered),
    pendingRoundReward: safeBoolean(input.pendingRoundReward),
    roundRewardResolved: safeBoolean(input.roundRewardResolved),
    roundRewardPlayerId: safeText(input.roundRewardPlayerId, '', 80),
    roundRewardFailedReason: safeText(input.roundRewardFailedReason, '', 80),
    checkedTeamIds: Array.isArray(input.checkedTeamIds)
      ? input.checkedTeamIds.map(teamId => safeText(teamId, '', 80)).filter(Boolean).slice(0, 20)
      : [],
    resolvedAt: safeText(input.resolvedAt, '', 40),
  };
}

function applyRoundIncome(snapshot, round) {
  const incomeRound = safePositiveNumber(round, 1, 8);
  if (incomeRound <= 1) return snapshot;
  snapshot.roundIncomeApplied = snapshot.roundIncomeApplied && typeof snapshot.roundIncomeApplied === 'object'
    ? snapshot.roundIncomeApplied
    : {};
  const roundKey = String(incomeRound);
  if (snapshot.roundIncomeApplied[roundKey]) return snapshot;
  const income = safePositiveNumber(snapshot.settings && snapshot.settings.roundIncome, 3, 99);
  if (Array.isArray(snapshot.teams)) {
    snapshot.teams = snapshot.teams.map(team => {
      const teamId = safeText(team && (team.teamId || team.id), '', 80);
      if (!teamId) return team;
      const source = team.economy && typeof team.economy === 'object' ? team.economy : {};
      const defaultGold = safePositiveNumber(snapshot.settings && snapshot.settings.initialGold, 6, 999);
      return {
        ...team,
        economy: {
          ...source,
          gold: safePositiveNumber(source.gold, defaultGold, 999) + income,
          roundState: source.roundState && typeof source.roundState === 'object' ? source.roundState : {},
        },
      };
    });
  }
  snapshot.roundIncomeApplied[roundKey] = true;
  snapshot.lastRoundIncome = {
    round: incomeRound,
    income,
  };
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
    playerId: safeText(input.playerId, '', 80),
    price: safePositiveNumber(input.price, 0, 99),
    expiresAt: safePositiveNumber(input.expiresAt, 0),
  };
}

function applyHexcoreWindows(snapshot, windows) {
  if (!Array.isArray(windows)) return snapshot;
  snapshot.hexcoreActionWindows = windows.map(normalizeHexcoreActionWindow)
    .filter(window => window.teamId && window.hexcoreId);
  return snapshot;
}

function normalizeShopDisturbance(input = {}) {
  return {
    type: safeText(input.type, '', 40),
    sourceTeamId: safeText(input.sourceTeamId || input.sourceCaptainId, '', 80),
    targetTeamId: safeText(input.targetTeamId || input.targetCaptainId, '', 80),
    hexcoreId: safeText(input.hexcoreId, '', 80),
    active: input.active === false ? false : true,
    createdAt: safeText(input.createdAt, '', 40),
    consumedAt: safeText(input.consumedAt, '', 40),
  };
}

function applyShopDisturbances(snapshot, disturbances) {
  if (!Array.isArray(disturbances)) return snapshot;
  snapshot.shopDisturbances = disturbances.map(normalizeShopDisturbance)
    .filter(item => item.type && item.sourceTeamId && item.targetTeamId);
  return snapshot;
}

function teamExists(snapshot, teamId) {
  return teamIndex(snapshot, teamId) >= 0;
}

function teamHasHexcore(snapshot, teamId, hexcoreId) {
  const assignments = snapshot.hexcoreAssignments && typeof snapshot.hexcoreAssignments === 'object'
    ? snapshot.hexcoreAssignments
    : {};
  const list = Array.isArray(assignments[safeText(teamId, '', 80)]) ? assignments[safeText(teamId, '', 80)] : [];
  return list.some(item => {
    const currentId = safeText(item && (item.id || item.hexcoreId) || item, '', 80);
    const status = safeText(item && item.status, 'available', 40);
    return currentId === safeText(hexcoreId, '', 80) && status !== 'used';
  });
}

function teamIdsWithHexcore(snapshot = {}, hexcoreId = '') {
  return teamIdsFrom(snapshot).filter(teamId => teamHasHexcore(snapshot, teamId, hexcoreId));
}

function selectedHungryWaveTeamId(snapshot = {}, round = 1) {
  const existing = normalizeHungryWaveRound(snapshot.hungryWaveRound);
  const cleanRound = safePositiveNumber(round, 1, 8);
  if (existing && existing.round === cleanRound && existing.captainId) return existing.captainId;
  const candidates = teamIdsWithHexcore(snapshot, 'hungry-wave');
  if (!candidates.length) return '';
  const seed = `${safeText(snapshot.tournamentId, 'local', 80)}:${cleanRound}:hungry-wave`;
  const digest = crypto.createHash('sha256').update(seed).digest('hex');
  const index = Number.parseInt(digest.slice(0, 8), 16) % candidates.length;
  return candidates[index] || '';
}

function markHexcoreUsed(snapshot, teamId, hexcoreId) {
  const cleanTeamId = safeText(teamId, '', 80);
  const cleanHexcoreId = safeText(hexcoreId, '', 80);
  if (!cleanTeamId || !cleanHexcoreId || !snapshot.hexcoreAssignments || typeof snapshot.hexcoreAssignments !== 'object') return snapshot;
  const list = Array.isArray(snapshot.hexcoreAssignments[cleanTeamId]) ? snapshot.hexcoreAssignments[cleanTeamId] : [];
  snapshot.hexcoreAssignments = {
    ...snapshot.hexcoreAssignments,
    [cleanTeamId]: list.map(item => {
      const currentId = safeText(item && (item.id || item.hexcoreId) || item, '', 80);
      if (currentId !== cleanHexcoreId) return item;
      return { ...(typeof item === 'object' ? item : { id: currentId }), status: 'used' };
    }),
  };
  return snapshot;
}

function normalizeHexcoreDraft(input = {}) {
  const allowedHexcoreIds = new Set(HEXCORE_IDS);
  const teamId = safeText(input.teamId || input.captainId, '', 80);
  const rawSlots = Array.isArray(input.slots || input.candidateIds)
    ? (input.slots || input.candidateIds).map(item => safeText(item, '', 80)).filter(item => item && allowedHexcoreIds.has(item)).slice(0, 5)
    : [];
  const slots = [...new Set(rawSlots)];
  const chosen = Array.isArray(input.chosen)
    ? input.chosen.map(item => safeText(item, '', 80)).filter(Boolean).slice(0, 5)
    : [];
  const seenIds = Array.isArray(input.seenIds)
    ? input.seenIds.map(item => safeText(item, '', 80)).filter(Boolean).slice(0, 40)
    : slots;
  const drawOrder = Array.isArray(input.drawOrder)
    ? input.drawOrder.map(item => safeText(item, '', 80)).filter(Boolean).slice(0, 40)
    : [];
  return {
    captainId: teamId,
    teamId,
    slots,
    chosen,
    seenIds: [...new Set([...seenIds, ...slots])],
    refreshUsed: Boolean(input.refreshUsed),
    drawOrder,
  };
}

function ensureHexcoreAssignments(snapshot) {
  snapshot.hexcoreAssignments = snapshot.hexcoreAssignments && typeof snapshot.hexcoreAssignments === 'object'
    ? { ...snapshot.hexcoreAssignments }
    : {};
  return snapshot.hexcoreAssignments;
}

function normalizeHexcoreAssignmentsProjection(input = {}, validTeamIds = new Set()) {
  const allowedHexcoreIds = new Set(HEXCORE_IDS);
  const usedHexcoreIds = new Set();
  if (!input || typeof input !== 'object') return {};
  return Object.fromEntries(Object.entries(input).map(([teamId, list]) => {
    const cleanTeamId = safeText(teamId, '', 80);
    if (!cleanTeamId || (validTeamIds.size && !validTeamIds.has(cleanTeamId))) return null;
    const normalized = (Array.isArray(list) ? list : [])
      .map(item => {
        const hexcoreId = safeText(item && (item.id || item.hexcoreId) || item, '', 80);
        if (!hexcoreId || !allowedHexcoreIds.has(hexcoreId)) return null;
        if (usedHexcoreIds.has(hexcoreId)) return null;
        usedHexcoreIds.add(hexcoreId);
        return {
          id: hexcoreId,
          status: safeText(item && item.status, 'available', 40) || 'available',
        };
      })
      .filter(Boolean)
      .slice(0, 4);
    return [cleanTeamId, normalized];
  }).filter(Boolean));
}

function assignHexcore(snapshot, teamId, hexcoreId, status = 'available') {
  const cleanTeamId = safeText(teamId, '', 80);
  const cleanHexcoreId = safeText(hexcoreId, '', 80);
  if (!cleanTeamId || !cleanHexcoreId) return snapshot;
  if (!HEXCORE_IDS.includes(cleanHexcoreId)) throw new Error('未知海克斯，不能写入队伍');
  const assignments = ensureHexcoreAssignments(snapshot);
  const occupiedByOther = Object.entries(assignments).some(([currentTeamId, list]) => {
    if (currentTeamId === cleanTeamId || !Array.isArray(list)) return false;
    return list.some(item => safeText(item && (item.id || item.hexcoreId) || item, '', 80) === cleanHexcoreId);
  });
  if (occupiedByOther) throw new Error('该海克斯已被其它队长选择');
  const current = Array.isArray(assignments[cleanTeamId]) ? assignments[cleanTeamId] : [];
  if (current.some(item => safeText(item && (item.id || item.hexcoreId) || item, '', 80) === cleanHexcoreId)) return snapshot;
  if (current.length >= 1) throw new Error('该队长已完成海克斯选择');
  assignments[cleanTeamId] = [
    ...current,
    {
      id: cleanHexcoreId,
      status: safeText(status, 'available', 40) || 'available',
    },
  ];
  if (cleanHexcoreId === 'donation' || cleanHexcoreId === 'origin-sage') {
    const economy = ensureTeamEconomy(snapshot, cleanTeamId);
    if (economy) economy.gold += 2;
  }
  return snapshot;
}

function teamIdsFrom(snapshot = {}) {
  return Array.isArray(snapshot.teams)
    ? snapshot.teams.map(team => safeText(team && (team.teamId || team.id), '', 80)).filter(Boolean)
    : [];
}

function teamById(snapshot = {}, teamId = '') {
  const cleanTeamId = safeText(teamId, '', 80);
  return Array.isArray(snapshot.teams)
    ? snapshot.teams.find(team => safeText(team && (team.teamId || team.id), '', 80) === cleanTeamId)
    : null;
}

function teamCamp(snapshot = {}, teamId = '') {
  const team = teamById(snapshot, teamId);
  return safeText(team && team.camp, '', 40);
}

function isNoCampMode(snapshot = {}) {
  const settings = snapshot.settings && typeof snapshot.settings === 'object' ? snapshot.settings : {};
  return safeText(settings.campMode, '', 40) === 'no_camp';
}

function normalizeTournamentScore(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 999) {
    throw new Error('赛程比分必须是 0-999 的整数');
  }
  return number;
}

function tournamentMatchStatus(match = {}) {
  const hasA = Boolean(safeText(match.teamAId, '', 80));
  const hasB = Boolean(safeText(match.teamBId, '', 80));
  if (hasA && !hasB) return 'bye';
  if (!hasA && !hasB) return 'empty';
  if (match.status === 'completed' && safeText(match.winnerId, '', 80)) return 'completed';
  return 'pending';
}

function normalizeTournamentMatchState(match = {}) {
  const status = tournamentMatchStatus(match);
  if (status === 'bye') {
    match.status = 'bye';
    match.winnerId = safeText(match.teamAId, '', 80);
    match.scoreA = '';
    match.scoreB = '';
    return match;
  }
  if (status === 'completed') {
    match.status = 'completed';
    return match;
  }
  match.status = status;
  match.winnerId = '';
  return match;
}

function buildTournamentRound(roundNumber, entrants, oldRound = null) {
  const cleanEntrants = Array.isArray(entrants) ? entrants.map(item => safeText(item, '', 80)).filter(Boolean) : [];
  const matches = [];
  const pairCount = Math.floor(cleanEntrants.length / 2);
  for (let index = 0; index < pairCount; index += 1) {
    const teamAId = cleanEntrants[index] || '';
    const teamBId = cleanEntrants[cleanEntrants.length - 1 - index] || '';
    const id = `r${roundNumber}m${index + 1}`;
    const oldMatch = oldRound && Array.isArray(oldRound.matches)
      ? oldRound.matches.find(match => safeText(match.id, '', 80) === id && safeText(match.teamAId, '', 80) === teamAId && safeText(match.teamBId, '', 80) === teamBId)
      : null;
    matches.push(oldMatch ? { ...oldMatch } : {
      id,
      teamAId,
      teamBId,
      scoreA: '',
      scoreB: '',
      winnerId: '',
      status: teamAId && teamBId ? 'pending' : 'empty',
    });
  }
  if (cleanEntrants.length % 2 === 1) {
    const teamAId = cleanEntrants[pairCount] || '';
    const id = `r${roundNumber}m${matches.length + 1}`;
    const oldMatch = oldRound && Array.isArray(oldRound.matches)
      ? oldRound.matches.find(match => safeText(match.id, '', 80) === id && safeText(match.teamAId, '', 80) === teamAId && !safeText(match.teamBId, '', 80))
      : null;
    matches.push(oldMatch ? { ...oldMatch } : {
      id,
      teamAId,
      teamBId: '',
      scoreA: '',
      scoreB: '',
      winnerId: teamAId,
      status: 'bye',
    });
  }
  return {
    id: `r${roundNumber}`,
    name: cleanEntrants.length <= 2 ? '决赛' : `第 ${roundNumber} 轮`,
    index: roundNumber,
    matches,
  };
}

function recomputeTournamentAdvancement(snapshot) {
  const tournament = snapshot.tournament && typeof snapshot.tournament === 'object'
    ? snapshot.tournament
    : { status: 'empty', championId: '', rounds: [] };
  if (tournament.type === 'bandle_defense') return snapshot;
  if (!Array.isArray(tournament.rounds) || !tournament.rounds.length) {
    tournament.status = 'empty';
    tournament.championId = '';
    tournament.rounds = [];
    snapshot.tournament = tournament;
    return snapshot;
  }

  tournament.status = 'running';
  tournament.championId = '';
  for (let roundIndex = 0; roundIndex < tournament.rounds.length; roundIndex += 1) {
    const round = tournament.rounds[roundIndex] || {};
    round.matches = Array.isArray(round.matches) ? round.matches : [];
    round.matches.forEach(normalizeTournamentMatchState);
    const allDone = round.matches.length > 0 && round.matches.every(match =>
      ['completed', 'bye'].includes(match.status) && safeText(match.winnerId, '', 80)
    );
    if (!allDone) {
      tournament.rounds = tournament.rounds.slice(0, roundIndex + 1);
      break;
    }
    const winners = round.matches.map(match => safeText(match.winnerId, '', 80)).filter(Boolean);
    if (winners.length <= 1) {
      tournament.status = 'completed';
      tournament.championId = winners[0] || '';
      tournament.rounds = tournament.rounds.slice(0, roundIndex + 1);
      break;
    }
    const oldNextRound = tournament.rounds[roundIndex + 1];
    tournament.rounds[roundIndex + 1] = buildTournamentRound(roundIndex + 2, winners, oldNextRound);
  }
  snapshot.tournament = tournament;
  return snapshot;
}

function recordTournamentMatchScore(snapshot, payload = {}) {
  const tournament = snapshot.tournament && typeof snapshot.tournament === 'object' ? snapshot.tournament : null;
  if (!tournament || !Array.isArray(tournament.rounds) || !tournament.rounds.length) {
    throw new Error('当前没有可记录比分的赛程');
  }
  if (tournament.type === 'bandle_defense') {
    throw new Error('班德尔保卫战比分暂不支持多人端 command 同步，请使用裁判端本地流程');
  }
  const matchId = safeText(payload.matchId, '', 80);
  const roundId = safeText(payload.roundId, '', 80);
  let targetMatch = null;
  tournament.rounds.some(round => {
    if (roundId && safeText(round.id, '', 80) !== roundId) return false;
    targetMatch = Array.isArray(round.matches)
      ? round.matches.find(match => safeText(match.id, '', 80) === matchId)
      : null;
    return Boolean(targetMatch);
  });
  if (!targetMatch) throw new Error('未找到目标赛程场次');
  const teamAId = safeText(targetMatch.teamAId, '', 80);
  const teamBId = safeText(targetMatch.teamBId, '', 80);
  if (!teamAId || !teamBId) throw new Error('目标场次无效或为轮空场次');
  const scoreA = normalizeTournamentScore(payload.scoreA);
  const scoreB = normalizeTournamentScore(payload.scoreB);
  if (scoreA === scoreB) throw new Error('淘汰赛比分不能相同，请录入胜负结果');
  const computedWinnerId = scoreA > scoreB ? teamAId : teamBId;
  const requestedWinnerId = safeText(payload.winnerTeamId || payload.winnerId, '', 80);
  if (requestedWinnerId && requestedWinnerId !== computedWinnerId) {
    throw new Error('胜者与比分结果不一致');
  }
  targetMatch.scoreA = scoreA;
  targetMatch.scoreB = scoreB;
  targetMatch.winnerId = computedWinnerId;
  targetMatch.status = 'completed';
  recomputeTournamentAdvancement(snapshot);
  return snapshot;
}

function playerById(snapshot = {}, playerId = '') {
  const cleanPlayerId = safeText(playerId, '', 80);
  return Array.isArray(snapshot.players)
    ? snapshot.players.find(player => safeText(player && (player.id || player.playerId), '', 80) === cleanPlayerId)
    : null;
}

function normalizeAttendanceStatus(value) {
  const text = safeText(value, '', 40).toLowerCase();
  if (['confirmed', 'confirm', 'ok', '已确认', '确认', '正常'].includes(text)) return 'confirmed';
  if (['pending', 'wait', '待确认', '未确认', '待定'].includes(text)) return 'pending';
  if (['high_risk', 'high-risk', 'risk', '高风险', '风险', '可能缺席'].includes(text)) return 'high_risk';
  if (['substitute', 'sub', '替补', '候补'].includes(text)) return 'substitute';
  if (['unavailable', 'absent', 'missing', '缺席', '不可用', '禁用'].includes(text)) return 'unavailable';
  return 'confirmed';
}

function activateSubstitutePlayer(snapshot, payload = {}) {
  const playerId = safeText(payload.playerId || payload.substitutePlayerId, '', 80);
  if (!playerId || !Array.isArray(snapshot.players)) throw new Error('需要选择有效替补选手');
  let activated = false;
  snapshot.players = snapshot.players.map(player => {
    const currentId = safeText(player && (player.id || player.playerId), '', 80);
    if (currentId !== playerId) return player;
    if (normalizeAttendanceStatus(player.attendanceStatus) !== 'substitute') throw new Error('目标选手不是替补状态');
    if (safeText(player.teamId, '', 80)) throw new Error('已入队选手不能作为替补激活');
    activated = true;
    return {
      ...player,
      attendanceStatus: 'confirmed',
      drawWeight: 1,
      status: safeText(player.status || 'available', 'available', 40) === 'disabled' ? 'disabled' : 'available',
    };
  });
  if (!activated) throw new Error('未找到替补选手');
  snapshot.lastSubstituteAction = {
    type: 'activate',
    playerId,
    resolvedAt: safeText(payload.resolvedAt, new Date().toISOString(), 40),
  };
  return snapshot;
}

function replacePlayerWithSubstitute(snapshot, payload = {}) {
  const teamId = safeText(payload.teamId, '', 80);
  const absentPlayerId = safeText(payload.absentPlayerId || payload.playerId, '', 80);
  const substitutePlayerId = safeText(payload.substitutePlayerId, '', 80);
  if (!teamId || !absentPlayerId || !substitutePlayerId) throw new Error('替补替换需要队伍、缺席选手和替补选手');
  const team = teamById(snapshot, teamId);
  const absent = playerById(snapshot, absentPlayerId);
  const substitute = playerById(snapshot, substitutePlayerId);
  if (!team) throw new Error('未找到目标队伍');
  if (!absent) throw new Error('未找到缺席选手');
  if (!substitute) throw new Error('未找到替补选手');
  const members = Array.isArray(team.team) ? team.team.map(item => safeText(item, '', 80)).filter(Boolean) : [];
  const memberIndex = members.indexOf(absentPlayerId);
  if (memberIndex < 0) throw new Error('缺席选手不在目标队伍中');
  if (safeText(substitute.teamId, '', 80)) throw new Error('替补选手已在其它队伍中');
  if (safeText(substitute.status || 'available', 'available', 40) === 'disabled') throw new Error('替补选手已禁用');
  if (normalizeAttendanceStatus(substitute.attendanceStatus) !== 'confirmed') throw new Error('替补选手需要先激活');
  if (!isNoCampMode(snapshot) && teamCamp(snapshot, teamId) && safeText(substitute.camp, '', 40) !== teamCamp(snapshot, teamId)) {
    throw new Error('双阵营模式下替补必须匹配目标队伍阵营');
  }
  const nextMembers = [...members];
  nextMembers[memberIndex] = substitutePlayerId;
  snapshot.teams = (Array.isArray(snapshot.teams) ? snapshot.teams : []).map(current => {
    const currentId = safeText(current && (current.teamId || current.id), '', 80);
    return currentId === teamId ? { ...current, team: nextMembers } : current;
  });
  snapshot.players = (Array.isArray(snapshot.players) ? snapshot.players : []).map(player => {
    const currentId = safeText(player && (player.id || player.playerId), '', 80);
    if (currentId === absentPlayerId) {
      return {
        ...player,
        status: 'unavailable',
        attendanceStatus: 'unavailable',
        teamId: '',
      };
    }
    if (currentId === substitutePlayerId) {
      return {
        ...player,
        status: 'drafted',
        attendanceStatus: 'confirmed',
        drawWeight: 1,
        teamId,
      };
    }
    return player;
  });
  snapshot.lastSubstituteAction = {
    type: 'replace',
    teamId,
    absentPlayerId,
    substitutePlayerId,
    reason: safeText(payload.reason || payload.replacementReason, '', 160),
    resolvedAt: safeText(payload.resolvedAt, new Date().toISOString(), 40),
  };
  return snapshot;
}

function activeHungryWave(snapshot = {}, round = 1) {
  const wave = normalizeHungryWaveRound(snapshot.hungryWaveRound);
  if (!wave || !wave.active || wave.consumed || wave.triggered) return null;
  if (wave.round !== safePositiveNumber(round, 1, 8)) return null;
  if (!teamHasHexcore(snapshot, wave.captainId, 'hungry-wave')) return null;
  return wave;
}

function hungryWaveAlreadyStarted(snapshot = {}, round = 1) {
  const wave = normalizeHungryWaveRound(snapshot.hungryWaveRound);
  return Boolean(wave && wave.round === safePositiveNumber(round, 1, 8) && wave.active);
}

function isHungryWaveImmuneTeam(snapshot = {}, teamId = '', round = 1) {
  const cleanTeamId = safeText(teamId, '', 80);
  if (!cleanTeamId) return false;
  if (selectedHungryWaveTeamId(snapshot, round) === cleanTeamId) return true;
  const wave = normalizeHungryWaveRound(snapshot.hungryWaveRound);
  return Boolean(wave
    && wave.active
    && !wave.consumed
    && wave.round === safePositiveNumber(round, 1, 8)
    && wave.captainId === cleanTeamId);
}

function stormFogTargetIds(snapshot, sourceTeamId, startTeamId) {
  const order = teamIdsFrom(snapshot);
  const source = safeText(sourceTeamId, '', 80);
  const start = safeText(startTeamId, '', 80);
  const startIndex = order.indexOf(start);
  if (startIndex < 0) return [];
  const targets = [];
  for (let offset = 0; offset < order.length && targets.length < 3; offset += 1) {
    const teamId = order[(startIndex + offset) % order.length];
    if (teamId && teamId !== source && !isHungryWaveImmuneTeam(snapshot, teamId, snapshot.currentRound)) targets.push(teamId);
  }
  return targets;
}

function assignPurchasedPlayer(snapshot, teamId, playerId) {
  const cleanTeamId = safeText(teamId, '', 80);
  const cleanPlayerId = safeText(playerId, '', 80);
  if (!cleanTeamId || !cleanPlayerId) return snapshot;
  let assigned = false;
  if (Array.isArray(snapshot.players)) {
    snapshot.players = snapshot.players.map(player => {
      const currentId = safeText(player && (player.id || player.playerId), '', 80);
      if (currentId !== cleanPlayerId) return player;
      if (safeText(player.teamId, '', 80) && safeText(player.teamId, '', 80) !== cleanTeamId) return player;
      if (safeText(player.status || 'available', 'available', 40) !== 'available') return player;
      assigned = true;
      return {
        ...player,
        status: 'drafted',
        teamId: cleanTeamId,
      };
    });
  }
  if (!assigned && Array.isArray(snapshot.players)) return snapshot;
  if (Array.isArray(snapshot.teams)) {
    snapshot.teams = snapshot.teams.map(team => {
      const currentId = safeText(team && (team.teamId || team.id), '', 80);
      if (currentId !== cleanTeamId) return team;
      const currentTeam = Array.isArray(team.team)
        ? team.team.map(item => safeText(item, '', 80)).filter(Boolean)
        : (Array.isArray(team.memberIds) ? team.memberIds.map(item => safeText(item, '', 80)).filter(Boolean) : []);
      const nextTeam = currentTeam.includes(cleanPlayerId) ? currentTeam : [...currentTeam, cleanPlayerId];
      return {
        ...team,
        team: nextTeam,
      };
    });
  }
  return snapshot;
}

function removePlayerFromTeam(snapshot, teamId, playerId) {
  const cleanTeamId = safeText(teamId, '', 80);
  const cleanPlayerId = safeText(playerId, '', 80);
  if (!cleanTeamId || !cleanPlayerId || !Array.isArray(snapshot.teams)) return snapshot;
  snapshot.teams = snapshot.teams.map(team => {
    const currentId = safeText(team && (team.teamId || team.id), '', 80);
    if (currentId !== cleanTeamId) return team;
    const currentTeam = Array.isArray(team.team)
      ? team.team.map(item => safeText(item, '', 80)).filter(Boolean)
      : [];
    return {
      ...team,
      team: currentTeam.filter(item => item !== cleanPlayerId),
    };
  });
  return snapshot;
}

function addPlayerToTeam(snapshot, teamId, playerId) {
  const cleanTeamId = safeText(teamId, '', 80);
  const cleanPlayerId = safeText(playerId, '', 80);
  if (!cleanTeamId || !cleanPlayerId || !Array.isArray(snapshot.teams)) return snapshot;
  snapshot.teams = snapshot.teams.map(team => {
    const currentId = safeText(team && (team.teamId || team.id), '', 80);
    if (currentId !== cleanTeamId) return team;
    const currentTeam = Array.isArray(team.team)
      ? team.team.map(item => safeText(item, '', 80)).filter(Boolean)
      : [];
    return {
      ...team,
      team: currentTeam.includes(cleanPlayerId) ? currentTeam : [...currentTeam, cleanPlayerId],
    };
  });
  return snapshot;
}

function refundTeamGold(snapshot, teamId, amount) {
  const economy = ensureTeamEconomy(snapshot, teamId);
  if (!economy) return 0;
  economy.gold += safePositiveNumber(amount, 0, 999);
  return economy.gold;
}

function grantHungryWaveFreeRefresh(snapshot, teamId, round) {
  const current = roundStateFor(snapshot, teamId, round);
  setRoundState(snapshot, teamId, round, {
    hungryWaveFreeRefreshes: safePositiveNumber(current.hungryWaveFreeRefreshes, 0, 9) + 1,
  });
}

function clearTeamGold(snapshot, teamId) {
  const economy = ensureTeamEconomy(snapshot, teamId);
  if (!economy) return 0;
  const goldBefore = safePositiveNumber(economy.gold, 0, 999);
  economy.gold = 0;
  return goldBefore;
}

function releasePlayerToPool(snapshot, playerId) {
  const cleanPlayerId = safeText(playerId, '', 80);
  if (!cleanPlayerId || !Array.isArray(snapshot.players)) return snapshot;
  snapshot.players = snapshot.players.map(player => {
    const currentId = safeText(player && (player.id || player.playerId), '', 80);
    if (currentId !== cleanPlayerId) return player;
    return {
      ...player,
      status: 'available',
      teamId: '',
    };
  });
  return snapshot;
}

function replacePlayerTeam(snapshot, playerId, teamId) {
  const cleanPlayerId = safeText(playerId, '', 80);
  const cleanTeamId = safeText(teamId, '', 80);
  if (!cleanPlayerId || !cleanTeamId || !Array.isArray(snapshot.players)) return snapshot;
  snapshot.players = snapshot.players.map(player => {
    const currentId = safeText(player && (player.id || player.playerId), '', 80);
    if (currentId !== cleanPlayerId) return player;
    return {
      ...player,
      status: 'drafted',
      teamId: cleanTeamId,
    };
  });
  return snapshot;
}

function teamMemberCapacity(snapshot = {}, teamId = '') {
  const settings = snapshot.settings && typeof snapshot.settings === 'object' ? snapshot.settings : {};
  return safePositiveNumber(settings.teamMemberCapacity || settings.playersPerTeam - 1, 4, 8);
}

function teamMemberCount(snapshot = {}, teamId = '') {
  const team = teamById(snapshot, teamId);
  return Array.isArray(team && team.team) ? team.team.length : 0;
}

function hungryWaveRewardCandidate(snapshot = {}, teamId = '') {
  const camp = teamCamp(snapshot, teamId);
  const noCampMode = isNoCampMode(snapshot);
  if ((!noCampMode && !camp) || !Array.isArray(snapshot.players)) return null;
  const captainPlayerIds = new Set((Array.isArray(snapshot.teams) ? snapshot.teams : [])
    .map(team => safeText(team && (team.playerId || team.captainPlayerId), '', 80))
    .filter(Boolean));
  return snapshot.players
    .filter(player => {
      const playerId = safeText(player && (player.id || player.playerId), '', 80);
      if (!playerId || captainPlayerIds.has(playerId) || player.isCaptain) return false;
      if (!noCampMode && safeText(player.camp, '', 40) !== camp) return false;
      if (safeText(player.status || 'available', 'available', 40) !== 'available') return false;
      if (safeText(player.teamId, '', 80)) return false;
      return true;
    })
    .sort((left, right) => safeText(left.id || left.playerId, '', 80).localeCompare(safeText(right.id || right.playerId, '', 80)))[0] || null;
}

function remainingHungryWaveCandidates(snapshot = {}, wave = {}) {
  const checked = new Set(Array.isArray(wave.checkedTeamIds) ? wave.checkedTeamIds : []);
  return teamIdsFrom(snapshot).filter(teamId => teamId !== wave.captainId && !checked.has(teamId));
}

function hungryWaveHitRoll(snapshot = {}, wave = {}, buyerId = '', playerId = '', event = {}, remaining = 1) {
  const chanceBase = Math.max(1, safePositiveNumber(remaining, 1, 20));
  const seed = [
    safeText(snapshot.tournamentId, 'local', 80),
    safePositiveNumber(wave.round || snapshot.currentRound, 1, 8),
    safeText(wave.captainId, '', 80),
    safeText(buyerId, '', 80),
    safeText(playerId, '', 80),
    safeText(event.sourceCommandId || event.eventSeq, '', 120),
  ].join(':');
  const digest = crypto.createHash('sha256').update(seed).digest('hex');
  const roll = Number.parseInt(digest.slice(0, 8), 16) % chanceBase;
  return {
    roll,
    chanceBase,
    hit: roll === 0,
  };
}

function resolveHungryWaveAfterPurchase(snapshot, buyerId, playerId, pricePaid, event) {
  const round = safePositiveNumber(snapshot.currentRound, 1, 8);
  const wave = activeHungryWave(snapshot, round);
  const cleanBuyerId = safeText(buyerId, '', 80);
  const cleanPlayerId = safeText(playerId, '', 80);
  if (!wave || !cleanBuyerId || !cleanPlayerId || wave.captainId === cleanBuyerId) return null;
  const remaining = remainingHungryWaveCandidates(snapshot, wave);
  if (!remaining.includes(cleanBuyerId)) return null;
  const nextChecked = [...new Set([...(wave.checkedTeamIds || []), cleanBuyerId])];
  const hitRoll = hungryWaveHitRoll(snapshot, wave, cleanBuyerId, cleanPlayerId, event, remaining.length);
  if (!hitRoll.hit) {
    snapshot.hungryWaveRound = {
      ...wave,
      checkedTeamIds: nextChecked,
    };
    return {
      type: 'miss',
      sourceTeamId: wave.captainId,
      buyerTeamId: cleanBuyerId,
      playerId: cleanPlayerId,
      round,
      roll: hitRoll.roll,
      chanceBase: hitRoll.chanceBase,
      resolvedAt: event.createdAt,
    };
  }
  const player = playerById(snapshot, cleanPlayerId);
  const noCampMode = isNoCampMode(snapshot);
  const sourceCamp = teamCamp(snapshot, wave.captainId);
  const sameCamp = !noCampMode && player && sourceCamp && sourceCamp === safeText(player.camp, '', 40);
  const directSteal = noCampMode || sameCamp;
  refundTeamGold(snapshot, cleanBuyerId, pricePaid);
  removePlayerFromTeam(snapshot, cleanBuyerId, cleanPlayerId);
  setRoundState(snapshot, cleanBuyerId, round, { freeShopUsed: true, purchaseUsed: false, skipped: false });
  grantHungryWaveFreeRefresh(snapshot, cleanBuyerId, round);
  const result = {
    type: noCampMode ? 'no_camp_steal' : (sameCamp ? 'same_camp_steal' : 'opposite_camp_return'),
    sourceTeamId: wave.captainId,
    buyerTeamId: cleanBuyerId,
    playerId: cleanPlayerId,
    round,
    priceRefunded: safePositiveNumber(pricePaid, 0, 999),
    roll: hitRoll.roll,
    chanceBase: hitRoll.chanceBase,
    resolvedAt: event.createdAt,
    pendingRoundReward: !directSteal,
  };
  if (directSteal) {
    addPlayerToTeam(snapshot, wave.captainId, cleanPlayerId);
    replacePlayerTeam(snapshot, cleanPlayerId, wave.captainId);
  } else {
    releasePlayerToPool(snapshot, cleanPlayerId);
  }
  snapshot.hungryWaveRound = {
    ...wave,
    checkedTeamIds: nextChecked,
    consumed: true,
    triggered: true,
    pendingRoundReward: !directSteal,
    resolvedAt: event.createdAt,
  };
  snapshot.lastHungryWave = result;
  return result;
}

function startHungryWaveOnSkip(snapshot, teamId, round, event) {
  const cleanTeamId = safeText(teamId, '', 80);
  const cleanRound = safePositiveNumber(round, 1, 8);
  if (!cleanTeamId || hungryWaveAlreadyStarted(snapshot, cleanRound)) return null;
  if (selectedHungryWaveTeamId(snapshot, cleanRound) !== cleanTeamId) return null;
  const goldBefore = clearTeamGold(snapshot, cleanTeamId);
  const result = {
    type: 'round_start',
    sourceTeamId: cleanTeamId,
    buyerTeamId: '',
    playerId: '',
    round: cleanRound,
    priceRefunded: 0,
    pendingRoundReward: false,
    goldBefore,
    resolvedAt: event.createdAt,
  };
  snapshot.hungryWaveRound = {
    type: 'hungry_wave_round',
    captainId: cleanTeamId,
    round: cleanRound,
    active: true,
    consumed: false,
    triggered: false,
    pendingRoundReward: false,
    checkedTeamIds: [],
    resolvedAt: '',
  };
  snapshot.lastHungryWave = result;
  return result;
}

function resolveHungryWaveRoundEnd(snapshot, round, event) {
  const wave = normalizeHungryWaveRound(snapshot.hungryWaveRound);
  const cleanRound = safePositiveNumber(round, 1, 8);
  if (!wave || wave.round !== cleanRound || !wave.pendingRoundReward || wave.roundRewardResolved) return null;
  const sourceTeamId = wave.captainId;
  let playerId = '';
  let failedReason = '';
  if (teamMemberCount(snapshot, sourceTeamId) >= teamMemberCapacity(snapshot, sourceTeamId)) {
    failedReason = 'team_full';
  } else {
    const rewardPlayer = hungryWaveRewardCandidate(snapshot, sourceTeamId);
    if (!rewardPlayer) {
      failedReason = 'no_candidate';
    } else {
      playerId = safeText(rewardPlayer.id || rewardPlayer.playerId, '', 80);
      addPlayerToTeam(snapshot, sourceTeamId, playerId);
      replacePlayerTeam(snapshot, playerId, sourceTeamId);
    }
  }
  const result = {
    type: playerId ? 'round_reward' : 'round_reward_failed',
    sourceTeamId,
    buyerTeamId: '',
    playerId,
    round: cleanRound,
    priceRefunded: 0,
    pendingRoundReward: false,
    failedReason,
    resolvedAt: event.createdAt,
  };
  snapshot.hungryWaveRound = {
    ...wave,
    active: false,
    roundRewardResolved: true,
    roundRewardPlayerId: playerId,
    roundRewardFailedReason: failedReason,
    resolvedAt: event.createdAt,
  };
  snapshot.lastHungryWave = result;
  return result;
}

function eligibleHeavenlyOwners(snapshot = {}, buyerTeamId = '', player = null) {
  const cleanBuyerId = safeText(buyerTeamId, '', 80);
  const noCampMode = isNoCampMode(snapshot);
  const playerCamp = safeText(player && player.camp, '', 40);
  if (!noCampMode && !playerCamp) return [];
  return teamIdsWithHexcore(snapshot, 'heavenly-descent')
    .filter(teamId => {
      if (!teamId || teamId === cleanBuyerId) return false;
      if (noCampMode) return true;
      return teamCamp(snapshot, teamId) === playerCamp;
    });
}

function replaceHeavenlyWindowsAfterPurchase(snapshot, buyerTeamId, playerId, slotId, pricePaid, round, event) {
  const cleanBuyerId = safeText(buyerTeamId, '', 80);
  const cleanPlayerId = safeText(playerId, '', 80);
  const player = playerById(snapshot, cleanPlayerId);
  const buyer = teamById(snapshot, cleanBuyerId);
  const buyerMembers = Array.isArray(buyer && buyer.team) ? buyer.team.map(item => safeText(item, '', 80)).filter(Boolean) : [];
  const currentWindows = Array.isArray(snapshot.hexcoreActionWindows)
    ? snapshot.hexcoreActionWindows.map(normalizeHexcoreActionWindow)
    : [];
  const otherWindows = currentWindows.filter(window => window.hexcoreId !== 'heavenly-descent');
  if (!player || safeText(player.teamId, '', 80) !== cleanBuyerId || !buyerMembers.includes(cleanPlayerId)) {
    snapshot.hexcoreActionWindows = otherWindows;
    return snapshot;
  }
  const owners = eligibleHeavenlyOwners(snapshot, cleanBuyerId, player);
  const createdMs = Date.parse(event.createdAt || '') || Date.now();
  snapshot.hexcoreActionWindows = [
    ...otherWindows,
    ...owners.map(teamId => ({
      windowId: `heavenly-${event.eventSeq}-${teamId}`,
      teamId,
      hexcoreId: 'heavenly-descent',
      round: safePositiveNumber(round, 1, 8),
      active: true,
      sourceTeamId: cleanBuyerId,
      slotId: safeText(slotId, '', 64),
      playerId: cleanPlayerId,
      price: safePositiveNumber(pricePaid, 0, 99),
      expiresAt: createdMs + 10000,
    })),
  ];
  return snapshot;
}

function markCurrentShopCardHeavenlyResolved(snapshot, buyerTeamId, slotId, playerId, event) {
  const cleanBuyerId = safeText(buyerTeamId, '', 80);
  const cleanSlotId = safeText(slotId, '', 64);
  const cleanPlayerId = safeText(playerId, '', 80);
  if (!snapshot.currentShop || safeText(snapshot.currentShop.teamId || snapshot.currentShop.captainId, '', 80) !== cleanBuyerId) return snapshot;
  if (!Array.isArray(snapshot.currentShop.cards)) return snapshot;
  snapshot.currentShop.cards = snapshot.currentShop.cards.map(card => {
    const cardSlotId = safeText(card && (card.slotId || card.index), '', 64);
    const cardPlayerId = safeText(card && card.playerId, '', 80);
    if (cardSlotId !== cleanSlotId && cardPlayerId !== cleanPlayerId) return card;
    return {
      ...card,
      purchased: true,
      purchasedAt: card.purchasedAt || event.createdAt,
      heavenlyResolved: true,
    };
  });
  return snapshot;
}

function resolveHeavenlyDescentUse(snapshot, payload = {}, event = {}) {
  const sourceTeamId = safeText(payload.teamId, '', 80);
  if (!sourceTeamId) throw new Error('神兵天降需要有效发动队伍');
  if (!teamHasHexcore(snapshot, sourceTeamId, 'heavenly-descent')) {
    throw new Error('当前队伍未持有神兵天降');
  }
  const windows = Array.isArray(snapshot.hexcoreActionWindows)
    ? snapshot.hexcoreActionWindows.map(normalizeHexcoreActionWindow)
    : [];
  const requestedWindowId = safeText(payload.windowId, '', 80);
  const window = windows.find(item =>
    item
    && item.active !== false
    && item.teamId === sourceTeamId
    && item.hexcoreId === 'heavenly-descent'
    && (!requestedWindowId || item.windowId === requestedWindowId)
  );
  if (!window) throw new Error('当前没有可发动的神兵天降窗口');
  const eventMs = Date.parse(event.createdAt || '') || Date.now();
  if (window.expiresAt && eventMs > window.expiresAt) {
    snapshot.hexcoreActionWindows = windows.map(item =>
      item.hexcoreId === 'heavenly-descent' && item.teamId === sourceTeamId
        ? { ...item, active: false, expiredAt: event.createdAt }
        : item
    );
    throw new Error('神兵天降发动窗口已过期');
  }
  const buyerTeamId = safeText(window.sourceTeamId, '', 80);
  const playerId = safeText(window.playerId, '', 80);
  const player = playerById(snapshot, playerId);
  const buyerTeam = teamById(snapshot, buyerTeamId);
  const buyerMembers = Array.isArray(buyerTeam && buyerTeam.team) ? buyerTeam.team.map(item => safeText(item, '', 80)).filter(Boolean) : [];
  if (!buyerTeamId || !player || !buyerMembers.includes(playerId) || safeText(player.teamId, '', 80) !== buyerTeamId) {
    throw new Error('神兵天降目标购买结果已变化');
  }
  if (sourceTeamId === buyerTeamId) throw new Error('神兵天降不能响应自己的购买');
  if (!isNoCampMode(snapshot)) {
    const sourceCamp = teamCamp(snapshot, sourceTeamId);
    if (!sourceCamp || safeText(player.camp, '', 40) !== sourceCamp) {
      throw new Error('神兵天降只能夺取同阵营选手');
    }
  }

  refundTeamGold(snapshot, buyerTeamId, window.price);
  removePlayerFromTeam(snapshot, buyerTeamId, playerId);
  releasePlayerToPool(snapshot, playerId);
  setRoundState(snapshot, buyerTeamId, window.round, { freeShopUsed: true, purchaseUsed: false, skipped: false });
  markCurrentShopCardHeavenlyResolved(snapshot, buyerTeamId, window.slotId, playerId, event);

  const assignedToSource = teamMemberCount(snapshot, sourceTeamId) < teamMemberCapacity(snapshot, sourceTeamId);
  if (assignedToSource) {
    addPlayerToTeam(snapshot, sourceTeamId, playerId);
    replacePlayerTeam(snapshot, playerId, sourceTeamId);
    setRoundState(snapshot, sourceTeamId, safePositiveNumber(window.round, 1, 8) + 1, {
      skipped: true,
      skipReason: 'heavenly-descent',
    });
  }
  markHexcoreUsed(snapshot, sourceTeamId, 'heavenly-descent');
  snapshot.hexcoreActionWindows = windows.map(item =>
    item.hexcoreId === 'heavenly-descent'
      ? { ...item, active: false, resolvedAt: event.createdAt }
      : item
  );
  snapshot.lastHeavenlyDescent = {
    sourceTeamId,
    buyerTeamId,
    playerId,
    round: safePositiveNumber(window.round, 1, 8),
    priceRefunded: safePositiveNumber(window.price, 0, 99),
    assignedToSource,
    noCampMode: isNoCampMode(snapshot),
    resolvedAt: event.createdAt,
  };
  return snapshot;
}

function canApplyClientProjection(payload = {}) {
  return [ROLES.SUPER_ADMIN, ROLES.TOURNAMENT_ADMIN, ROLES.REFEREE].includes(payload.commandRole);
}

function normalizeImportedSettings(input = {}, fallback = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const previous = fallback && typeof fallback === 'object' ? fallback : {};
  const teamCount = Math.max(6, safePositiveNumber(source.teamCount || source.totalTeams, previous.teamCount || previous.totalTeams || 10, 20));
  const campMode = ['dual_camp', 'no_camp'].includes(safeText(source.campMode, '', 40))
    ? safeText(source.campMode, 'dual_camp', 40)
    : safeText(previous.campMode, 'dual_camp', 40);
  const pairingMode = ['camp_versus', 'random', 'manual'].includes(safeText(source.pairingMode, '', 40))
    ? safeText(source.pairingMode, '', 40)
    : (campMode === 'no_camp' ? 'random' : safeText(previous.pairingMode, 'camp_versus', 40));
  const refreshCosts = Array.isArray(source.refreshCosts)
    ? source.refreshCosts.slice(0, 4).map(cost => safePositiveNumber(cost, 1, 9))
    : (Array.isArray(previous.refreshCosts) ? previous.refreshCosts.slice(0, 4).map(cost => safePositiveNumber(cost, 1, 9)) : [1, 2, 3, 4]);
  return {
    ...previous,
    minTeams: 6,
    maxTeams: 20,
    teamCount,
    totalTeams: teamCount,
    playersPerTeam: Math.max(2, safePositiveNumber(source.playersPerTeam, previous.playersPerTeam || 5, 8)),
    teamSizeIncludesCaptain: true,
    campMode,
    pairingMode,
    allowSubstitutes: Object.prototype.hasOwnProperty.call(source, 'allowSubstitutes')
      ? source.allowSubstitutes !== false
      : previous.allowSubstitutes !== false,
    initialGold: safePositiveNumber(source.initialGold, previous.initialGold || 6, 99),
    roundIncome: safePositiveNumber(source.roundIncome, previous.roundIncome || 3, 99),
    refreshCosts,
    turnTimers: normalizeTurnTimerSettings(source.turnTimers || previous.turnTimers || {}),
  };
}

function normalizeImportedRoundStates(input = {}) {
  if (!input || typeof input !== 'object') return {};
  return Object.fromEntries(Object.entries(input).map(([round, value]) => [
    String(safePositiveNumber(round, 1, 8)),
    normalizeRoundState(value || {}),
  ]));
}

function normalizeImportedTeam(input = {}, index = 0, snapshot = {}) {
  const settings = snapshot.settings && typeof snapshot.settings === 'object' ? snapshot.settings : {};
  const teamId = safeText(input.teamId || input.id, `team-${index + 1}`, 80);
  const sourceEconomy = input.economy && typeof input.economy === 'object' ? input.economy : {};
  return {
    teamId,
    name: safeText(input.name, `队伍${index + 1}`, 40),
    camp: safeText(input.camp, '', 40),
    playerId: safeText(input.playerId || input.captainPlayerId, '', 80),
    playerGameId: safeText(input.playerGameId, '', 80),
    team: Array.isArray(input.team)
      ? input.team.map(playerId => safeText(playerId, '', 80)).filter(Boolean).slice(0, 8)
      : [],
    economy: {
      gold: safePositiveNumber(sourceEconomy.gold, settings.initialGold || 6, 999),
      roundState: normalizeImportedRoundStates(sourceEconomy.roundState || {}),
    },
    renameUsed: safeBoolean(input.renameUsed),
  };
}

function normalizeImportedPlayer(input = {}, index = 0) {
  const status = safeText(input.status, 'available', 40);
  return {
    id: safeText(input.id || input.playerId, `player-${index + 1}`, 80),
    name: safeText(input.name, `选手${index + 1}`, 40),
    gameId: safeText(input.gameId || input.id || input.playerId, '', 80),
    camp: safeText(input.camp, '', 40),
    lane: safeText(input.lane, '', 40),
    tier: safePositiveNumber(input.tier || input.price || input.score, 1, 5),
    score: safePositiveNumber(input.score || input.tier, 0, 999),
    heroes: Array.isArray(input.heroes) ? input.heroes.map(hero => safeText(hero, '', 24)).filter(Boolean).slice(0, 5) : [],
    status,
    profileId: safeText(input.profileId, '', 80),
    tournamentName: safeText(input.tournamentName, '', 80),
    region: safeText(input.region, '', 40),
    attendanceStatus: normalizeAttendanceStatus(input.attendanceStatus),
    drawWeight: Math.max(0, Math.min(1, Number(input.drawWeight) || (normalizeAttendanceStatus(input.attendanceStatus) === 'confirmed' ? 1 : 0))),
    teamId: safeText(input.teamId, '', 80),
    isCaptain: safeBoolean(input.isCaptain || status === 'captain'),
  };
}

function normalizeImportedPlayerProfiles(input = []) {
  if (!Array.isArray(input)) return [];
  return input.map((profile, index) => ({
    id: safeText(profile && profile.id, `profile-${index + 1}`, 80),
    commonName: safeText(profile && profile.commonName, '', 40),
    aliases: Array.isArray(profile && profile.aliases)
      ? profile.aliases.map(alias => safeText(alias, '', 40)).filter(Boolean).slice(0, 12)
      : [],
    riskScore: safePositiveNumber(profile && profile.riskScore, 0, 100),
    notes: safeText(profile && profile.notes, '', 200),
  })).filter(profile => profile.id).slice(0, 500);
}

function normalizeImportedTournament(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    status: safeText(source.status, 'empty', 40),
    championId: safeText(source.championId, '', 80),
    type: safeText(source.type, '', 40),
    pairingMode: safeText(source.pairingMode, '', 40),
    rounds: Array.isArray(source.rounds)
      ? source.rounds.map((round, roundIndex) => ({
        id: safeText(round && round.id, `r${roundIndex + 1}`, 80),
        name: safeText(round && round.name, `第 ${roundIndex + 1} 轮`, 40),
        index: safePositiveNumber(round && round.index, roundIndex + 1, 99),
        pairingMode: safeText(round && round.pairingMode, '', 40),
        matches: Array.isArray(round && round.matches)
          ? round.matches.map((match, matchIndex) => ({
            id: safeText(match && match.id, `r${roundIndex + 1}m${matchIndex + 1}`, 80),
            teamAId: safeText(match && match.teamAId, '', 80),
            teamBId: safeText(match && match.teamBId, '', 80),
            scoreA: match && Number.isFinite(Number(match.scoreA)) ? Number(match.scoreA) : '',
            scoreB: match && Number.isFinite(Number(match.scoreB)) ? Number(match.scoreB) : '',
            winnerId: safeText(match && match.winnerId, '', 80),
            status: safeText(match && match.status, 'pending', 40),
            pairingMode: safeText(match && match.pairingMode, '', 40),
            expectedCampA: safeText(match && match.expectedCampA, '', 40),
            expectedCampB: safeText(match && match.expectedCampB, '', 40),
          })).slice(0, 40)
          : [],
      })).slice(0, 12)
      : [],
  };
}

function applyImportedStateSnapshot(snapshot, payload = {}) {
  if (!canApplyClientProjection(payload)) throw new Error('只有裁判或管理员可以导入赛事状态');
  const imported = payload.snapshot && typeof payload.snapshot === 'object' ? payload.snapshot : {};
  snapshot.name = safeText(imported.name || snapshot.name, snapshot.name || '', 80);
  if (imported.settings && typeof imported.settings === 'object') {
    snapshot.settings = normalizeImportedSettings(imported.settings, snapshot.settings || {});
  }
  if (Array.isArray(imported.players)) {
    snapshot.players = imported.players.map(normalizeImportedPlayer).filter(player => player.id).slice(0, 500);
  }
  if (Array.isArray(imported.playerProfiles)) {
    snapshot.playerProfiles = normalizeImportedPlayerProfiles(imported.playerProfiles);
  }
  if (Array.isArray(imported.teams)) {
    snapshot.teams = imported.teams.map((team, index) => normalizeImportedTeam(team, index, snapshot)).filter(team => team.teamId).slice(0, 20);
  }
  const validTeamIds = new Set(teamIdsFrom(snapshot));
  if (imported.roundStates && typeof imported.roundStates === 'object') {
    snapshot.roundStates = Object.fromEntries(Object.entries(imported.roundStates).map(([teamId, rounds]) => {
      const cleanTeamId = safeText(teamId, '', 80);
      if (!cleanTeamId || (validTeamIds.size && !validTeamIds.has(cleanTeamId))) return null;
      return [cleanTeamId, normalizeImportedRoundStates(rounds || {})];
    }).filter(Boolean));
  }
  if (imported.hexcoreAssignments && typeof imported.hexcoreAssignments === 'object') {
    snapshot.hexcoreAssignments = normalizeHexcoreAssignmentsProjection(imported.hexcoreAssignments, validTeamIds);
  }
  if (imported.hexcoreDraft && typeof imported.hexcoreDraft === 'object') {
    snapshot.hexcoreDraft = normalizeHexcoreDraft(imported.hexcoreDraft);
  }
  if (imported.tournament && typeof imported.tournament === 'object') {
    snapshot.tournament = normalizeImportedTournament(imported.tournament);
  }
  if (Object.prototype.hasOwnProperty.call(imported, 'currentRound')) {
    snapshot.currentRound = safePositiveNumber(imported.currentRound, snapshot.currentRound || 1, 8);
  }
  if (Object.prototype.hasOwnProperty.call(imported, 'currentTeamId')) {
    const currentTeamId = safeText(imported.currentTeamId, '', 80);
    if (!currentTeamId || validTeamIds.has(currentTeamId)) snapshot.currentTeamId = currentTeamId;
  }
  snapshot.lastImport = {
    checksum: safeText(payload.checksum, '', 120),
    sourceVersion: safeText(payload.sourceVersion, '', 80),
    reason: safeText(payload.reason, '', 120),
  };
  return snapshot;
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
  if (event.type === EVENT_TYPES.STATE_IMPORTED) {
    return applyImportedStateSnapshot(next, payload);
  }
  if (event.type === EVENT_TYPES.TEAM_RENAMED) {
    const teamId = String((payload && payload.teamId) || '').trim();
    const name = String((payload && payload.name) || '').trim().slice(0, 12);
    next.teams = Array.isArray(next.teams) ? next.teams.map(team => {
      const currentId = String(team.teamId || team.id || '').trim();
      if (currentId !== teamId) return team;
      return { ...team, name, renameUsed: true };
    }) : [];
  }
  if (event.type === EVENT_TYPES.TURN_TIMERS_UPDATED) {
    next.settings = next.settings && typeof next.settings === 'object' ? { ...next.settings } : {};
    next.settings.turnTimers = normalizeTurnTimerPayload(payload);
    if (next.activeTurnTimer && next.activeTurnTimer.phase && next.activeTurnTimer.teamId) {
      startActiveTurnTimer(next, next.activeTurnTimer.phase, next.activeTurnTimer.teamId, event.createdAt);
    }
  }
  if (event.type === EVENT_TYPES.HEXCORE_DRAW_ORDER_SET) {
    const validTeamIds = new Set(teamIdsFrom(next));
    const teamIds = Array.isArray(payload.teamIds)
      ? payload.teamIds.map(item => safeText(item, '', 80)).filter(teamId => teamId && validTeamIds.has(teamId))
      : [];
    const drawOrder = [...new Set(teamIds)];
    if (payload.hexcoreAssignments && typeof payload.hexcoreAssignments === 'object') {
      next.hexcoreAssignments = normalizeHexcoreAssignmentsProjection(payload.hexcoreAssignments, validTeamIds);
      teamIdsFrom(next).forEach(teamId => {
        if (!Array.isArray(next.hexcoreAssignments[teamId])) next.hexcoreAssignments[teamId] = [];
      });
    } else {
      next.hexcoreAssignments = {};
      drawOrder.forEach(teamId => {
        next.hexcoreAssignments[teamId] = [];
      });
    }
    next.hexcoreDraft = {
      captainId: '',
      teamId: '',
      slots: [],
      chosen: [],
      seenIds: [],
      refreshUsed: false,
      drawOrder,
    };
    if (drawOrder.length) {
      startPrepareTimerOrOpenPhase(next, 'hexcore_prepare', 'hexcore_draw', drawOrder[0], event.createdAt);
    } else {
      next.currentTeamId = '';
      next.currentPhase = next.currentPhase || '';
      clearActiveTurnTimer(next);
    }
  }
  if (event.type === EVENT_TYPES.TURN_PREPARE_COMPLETED) {
    const timerPhase = safeText(payload.timerPhase || payload.phase, '', 40);
    const teamId = safeText(payload.teamId, '', 80);
    if (timerPhase === 'hexcore_prepare') {
      next.currentTeamId = teamId;
      next.currentPhase = 'hexcore_draw';
      clearActiveTurnTimer(next);
    }
    if (timerPhase === 'gold_shop_prepare') {
      next.currentTeamId = teamId;
      next.currentRound = safePositiveNumber(payload.round || next.currentRound, 1, 8);
      next.currentPhase = 'gold_shop';
      clearActiveTurnTimer(next);
    }
    next.lastTurnPrepare = {
      timerPhase,
      teamId,
      round: safePositiveNumber(payload.round || next.currentRound, 1, 8),
      completedAt: event.createdAt,
    };
  }
  if (event.type === EVENT_TYPES.SHOP_DRAFT_STARTED) {
    const teamId = safeText(payload.teamId, '', 80);
    if (!teamId || !teamExists(next, teamId)) throw new Error('开始抽选手卡需要有效队长');
    next.currentRound = safePositiveNumber(payload.round || next.currentRound || 1, 1, 8);
    startPrepareTimerOrOpenPhase(next, 'gold_shop_prepare', 'gold_shop', teamId, event.createdAt);
  }
  if (event.type === EVENT_TYPES.HEXCORE_CANDIDATES_CREATED) {
    const draft = normalizeHexcoreDraft(payload);
    if (!draft.teamId || !teamExists(next, draft.teamId)) throw new Error('海克斯抽取需要有效队长');
    if (!draft.slots.length) throw new Error('海克斯候选不能为空');
    const currentList = Array.isArray(next.hexcoreAssignments && next.hexcoreAssignments[draft.teamId])
      ? next.hexcoreAssignments[draft.teamId]
      : [];
    if (currentList.length >= 1) throw new Error('该队长已完成海克斯选择');
    next.hexcoreDraft = draft;
    next.currentTeamId = draft.teamId;
    next.currentPhase = 'hexcore_draw';
    startActiveTurnTimer(next, 'hexcore_draw', draft.teamId, event.createdAt);
  }
  if (event.type === EVENT_TYPES.HEXCORE_CANDIDATE_REFRESHED) {
    const teamId = safeText(payload.teamId || payload.captainId, '', 80);
    const draft = normalizeHexcoreDraft(next.hexcoreDraft || {});
    const candidateSlot = Number(payload.candidateSlot);
    const replacementId = safeText(payload.replacementId || payload.hexcoreId, '', 80);
    if (!teamId || draft.teamId !== teamId || !draft.slots.length) throw new Error('当前没有该队长的海克斯抽取会话');
    if (!Number.isInteger(candidateSlot) || candidateSlot < 0 || candidateSlot >= draft.slots.length) throw new Error('海克斯候选槽无效');
    if (draft.refreshUsed) throw new Error('本次海克斯抽取已使用过刷新');
    if (!replacementId) throw new Error('刷新后的海克斯不能为空');
    draft.slots[candidateSlot] = replacementId;
    draft.seenIds = [...new Set([...(draft.seenIds || []), replacementId])];
    draft.refreshUsed = true;
    next.hexcoreDraft = draft;
    next.currentTeamId = teamId;
    next.currentPhase = 'hexcore_draw';
  }
  if (event.type === EVENT_TYPES.HEXCORE_PICKED) {
    const teamId = safeText(payload.teamId || payload.captainId, '', 80);
    const hexcoreId = safeText(payload.hexcoreId, '', 80);
    const draft = normalizeHexcoreDraft(next.hexcoreDraft || {});
    if (!teamId || !hexcoreId || draft.teamId !== teamId || !draft.slots.includes(hexcoreId)) {
      throw new Error('当前海克斯抽取会话无效');
    }
    assignHexcore(next, teamId, hexcoreId, payload.hexcoreStatus || payload.status || 'available');
    next.hexcoreDraft = {
      ...draft,
      captainId: '',
      teamId: '',
      slots: [],
      chosen: [...new Set([...(draft.chosen || []), hexcoreId])],
      seenIds: [...new Set([...(draft.seenIds || []), hexcoreId])],
      refreshUsed: false,
    };
    const order = Array.isArray(draft.drawOrder) ? draft.drawOrder : [];
    const nextTeamId = order.find(id => {
      const cleanId = safeText(id, '', 80);
      const list = Array.isArray(next.hexcoreAssignments && next.hexcoreAssignments[cleanId]) ? next.hexcoreAssignments[cleanId] : [];
      return cleanId && cleanId !== teamId && list.length < 1;
    });
    next.currentTeamId = nextTeamId || '';
    next.currentPhase = nextTeamId ? 'hexcore_draw' : 'gold_shop_pending';
    clearActiveTurnTimer(next);
  }
  if (event.type === EVENT_TYPES.SHOP_OPENED || event.type === EVENT_TYPES.SHOP_REFRESHED) {
    const teamId = safeText(payload.teamId, '', 80);
    const round = safePositiveNumber(payload.round || next.currentRound, 1, 8);
    const refereeProjection = canApplyClientProjection(payload);
    const trustedProjection = refereeProjection || payload._serverGeneratedProjection === true;
    const previousRoundState = roundStateFor(next, teamId, round);
    if (!refereeProjection
      && event.type === EVENT_TYPES.SHOP_OPENED
      && selectedHungryWaveTeamId(next, round) === teamId
      && !hungryWaveAlreadyStarted(next, round)) {
      ensureTeamEconomy(next, teamId);
      startHungryWaveOnSkip(next, teamId, round, event);
      setRoundState(next, teamId, round, { freeShopUsed: true, purchaseUsed: false, skipped: true });
      next.currentShop = null;
      const nextPointer = nextTurnPointer(next, teamId);
      next.currentTeamId = nextPointer.nextTeamId;
      next.currentRound = nextPointer.nextRound;
      next.currentPhase = 'gold_shop';
      if (next.currentRound > round) applyRoundIncome(next, next.currentRound);
      if (next.currentTeamId && next.currentRound <= 4) startActiveTurnTimer(next, 'gold_shop', next.currentTeamId, event.createdAt);
      else clearActiveTurnTimer(next);
      return next;
    }
    const currentShopForTeam = next.currentShop
      && typeof next.currentShop === 'object'
      && safeText(next.currentShop.teamId || next.currentShop.captainId, '', 80) === teamId;
    if (!refereeProjection && previousRoundState.purchaseUsed && currentShopForTeam) throw new Error('本轮购买权已使用，不能再次开店或刷新');
    if (!refereeProjection && previousRoundState.skipped) throw new Error('本轮已跳过，不能再次开店或刷新');
    if (!refereeProjection && event.type === EVENT_TYPES.SHOP_OPENED && previousRoundState.freeShopUsed && currentShopForTeam) {
      throw new Error('本轮免费商店已使用，不能重复开店');
    }
    if (!refereeProjection && event.type === EVENT_TYPES.SHOP_REFRESHED && !previousRoundState.freeShopUsed) {
      throw new Error('刷新前必须先打开本轮商店');
    }
    let refreshCostPaid = 0;
    let refreshCount = event.type === EVENT_TYPES.SHOP_REFRESHED
      ? safePositiveNumber(previousRoundState.refreshCount, 0, 99) + 1
      : 0;
    let hungryWaveFreeRefreshes = safePositiveNumber(previousRoundState.hungryWaveFreeRefreshes, 0, 9);
    if (event.type === EVENT_TYPES.SHOP_REFRESHED) {
      refreshCostPaid = refreshCostFor(next, teamId, round);
      deductTeamGold(next, teamId, refreshCostPaid, '刷新商店');
      if (hungryWaveFreeRefreshes > 0) hungryWaveFreeRefreshes -= 1;
    } else {
      ensureTeamEconomy(next, teamId);
    }
    next.currentTeamId = teamId || next.currentTeamId;
    next.currentRound = round;
    next.currentPhase = 'gold_shop';
    const currentShopInput = trustedProjection ? (payload.currentShop || payload.shop || {}) : {};
    next.currentShop = normalizeCurrentShop({
      ...currentShopInput,
      refreshCostPaid,
    }, {
      teamId,
      round,
      generatedBy: event.type === EVENT_TYPES.SHOP_OPENED ? 'free_shop' : 'refresh_shop',
      reason: event.type === EVENT_TYPES.SHOP_OPENED ? '服务端确认开店' : '服务端确认刷新',
    });
    setRoundState(next, teamId, round, {
      freeShopUsed: true,
      purchaseUsed: false,
      skipped: false,
      refreshCount,
      hungryWaveFreeRefreshes,
    });
    if (trustedProjection) applyHexcoreWindows(next, payload.hexcoreActionWindows);
    if (trustedProjection) applyShopDisturbances(next, payload.shopDisturbances);
    if (event.type === EVENT_TYPES.SHOP_OPENED || !next.activeTurnTimer) {
      startActiveTurnTimer(next, 'gold_shop', teamId, event.createdAt);
    }
  }
  if (event.type === EVENT_TYPES.SHOP_CARD_PURCHASED) {
    const teamId = safeText(payload.teamId, '', 80);
    const round = safePositiveNumber(payload.round || next.currentRound, 1, 8);
    const slotId = safeText(payload.slotId, '', 64);
    let purchasedCard = null;
    const currentRoundState = roundStateFor(next, teamId, round);
    if (currentRoundState.purchaseUsed) throw new Error('本轮购买权已使用');
    if (currentRoundState.skipped) throw new Error('本轮已跳过，不能购买');
    const existingCard = purchasedCardFromShop(next, teamId, slotId);
    if (existingCard && existingCard.purchased) throw new Error('该商店卡位已购买');
    let pricePaid = 0;
    if (existingCard) {
      pricePaid = safePositiveNumber(existingCard.price || existingCard.tier, 1, 99);
      deductTeamGold(next, teamId, pricePaid, '购买选手');
    } else {
      ensureTeamEconomy(next, teamId);
    }
    if (next.currentShop && Array.isArray(next.currentShop.cards)) {
      next.currentShop.cards = next.currentShop.cards.map(card => {
        if (String(card.slotId || '') !== slotId && String(card.index ?? '') !== slotId) return card;
        purchasedCard = card;
        const markedCard = {
          ...card,
          purchased: true,
          purchasedAt: safeText(payload.purchasedAt, event.createdAt || new Date().toISOString(), 40),
        };
        return markedCard;
      });
      next.currentShop.pickedThisTurn = true;
    }
    const purchasePlayerId = purchasedCard ? purchasedCard.playerId : '';
    const purchaseDisplayPlayerId = purchasedCard ? purchasedCard.displayPlayerId : '';
    assignPurchasedPlayer(next, teamId, purchasePlayerId);
    const hungryWaveResult = resolveHungryWaveAfterPurchase(next, teamId, purchasePlayerId, pricePaid, event);
    replaceHeavenlyWindowsAfterPurchase(next, teamId, purchasePlayerId, slotId, pricePaid, round, event);
    next.lastPurchase = {
      teamId,
      slotId,
      playerId: safeText(purchasePlayerId, '', 80),
      displayPlayerId: safeText(purchaseDisplayPlayerId, '', 80),
      round,
      resolvedAt: event.createdAt,
      pricePaid,
      goldAfter: ensureTeamEconomy(next, teamId) ? ensureTeamEconomy(next, teamId).gold : 0,
      hungryWave: hungryWaveResult || null,
    };
    if (!hungryWaveResult || hungryWaveResult.type === 'miss') {
      setRoundState(next, teamId, round, { freeShopUsed: true, purchaseUsed: true, skipped: false });
    }
    if (canApplyClientProjection(payload)) applyHexcoreWindows(next, payload.hexcoreActionWindows);
    clearActiveTurnTimer(next);
  }
  if (event.type === EVENT_TYPES.TURN_SKIPPED) {
    const teamId = safeText(payload.teamId, '', 80);
    const round = safePositiveNumber(payload.round || next.currentRound, 1, 8);
    ensureTeamEconomy(next, teamId);
    startHungryWaveOnSkip(next, teamId, round, event);
    setRoundState(next, teamId, round, { freeShopUsed: true, purchaseUsed: false, skipped: true });
    next.currentShop = null;
    const nextPointer = nextTurnPointer(next, teamId);
    const trustedProjection = canApplyClientProjection(payload);
    next.currentTeamId = safeText(trustedProjection ? (payload.nextTeamId || nextPointer.nextTeamId) : nextPointer.nextTeamId, '', 80);
    next.currentRound = safePositiveNumber(trustedProjection ? (payload.nextRound || nextPointer.nextRound) : nextPointer.nextRound, round, 8);
    if (next.currentRound > round) {
      resolveHungryWaveRoundEnd(next, round, event);
      applyRoundIncome(next, next.currentRound);
    }
    if (trustedProjection) applyHexcoreWindows(next, payload.hexcoreActionWindows);
    if (next.currentTeamId && next.currentRound <= 4) {
      startActiveTurnTimer(next, 'gold_shop', next.currentTeamId, event.createdAt);
    } else {
      clearActiveTurnTimer(next);
    }
  }
  if (event.type === EVENT_TYPES.HEXCORE_USED) {
    const teamId = safeText(payload.teamId, '', 80);
    const hexcoreId = safeText(payload.hexcoreId, '', 80);
    if (hexcoreId === 'heavenly-descent') {
      resolveHeavenlyDescentUse(next, payload, event);
    }
    if (hexcoreId === 'snow-cat') {
      const targetTeamId = safeText(payload.targetTeamId || payload.targetCaptainId, '', 80);
      if (!targetTeamId || !teamExists(next, targetTeamId)) throw new Error('雪定饿的喵需要选择有效目标队伍');
      if (targetTeamId === teamId) throw new Error('雪定饿的喵不能对自己使用');
      if (isHungryWaveImmuneTeam(next, targetTeamId, next.currentRound)) throw new Error('雪定饿的喵不能对海浪免疫队伍使用');
      if (!canApplyClientProjection(payload) && !teamHasHexcore(next, teamId, hexcoreId)) {
        throw new Error('当前队伍未持有雪定饿的喵');
      }
      const current = Array.isArray(next.shopDisturbances) ? next.shopDisturbances.map(normalizeShopDisturbance) : [];
      next.shopDisturbances = [
        ...current.filter(item => item.active && !(item.type === 'snow_cat' && item.targetTeamId === targetTeamId)),
        {
          type: 'snow_cat',
          sourceTeamId: teamId,
          targetTeamId,
          hexcoreId,
          active: true,
          createdAt: event.createdAt,
          consumedAt: '',
        },
      ];
      markHexcoreUsed(next, teamId, hexcoreId);
    }
    if (hexcoreId === 'storm-fog') {
      const targetTeamId = safeText(payload.targetTeamId || payload.targetCaptainId, '', 80);
      if (!targetTeamId || !teamExists(next, targetTeamId)) throw new Error('骤雨 血雾 清风需要选择有效目标队伍');
      if (targetTeamId === teamId) throw new Error('骤雨 血雾 清风不能对自己使用');
      if (isHungryWaveImmuneTeam(next, targetTeamId, next.currentRound)) throw new Error('骤雨 血雾 清风不能直接指定海浪免疫队伍');
      if (!canApplyClientProjection(payload) && !teamHasHexcore(next, teamId, hexcoreId)) {
        throw new Error('当前队伍未持有骤雨 血雾 清风');
      }
      const targetIds = stormFogTargetIds(next, teamId, targetTeamId);
      if (!targetIds.length) throw new Error('骤雨 血雾 清风没有可影响目标');
      const current = Array.isArray(next.shopDisturbances) ? next.shopDisturbances.map(normalizeShopDisturbance) : [];
      next.shopDisturbances = [
        ...current.filter(item => item.active && !(item.type === 'weather_fog' && targetIds.includes(item.targetTeamId))),
        ...targetIds.map(targetId => ({
          type: 'weather_fog',
          sourceTeamId: teamId,
          targetTeamId: targetId,
          hexcoreId,
          active: true,
          createdAt: event.createdAt,
          consumedAt: '',
        })),
      ];
      markHexcoreUsed(next, teamId, hexcoreId);
    }
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
  if (event.type === EVENT_TYPES.MATCH_SCORE_RECORDED) {
    recordTournamentMatchScore(next, payload);
  }
  if (event.type === EVENT_TYPES.SUBSTITUTE_ACTIVATED) {
    activateSubstitutePlayer(next, payload);
  }
  if (event.type === EVENT_TYPES.PLAYER_REPLACED_BY_SUBSTITUTE) {
    replacePlayerWithSubstitute(next, payload);
  }
  if (event.type === EVENT_TYPES.REFEREE_RULING_FORCED) {
    next.lastRefereeRuling = {
      eventSeq: event.eventSeq,
      reason: safeText(payload.reason, '', 160),
      patchSummary: safeText(payload.patchSummary, '', 240),
      createdAt: event.createdAt,
    };
  }
  return next;
}

function checkpointFromState(state, event = {}) {
  return {
    stateVersion: state.stateVersion,
    eventSeq: state.eventSeq,
    eventType: safeText(event.type, 'InitialState', 80),
    sourceCommandId: safeText(event.sourceCommandId, '', 80),
    actorId: safeText(event.actorId, '', 80),
    createdAt: safeText(event.createdAt, new Date().toISOString(), 40),
    paused: Boolean(state.paused),
    snapshot: clone(state.snapshot || {}),
  };
}

function rollbackCheckpointFor(state, payload = {}) {
  const targetStateVersion = Number(payload.targetStateVersion);
  if (!Number.isInteger(targetStateVersion) || targetStateVersion < 0) {
    throw new Error('回滚目标版本必须是非负整数');
  }
  if (targetStateVersion >= state.stateVersion) {
    throw new Error('回滚目标版本必须早于当前版本');
  }
  const checkpoints = Array.isArray(state.checkpoints) ? state.checkpoints : [];
  const checkpoint = checkpoints.find(item => Number(item.stateVersion) === targetStateVersion);
  if (!checkpoint) throw new Error(`未找到可回滚的状态版本：${targetStateVersion}`);
  return checkpoint;
}

function applyRollbackCheckpoint(state, event, checkpoint) {
  const payload = event.payload || {};
  state.snapshot = clone(checkpoint.snapshot || {});
  state.paused = Boolean(checkpoint.paused);
  state.snapshot.lastRollback = {
    eventSeq: event.eventSeq,
    targetStateVersion: Number(checkpoint.stateVersion) || 0,
    restoredStateVersion: Number(checkpoint.stateVersion) || 0,
    reason: safeText(payload.reason, '', 160),
    createdAt: event.createdAt,
  };
  return state;
}

const AUDITED_EVENT_TYPES = new Set([
  EVENT_TYPES.STATE_IMPORTED,
  EVENT_TYPES.TOURNAMENT_PAUSED,
  EVENT_TYPES.TOURNAMENT_RESUMED,
  EVENT_TYPES.REFEREE_RULING_FORCED,
  EVENT_TYPES.STATE_ROLLED_BACK,
  EVENT_TYPES.MATCH_SCORE_RECORDED,
  EVENT_TYPES.SUBSTITUTE_ACTIVATED,
  EVENT_TYPES.PLAYER_REPLACED_BY_SUBSTITUTE,
]);

function auditEntryFromEvent(event, auditSeq) {
  if (!AUDITED_EVENT_TYPES.has(event.type)) return null;
  const payload = event.payload || {};
  return {
    auditSeq,
    eventSeq: event.eventSeq,
    eventType: event.type,
    stateVersion: event.stateVersion,
    actorId: event.actorId,
    sourceCommandId: event.sourceCommandId || '',
    commandType: safeText(payload.commandType, '', 80),
    commandRole: safeText(payload.commandRole, '', 40),
    teamId: safeText(payload.teamId, '', 80),
    matchId: safeText(payload.matchId, '', 80),
    reason: safeText(payload.reason, '', 160),
    patchSummary: safeText(payload.patchSummary, '', 240),
    targetStateVersion: Number.isInteger(Number(payload.targetStateVersion)) ? Number(payload.targetStateVersion) : null,
    restoredStateVersion: Number.isInteger(Number(payload.restoredStateVersion)) ? Number(payload.restoredStateVersion) : null,
    scoreA: Number.isFinite(Number(payload.scoreA)) ? Number(payload.scoreA) : null,
    scoreB: Number.isFinite(Number(payload.scoreB)) ? Number(payload.scoreB) : null,
    winnerTeamId: safeText(payload.winnerTeamId, '', 80),
    createdAt: event.createdAt,
  };
}

function appendEvent(state, eventInput) {
  assertAuthorityState(state);
  const next = clone(state);
  const rollbackCheckpoint = eventInput.type === EVENT_TYPES.STATE_ROLLED_BACK
    ? rollbackCheckpointFor(state, eventInput.payload || {})
    : null;
  const payload = rollbackCheckpoint
    ? {
      ...(eventInput.payload || {}),
      targetStateVersion: Number(rollbackCheckpoint.stateVersion) || 0,
      restoredStateVersion: Number(rollbackCheckpoint.stateVersion) || 0,
    }
    : (eventInput.payload || {});
  const event = createEventEnvelope({
    ...eventInput,
    payload,
    eventSeq: next.eventSeq + 1,
    stateVersion: next.stateVersion + 1,
    tournamentId: next.tournamentId,
  });
  next.eventSeq = event.eventSeq;
  next.stateVersion = event.stateVersion;
  next.events.push(event);
  next.auditLog = Array.isArray(next.auditLog) ? next.auditLog : [];
  const auditEntry = auditEntryFromEvent(event, next.auditLog.length + 1);
  if (auditEntry) next.auditLog.push(auditEntry);
  if (rollbackCheckpoint) {
    applyRollbackCheckpoint(next, event, rollbackCheckpoint);
  } else {
    next.snapshot = applyEventToSnapshot(next.snapshot, event);
  }
  if (event.sourceCommandId) {
    next.processedCommands[event.sourceCommandId] = event;
  }
  if (!rollbackCheckpoint) {
    if (event.type === EVENT_TYPES.TOURNAMENT_PAUSED) next.paused = true;
    if (event.type === EVENT_TYPES.TOURNAMENT_RESUMED) next.paused = false;
  }
  next.checkpoints = Array.isArray(next.checkpoints) ? next.checkpoints : [];
  next.checkpoints.push(checkpointFromState(next, event));
  next.checkpoints = next.checkpoints.slice(-60);
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
      ...payload,
      commandType: command.type,
      commandRole: command.role,
    },
  });
  return {
    state: next,
    event: next.events[next.events.length - 1],
    duplicate: false,
  };
}

function resolveExpiredTurnTimer(state, nowInput = new Date().toISOString()) {
  assertAuthorityState(state);
  const timer = state.snapshot && state.snapshot.activeTurnTimer;
  if (!timer || typeof timer !== 'object') return state;
  const graceMs = Date.parse(timer.graceDeadlineAt || timer.deadlineAt || '');
  const nowMs = Date.parse(nowInput) || Date.now();
  if (!graceMs || nowMs < graceMs) return state;
  const teamId = safeText(timer.teamId, '', 80);
  if (!teamId) return appendEvent(state, {
    type: EVENT_TYPES.REFEREE_RULING_FORCED,
    actorId: 'system-timeout',
    payload: { reason: '回合计时异常', patchSummary: '计时器缺少队伍，未执行自动流转' },
    createdAt: new Date(nowMs).toISOString(),
  });
  if (timer.phase === 'hexcore_prepare' || timer.phase === 'gold_shop_prepare') {
    return appendEvent(state, {
      type: EVENT_TYPES.TURN_PREPARE_COMPLETED,
      actorId: 'system-timeout',
      payload: {
        timerPhase: timer.phase,
        phase: timer.phase,
        teamId,
        round: safePositiveNumber(timer.round || state.snapshot.currentRound, 1, 8),
        timeout: true,
        summary: timer.phase === 'hexcore_prepare'
          ? '海克斯准备倒计时结束，开放队长抽取候选'
          : '选手卡准备倒计时结束，开放队长开店',
      },
      createdAt: new Date(nowMs).toISOString(),
    });
  }
  if (timer.phase === 'hexcore_draw') {
    const draft = normalizeHexcoreDraft(state.snapshot.hexcoreDraft || {});
    const hexcoreId = draft.teamId === teamId ? draft.slots.find(id => id && !(draft.chosen || []).includes(id)) : '';
    if (!hexcoreId) return state;
    return appendEvent(state, {
      type: EVENT_TYPES.HEXCORE_PICKED,
      actorId: 'system-timeout',
      payload: {
        teamId,
        hexcoreId,
        hexcoreStatus: 'available',
        timeout: true,
        summary: '海克斯选择倒计时结束，系统自动选择第一个候选',
      },
      createdAt: new Date(nowMs).toISOString(),
    });
  }
  if (timer.phase === 'gold_shop') {
    return appendEvent(state, {
      type: EVENT_TYPES.TURN_SKIPPED,
      actorId: 'system-timeout',
      payload: {
        teamId,
        round: safePositiveNumber(timer.round || state.snapshot.currentRound, 1, 8),
        timeout: true,
        summary: '商店回合倒计时结束，系统自动跳过当前队长',
      },
      createdAt: new Date(nowMs).toISOString(),
    });
  }
  return state;
}

module.exports = {
  acceptCommandAsEvent,
  appendEvent,
  assertAuthorityState,
  createAuthorityState,
  normalizeRoleBinding,
  preflightCommand,
  resolveExpiredTurnTimer,
};
