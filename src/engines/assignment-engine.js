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
  };
})(window);
