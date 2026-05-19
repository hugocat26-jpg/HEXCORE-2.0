(function initHexcoreEngine(global) {
  const Hexcore2 = global.Hexcore2 || (global.Hexcore2 = {});

  Hexcore2.hexcoreEngine = {
    activate(hexcoreId) {
      const state = Hexcore2.state;
      const captain = Hexcore2.selectors.currentCaptain();
      if (!captain) return false;

      const hexcore = (state.hexcoreAssignments[captain.id] || []).find(item => item.id === hexcoreId);
      if (!hexcore || hexcore.status === 'used') return false;

      if (hexcore.id === 'origin') {
        state.draft.runtimeEffects.push({
          type: 'move_first',
          captainId: captain.id,
          round: state.draft.round,
          priority: 800,
          reason: '启元优先：本轮获得最高可用顺位',
        });
        Hexcore2.turnOrderEngine.recompute();
        state.draft.currentIndex = state.draft.currentOrder.indexOf(captain.id);
      }

      if (hexcore.id === 'blind') {
        const target = this.nextCaptain(captain.id);
        if (target) {
          state.draft.runtimeEffects.push({
            type: 'blind_draw',
            captainId: target.id,
            round: state.draft.round,
            priority: 500,
            reason: `${captain.name} 对 ${target.name} 使用致盲吹箭`,
          });
          Hexcore2.eventStore.append('海克斯激活', `${captain.name} 化身提莫，对 ${target.name} 使用了致盲吹箭`, 'warn');
        }
      }

      if (hexcore.id === 'double-shot') {
        state.draft.runtimeEffects.push({
          type: 'extra_draw',
          captainId: captain.id,
          round: state.draft.round,
          countBonus: 1,
          priority: 500,
          reason: '双发快射：本轮额外抽 1 张',
        });
      }

      hexcore.status = 'used';
      Hexcore2.eventStore.append('海克斯激活', `${captain.name} 使用【${hexcore.name}】`, hexcore.id === 'blind' ? 'warn' : 'info');
      return true;
    },

    isBlinded(captainId) {
      return Hexcore2.state.draft.runtimeEffects.some(effect =>
        effect.type === 'blind_draw' && effect.captainId === captainId && effect.round === Hexcore2.state.draft.round
      );
    },

    extraDrawCount(captainId) {
      return Hexcore2.state.draft.runtimeEffects
        .filter(effect => effect.type === 'extra_draw' && effect.captainId === captainId && effect.round === Hexcore2.state.draft.round)
        .reduce((sum, effect) => sum + (effect.countBonus || 0), 0);
    },

    nextCaptain(captainId) {
      const order = Hexcore2.state.draft.currentOrder;
      const index = order.indexOf(captainId);
      const nextId = order[index + 1];
      return Hexcore2.state.captains.find(captain => captain.id === nextId);
    },
  };
})(window);
