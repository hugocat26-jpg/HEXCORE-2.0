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

function nextTurnPointer(snapshot, teamId) {
  const teams = Array.isArray(snapshot.teams) ? snapshot.teams : [];
  if (!teams.length) return { nextTeamId: '', nextRound: safePositiveNumber(snapshot.currentRound, 1, 8) };
  const currentIndex = Math.max(0, teamIndex(snapshot, teamId));
  const nextIndex = (currentIndex + 1) % teams.length;
  const nextRound = nextIndex === 0
    ? safePositiveNumber(snapshot.currentRound, 1, 8) + 1
    : safePositiveNumber(snapshot.currentRound, 1, 8);
  const nextTeam = teams[nextIndex] || {};
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

function playerById(snapshot = {}, playerId = '') {
  const cleanPlayerId = safeText(playerId, '', 80);
  return Array.isArray(snapshot.players)
    ? snapshot.players.find(player => safeText(player && (player.id || player.playerId), '', 80) === cleanPlayerId)
    : null;
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

function stormFogTargetIds(snapshot, sourceTeamId, startTeamId) {
  const order = teamIdsFrom(snapshot);
  const source = safeText(sourceTeamId, '', 80);
  const start = safeText(startTeamId, '', 80);
  const startIndex = order.indexOf(start);
  if (startIndex < 0) return [];
  const targets = [];
  for (let offset = 0; offset < order.length && targets.length < 3; offset += 1) {
    const teamId = order[(startIndex + offset) % order.length];
    if (teamId && teamId !== source) targets.push(teamId);
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

function remainingHungryWaveCandidates(snapshot = {}, wave = {}) {
  const checked = new Set(Array.isArray(wave.checkedTeamIds) ? wave.checkedTeamIds : []);
  return teamIdsFrom(snapshot).filter(teamId => teamId !== wave.captainId && !checked.has(teamId));
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
  const shouldHit = remaining.length <= 1;
  if (!shouldHit) {
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
      resolvedAt: event.createdAt,
    };
  }
  const player = playerById(snapshot, cleanPlayerId);
  const sameCamp = player && teamCamp(snapshot, wave.captainId) && teamCamp(snapshot, wave.captainId) === safeText(player.camp, '', 40);
  refundTeamGold(snapshot, cleanBuyerId, pricePaid);
  removePlayerFromTeam(snapshot, cleanBuyerId, cleanPlayerId);
  setRoundState(snapshot, cleanBuyerId, round, { freeShopUsed: true, purchaseUsed: false, skipped: false });
  grantHungryWaveFreeRefresh(snapshot, cleanBuyerId, round);
  const result = {
    type: sameCamp ? 'same_camp_steal' : 'opposite_camp_return',
    sourceTeamId: wave.captainId,
    buyerTeamId: cleanBuyerId,
    playerId: cleanPlayerId,
    round,
    priceRefunded: safePositiveNumber(pricePaid, 0, 999),
    resolvedAt: event.createdAt,
    pendingRoundReward: !sameCamp,
  };
  if (sameCamp) {
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
    pendingRoundReward: !sameCamp,
    resolvedAt: event.createdAt,
  };
  snapshot.lastHungryWave = result;
  return result;
}

function startHungryWaveOnSkip(snapshot, teamId, round, event) {
  const cleanTeamId = safeText(teamId, '', 80);
  const cleanRound = safePositiveNumber(round, 1, 8);
  if (!cleanTeamId || hungryWaveAlreadyStarted(snapshot, cleanRound)) return null;
  if (!teamHasHexcore(snapshot, cleanTeamId, 'hungry-wave')) return null;
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
    const refereeProjection = canApplyClientProjection(payload);
    const trustedProjection = refereeProjection || payload._serverGeneratedProjection === true;
    const previousRoundState = roundStateFor(next, teamId, round);
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
    if (next.currentRound > round) applyRoundIncome(next, next.currentRound);
    if (trustedProjection) applyHexcoreWindows(next, payload.hexcoreActionWindows);
  }
  if (event.type === EVENT_TYPES.HEXCORE_USED) {
    const teamId = safeText(payload.teamId, '', 80);
    const hexcoreId = safeText(payload.hexcoreId, '', 80);
    if (hexcoreId === 'snow-cat') {
      const targetTeamId = safeText(payload.targetTeamId || payload.targetCaptainId, '', 80);
      if (!targetTeamId || !teamExists(next, targetTeamId)) throw new Error('雪定饿的喵需要选择有效目标队伍');
      if (targetTeamId === teamId) throw new Error('雪定饿的喵不能对自己使用');
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

module.exports = {
  acceptCommandAsEvent,
  appendEvent,
  assertAuthorityState,
  createAuthorityState,
  normalizeRoleBinding,
  preflightCommand,
};
