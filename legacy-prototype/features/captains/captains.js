// hexcore2.0/src/features/captains/captains.js
import { AppState } from '../../app.js';
import { generateId, compareIds } from '../../core/id.js';
import { escapeHtml } from '../../core/escape.js';
import { EventBus } from '../../core/events.js';

export function addCaptain(captainData) {
  const captain = {
    id: generateId('c'),
    name: escapeHtml(captainData.name || ''),
    playerId: captainData.playerId || null,
    team: [],
    hexcores: [],
  };

  AppState.captains.push(captain);
  EventBus.emit('stateChanged');
  EventBus.emit('captainsChanged', AppState.captains);
  return captain;
}

export function getCaptain(captainId) {
  return AppState.captains.find(c => compareIds(c.id, captainId));
}

export function addPlayerToTeam(captainId, player, options = {}) {
  const captain = getCaptain(captainId);
  if (!captain) return null;

  const teamMember = {
    playerId: player.id,
    name: player.name,
    gameId: player.gameId,
    cost: player.cost,
    isRandom: options.isRandom || false,
  };

  captain.team.push(teamMember);

  // 更新选手状态
  const appPlayer = AppState.players.find(p => compareIds(p.id, player.id));
  if (appPlayer) {
    appPlayer.status = 'drafted';
    appPlayer.teamId = captainId;
  }

  EventBus.emit('stateChanged');
  EventBus.emit('teamUpdated', { captainId, team: captain.team });
  return captain;
}

export function getTeamSize(captainId) {
  const captain = getCaptain(captainId);
  return captain ? captain.team.length : 0;
}

export function removeCaptain(captainId) {
  const index = AppState.captains.findIndex(c => compareIds(c.id, captainId));
  if (index !== -1) {
    // 释放选手
    const captain = AppState.captains[index];
    captain.team.forEach(member => {
      const player = AppState.players.find(p => compareIds(p.id, member.playerId));
      if (player) {
        player.status = 'available';
        player.teamId = null;
      }
    });

    AppState.captains.splice(index, 1);
    EventBus.emit('stateChanged');
    EventBus.emit('captainsChanged', AppState.captains);
  }
}
