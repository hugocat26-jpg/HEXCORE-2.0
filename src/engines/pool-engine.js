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
  };
})(window);
