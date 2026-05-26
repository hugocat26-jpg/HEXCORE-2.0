(function initTurnOrderEngine(global) {
  const Hexcore2 = global.Hexcore2 || (global.Hexcore2 = {});

  function teamIsOpen(captainId) {
    return Hexcore2.selectors.teamSize(captainId) < Hexcore2.selectors.teamMemberCapacity(captainId);
  }

  function canUseFullTeamHexcore(captainId, round = Hexcore2.state.draft.round) {
    const captain = Hexcore2.state.captains.find(item => item.id === captainId);
    if (!captain || teamIsOpen(captainId)) return false;
    const lastStand = (Hexcore2.state.hexcoreAssignments[captainId] || []).find(hexcore =>
      hexcore
      && hexcore.id === 'last-stand'
      && hexcore.status !== 'used'
      && Hexcore2.selectors.isHexcoreEnabled('last-stand')
    );
    if (!lastStand || (captain.team || []).length < 4) return false;
    if (
      Hexcore2.hexcoreEngine
      && typeof Hexcore2.hexcoreEngine.lastStandDeclinedThisRound === 'function'
      && Hexcore2.hexcoreEngine.lastStandDeclinedThisRound(captainId, round)
    ) {
      return false;
    }
    if (Hexcore2.hexcoreEngine && typeof Hexcore2.hexcoreEngine.lastStandCandidates === 'function') {
      return Hexcore2.hexcoreEngine.lastStandCandidates(captainId).length >= 4;
    }
    return true;
  }

  function isSkippedThisRound(captainId, round = Hexcore2.state.draft.round) {
    const state = Hexcore2.state;
    return state.draft.runtimeEffects.some(effect =>
      effect.type === 'skip_round'
      && effect.captainId === captainId
      && Number(effect.round) === Number(round)
    );
  }

  function skippedThisRoundEffect(captainId, round = Hexcore2.state.draft.round) {
    const state = Hexcore2.state;
    return state.draft.runtimeEffects.find(effect =>
      effect.type === 'skip_round'
      && effect.captainId === captainId
      && Number(effect.round) === Number(round)
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

  function originSageAlreadyCreated(round) {
    return (Hexcore2.state.draft.runtimeEffects || []).some(effect =>
      effect.type === 'move_first'
      && effect.sourceHexcoreId === 'origin-sage'
      && Number(effect.round) === Number(round)
    );
  }

  function buildOrder(round = Hexcore2.state.draft.round, options = {}) {
    const state = Hexcore2.state;
    const announceSkips = Boolean(options.announceSkips);
    const includeOriginSagePreview = Boolean(options.includeOriginSagePreview);

    if (announceSkips) {
      const skippedCaptains = state.draft.baseOrder
        .map(captainId => ({ captainId, effect: skippedThisRoundEffect(captainId, round) }))
        .filter(item => item.effect);
      skippedCaptains.forEach(({ captainId, effect }) => {
        const captain = state.captains.find(item => item.id === captainId);
        if (captain && !effect.announced) {
          Hexcore2.eventStore.append('海克斯自动跳过', `${captain.name} 受海克斯效果影响，跳过第 ${round} 轮选人`, 'warn');
          effect.announced = true;
        }
      });
    }

    const order = state.draft.baseOrder.filter(captainId =>
      (teamIsOpen(captainId) || canUseFullTeamHexcore(captainId, round))
      && !isSkippedThisRound(captainId, round)
    );
    const explanations = new Map(order.map((id, index) => [id, [`基础顺位第 ${index + 1}`]]));

    if (round % 2 === 0) {
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
      if (!hasHexcore(captainId, 'demon-contract')) return;
      modifiers.push({
        captainId,
        operation: round === 4 ? 'move_last' : 'move_first',
        priority: 600,
        reason: round === 4
          ? '恶魔契约：第4轮自动变为最后顺位'
          : '恶魔契约：第1-3轮自动获得第1顺位',
      });
    });

    if (includeOriginSagePreview && !originSageAlreadyCreated(round)) {
      const candidates = order
        .map(captainId => state.captains.find(captain => captain.id === captainId))
        .filter(captain => {
          if (!captain || !hasHexcore(captain.id, 'origin-sage') || !teamIsOpen(captain.id)) return false;
          const hexcore = (state.hexcoreAssignments[captain.id] || []).find(item => item.id === 'origin-sage');
          const roundState = Hexcore2.economyEngine.roundState(captain.id, round);
          return hexcore
            && Number(hexcore.lastUsedRound) !== Number(round)
            && !roundState.purchaseUsed
            && !roundState.skipped
            && order.indexOf(captain.id) > 0;
        });
      candidates.slice().reverse().forEach((captain, index) => modifiers.push({
        captainId: captain.id,
        operation: 'move_first',
        priority: 540 + index,
        reason: `${captain.name} 的神秘贤者·启元在轮次开始时生效，本轮提到第一顺位，原第一及后续顺延`,
      }));
    }

    state.draft.runtimeEffects
      .filter(effect => effect.type === 'move_first' && Number(effect.round) === Number(round))
      .forEach(effect => modifiers.push({
        captainId: effect.captainId,
        operation: 'move_first',
        priority: effect.priority,
        reason: effect.reason,
      }));

    state.draft.runtimeEffects
      .filter(effect => effect.type === 'fixed_position' && Number(effect.round) === Number(round))
      .forEach(effect => modifiers.push({
        captainId: effect.captainId,
        operation: 'fixed_position',
        position: effect.position,
        priority: effect.priority,
        reason: effect.reason,
      }));

    state.draft.runtimeEffects
      .filter(effect => effect.type === 'move_down_one' && Number(effect.round) === Number(round))
      .forEach(effect => modifiers.push({
        captainId: effect.captainId,
        operation: 'move_down_one',
        priority: effect.priority,
        reason: effect.reason,
      }));

    state.draft.runtimeEffects
      .filter(effect => effect.type === 'move_up_one' && Number(effect.round) === Number(round))
      .forEach(effect => modifiers.push({
        captainId: effect.captainId,
        operation: 'move_up_one',
        priority: effect.priority,
        reason: effect.reason,
      }));

    modifiers
      .sort((a, b) => a.priority - b.priority)
      .forEach(modifier => applyModifier(order, explanations, modifier));

    return {
      order,
      explanations: order.map((captainId, index) => ({
        captainId,
        finalPosition: index + 1,
        reasons: explanations.get(captainId) || [],
      })),
    };
  }

  Hexcore2.turnOrderEngine = {
    preview(round = Hexcore2.state.draft.round, options = {}) {
      return buildOrder(round, { ...options, announceSkips: false });
    },

    recompute() {
      const state = Hexcore2.state;
      const result = buildOrder(state.draft.round, { announceSkips: true });

      state.draft.currentOrder = result.order;
      state.draft.explanations = result.explanations;
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

      if (Hexcore2.hexcoreEngine && typeof Hexcore2.hexcoreEngine.resolveHungryWaveRoundEnd === 'function') {
        const hungryRoundEnd = Hexcore2.hexcoreEngine.resolveHungryWaveRoundEnd(state.draft.round);
        const reveal = hungryRoundEnd
          && Array.isArray(hungryRoundEnd.resolved)
          && hungryRoundEnd.resolved.find(item => item && item.assigned && item.reveal);
        if (reveal && reveal.reveal) {
          state.ui = state.ui || {};
          state.ui.recruitReveal = {
            ...reveal.reveal,
            advanceTurn: false,
            createdAt: Date.now(),
          };
        }
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
