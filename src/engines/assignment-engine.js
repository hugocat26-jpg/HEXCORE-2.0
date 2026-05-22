(function initAssignmentEngine(global) {
  const Hexcore2 = global.Hexcore2 || (global.Hexcore2 = {});
  const goldAllowedSources = new Set(['gold_shop_purchase', 'final_random_fill', 'steady_reinforce', 'decompose_knowledge', 'stuck_together']);

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
    const basePrice = Math.max(1, Number(player.tier) || 1);
    let price = basePrice;
    const appliedEffects = [];
    const discount = activeEffect(captainId, 'discount_coupon');
    if (discount) {
      price = Math.max(1, price - 1);
      appliedEffects.push(discount);
    }
    const interference = activeEffect(captainId, 'price_interference');
    if (interference) {
      price += 1;
      appliedEffects.push(interference);
    }
    const captain = Hexcore2.state.captains.find(item => item.id === captainId);
    const hasGiantSlayer = captain && (Hexcore2.state.hexcoreAssignments[captain.id] || []).some(hex => hex.id === 'giant-slayer');
    const used = captain && captain.giantSlayerDiscountUsed ? captain.giantSlayerDiscountUsed : {};
    if (hasGiantSlayer && (basePrice === 4 || basePrice === 5) && !used[basePrice]) {
      price = Math.max(1, price - 1);
      appliedEffects.push({
        type: 'giant_slayer',
        captainId,
        tier: basePrice,
        reason: `巨人杀手：首次购买${basePrice}费卡优惠1金币`,
      });
    }
    return { price, basePrice, appliedEffects };
  }

  function consumeAppliedEffects(effects, result = {}) {
    effects.forEach(effect => {
      effect.consumed = true;
      effect.appliedRound = Hexcore2.state.draft.round;
      effect.appliedAt = new Date().toISOString();
      Object.assign(effect, result);
    });
  }

  function applySponsorFlow(captain, player, paidPrice) {
    const hasSponsorFlow = (Hexcore2.state.hexcoreAssignments[captain.id] || []).some(hex => hex.id === 'sponsor-flow');
    captain.sponsorFlowUsed = Math.max(0, Number(captain.sponsorFlowUsed) || 0);
    if (!hasSponsorFlow || captain.sponsorFlowUsed >= 2 || Number(paidPrice) < 3) return false;
    captain.economy.gold += 1;
    captain.sponsorFlowUsed += 1;
    Hexcore2.eventStore.append('赞助回流', `${captain.name} 购买「${player.name}」后获得赞助返还 1 金币（${captain.sponsorFlowUsed}/2）`, 'success');
    return true;
  }

  function markSpecialPurchase(captainId, cost) {
    const captain = Hexcore2.state.captains.find(item => item.id === captainId);
    if (!captain) return { ok: false, reason: '当前没有可操作队长' };
    Hexcore2.economyEngine.ensureAll();
    const operate = Hexcore2.economyEngine.canOperate(captainId);
    if (!operate.ok) return { ok: false, reason: operate.reason };
    const finalCost = Math.max(0, Math.round(Number(cost) || 0));
    if (captain.economy.gold < finalCost) {
      return { ok: false, reason: `金币不足，本次选择需要 ${finalCost} 金币` };
    }
    captain.economy.gold -= finalCost;
    Hexcore2.economyEngine.roundState(captainId).purchaseUsed = true;
    return { ok: true, cost: finalCost, gold: captain.economy.gold };
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
      const pricing = purchasePrice(captainId, player);
      const price = pricing.price;
      const economy = Hexcore2.economyEngine.spendForPurchase(captainId, price);
      if (!economy.ok) return economy;
      const assigned = this.assign(captainId, playerId, source);
      if (!assigned) {
        captain.economy.gold += price;
        Hexcore2.economyEngine.roundState(captainId).purchaseUsed = false;
        return { ok: false, reason: '购买失败，队伍容量或选手状态已变化' };
      }
      consumeAppliedEffects(pricing.appliedEffects, { appliedPrice: price, appliedPlayerId: player.id });
      pricing.appliedEffects.forEach(effect => {
        if (effect.type === 'giant_slayer') {
          captain.giantSlayerDiscountUsed = captain.giantSlayerDiscountUsed || {};
          captain.giantSlayerDiscountUsed[effect.tier] = true;
        }
      });
      Hexcore2.eventStore.append(
        '金币购买',
        `${captain.name} 花费 ${price} 金币购买「${player.name}」，剩余 ${captain.economy.gold} 金币`,
        'success',
        { source, price, playerId }
      );
      pricing.appliedEffects.forEach(effect => {
        Hexcore2.eventStore.append(
          '海克斯生效',
          `${captain.name} 购买「${player.name}」时触发：${effect.reason || effect.type}`,
          'warn',
          { source, price, playerId, effectType: effect.type, sourceCaptainId: effect.sourceCaptainId }
        );
      });
      applySponsorFlow(captain, player, price);
      return { ok: true, price, gold: captain.economy.gold, appliedEffects: pricing.appliedEffects.map(effect => ({ ...effect })) };
    },

    purchaseWithOffset(captainId, playerId, offset = 0, source = 'decompose_knowledge') {
      const state = Hexcore2.state;
      const captain = state.captains.find(item => item.id === captainId);
      const player = state.players.find(item => item.id === playerId);
      if (!captain || !player || player.status !== 'available') return { ok: false, reason: '目标队员不可选择' };
      const camp = captainCamp(captainId);
      if (!camp || player.camp !== camp) return { ok: false, reason: '不能选择异阵营选手' };
      if (isCaptainPlayer(player.id)) return { ok: false, reason: '队长锁定选手不可选择' };
      const basePrice = Math.max(1, Number(player.tier) || 1);
      const finalCost = Math.max(0, basePrice - Math.max(0, Math.round(Number(offset) || 0)));
      const paid = markSpecialPurchase(captainId, finalCost);
      if (!paid.ok) return paid;
      const assigned = this.assign(captainId, playerId, source);
      if (!assigned) {
        captain.economy.gold += finalCost;
        Hexcore2.economyEngine.roundState(captainId).purchaseUsed = false;
        return { ok: false, reason: '选择失败，队伍容量或选手状态已变化' };
      }
      Hexcore2.eventStore.append(
        '金币购买',
        `${captain.name} 通过特殊海克斯选择「${player.name}」，原费用 ${basePrice}，抵扣 ${Math.max(0, basePrice - finalCost)}，实付 ${finalCost} 金币`,
        'success',
        { source, price: finalCost, basePrice, offset, playerId }
      );
      return { ok: true, price: finalCost, basePrice, offset, gold: captain.economy.gold };
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
