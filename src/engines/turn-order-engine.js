(function initTurnOrderEngine(global) {
  const Hexcore2 = global.Hexcore2 || (global.Hexcore2 = {});

  function teamIsOpen(captainId) {
    return Hexcore2.selectors.teamSize(captainId) < Hexcore2.state.settings.playersPerTeam;
  }

  function resetTurnState() {
    const state = Hexcore2.state;
    state.draft.selectedSlot = 0;
    state.draft.currentDraw = null;
    state.draft.pickedThisTurn = false;
  }

  Hexcore2.turnOrderEngine = {
    recompute() {
      const state = Hexcore2.state;
      const order = state.draft.baseOrder.filter(teamIsOpen);
      const explanations = new Map(order.map((id, index) => [id, [`基础顺位第 ${index + 1}`]]));

      if (state.draft.round % 2 === 0) {
        order.reverse();
        order.forEach(id => explanations.get(id).push('偶数轮蛇形反转'));
      }

      const priorityEffects = state.draft.runtimeEffects
        .filter(effect => effect.type === 'move_first' && effect.round === state.draft.round)
        .sort((a, b) => b.priority - a.priority);

      priorityEffects.forEach(effect => {
        const index = order.indexOf(effect.captainId);
        if (index >= 0) {
          order.splice(index, 1);
          order.unshift(effect.captainId);
          explanations.get(effect.captainId).push(effect.reason);
        }
      });

      state.draft.currentOrder = order;
      state.draft.explanations = order.map((captainId, index) => ({
        captainId,
        finalPosition: index + 1,
        reasons: explanations.get(captainId) || [],
      }));
      if (state.draft.currentIndex >= state.draft.currentOrder.length) {
        state.draft.currentIndex = Math.max(0, state.draft.currentOrder.length - 1);
      }
      return state.draft.currentOrder;
    },

    advance() {
      const state = Hexcore2.state;
      if (state.draft.phase === 'completed') {
        return { type: 'completed' };
      }

      let nextIndex = state.draft.currentIndex + 1;
      if (nextIndex < state.draft.currentOrder.length) {
        state.draft.currentIndex = nextIndex;
        resetTurnState();
        return { type: 'next_turn' };
      }

      if (state.draft.round >= state.draft.maxRounds) {
        state.draft.phase = 'completed';
        resetTurnState();
        return { type: 'completed' };
      }

      state.draft.round += 1;
      state.draft.phase = 'round_start';
      this.recompute();
      state.draft.currentIndex = 0;
      resetTurnState();

      if (state.draft.currentOrder.length === 0) {
        state.draft.phase = 'completed';
        return { type: 'completed' };
      }

      state.draft.phase = 'captain_action';
      return { type: 'next_round', round: state.draft.round };
    },
  };
})(window);
