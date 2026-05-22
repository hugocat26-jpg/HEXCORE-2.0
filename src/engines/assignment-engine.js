(function initAssignmentEngine(global) {
  const Hexcore2 = global.Hexcore2 || (global.Hexcore2 = {});
  const goldAllowedSources = new Set(['gold_shop_purchase', 'final_random_fill', 'steady_reinforce']);

  function captainCamp(captainId) {
    return Hexcore2.selectors.captainCamp ? Hexcore2.selectors.captainCamp(captainId) : '';
  }

  function isCaptainPlayer(playerId) {
    return Hexcore2.selectors.isCaptainPlayer
      ? Hexcore2.selectors.isCaptainPlayer(playerId)
      : Hexcore2.state.captains.some(captain => captain.playerId === playerId);
  }

  function activeEffect(captainId, type) {
    return Hexcore2.state.draft.runtimeEffects.find(effect =>
      effect.type === type && effect.captainId === captainId && !effect.consumed
    );
  }

  function purchasePrice(captainId, player) {
    let price = Math.max(1, Math.min(5, Number(player.tier) || 1));
    const discount = activeEffect(captainId, 'discount_coupon');
    if (discount) {
      price = Math.max(1, price - 1);
      discount.consumed = true;
    }
    const interference = activeEffect(captainId, 'price_interference');
    if (interference) {
      price = Math.min(5, price + 1);
      interference.consumed = true;
    }
    return price;
  }

  function applyBudgetRefund(captain, player) {
    const hasRefund = (Hexcore2.state.hexcoreAssignments[captain.id] || []).some(hex => hex.id === 'budget-refund');
    if (!hasRefund || captain.budgetRefundUsed || Number(player.tier) > 2) return false;
    captain.economy.gold += 1;
    captain.budgetRefundUsed = true;
    Hexcore2.eventStore.append('预算返还', `${captain.name} 购买 ${player.tier}费选手「${player.name}」，返还 1 金币`, 'success');
    return true;
  }

  Hexcore2.assignmentEngine = {
    assign(captainId, playerId, source = 'normal_pick') {
      if (Hexcore2.state.settings.economyMode === 'gold_shop' && !goldAllowedSources.has(source)) {
        Hexcore2.eventStore.append('入队失败', '金币模式下只能通过商店购买或终局随机补位入队', 'warn', { source });
        return false;
      }
      const state = Hexcore2.state;
      const captain = state.captains.find(item => item.id === captainId);
      const player = state.players.find(item => item.id === playerId);
      if (!captain || !player || player.status !== 'available') return false;
      const camp = captainCamp(captainId);
      if (!camp || player.camp !== camp) {
        Hexcore2.eventStore.append('入队失败', `${captain ? captain.name : '目标队伍'} 不能接收异阵营选手「${player ? player.name : playerId}」`, 'warn', { source, playerId });
        return false;
      }
      if (isCaptainPlayer(player.id)) {
        Hexcore2.eventStore.append('入队失败', `「${player.name}」是队长锁定选手，不能作为队员入队`, 'warn', { source, playerId });
        return false;
      }
      const capacity = Hexcore2.selectors.teamMemberCapacity(captainId);
      if (captain.team.length >= capacity) return false;

      captain.team.push(player.id);
      player.status = 'drafted';
      player.teamId = captainId;
      Hexcore2.eventStore.append('选手入队', `${captain.name} 选择了选手「${player.name}」加入队伍（${captain.team.length}/${capacity}）`, 'success', { source });
      if (Hexcore2.hexcoreEngine && source !== 'lock_contract_pair') {
        Hexcore2.hexcoreEngine.resolveLockContracts(captainId, player.id);
      }
      return true;
    },

    purchase(captainId, playerId, source = 'shop_purchase') {
      const state = Hexcore2.state;
      const captain = state.captains.find(item => item.id === captainId);
      const player = state.players.find(item => item.id === playerId);
      if (!captain || !player || player.status !== 'available') return { ok: false, reason: '目标队员不可购买' };
      const camp = captainCamp(captainId);
      if (!camp || player.camp !== camp) {
        Hexcore2.eventStore.append('购买失败', `${captain.name} 不能购买异阵营选手「${player.name}」`, 'warn', { source, playerId });
        return { ok: false, reason: '不能购买异阵营选手' };
      }
      if (isCaptainPlayer(player.id)) return { ok: false, reason: '队长锁定选手不可购买' };
      const price = purchasePrice(captainId, player);
      const economy = Hexcore2.economyEngine.spendForPurchase(captainId, price);
      if (!economy.ok) return economy;
      const assigned = this.assign(captainId, playerId, source);
      if (!assigned) {
        captain.economy.gold += price;
        Hexcore2.economyEngine.roundState(captainId).purchaseUsed = false;
        return { ok: false, reason: '购买失败，队伍容量或选手状态已变化' };
      }
      Hexcore2.eventStore.append(
        '金币购买',
        `${captain.name} 花费 ${price} 金币购买「${player.name}」，剩余 ${captain.economy.gold} 金币`,
        'success',
        { source, price, playerId }
      );
      applyBudgetRefund(captain, player);
      return { ok: true, price, gold: captain.economy.gold };
    },

    assignRandomFromTier(captainId, tier, source = 'auto_assign') {
      const candidates = Hexcore2.selectors.availablePlayers(tier, captainCamp(captainId));
      if (candidates.length === 0) return false;

      const index = Math.floor(Math.random() * candidates.length);
      return this.assign(captainId, candidates[index].id, source);
    },

    assignBlindFromTier(captainId, tier, source = 'blind_auto_assign') {
      return this.assignRandomFromTier(captainId, tier, source);
    },

    assignRandomFromTopScored(captainId, tier, limit = 5, source = 'top_scored_auto_assign') {
      const candidates = Hexcore2.selectors.availablePlayers(tier, captainCamp(captainId))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
      if (candidates.length === 0) return false;

      const index = Math.floor(Math.random() * candidates.length);
      return this.assign(captainId, candidates[index].id, source);
    },

    transferDraftedPlayer(targetCaptainId, playerId, source = 'transfer_pick') {
      if (Hexcore2.state.settings.economyMode === 'gold_shop') {
        Hexcore2.eventStore.append('转队失败', '金币模式禁用转队和补偿回合效果', 'warn', { source });
        return null;
      }
      const state = Hexcore2.state;
      const targetCaptain = state.captains.find(item => item.id === targetCaptainId);
      const player = state.players.find(item => item.id === playerId);
      const ownerId = player && (player.teamId || (state.captains.find(captain => captain.team.includes(player.id)) || {}).id);
      if (!targetCaptain || !player || player.status !== 'drafted' || !ownerId) return null;
      if (ownerId === targetCaptainId) return null;
      const capacity = Hexcore2.selectors.teamMemberCapacity(targetCaptainId);
      if (targetCaptain.team.length >= capacity) return null;

      const sourceCaptain = state.captains.find(item => item.id === ownerId);
      if (!sourceCaptain) return null;

      sourceCaptain.team = sourceCaptain.team.filter(id => id !== player.id);
      targetCaptain.team.push(player.id);
      player.teamId = targetCaptainId;
      Hexcore2.eventStore.append(
        '选手转队',
        `${targetCaptain.name} 通过盲盒选中「${player.name}」，该选手从 ${sourceCaptain.name} 转入当前队伍（${targetCaptain.team.length}/${capacity}）`,
        'warn',
        { source, fromCaptainId: sourceCaptain.id }
      );
      return { player, sourceCaptain, targetCaptain };
    },

    fillIncompleteRosters() {
      const state = Hexcore2.state;
      if (state.draft.finalFillCompleted) return { filled: 0 };
      let filled = 0;
      state.captains.forEach(captain => {
        while (captain.team.length < Hexcore2.selectors.teamMemberCapacity(captain.id)) {
          const camp = captainCamp(captain.id);
          const candidates = state.players.filter(player =>
            player.status === 'available'
            && player.camp === camp
            && player.tier >= 1
            && player.tier <= 5
            && !isCaptainPlayer(player.id)
          );
          if (!candidates.length) break;
          const player = candidates[Math.floor(Math.random() * candidates.length)];
          const assigned = this.assign(captain.id, player.id, 'final_random_fill');
          if (!assigned) break;
          filled += 1;
          Hexcore2.eventStore.append(
            '最终随机补位',
            `${captain.name} 阵容不足，系统从剩余队员中随机补入「${player.name}」（不消耗金币）`,
            'warn',
            { playerId: player.id }
          );
        }
      });
      state.draft.finalFillCompleted = true;
      return { filled };
    },
  };
})(window);
