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
      return true;
    },
  };
})(window);
