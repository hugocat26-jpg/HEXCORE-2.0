(function initAssignmentEngine(global) {
  const Hexcore2 = global.Hexcore2 || (global.Hexcore2 = {});

  Hexcore2.assignmentEngine = {
    assign(captainId, playerId, source = 'normal_pick') {
      const state = Hexcore2.state;
      const captain = state.captains.find(item => item.id === captainId);
      const player = state.players.find(item => item.id === playerId);
      if (!captain || !player || player.status !== 'available') return false;
      if (captain.team.length >= state.settings.playersPerTeam) return false;

      captain.team.push(player.id);
      player.status = 'drafted';
      player.teamId = captainId;
      Hexcore2.eventStore.append('选手入队', `${captain.name} 选择了选手「${player.name}」加入队伍（${captain.team.length}/4）`, 'success', { source });
      if (Hexcore2.hexcoreEngine && source !== 'lock_contract_pair') {
        Hexcore2.hexcoreEngine.resolveLockContracts(captainId, player.id);
      }
      return true;
    },

    assignRandomFromTier(captainId, tier, source = 'auto_assign') {
      const candidates = Hexcore2.selectors.availablePlayers(tier);
      if (candidates.length === 0) return false;

      const index = Math.floor(Math.random() * candidates.length);
      return this.assign(captainId, candidates[index].id, source);
    },

    assignBlindFromTier(captainId, tier, source = 'blind_auto_assign') {
      return this.assignRandomFromTier(captainId, tier, source);
    },

    assignRandomFromTopScored(captainId, tier, limit = 5, source = 'top_scored_auto_assign') {
      const candidates = Hexcore2.selectors.availablePlayers(tier)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
      if (candidates.length === 0) return false;

      const index = Math.floor(Math.random() * candidates.length);
      return this.assign(captainId, candidates[index].id, source);
    },

    transferDraftedPlayer(targetCaptainId, playerId, source = 'transfer_pick') {
      const state = Hexcore2.state;
      const targetCaptain = state.captains.find(item => item.id === targetCaptainId);
      const player = state.players.find(item => item.id === playerId);
      const ownerId = player && (player.teamId || (state.captains.find(captain => captain.team.includes(player.id)) || {}).id);
      if (!targetCaptain || !player || player.status !== 'drafted' || !ownerId) return null;
      if (ownerId === targetCaptainId) return null;
      if (targetCaptain.team.length >= state.settings.playersPerTeam) return null;

      const sourceCaptain = state.captains.find(item => item.id === ownerId);
      if (!sourceCaptain) return null;

      sourceCaptain.team = sourceCaptain.team.filter(id => id !== player.id);
      targetCaptain.team.push(player.id);
      player.teamId = targetCaptainId;
      Hexcore2.eventStore.append(
        '选手转队',
        `${targetCaptain.name} 通过盲盒选中「${player.name}」，该选手从 ${sourceCaptain.name} 转入当前队伍（${targetCaptain.team.length}/4）`,
        'warn',
        { source, fromCaptainId: sourceCaptain.id }
      );
      return { player, sourceCaptain, targetCaptain };
    },
  };
})(window);
