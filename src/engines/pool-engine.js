(function initPoolEngine(global) {
  const Hexcore2 = global.Hexcore2 || (global.Hexcore2 = {});

  Hexcore2.poolEngine = {
    effectiveTier(captainId) {
      const state = Hexcore2.state;
      const reverseEffect = state.draft.runtimeEffects.find(effect =>
        effect.type === 'reverse_pool_order' && effect.captainId === captainId
      );
      if (reverseEffect) return 5 - state.draft.round;
      return state.draft.round;
    },
  };
})(window);
