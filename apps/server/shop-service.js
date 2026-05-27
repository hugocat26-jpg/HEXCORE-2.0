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
  const cards = candidates.slice(0, 5).map(playerToShopCard);
  return {
    id: safeText(`shop_${teamId}_${round}_${command.commandId}`, `shop_${Date.now()}`, 80),
    teamId,
    captainId: teamId,
    round,
    generatedBy: command.type === COMMAND_TYPES.OPEN_SHOP ? 'server_free_shop' : 'server_refresh_shop',
    reason: cards.length ? '服务端从导入选手池生成商店' : '服务端生成商店：暂无可用选手',
    refreshCostPaid: safePositiveNumber(payload.refreshCostPaid, 0, 99),
    selectedSlot: 0,
    pickedThisTurn: false,
    cards,
  };
}

function createAuthoritativeCommandPayload(state, command, roleBinding = {}) {
  const payload = command && command.payload && typeof command.payload === 'object' ? { ...command.payload } : {};
  delete payload._serverGeneratedProjection;
  if (!shouldGenerateServerShop(command, roleBinding, payload)) return payload;
  return {
    ...payload,
    currentShop: createServerShop(state.snapshot || {}, command, roleBinding, payload),
    hexcoreActionWindows: [],
    _serverGeneratedProjection: true,
  };
}

module.exports = {
  createAuthoritativeCommandPayload,
  createServerShop,
  shopPlayerCandidates,
};
