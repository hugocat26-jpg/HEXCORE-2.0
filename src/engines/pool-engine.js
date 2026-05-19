(function initPoolEngine(global) {
  const Hexcore2 = global.Hexcore2 || (global.Hexcore2 = {});

  function hasHexcore(captainId, hexcoreId) {
    return (Hexcore2.state.hexcoreAssignments[captainId] || []).some(hexcore => hexcore.id === hexcoreId);
  }

  function swappedRound(round) {
    const effect = Hexcore2.state.draft.runtimeEffects.find(item =>
      item.type === 'global_pool_swap' && (item.round === round || item.round + 1 === round)
    );
    if (!effect) return round;
    return effect.round === round ? round + 1 : round - 1;
  }

  Hexcore2.poolEngine = {
    effectiveTier(captainId) {
      const state = Hexcore2.state;
      const baseRound = swappedRound(state.draft.round);
      if (hasHexcore(captainId, 'giant-slayer')) {
        if (baseRound === 1) return 4;
        if (baseRound === 4) return 1;
      }

      const reverseEffect = state.draft.runtimeEffects.find(effect =>
        effect.type === 'reverse_pool_order' && effect.captainId === captainId
      );
      const tier = (reverseEffect || hasHexcore(captainId, 'ballroom-queen'))
        ? 5 - baseRound
        : baseRound;
      return Math.max(1, Math.min(4, tier));
    },

    explain(captainId) {
      const state = Hexcore2.state;
      const roundAfterGlobal = swappedRound(state.draft.round);
      const baseTier = Math.max(1, Math.min(4, roundAfterGlobal));
      const effectiveTier = this.effectiveTier(captainId);
      const reasons = [`基础卡池：第 ${state.draft.round} 轮对应${state.settings.tierNames[Math.max(1, Math.min(4, state.draft.round))]}池`];

      if (roundAfterGlobal !== state.draft.round) {
        reasons.push(`摄影艺术家：本轮与下轮卡池互换，当前按${state.settings.tierNames[baseTier]}池执行`);
      }

      if (hasHexcore(captainId, 'giant-slayer') && baseTier === 1) {
        reasons.push('巨人杀手：侏儒马轮次进入猛犸池');
      }
      if (hasHexcore(captainId, 'giant-slayer') && baseTier === 4) {
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
