(function initPoolEngine(global) {
  const Hexcore2 = global.Hexcore2 || (global.Hexcore2 = {});

  Hexcore2.poolEngine = {
    effectiveTier(captainId) {
      const state = Hexcore2.state;
      const reverseEffect = state.draft.runtimeEffects.find(effect =>
        effect.type === 'reverse_pool_order' && effect.captainId === captainId
      );
      const tier = reverseEffect ? 5 - state.draft.round : state.draft.round;
      return Math.max(1, Math.min(4, tier));
    },
  };
})(window);
