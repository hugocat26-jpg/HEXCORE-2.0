(function initIntegrityService(global) {
  const Hexcore2 = global.Hexcore2 || (global.Hexcore2 = {});
  function markPlayerAvailable(player) {
    if (!player) return;
    player.status = 'available';
    delete player.teamId;
    delete player.isCaptain;
    delete player.role;
  }

  function checkState() {
    const issues = [];
    const addIssue = (type, message, level = 'warn') => {
      issues.push({ type, message, level });
    };
    const captainIds = new Set(Hexcore2.state.captains.map(captain => captain.id));
    const assignedPlayers = new Set();
    const captainPlayerIds = new Set();

    Hexcore2.state.captains.forEach(captain => {
      const captainPlayer = Hexcore2.selectors.captainPlayer(captain.id);
      const captainCamp = Hexcore2.selectors.captainCamp(captain.id);
      if (captain.playerId) {
        if (captainPlayerIds.has(captain.playerId)) addIssue('队长冲突', `${captain.name} 的队长选手重复绑定`);
        captainPlayerIds.add(captain.playerId);
        if (!captainPlayer) addIssue('队长冲突', `${captain.name} 队长不在选手库`);
      }
      if (captain.team.length > Hexcore2.selectors.teamMemberCapacity(captain.id)) {
        addIssue('超员', `${captain.name} 队伍人数超过上限`);
      }
      captain.team.forEach(playerId => {
        if (assignedPlayers.has(playerId)) addIssue('重复归属', `选手 ${playerId} 被多个队伍占用`);
        assignedPlayers.add(playerId);
        const player = Hexcore2.state.players.find(item => item.id === playerId);
        if (!player) addIssue('缺失选手', `${captain.name} 包含不存在的选手 ${playerId}`);
        if (player && player.teamId !== captain.id) addIssue('重复归属', `${player.name} 的归属字段与队伍列表不一致`);
        if (player && captainCamp && player.camp !== captainCamp) {
          addIssue('跨阵营', `${captain.name} 包含${Hexcore2.selectors.campLabel(player.camp)}选手 ${player.name}`);
        }
      });
    });

    const seenOrder = new Set();
    Hexcore2.state.draft.baseOrder.forEach(captainId => {
      if (!captainIds.has(captainId)) addIssue('顺位异常', `基础顺位包含不存在队长 ${captainId}`);
      if (seenOrder.has(captainId)) addIssue('顺位异常', `基础顺位重复包含 ${captainId}`);
      seenOrder.add(captainId);
    });

    Hexcore2.state.players.forEach(player => {
      if (player.status === 'drafted' && !player.teamId) addIssue('重复归属', `${player.name} 已入队但缺少队伍归属`);
      if (player.teamId && !captainIds.has(player.teamId)) addIssue('重复归属', `${player.name} 指向不存在的队伍`);
    });

    if (Hexcore2.normalizeState) {
      const expectedState = Hexcore2.normalizeState(JSON.parse(JSON.stringify(Hexcore2.state)));
      const expectedTierById = new Map(expectedState.players.map(player => [player.id, Number(player.tier)]));
      Hexcore2.state.players.forEach(player => {
        if (player.status === 'disabled') return;
        const expectedTier = expectedTierById.get(player.id);
        if (expectedTier && Number(player.tier) !== expectedTier) {
          addIssue('卡池异常', `${player.name} 当前 ${player.tier} 费，应为 ${expectedTier} 费`);
        }
      });
    }

    return {
      ok: issues.length === 0,
      totalIssues: issues.length,
      checkedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
      issues: issues.slice(0, 50),
    };
  }

  function repairState() {
    const firstOwner = new Map();
    Hexcore2.state.captains.forEach(captain => {
      (captain.team || []).forEach(playerId => {
        if (!firstOwner.has(playerId)) firstOwner.set(playerId, captain.id);
      });
    });

    let removedCount = 0;
    let syncedCount = 0;
    Hexcore2.state.captains.forEach(captain => {
      const capacity = Hexcore2.selectors.teamMemberCapacity(captain.id);
      const captainCamp = Hexcore2.selectors.captainCamp(captain.id);
      const kept = [];
      (captain.team || []).forEach(playerId => {
        const player = Hexcore2.state.players.find(item => item.id === playerId);
        const duplicatedElsewhere = firstOwner.get(playerId) !== captain.id;
        const duplicatedInCurrentTeam = kept.includes(playerId);
        const illegalCrossCamp = Boolean(player && captainCamp && player.camp !== captainCamp);
        if (!player || player.status === 'disabled' || duplicatedElsewhere || duplicatedInCurrentTeam || illegalCrossCamp || kept.length >= capacity) {
          removedCount += 1;
          if (player && player.teamId === captain.id && player.status !== 'disabled' && !duplicatedInCurrentTeam) markPlayerAvailable(player);
          return;
        }
        kept.push(playerId);
        if (player.teamId !== captain.id || player.status !== 'drafted') syncedCount += 1;
        player.teamId = captain.id;
        player.status = 'drafted';
      });
      captain.team = kept;
      if (captain.playerId && !Hexcore2.state.players.find(player => player.id === captain.playerId)) captain.playerId = null;
    });

    return { removedCount, syncedCount };
  }

  Hexcore2.integrityService = {
    checkState,
    repairState,
  };
})(window);
