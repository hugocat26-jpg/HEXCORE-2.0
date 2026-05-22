(function initTurnOrderEngine(global) {
  const Hexcore2 = global.Hexcore2 || (global.Hexcore2 = {});

  function teamIsOpen(captainId) {
    return Hexcore2.selectors.teamSize(captainId) < Hexcore2.selectors.teamMemberCapacity(captainId);
  }

  function isSkippedThisRound(captainId) {
    const state = Hexcore2.state;
    return state.draft.runtimeEffects.some(effect =>
      effect.type === 'skip_round'
      && effect.captainId === captainId
      && effect.round === state.draft.round
    );
  }

  function skippedThisRoundEffect(captainId) {
    const state = Hexcore2.state;
    return state.draft.runtimeEffects.find(effect =>
      effect.type === 'skip_round'
      && effect.captainId === captainId
      && effect.round === state.draft.round
    );
  }

  function resetTurnState() {
    const state = Hexcore2.state;
    state.draft.selectedSlot = 0;
    state.draft.currentDraw = null;
    state.draft.pickedThisTurn = false;
  }

  function hasHexcore(captainId, hexcoreId) {
    return Hexcore2.selectors.isHexcoreEnabled(hexcoreId)
      && (Hexcore2.state.hexcoreAssignments[captainId] || []).some(hexcore => hexcore.id === hexcoreId);
  }

  function applyModifier(order, explanations, modifier) {
    const index = order.indexOf(modifier.captainId);
    if (index < 0) return;

    order.splice(index, 1);
    if (modifier.operation === 'fixed_position') {
      const targetIndex = Math.max(0, Math.min(order.length, (modifier.position || 1) - 1));
      order.splice(targetIndex, 0, modifier.captainId);
    } else if (modifier.operation === 'move_last') {
      order.push(modifier.captainId);
    } else if (modifier.operation === 'move_down_one') {
      const targetIndex = Math.max(0, Math.min(order.length, index + 1));
      order.splice(targetIndex, 0, modifier.captainId);
    } else if (modifier.operation === 'move_up_one') {
      const targetIndex = Math.max(0, index - 1);
      order.splice(targetIndex, 0, modifier.captainId);
    } else {
      order.unshift(modifier.captainId);
    }
    explanations.get(modifier.captainId).push(modifier.reason);
  }

  Hexcore2.turnOrderEngine = {
    recompute() {
      const state = Hexcore2.state;
      const skippedCaptains = state.draft.baseOrder
        .map(captainId => ({ captainId, effect: skippedThisRoundEffect(captainId) }))
        .filter(item => item.effect);
      skippedCaptains.forEach(({ captainId, effect }) => {
        const captain = state.captains.find(item => item.id === captainId);
        if (captain && !effect.announced) {
          Hexcore2.eventStore.append('海克斯自动跳过', `${captain.name} 受海克斯效果影响，跳过第 ${state.draft.round} 轮选人`, 'warn');
          effect.announced = true;
        }
      });

      const order = state.draft.baseOrder.filter(captainId => teamIsOpen(captainId) && !isSkippedThisRound(captainId));
      const explanations = new Map(order.map((id, index) => [id, [`基础顺位第 ${index + 1}`]]));

      if (state.draft.round % 2 === 0) {
        order.reverse();
        order.forEach(id => explanations.get(id).push('偶数轮蛇形反转'));
      }

      const modifiers = [];
      order.forEach(captainId => {
        if (hasHexcore(captainId, 'pandora-box')) {
          modifiers.push({
            captainId,
            operation: 'fixed_position',
            position: 3,
            priority: 700,
            reason: '潘多拉魔盒：全程固定第3顺位',
          });
        }
        if (hasHexcore(captainId, 'last-stand') && state.draft.round === 4) {
          modifiers.push({
            captainId,
            operation: 'move_first',
            priority: 900,
            reason: '背水一战：第4轮优先级最高，获得第1顺位',
          });
        }
        if (!hasHexcore(captainId, 'demon-contract')) return;
        modifiers.push({
          captainId,
          operation: state.draft.round === 4 ? 'move_last' : 'move_first',
          priority: 600,
          reason: state.draft.round === 4
            ? '恶魔契约：第4轮自动变为最后顺位'
            : '恶魔契约：第1-3轮自动获得第1顺位',
        });
      });

      state.draft.runtimeEffects
        .filter(effect => effect.type === 'move_first' && effect.round === state.draft.round)
        .forEach(effect => modifiers.push({
          captainId: effect.captainId,
          operation: 'move_first',
          priority: effect.priority,
          reason: effect.reason,
        }));

      state.draft.runtimeEffects
        .filter(effect => effect.type === 'fixed_position' && effect.round === state.draft.round)
        .forEach(effect => modifiers.push({
          captainId: effect.captainId,
          operation: 'fixed_position',
          position: effect.position,
          priority: effect.priority,
          reason: effect.reason,
        }));

      state.draft.runtimeEffects
        .filter(effect => effect.type === 'move_down_one' && effect.round === state.draft.round)
        .forEach(effect => modifiers.push({
          captainId: effect.captainId,
          operation: 'move_down_one',
          priority: effect.priority,
          reason: effect.reason,
        }));

      state.draft.runtimeEffects
        .filter(effect => effect.type === 'move_up_one' && effect.round === state.draft.round)
        .forEach(effect => modifiers.push({
          captainId: effect.captainId,
          operation: 'move_up_one',
          priority: effect.priority,
          reason: effect.reason,
        }));

      modifiers
        .sort((a, b) => a.priority - b.priority)
        .forEach(modifier => applyModifier(order, explanations, modifier));

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
        if (Hexcore2.assignmentEngine) Hexcore2.assignmentEngine.fillIncompleteRosters();
        return { type: 'completed' };
      }

      state.draft.round += 1;
      state.draft.phase = 'round_start';
      if (Hexcore2.economyEngine) Hexcore2.economyEngine.applyRoundIncome(state.draft.round);
      this.recompute();
      state.draft.currentIndex = 0;
      resetTurnState();

      if (state.draft.currentOrder.length === 0) {
        state.draft.phase = 'completed';
        if (Hexcore2.assignmentEngine) Hexcore2.assignmentEngine.fillIncompleteRosters();
        return { type: 'completed' };
      }

      state.draft.phase = 'captain_action';
      return { type: 'next_round', round: state.draft.round };
    },
  };
})(window);
