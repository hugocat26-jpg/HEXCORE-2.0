// hexcore2.0/src/features/players/players.js
import { AppState } from '../../app.js';
import { generateId, compareIds } from '../../core/id.js';
import { escapeHtml } from '../../core/escape.js';
import { EventBus } from '../../core/events.js';

const TIER_THRESHOLDS = [0, 25, 50, 75, 100]; // 百分位

export function addPlayer(playerData) {
  const player = {
    id: generateId('p'),
    name: escapeHtml(playerData.name || ''),
    gameId: escapeHtml(playerData.gameId || ''),
    s1: parseInt(playerData.s1) || -1,
    s2: parseInt(playerData.s2) || -1,
    s3: parseInt(playerData.s3) || -1,
    score: 0,
    cost: 1,
    manualCost: null,
    status: 'available',
    teamId: null,
  };

  player.score = calculateScore(player);
  player.cost = autoGrade(player);

  AppState.players.push(player);
  EventBus.emit('stateChanged');
  EventBus.emit('playersChanged', AppState.players);
  return player;
}

export function calculateScore(player) {
  return (player.s1 >= 0 ? player.s1 : 0) * 3 +
         (player.s2 >= 0 ? player.s2 : 0) * 2 +
         (player.s3 >= 0 ? player.s3 : 0) * 1;
}

export function autoGrade(player) {
  if (player.manualCost) return player.manualCost;

  const scores = AppState.players.map(p => p.score).sort((a, b) => a - b);
  const percentile = scores.indexOf(player.score) / scores.length * 100;

  if (percentile >= 75) return 4;
  if (percentile >= 50) return 3;
  if (percentile >= 25) return 2;
  return 1;
}

export function getPlayersByTier(tier) {
  return AppState.players.filter(p => p.cost === tier && p.status === 'available');
}

export function getAvailablePlayers() {
  return AppState.players.filter(p => p.status === 'available');
}

export function removePlayer(playerId) {
  const index = AppState.players.findIndex(p => compareIds(p.id, playerId));
  if (index !== -1) {
    AppState.players.splice(index, 1);
    EventBus.emit('stateChanged');
    EventBus.emit('playersChanged', AppState.players);
  }
}

export function updatePlayer(playerId, updates) {
  const player = AppState.players.find(p => compareIds(p.id, playerId));
  if (!player) return null;

  Object.assign(player, {
    name: escapeHtml(updates.name ?? player.name),
    gameId: escapeHtml(updates.gameId ?? player.gameId),
    manualCost: updates.manualCost ?? player.manualCost,
  });

  if ('s1' in updates || 's2' in updates || 's3' in updates) {
    player.s1 = parseInt(updates.s1 ?? player.s1);
    player.s2 = parseInt(updates.s2 ?? player.s2);
    player.s3 = parseInt(updates.s3 ?? player.s3);
    player.score = calculateScore(player);
    player.cost = autoGrade(player);
  }

  EventBus.emit('stateChanged');
  EventBus.emit('playersChanged', AppState.players);
  return player;
}
