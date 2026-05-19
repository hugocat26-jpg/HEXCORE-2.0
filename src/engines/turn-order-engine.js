(function initTurnOrderEngine(global) {
  const Hexcore2 = global.Hexcore2 || (global.Hexcore2 = {});

  Hexcore2.turnOrderEngine = {
    recompute() {
      const state = Hexcore2.state;
      const order = [...state.draft.baseOrder];
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
      return state.draft.currentOrder;
    },

    advance() {
      const state = Hexcore2.state;
      state.draft.currentIndex = (state.draft.currentIndex + 1) % state.draft.currentOrder.length;
      state.draft.selectedSlot = 0;
      state.draft.currentDraw = null;
      state.draft.pickedThisTurn = false;
    },
  };
})(window);
