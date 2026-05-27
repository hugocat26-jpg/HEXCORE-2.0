const crypto = require('crypto');
const { COMMAND_TYPES, ROLES } = require('../../packages/shared');

function safeText(value, fallback = '', maxLength = 120) {
  return String(value ?? fallback).trim().slice(0, maxLength);
}

function safePositiveNumber(value, fallback = 0, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(max, Math.round(number)));
}

function teamById(snapshot = {}, teamId = '') {
  const cleanTeamId = safeText(teamId, '', 80);
  return Array.isArray(snapshot.teams)
    ? snapshot.teams.find(team => safeText(team.teamId || team.id, '', 80) === cleanTeamId)
    : null;
}

function teamCamp(snapshot = {}, teamId = '') {
  const team = teamById(snapshot, teamId);
  return safeText(team && team.camp, '', 40);
}

function roundRefreshCount(snapshot = {}, teamId = '', round = 1) {
  const roundStates = snapshot.roundStates || {};
  const teamStates = roundStates[safeText(teamId, '', 80)] || {};
  const state = teamStates[String(safePositiveNumber(round, 1, 8))] || {};
  return safePositiveNumber(state.refreshCount, 0, 99);
}

function nextRefreshCost(snapshot = {}, teamId = '', round = 1) {
  const settings = snapshot.settings && typeof snapshot.settings === 'object' ? snapshot.settings : {};
  const costs = Array.isArray(settings.refreshCosts) && settings.refreshCosts.length ? settings.refreshCosts : [1, 2, 3, 4];
  const refreshCount = roundRefreshCount(snapshot, teamId, round);
  return safePositiveNumber(costs[Math.min(refreshCount, costs.length - 1)], 1, 99);
}

function shopPlayerCandidates(snapshot = {}, teamId = '') {
  const camp = teamCamp(snapshot, teamId);
  if (!camp) return [];
  const captainPlayerIds = new Set((Array.isArray(snapshot.teams) ? snapshot.teams : [])
    .map(team => safeText(team.playerId || team.captainPlayerId, '', 80))
    .filter(Boolean));
  return (Array.isArray(snapshot.players) ? snapshot.players : [])
    .filter(player => {
      if (!player || !safeText(player.id || player.playerId, '', 80)) return false;
      if (safeText(player.camp, '', 40) !== camp) return false;
      if (player.isCaptain || captainPlayerIds.has(safeText(player.id || player.playerId, '', 80))) return false;
      if (safeText(player.status || 'available', 'available', 40) !== 'available') return false;
      if (safeText(player.teamId, '', 80)) return false;
      return true;
    });
}

function rankedCandidates(candidates, seed) {
  return [...candidates].sort((left, right) => {
    const leftKey = crypto.createHash('sha256').update(`${seed}:${left.id || left.playerId}`).digest('hex');
    const rightKey = crypto.createHash('sha256').update(`${seed}:${right.id || right.playerId}`).digest('hex');
    return leftKey.localeCompare(rightKey);
  });
}

function playerToShopCard(player, index) {
  const tier = safePositiveNumber(player.tier || player.price || 1, 1, 5);
  return {
    slotId: `slot-${index + 1}`,
    playerId: safeText(player.id || player.playerId, '', 80),
    displayPlayerId: safeText(player.displayPlayerId || player.id || player.playerId, '', 80),
    name: safeText(player.name, '', 40),
    gameId: safeText(player.gameId || player.id || player.playerId, '', 80),
    lane: safeText(player.lane, '', 40),
    score: safePositiveNumber(player.score || tier, tier, 999),
    heroes: Array.isArray(player.heroes) ? player.heroes.map(hero => safeText(hero, '', 24)).filter(Boolean).slice(0, 3) : [],
    tier,
    price: safePositiveNumber(player.price || tier, tier, 99),
    camp: safeText(player.camp, '', 40),
    purchased: false,
  };
}

function teamIds(snapshot = {}) {
  return Array.isArray(snapshot.teams)
    ? snapshot.teams.map(team => safeText(team && (team.teamId || team.id), '', 80)).filter(Boolean)
    : [];
}

function teamHasHexcore(snapshot = {}, teamId = '', hexcoreId = '') {
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

function selectedHungryWaveTeamId(snapshot = {}, round = 1) {
  const existing = snapshot.hungryWaveRound && typeof snapshot.hungryWaveRound === 'object' ? snapshot.hungryWaveRound : null;
  const cleanRound = safePositiveNumber(round, 1, 8);
  if (existing && safePositiveNumber(existing.round, 1, 8) === cleanRound && safeText(existing.captainId || existing.teamId, '', 80)) {
    return safeText(existing.captainId || existing.teamId, '', 80);
  }
  const candidates = teamIds(snapshot).filter(teamId => teamHasHexcore(snapshot, teamId, 'hungry-wave'));
  if (!candidates.length) return '';
  const seed = `${safeText(snapshot.tournamentId, 'local', 80)}:${cleanRound}:hungry-wave`;
  const digest = crypto.createHash('sha256').update(seed).digest('hex');
  const index = Number.parseInt(digest.slice(0, 8), 16) % candidates.length;
  return candidates[index] || '';
}

function hungryWaveAlreadyStarted(snapshot = {}, round = 1) {
  const wave = snapshot.hungryWaveRound && typeof snapshot.hungryWaveRound === 'object' ? snapshot.hungryWaveRound : null;
  return Boolean(wave
    && safePositiveNumber(wave.round, 1, 8) === safePositiveNumber(round, 1, 8)
    && wave.active !== false);
}

function activeDisplayDisturbance(snapshot = {}, teamId = '') {
  const cleanTeamId = safeText(teamId, '', 80);
  return (Array.isArray(snapshot.shopDisturbances) ? snapshot.shopDisturbances : [])
    .find(item => item
      && item.active !== false
      && ['snow_cat', 'weather_fog'].includes(safeText(item.type, '', 40))
      && safeText(item.targetTeamId || item.targetCaptainId, '', 80) === cleanTeamId) || null;
}

function applyDisplayShuffle(cards = [], seed = '', disturbanceType = '') {
  if (!Array.isArray(cards) || cards.length < 2) return cards;
  const ranked = [...cards].sort((left, right) => {
    const leftKey = crypto.createHash('sha256').update(`${seed}:display:${left.playerId}`).digest('hex');
    const rightKey = crypto.createHash('sha256').update(`${seed}:display:${right.playerId}`).digest('hex');
    return leftKey.localeCompare(rightKey);
  });
  const displayById = new Map();
  ranked.forEach((card, index) => {
    displayById.set(card.playerId, ranked[(index + 1) % ranked.length]);
  });
  return cards.map(card => {
    const display = displayById.get(card.playerId);
    if (!display || display.playerId === card.playerId) return card;
    return {
      ...card,
      displayPlayerId: display.playerId,
      displayName: display.name,
      displayGameId: display.gameId,
      displayLane: display.lane,
      displayScore: display.score,
      displayHeroes: display.heroes,
      snowCatShuffled: true,
      weatherFogged: safeText(disturbanceType, '', 40) === 'weather_fog',
    };
  });
}

function consumeShopDisturbance(snapshot = {}, teamId = '', consumedAt = new Date().toISOString()) {
  const cleanTeamId = safeText(teamId, '', 80);
  return (Array.isArray(snapshot.shopDisturbances) ? snapshot.shopDisturbances : []).map(item => {
    if (!item || !['snow_cat', 'weather_fog'].includes(safeText(item.type, '', 40))) return item;
    if (safeText(item.targetTeamId || item.targetCaptainId, '', 80) !== cleanTeamId || item.active === false) return item;
    return { ...item, active: false, consumedAt };
  });
}

function shouldGenerateServerShop(command, roleBinding, payload = {}) {
  if (![COMMAND_TYPES.OPEN_SHOP, COMMAND_TYPES.REFRESH_SHOP].includes(command.type)) return false;
  if ([ROLES.REFEREE, ROLES.TOURNAMENT_ADMIN, ROLES.SUPER_ADMIN].includes(roleBinding.role)
    && (payload.currentShop || payload.shop)) {
    return false;
  }
  return true;
}

function createServerShop(snapshot = {}, command, roleBinding = {}, payload = {}) {
  const teamId = safeText(payload.teamId || command.teamId || roleBinding.teamId, '', 80);
  const round = safePositiveNumber(payload.round || snapshot.currentRound, 1, 8);
  const refreshCount = command.type === COMMAND_TYPES.REFRESH_SHOP
    ? roundRefreshCount(snapshot, teamId, round) + 1
    : 0;
  const seed = safeText(payload.seed || payload.clientSeed || command.commandId, command.commandId, 120);
  const candidates = rankedCandidates(shopPlayerCandidates(snapshot, teamId), `${snapshot.tournamentId || command.tournamentId}:${teamId}:${round}:${refreshCount}:${seed}`);
  const disturbance = activeDisplayDisturbance(snapshot, teamId);
  const baseCards = candidates.slice(0, 5).map(playerToShopCard);
  const cards = disturbance
    ? applyDisplayShuffle(baseCards, `${snapshot.tournamentId || command.tournamentId}:${teamId}:${round}:${refreshCount}:${seed}:${safeText(disturbance.type, '', 40)}`, safeText(disturbance.type, '', 40))
    : baseCards;
  return {
    id: safeText(`shop_${teamId}_${round}_${command.commandId}`, `shop_${Date.now()}`, 80),
    teamId,
    captainId: teamId,
    round,
    generatedBy: command.type === COMMAND_TYPES.OPEN_SHOP ? 'server_free_shop' : 'server_refresh_shop',
    reason: cards.length ? '服务端从导入选手池生成商店' : '服务端生成商店：暂无可用选手',
    refreshCostPaid: command.type === COMMAND_TYPES.REFRESH_SHOP ? nextRefreshCost(snapshot, teamId, round) : 0,
    selectedSlot: 0,
    pickedThisTurn: false,
    appliedDisturbance: disturbance ? { type: safeText(disturbance.type, '', 40), sourceTeamId: safeText(disturbance.sourceTeamId, '', 80) } : null,
    cards,
  };
}

function createAuthoritativeCommandPayload(state, command, roleBinding = {}) {
  const payload = command && command.payload && typeof command.payload === 'object' ? { ...command.payload } : {};
  delete payload._serverGeneratedProjection;
  if (!shouldGenerateServerShop(command, roleBinding, payload)) return payload;
  const teamId = safeText(payload.teamId || command.teamId || roleBinding.teamId, '', 80);
  const round = safePositiveNumber(payload.round || state.snapshot && state.snapshot.currentRound, 1, 8);
  if (command.type === COMMAND_TYPES.OPEN_SHOP
    && selectedHungryWaveTeamId(state.snapshot || {}, round) === teamId
    && !hungryWaveAlreadyStarted(state.snapshot || {}, round)) {
    return {
      ...payload,
      currentShop: null,
      refreshCount: roundRefreshCount(state.snapshot || {}, teamId, round),
      shopDisturbances: consumeShopDisturbance(state.snapshot || {}, teamId),
      hexcoreActionWindows: [],
      _serverGeneratedProjection: true,
    };
  }
  const refreshCount = command.type === COMMAND_TYPES.REFRESH_SHOP
    ? roundRefreshCount(state.snapshot || {}, teamId, round) + 1
    : 0;
  const currentShop = createServerShop(state.snapshot || {}, command, roleBinding, payload);
  return {
    ...payload,
    currentShop,
    refreshCount,
    shopDisturbances: consumeShopDisturbance(state.snapshot || {}, teamId),
    hexcoreActionWindows: [],
    _serverGeneratedProjection: true,
  };
}

module.exports = {
  createAuthoritativeCommandPayload,
  createServerShop,
  consumeShopDisturbance,
  shopPlayerCandidates,
};
