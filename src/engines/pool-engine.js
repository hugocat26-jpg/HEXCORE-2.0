(function initPoolEngine(global) {
  const Hexcore2 = global.Hexcore2 || (global.Hexcore2 = {});

  function hasHexcore(captainId, hexcoreId) {
    return (Hexcore2.state.hexcoreAssignments[captainId] || []).some(hexcore => hexcore.id === hexcoreId);
  }

  Hexcore2.poolEngine = {
    effectiveTier(captainId) {
      const state = Hexcore2.state;
      if (hasHexcore(captainId, 'giant-slayer')) {
        if (state.draft.round === 1) return 4;
        if (state.draft.round === 4) return 1;
      }

      const reverseEffect = state.draft.runtimeEffects.find(effect =>
        effect.type === 'reverse_pool_order' && effect.captainId === captainId
      );
      const tier = (reverseEffect || hasHexcore(captainId, 'ballroom-queen'))
        ? 5 - state.draft.round
        : state.draft.round;
      return Math.max(1, Math.min(4, tier));
    },

    explain(captainId) {
      const state = Hexcore2.state;
      const baseTier = Math.max(1, Math.min(4, state.draft.round));
      const effectiveTier = this.effectiveTier(captainId);
      const reasons = [`基础卡池：第 ${state.draft.round} 轮对应${state.settings.tierNames[baseTier]}池`];

      if (hasHexcore(captainId, 'giant-slayer') && state.draft.round === 1) {
        reasons.push('巨人杀手：侏儒马轮次进入猛犸池');
      }
      if (hasHexcore(captainId, 'giant-slayer') && state.draft.round === 4) {
        reasons.push('巨人杀手：猛犸轮次进入侏儒马池');
      }
      if (hasHexcore(captainId, 'ballroom-queen')) {
        reasons.push('舞会女王：个人卡池顺序反转');
      }

      return {
        baseTier,
        effectiveTier,
        reasons,
      };
    },
  };
})(window);
