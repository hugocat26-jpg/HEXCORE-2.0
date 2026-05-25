(function initHexcoreEngine(global) {
  const Hexcore2 = global.Hexcore2 || (global.Hexcore2 = {});
  const CAMP_HEXCORE_IDS = new Set([
    'camp-scout',
    'discount-coupon',
    'reserved-seat',
    'urgent-restock',
    'camp-blockade',
    'price-interference',
    'steady-reinforce',
    'donation',
    'sponsor-flow',
    'hungry-wave',
    'last-stand',
    'open-feast',
    'vampiric-habit',
    'giant-slayer',
    'photographer',
    'wise-benevolence',
    'origin-sage',
    'mystery-box',
    'transmute-gold',
    'transmute-prismatic',
    'decompose-knowledge',
    'stuck-together',
    'storm-fog',
    'snow-cat',
    'charged-cannon',
    'heavenly-descent',
  ]);

  function hasHexcore(captainId, hexcoreId) {
    return Hexcore2.selectors.isHexcoreEnabled(hexcoreId)
      && (Hexcore2.state.hexcoreAssignments[captainId] || []).some(hexcore => hexcore.id === hexcoreId);
  }

  function markUsed(hexcore) {
    if (!hexcore || hexcore.mode === 'passive') return;
    if (hexcore.maxUsesPerRound) {
      hexcore.lastUsedRound = Hexcore2.state.draft.round;
      return;
    }
    hexcore.status = 'used';
  }

  function usedThisRound(hexcore) {
    return Boolean(hexcore && hexcore.maxUsesPerRound && Number(hexcore.lastUsedRound) === Number(Hexcore2.state.draft.round));
  }

  function currentCaptain() {
    return Hexcore2.selectors.currentCaptain();
  }

  function currentRoundState(captainId) {
    return Hexcore2.economyEngine.roundState(captainId, Hexcore2.state.draft.round);
  }

  function captainCamp(captainId) {
    return Hexcore2.selectors.captainCamp ? Hexcore2.selectors.captainCamp(captainId) : '';
  }

  function sameCampCaptains(sourceCaptainId) {
    const camp = captainCamp(sourceCaptainId);
    return Hexcore2.state.captains.filter(captain => captain.id !== sourceCaptainId && captainCamp(captain.id) === camp);
  }

  function isShopOpenFor(captainId) {
    return Boolean(Hexcore2.state.draft.currentDraw && Hexcore2.state.draft.currentDraw.captainId === captainId);
  }

  function hasOpenSlot(captainId) {
    return Hexcore2.selectors.teamSize(captainId) < Hexcore2.selectors.teamMemberCapacity(captainId);
  }

  function hungryWaveForRound(round = Hexcore2.state.draft.round) {
    return (Hexcore2.state.draft.runtimeEffects || []).find(effect =>
      effect.type === 'hungry_wave_round'
      && Number(effect.round) === Number(round)
    );
  }

  function activeHungryWave(round = Hexcore2.state.draft.round) {
    const effect = hungryWaveForRound(round);
    return effect && !effect.consumed ? effect : null;
  }

  function isHungryWaveImmune(captainId, round = Hexcore2.state.draft.round) {
    const effect = hungryWaveForRound(round);
    return Boolean(effect && effect.captainId === captainId && effect.immune);
  }

  function isHungryWaveOrderImmune(captainId, round = Hexcore2.state.draft.round) {
    return hasHexcore(captainId, 'hungry-wave') || isHungryWaveImmune(captainId, round);
  }

  function hungryWaveAlreadyCreated(round = Hexcore2.state.draft.round) {
    return (Hexcore2.state.draft.runtimeEffects || []).find(effect =>
      effect.type === 'hungry_wave_round'
      && Number(effect.round) === Number(round)
    );
  }

  function originSageAlreadyCreated(round = Hexcore2.state.draft.round) {
    return (Hexcore2.state.draft.runtimeEffects || []).some(effect =>
      effect.type === 'move_first'
      && effect.sourceHexcoreId === 'origin-sage'
      && Number(effect.round) === Number(round)
    );
  }

  function hungryWaveEligibleCaptains(round = Hexcore2.state.draft.round) {
    return Hexcore2.state.captains.filter(captain =>
      hasHexcore(captain.id, 'hungry-wave')
      && hasOpenSlot(captain.id)
      && !currentRoundState(captain.id).purchaseUsed
      && !currentRoundState(captain.id).skipped
      && Number(round) === Number(Hexcore2.state.draft.round)
    );
  }

  function remainingHungryWaveCandidates(effect, buyerId) {
    const checked = new Set(effect.checkedCaptainIds || []);
    const order = Hexcore2.state.draft.currentOrder && Hexcore2.state.draft.currentOrder.length
      ? Hexcore2.state.draft.currentOrder
      : Hexcore2.state.draft.baseOrder;
    const currentIndex = Math.max(0, Number(Hexcore2.state.draft.currentIndex) || 0);
    const pending = order.slice(currentIndex)
      .filter(captainId => captainId !== effect.captainId && !checked.has(captainId));
    if (buyerId && !pending.includes(buyerId) && buyerId !== effect.captainId && !checked.has(buyerId)) {
      pending.unshift(buyerId);
    }
    return [...new Set(pending)];
  }

  function restoreCurrentShopCard(playerId) {
    const draw = Hexcore2.state.draft.currentDraw;
    if (!draw || !Array.isArray(draw.cards)) return;
    const card = draw.cards.find(item => item && item.playerId === playerId);
    if (!card) return;
    card.purchased = false;
    delete card.purchasedAt;
    delete card.revealUntil;
    delete card.revealFlipUntil;
    delete card.purchaseRevealReason;
  }

  function returnPurchasedPlayerToPool(buyer, player) {
    buyer.team = (buyer.team || []).filter(id => id !== player.id);
    player.status = 'available';
    delete player.teamId;
    delete player.teamBypassReason;
    restoreCurrentShopCard(player.id);
  }

  function hungryWaveRewardPlayer(captainId, round) {
    const candidatesByTier = new Map();
    for (let tier = 1; tier <= 5; tier += 1) {
      candidatesByTier.set(tier, Hexcore2.selectors.availablePlayers(tier, captainCamp(captainId)));
    }
    const weights = Hexcore2.shopEngine && Hexcore2.shopEngine.probabilityForRound
      ? Hexcore2.shopEngine.probabilityForRound(round)
      : { 1: 100 };
    let entries = [1, 2, 3, 4, 5]
      .map(tier => ({
        tier,
        weight: Math.max(0, Number(weights[tier]) || 0),
        candidates: candidatesByTier.get(tier) || [],
      }))
      .filter(item => item.weight > 0 && item.candidates.length > 0);
    if (!entries.length) {
      entries = [1, 2, 3, 4, 5]
        .map(tier => ({ tier, weight: 1, candidates: candidatesByTier.get(tier) || [] }))
        .filter(item => item.candidates.length > 0);
    }
    if (!entries.length) return null;
    const total = entries.reduce((sum, item) => sum + item.weight, 0);
    let roll = Math.random() * total;
    let selected = entries[entries.length - 1];
    for (const entry of entries) {
      roll -= entry.weight;
      if (roll <= 0) {
        selected = entry;
        break;
      }
    }
    return selected.candidates[Math.floor(Math.random() * selected.candidates.length)] || null;
  }

  function unusedSameCampCaptains(sourceCaptainId) {
    const order = Hexcore2.state.draft.currentOrder || [];
    const currentIndex = Hexcore2.state.draft.currentIndex;
    const pending = new Set(order.slice(currentIndex));
    return sameCampCaptains(sourceCaptainId).filter(captain => pending.has(captain.id));
  }

  function targetableCaptains(sourceCaptainId) {
    const state = Hexcore2.state;
    const order = state.draft.currentOrder || [];
    const currentIndex = state.draft.currentIndex;
    return state.captains.filter(captain => {
      if (captain.id === sourceCaptainId) return false;
      if (isHungryWaveImmune(captain.id)) return false;
      if (Hexcore2.selectors.teamSize(captain.id) >= Hexcore2.selectors.teamMemberCapacity(captain.id)) return false;
      const index = order.indexOf(captain.id);
      if (index >= currentIndex) return true;
      return state.draft.round < state.draft.maxRounds;
    });
  }

  function pushEffect(effect) {
    Hexcore2.state.draft.runtimeEffects.push({
      round: Hexcore2.state.draft.round,
      priority: 500,
      ...effect,
    });
  }

  function captainName(captainId) {
    const captain = Hexcore2.state.captains.find(item => item.id === captainId);
    return captain ? captain.name : '未知队长';
  }

  function effectLabel(effect) {
    const sourceName = effect.sourceCaptainId ? captainName(effect.sourceCaptainId) : '本队';
    const labels = {
      camp_scout: `${sourceName} 的【阵营侦察】：本次商店额外展示 ${Number(effect.countBonus) || 1} 张同阵营卡`,
      discount_coupon: `${sourceName} 的【压价券】：本次购买费用 -1，最低 1 金币`,
      reserved_seat: `${sourceName} 的【保留席位】：本次刷新保留指定卡牌`,
      camp_blockade: `${sourceName} 的【阵营封锁】：本次商店展示数量 -${Number(effect.countPenalty) || 1}`,
      price_interference: `${sourceName} 的【抬价干扰】：下一次购买费用 +1 金币`,
      weather_fog: `${sourceName} 的【骤雨 血雾 清风】：本次商店卡牌信息被天气迷雾隐藏`,
      snow_cat_shuffle: `${sourceName} 的【雪定饿的喵】：本次商店显示信息被打乱`,
      hungry_wave_round: `${sourceName} 的【海浪，我没吃饭】：本轮跳过并等待判定其他队长购买结果`,
      skip_round: `${sourceName} 的【跳过效果】：本轮行动被跳过`,
      move_first: `${sourceName} 的【顺位效果】：本轮顺位前移`,
      fixed_position: `${sourceName} 的【顺位效果】：本轮固定到指定顺位`,
      move_up_one: `${sourceName} 的【顺位效果】：本轮顺位前移 1 位`,
      move_down_one: `${sourceName} 的【顺位效果】：本轮顺位后移 1 位`,
    };
    return labels[effect.type] || (effect.reason || effect.type || '未知效果');
  }

  function effectStatus(effect, status) {
    return {
      type: effect.type,
      status,
      sourceCaptainId: effect.sourceCaptainId || '',
      sourceCaptainName: effect.sourceCaptainId ? captainName(effect.sourceCaptainId) : '',
      label: effectLabel(effect),
      reason: effect.reason || '',
    };
  }

  function clearWeatherFogForCaptain(captainId, round = Hexcore2.state.draft.round, reason = '购买权结束') {
    const cleared = [];
    (Hexcore2.state.draft.runtimeEffects || []).forEach(effect => {
      if (
        effect.type === 'weather_fog'
        && effect.captainId === captainId
        && !effect.consumed
        && (!effect.triggerRound || Number(effect.triggerRound) <= Number(round))
      ) {
        effect.consumed = true;
        effect.consumedRound = round;
        effect.consumedAt = new Date().toISOString();
        effect.consumedReason = reason;
        cleared.push(effect);
      }
    });
    return cleared;
  }

  function activeCardPlayer(card) {
    return card && Hexcore2.state.players.find(player => player.id === card.playerId);
  }

  function refreshSnowCatDisplayForDraw(draw) {
    if (!draw || !Array.isArray(draw.cards)) return;
    const effect = (draw.appliedEffects || []).find(item => item && item.type === 'snow_cat_shuffle');
    if (!effect) return;
    const cards = draw.cards.filter(Boolean);
    if (!cards.length) return;
    if (cards.length === 1) {
      cards[0].displayPlayerId = cards[0].playerId;
      cards[0].snowCatShuffled = true;
      effect.displayOffset = 0;
      effect.affectedSlots = 1;
      return;
    }
    let offset = Math.round(Number(effect.displayOffset) || 1);
    offset = ((offset % cards.length) + cards.length) % cards.length;
    if (offset === 0) offset = 1;
    cards.forEach((card, index) => {
      const displayCard = cards[(index + offset) % cards.length];
      card.displayPlayerId = displayCard.playerId;
      card.snowCatShuffled = true;
    });
    effect.displayOffset = offset;
    effect.affectedSlots = cards.length;
  }

  function logFail(message, payload) {
    Hexcore2.eventStore.append('海克斯执行失败', message, 'warn', payload || {});
    return { ok: false, reason: message };
  }

  function steadyReinforceFloorTier(round = Hexcore2.state.draft.round) {
    const value = Math.max(1, Math.min(4, Math.round(Number(round) || 1)));
    if (value <= 2) return 2;
    if (value === 3) return 3;
    return 4;
  }

  function steadyReinforcePlayer(captainId) {
    const floor = steadyReinforceFloorTier();
    for (let tier = floor; tier <= 5; tier += 1) {
      const candidates = Hexcore2.selectors.availablePlayers(tier, captainCamp(captainId));
      if (candidates.length) return candidates[Math.floor(Math.random() * candidates.length)];
    }
    return null;
  }

  function transmuteTier(hexcoreId) {
    if (hexcoreId === 'transmute-gold') return 4;
    if (hexcoreId === 'transmute-prismatic') return 5;
    return 0;
  }

  function transmuteTargets(captainId, hexcoreId) {
    return transmutePlan(captainId, hexcoreId).targets;
  }

  function transmutePlan(captainId, hexcoreId) {
    const requestedTier = transmuteTier(hexcoreId);
    if (!requestedTier) return { requestedTier: 0, tier: 0, targets: [], downgraded: false };
    const available = Hexcore2.selectors.availableCampPlayers(captainId);
    for (let tier = requestedTier; tier >= 1; tier -= 1) {
      const targets = available.filter(player => Number(player.tier) === tier);
      if (targets.length) {
        return { requestedTier, tier, targets, downgraded: tier < requestedTier };
      }
    }
    return { requestedTier, tier: 0, targets: [], downgraded: false };
  }

  function lastStandCandidates(captainId) {
    const captain = Hexcore2.state.captains.find(item => item.id === captainId);
    const oldTeam = new Set(captain ? captain.team || [] : []);
    const camp = captainCamp(captainId);
    return Hexcore2.state.players.filter(player =>
      player
      && player.camp === camp
      && player.status !== 'disabled'
      && !oldTeam.has(player.id)
      && !Hexcore2.selectors.isCaptainPlayer(player.id)
      && !belongsToHungryWaveTeam(player)
      && (!player.teamId || player.teamId === captainId || captainCamp(player.teamId) === camp)
    );
  }

  function lastStandOwner(player) {
    if (!player || !player.teamId) return null;
    return Hexcore2.state.captains.find(captain => captain.id === player.teamId && (captain.team || []).includes(player.id)) || null;
  }

  function belongsToHungryWaveTeam(player) {
    const owner = lastStandOwner(player);
    return Boolean(owner && hasHexcore(owner.id, 'hungry-wave'));
  }

  function ensureHexcoreEconomy(captain) {
    captain.hexcoreEconomy = captain.hexcoreEconomy || {};
    captain.hexcoreEconomy.decomposeKnowledgeStacks = Math.max(
      0,
      Math.min(3, Math.round(Number(captain.hexcoreEconomy.decomposeKnowledgeStacks) || 0))
    );
    return captain.hexcoreEconomy;
  }

  function decomposeTargets(captainId) {
    const available = Hexcore2.selectors.availableCampPlayers(captainId)
      .sort((a, b) => (Number(b.tier) || 0) - (Number(a.tier) || 0) || (Number(b.score) || 0) - (Number(a.score) || 0));
    const high = available.filter(player => player.tier === 4 || player.tier === 5);
    if (high.length) return high;
    const tier3 = available.filter(player => player.tier === 3);
    if (tier3.length) return tier3;
    return available.filter(player => player.tier === 2);
  }

  function decomposableTeamPlayers(captain) {
    return (captain.team || [])
      .map(playerId => Hexcore2.state.players.find(player => player.id === playerId))
      .filter(player => player && (player.tier === 2 || player.tier === 3));
  }

  function stuckTogetherMaxTier(round = Hexcore2.state.draft.round) {
    const baseTier = Hexcore2.selectors.roundTier
      ? Hexcore2.selectors.roundTier(round)
      : Math.max(1, Math.min(5, Number(round) || 1));
    return Math.max(1, Math.min(5, (Number(baseTier) || 1) + 1));
  }

  function stuckTogetherTargets(captainId, round = Hexcore2.state.draft.round) {
    const camp = captainCamp(captainId);
    const maxTier = stuckTogetherMaxTier(round);
    return Hexcore2.state.players
      .filter(player =>
        player.status === 'available'
        && player.tier >= 1
        && player.tier <= maxTier
        && player.camp === camp
        && !Hexcore2.selectors.isCaptainPlayer(player.id)
      )
      .sort((a, b) => (Number(b.tier) || 0) - (Number(a.tier) || 0) || (Number(b.score) || 0) - (Number(a.score) || 0));
  }

  function pendingStuckTogether(captainId) {
    return (Hexcore2.state.draft.runtimeEffects || []).find(effect =>
      effect.type === 'stuck_together'
      && effect.captainId === captainId
      && !effect.consumed
      && Number(effect.triggerRound) <= Number(Hexcore2.state.draft.round)
    );
  }

  function canReceiveWeatherFog(captain, sourceCaptainId, round) {
    if (!captain || captain.id === sourceCaptainId) return false;
    if (hasHexcore(captain.id, 'hungry-wave')) return false;
    if (Hexcore2.selectors.teamSize(captain.id) >= Hexcore2.selectors.teamMemberCapacity(captain.id)) return false;
    const roundState = Hexcore2.economyEngine.roundState(captain.id, round);
    if (roundState.purchaseUsed || roundState.skipped) return false;
    if ((Hexcore2.state.draft.runtimeEffects || []).some(effect =>
      effect.type === 'skip_round'
      && effect.captainId === captain.id
      && Number(effect.round) === Number(round)
    )) return false;
    if (Number(round) === Number(Hexcore2.state.draft.round) && isHungryWaveImmune(captain.id, round)) return false;
    return true;
  }

  function weatherFogTargetChain(sourceCaptainId, firstTargetId) {
    const state = Hexcore2.state;
    const currentOrder = state.draft.currentOrder && state.draft.currentOrder.length
      ? state.draft.currentOrder
      : state.draft.baseOrder;
    const currentStartIndex = currentOrder.indexOf(firstTargetId);
    if (currentStartIndex < 0 || firstTargetId === sourceCaptainId) return [];
    const result = [];
    const currentIndex = Math.max(0, Number(state.draft.currentIndex) || 0);
    const used = new Set();
    const firstRound = currentStartIndex < currentIndex ? state.draft.round + 1 : state.draft.round;
    const firstCaptain = state.captains.find(item => item.id === firstTargetId);
    if (!canReceiveWeatherFog(firstCaptain, sourceCaptainId, firstRound)) return [];
    const orderForRound = round => {
      if (Number(round) === Number(state.draft.round)) return currentOrder;
      if (Hexcore2.turnOrderEngine && Hexcore2.turnOrderEngine.preview) {
        return Hexcore2.turnOrderEngine.preview(round, { includeOriginSagePreview: true }).order || [];
      }
      return state.draft.baseOrder || currentOrder;
    };
    for (let targetRound = firstRound; targetRound <= state.draft.maxRounds && result.length < 3; targetRound += 1) {
      const order = orderForRound(targetRound);
      let startIndex = 0;
      if (targetRound === firstRound) {
        startIndex = Number(targetRound) === Number(state.draft.round)
          ? currentStartIndex
          : order.indexOf(firstTargetId);
        if (startIndex < 0) return [];
      }
      for (let index = startIndex; index < order.length && result.length < 3; index += 1) {
        const captainId = order[index];
        if (used.has(captainId)) continue;
        const captain = state.captains.find(item => item.id === captainId);
        if (!canReceiveWeatherFog(captain, sourceCaptainId, targetRound)) continue;
        used.add(captainId);
        result.push({ captain, triggerRound: targetRound });
      }
    }
    return result;
  }

  function weatherFogTargets(sourceCaptainId) {
    const state = Hexcore2.state;
    const order = state.draft.currentOrder && state.draft.currentOrder.length
      ? state.draft.currentOrder
      : state.draft.baseOrder;
    return order
      .map(captainId => state.captains.find(captain => captain.id === captainId))
      .filter(captain =>
        captain
        && captain.id !== sourceCaptainId
        && weatherFogTargetChain(sourceCaptainId, captain.id).length > 0
      );
  }

  function openCaptainTargets(sourceCaptainId, includeSelf = false) {
    return Hexcore2.state.captains.filter(captain =>
      (includeSelf || captain.id !== sourceCaptainId)
      && !isHungryWaveImmune(captain.id)
      && Hexcore2.selectors.teamSize(captain.id) < Hexcore2.selectors.teamMemberCapacity(captain.id)
    );
  }

  function cannonTargets(sourceCaptainId) {
    const state = Hexcore2.state;
    const order = state.draft.currentOrder && state.draft.currentOrder.length
      ? state.draft.currentOrder
      : state.draft.baseOrder;
    return order
      .slice(state.draft.currentIndex + 1)
      .map(captainId => state.captains.find(captain => captain.id === captainId))
      .filter(captain =>
        captain
        && captain.id !== sourceCaptainId
        && !isHungryWaveOrderImmune(captain.id)
        && Hexcore2.selectors.teamSize(captain.id) < Hexcore2.selectors.teamMemberCapacity(captain.id)
      );
  }

  function chargedCannonHex(captainId) {
    return (Hexcore2.state.hexcoreAssignments[captainId] || [])
      .find(hexcore => hexcore.id === 'charged-cannon');
  }

  function originSageProtectedCaptainIds(round = Hexcore2.state.draft.round) {
    return new Set((Hexcore2.state.draft.runtimeEffects || [])
      .filter(effect =>
        effect.type === 'move_first'
        && effect.sourceHexcoreId === 'origin-sage'
        && Number(effect.round) === Number(round)
      )
      .map(effect => effect.captainId));
  }

  function originSagePriorityCaptainIds(round = Hexcore2.state.draft.round) {
    const ids = originSageProtectedCaptainIds(round);
    Hexcore2.state.captains.forEach(captain => {
      if (hasHexcore(captain.id, 'origin-sage')) ids.add(captain.id);
    });
    return ids;
  }

  function applyChargedCannonOrderMove(order, captainId, operation, position = 1) {
    const index = order.indexOf(captainId);
    if (index < 0) return order;
    const nextOrder = [...order];
    const [item] = nextOrder.splice(index, 1);
    if (operation === 'fixed_position') {
      nextOrder.splice(Math.max(0, Math.min(nextOrder.length, Number(position) - 1 || 0)), 0, item);
    } else if (operation === 'move_down_one') {
      nextOrder.splice(Math.max(0, Math.min(nextOrder.length, index + 1)), 0, item);
    } else if (operation === 'move_up_one') {
      nextOrder.splice(Math.max(0, index - 1), 0, item);
    } else {
      nextOrder.unshift(item);
    }
    return nextOrder;
  }

  function chargedCannonOrder(round = Hexcore2.state.draft.round) {
    const state = Hexcore2.state;
    const captainIds = new Set(state.captains.map(captain => captain.id));
    const seen = new Set();
    let order = (state.draft.baseOrder || [])
      .filter(captainId => captainIds.has(captainId) && !seen.has(captainId) && seen.add(captainId));
    state.captains.forEach(captain => {
      if (!seen.has(captain.id)) {
        seen.add(captain.id);
        order.push(captain.id);
      }
    });
    if (Number(round) % 2 === 0) order = [...order].reverse();

    (state.draft.runtimeEffects || [])
      .filter(effect => Number(effect.round) === Number(round))
      .filter(effect => ['move_first', 'fixed_position', 'move_down_one', 'move_up_one'].includes(effect.type))
      .sort((a, b) => (Number(a.priority) || 0) - (Number(b.priority) || 0))
      .forEach(effect => {
        order = applyChargedCannonOrderMove(order, effect.captainId, effect.type, effect.position);
      });
    return order;
  }

  function chargedCannonPendingOwners(round = Hexcore2.state.draft.round) {
    const state = Hexcore2.state;
    const order = state.draft.currentOrder && state.draft.currentOrder.length
      ? state.draft.currentOrder
      : state.draft.baseOrder;
    return order
      .map(captainId => state.captains.find(captain => captain.id === captainId))
      .filter(captain => {
        if (!captain || !hasHexcore(captain.id, 'charged-cannon') || !hasOpenSlot(captain.id)) return false;
        if (!Hexcore2.selectors.isHexcoreEnabled('charged-cannon')) return false;
        const hexcore = chargedCannonHex(captain.id);
        return hexcore && !usedThisRound(hexcore) && Number(round) === Number(state.draft.round);
      });
  }

  function chargedCannonBoostPreview(captainId) {
    const order = chargedCannonOrder();
    const index = order.indexOf(captainId);
    const protectedIds = originSagePriorityCaptainIds();
    const minIndex = protectedIds.has(order[0]) ? 1 : 0;
    if (index < 0) return { canBoost: false, beforeOrder: order, afterOrder: order, reason: '当前顺位中找不到该队长' };
    if (index <= minIndex) {
      return {
        canBoost: false,
        beforeOrder: order,
        afterOrder: order,
        reason: minIndex === 1 ? '神秘贤者·启元占据第一顺位，当前已无法继续前移' : '当前已经是本轮最前顺位',
      };
    }
    const afterOrder = [...order];
    const [item] = afterOrder.splice(index, 1);
    afterOrder.splice(Math.max(minIndex, index - 1), 0, item);
    return { canBoost: true, beforeOrder: order, afterOrder, fromIndex: index, toIndex: Math.max(minIndex, index - 1), reason: '加速之门可让自己前移1位' };
  }

  function chargedCannonDelayTargets(sourceCaptainId) {
    const state = Hexcore2.state;
    const order = chargedCannonOrder();
    const protectedIds = originSagePriorityCaptainIds();
    return order
      .map((captainId, index) => ({ captain: state.captains.find(item => item.id === captainId), index }))
      .filter(({ captain, index }) =>
        captain
        && captain.id !== sourceCaptainId
        && index < order.length - 1
        && !protectedIds.has(captain.id)
        && !isHungryWaveOrderImmune(captain.id)
      )
      .map(item => item.captain);
  }

  function activateChargedCannonBoost(captainId) {
    const state = Hexcore2.state;
    const captain = state.captains.find(item => item.id === captainId);
    const hexcore = captain && chargedCannonHex(captain.id);
    if (!captain || !hexcore) return logFail('请选择持有大炮已充能的队长');
    if (!Hexcore2.selectors.isHexcoreEnabled('charged-cannon')) return logFail('大炮已充能已被规则设置禁用');
    if (usedThisRound(hexcore)) return logFail('大炮已充能本轮已经处理过');
    if (state.draft.currentDraw) return logFail('大炮已充能只能在轮次开始、商店打开前使用');
    const preview = chargedCannonBoostPreview(captain.id);
    if (!preview.canBoost) return logFail(preview.reason || '当前无法使用加速之门');
    pushEffect({
      type: 'move_up_one',
      captainId: captain.id,
      sourceCaptainId: captain.id,
      sourceHexcoreId: 'charged-cannon',
      priority: 520,
      reason: `${captain.name} 使用大炮已充能：加速之门，本轮顺位前移1位`,
    });
    markUsed(hexcore);
    if (Hexcore2.turnOrderEngine) {
      Hexcore2.turnOrderEngine.recompute();
      state.draft.currentIndex = 0;
    }
    Hexcore2.eventStore.append('大炮已充能', `${captain.name} 使用加速之门，本轮顺位前移1位`, 'warn');
    return { ok: true, beforeOrder: preview.beforeOrder, afterOrder: state.draft.currentOrder };
  }

  function activateChargedCannonDelay(captainId, targetCaptainId) {
    const state = Hexcore2.state;
    const captain = state.captains.find(item => item.id === captainId);
    const hexcore = captain && chargedCannonHex(captain.id);
    if (!captain || !hexcore) return logFail('请选择持有大炮已充能的队长');
    if (!Hexcore2.selectors.isHexcoreEnabled('charged-cannon')) return logFail('大炮已充能已被规则设置禁用');
    if (usedThisRound(hexcore)) return logFail('大炮已充能本轮已经处理过');
    if (state.draft.currentDraw) return logFail('大炮已充能只能在轮次开始、商店打开前使用');
    const target = chargedCannonDelayTargets(captain.id).find(item => item.id === targetCaptainId);
    if (!target) return logFail('雷霆一击需要选择非自己、非启元保护、非海浪免疫且非最后顺位的队长');
    pushEffect({
      type: 'move_down_one',
      captainId: target.id,
      sourceCaptainId: captain.id,
      sourceHexcoreId: 'charged-cannon',
      priority: 520,
      reason: `${captain.name} 使用大炮已充能：雷霆一击，${target.name} 本轮顺位延后一位`,
    });
    markUsed(hexcore);
    if (Hexcore2.turnOrderEngine) {
      Hexcore2.turnOrderEngine.recompute();
      state.draft.currentIndex = 0;
    }
    Hexcore2.eventStore.append('大炮已充能', `${captain.name} 对 ${target.name} 使用雷霆一击，目标本轮顺位延后一位`, 'warn');
    return { ok: true, targetCaptainId: target.id };
  }

  function skipChargedCannon(captainId) {
    const captain = Hexcore2.state.captains.find(item => item.id === captainId);
    const hexcore = captain && chargedCannonHex(captain.id);
    if (!captain || !hexcore) return { ok: false, reason: '请选择持有大炮已充能的队长' };
    if (usedThisRound(hexcore)) return { ok: false, reason: '本轮已经处理过' };
    markUsed(hexcore);
    Hexcore2.eventStore.append('大炮已充能', `${captain.name} 本轮不使用大炮已充能`, 'info');
    return { ok: true };
  }

  function originSageOrderState(captainId) {
    const state = Hexcore2.state;
    const order = state.draft.currentOrder || [];
    const currentIndex = Number(state.draft.currentIndex) || 0;
    const index = order.indexOf(captainId);
    return {
      index,
      currentIndex,
      isCurrentOrPending: index >= currentIndex,
      isFirst: index === 0,
    };
  }

  Hexcore2.hexcoreEngine = {
    hasHexcore,

    isDisabledInGoldMode(hexcoreId) {
      return !CAMP_HEXCORE_IDS.has(hexcoreId);
    },

    isDisabledByPandora() {
      return false;
    },

    executionQueue(captainId) {
      const state = Hexcore2.state;
      const captain = Hexcore2.state.captains.find(item => item.id === captainId) || currentCaptain();
      if (!captain) return [];
      const roundState = currentRoundState(captain.id);
      const shopOpen = isShopOpenFor(captain.id);
      const remainingSlots = Hexcore2.selectors.teamMemberCapacity(captain.id) - Hexcore2.selectors.teamSize(captain.id);
      const hexcores = Hexcore2.state.hexcoreAssignments[captain.id] || [];
      const blocked = (base, status, reason) => ({ ...base, type: 'blocked', status, reason, executable: false });
      const active = (base, status, reason, extra = {}) => ({ ...base, type: 'active', status, reason, executable: true, ...extra });
      const passive = (base, status, reason) => ({ ...base, type: 'passive', status, reason, executable: false });
      const target = (base, status, reason, extra = {}) => ({ ...base, type: 'target', status, reason, executable: true, needsTarget: true, ...extra });
      const labels = {
        'camp-scout': '开店强化',
        'discount-coupon': '购买减费',
        'reserved-seat': '保留卡牌',
        'urgent-restock': '替换卡牌',
        'camp-blockade': '商店干扰',
        'price-interference': '费用干扰',
        'steady-reinforce': '稳健补强',
        donation: '初始经济',
        'sponsor-flow': '被动返还',
        'hungry-wave': '饥饿夺取',
        'last-stand': '整队置换',
        'open-feast': '轮次经济',
        'vampiric-habit': '经济干扰',
        'giant-slayer': '高费优惠',
        photographer: '免费刷新',
        'wise-benevolence': '经济刷新',
        'origin-sage': '提到首位',
        'mystery-box': '随机盲抽',
        'transmute-gold': '免费质变',
        'transmute-prismatic': '免费质变',
        'decompose-knowledge': '自选分解',
        'stuck-together': '延迟锁定',
        'storm-fog': '天气迷雾',
        'snow-cat': '信息扰乱',
        'charged-cannon': '转换顺位',
        'heavenly-descent': '响应窗口',
      };

      return hexcores.map((hex, index) => {
        const base = {
          id: hex.id,
          name: hex.name,
          captainId: captain.id,
          captainName: captain.name,
          priority: index + 1,
          mode: hex.mode,
          category: hex.category || 'shop_control',
          tags: Array.isArray(hex.tags) ? [...hex.tags] : [],
          needsTarget: false,
          executable: false,
          actionLabel: labels[hex.id] || '裁判执行',
          actionType: labels[hex.id] || '裁判执行',
          timingLabel: hex.mode === 'passive' ? '自动触发' : (hex.needsTarget ? '目标选择' : (hex.maxUsesPerRound ? '每轮一次' : '裁判手动')),
        };
        if (!Hexcore2.selectors.isHexcoreEnabled(hex.id)) return blocked(base, '已禁用', '规则设置已禁用该海克斯。');
        if (!CAMP_HEXCORE_IDS.has(hex.id)) return blocked(base, '旧海克斯禁用', '阵营锁定模式不执行旧海克斯。');
        if (hex.mode === 'passive') return passive(base, '被动待机', hex.desc || '被动效果自动生效。');
        if (usedThisRound(hex)) return blocked(base, '本轮已使用', '该海克斯每轮最多使用1次。');
        if (hex.status === 'used') return { ...base, type: 'used', status: '已使用', reason: '该海克斯次数已消耗。', executable: false };
        if (remainingSlots <= 0 && !['camp-blockade', 'price-interference', 'vampiric-habit', 'charged-cannon', 'storm-fog', 'origin-sage', 'last-stand'].includes(hex.id)) return blocked(base, '队伍已满', '队伍已满员，不能再执行选人相关海克斯。');
        if (hex.id === 'camp-scout') {
          if (shopOpen) return blocked(base, '商店已打开', '该海克斯必须在开店前使用。');
          return active(base, '可执行', '下一次商店额外展示1张同阵营可抽卡。');
        }
        if (['discount-coupon', 'reserved-seat', 'urgent-restock'].includes(hex.id)) {
          if (!shopOpen || roundState.purchaseUsed) return blocked(base, '无可处理商店', '该海克斯必须在当前商店打开且购买前使用。');
          return hex.id === 'discount-coupon'
            ? active(base, '可执行', '本次购买费用-1，最低1金币。')
            : target(base, '需选择卡牌', '请选择当前商店中的1张卡。');
        }
        if (['camp-blockade', 'price-interference'].includes(hex.id)) {
          const targets = targetableCaptains(captain.id);
          return targets.length
            ? target(base, '需选择队长', `当前可选择 ${targets.length} 名队长；若目标本轮已行动，则下轮生效。`, { targetCount: targets.length })
            : blocked(base, '无可用目标', '没有满足条件的目标队长。');
        }
        if (hex.id === 'steady-reinforce') {
          const floor = steadyReinforceFloorTier();
          return steadyReinforcePlayer(captain.id)
            ? active(base, '可执行', `系统将从同阵营${floor}费及以上的最低可用费用池随机分配1人。`)
            : blocked(base, '无可抽选手', `同阵营没有${floor}费及以上可抽选手。`);
        }
        if (hex.id === 'vampiric-habit') {
          return Hexcore2.state.captains.some(item => item.id !== captain.id && item.economy && Number(item.economy.gold) > 0)
            ? active(base, '可执行', '从金币最高的三名其他队长处每人获得1金币。')
            : blocked(base, '无可吸取目标', '其他队长当前没有可吸取金币。');
        }
        if (hex.id === 'last-stand') {
          const candidates = lastStandCandidates(captain.id);
          const draftedCandidates = candidates.filter(player => lastStandOwner(player) && lastStandOwner(player).id !== captain.id);
          if ((captain.team || []).length < 4) return blocked(base, '队伍未满', '背水一战需要当前已有4名队员作为置换筹码。');
          if (roundState.purchaseUsed || roundState.skipped) return blocked(base, '购买权已使用', '背水一战会消耗本轮购买权，购买或跳过后不能发动。');
          return candidates.length >= 4
            ? active(base, '可弹窗确认', `本阵营候选 ${candidates.length} 人，其中已在别队 ${draftedCandidates.length} 人；确认后随机替换当前4名队员。`)
            : blocked(base, '候选不足', `本阵营可置换候选不足4人，当前 ${candidates.length} 人。`);
        }
        if (hex.id === 'origin-sage') {
          return passive(base, '轮次开始自动', '每轮开始自动提到第一顺位；无需裁判手动执行。');
        }
        if (hex.id === 'mystery-box') {
          const targets = Hexcore2.selectors.availableCampPlayers(captain.id)
            .filter(player => player.tier >= 2 && player.tier <= 5);
          if (shopOpen) return blocked(base, '商店已打开', '盲盒需在本轮商店打开前使用。');
          if (roundState.purchaseUsed || roundState.skipped) return blocked(base, '购买权已使用', '盲盒会消耗本轮购买权。');
          if (!targets.length) return blocked(base, '无可抽目标', '同阵营没有2-5费可选选手。');
          if (!captain.economy || Number(captain.economy.gold) < 3) return blocked(base, '金币不足', '神秘贤者·盲盒需要支付3金币。');
          return active(base, '可执行', `支付3金币，从 ${targets.length} 名同阵营2-5费可选选手中随机盲抽1人。`);
        }
        if (hex.id === 'transmute-gold' || hex.id === 'transmute-prismatic') {
          const plan = transmutePlan(captain.id, hex.id);
          if (shopOpen) return blocked(base, '商店已打开', '质变必须在本轮商店打开前使用。');
          if (roundState.purchaseUsed || roundState.skipped) return blocked(base, '购买权已使用', '质变会消耗本轮购买权。');
          if (!plan.targets.length) return blocked(base, '目标池为空', `同阵营${plan.requestedTier}费及以下卡池均无可选选手，质变无法发动。`);
          return active(
            base,
            '可执行',
            `${plan.downgraded ? `原${plan.requestedTier}费池为空，降级` : '免费'}从同阵营${plan.tier}费可选池随机获得1人，并消耗本轮购买权。`
          );
        }
        if (hex.id === 'decompose-knowledge') {
          const hexcoreEconomy = ensureHexcoreEconomy(captain);
          const targets = decomposeTargets(captain.id);
          if (hexcoreEconomy.decomposeKnowledgeStacks < 3) {
            return blocked(base, '解构不足', `当前 ${hexcoreEconomy.decomposeKnowledgeStacks}/3 层；每次轮到该队长选人开始时自动 +1。`);
          }
          if (!targets.length) return blocked(base, '无可选目标', '同阵营没有4/5费可选选手，顺延到3/2费后仍无目标。');
          return target(base, '需选择选手', `消耗3层解构，自选 ${targets[0].tier >= 4 ? '4/5费' : `${targets[0].tier}费顺延`} 可选选手；金币不足时可分解队内2/3费队员抵扣。`, { targetCount: targets.length });
        }
        if (hex.id === 'stuck-together') {
          if (state.draft.round >= state.draft.maxRounds) return blocked(base, '无后续轮次', '该海克斯需要等到你的下一轮选人开始时结算。');
          const maxTier = stuckTogetherMaxTier(state.draft.round);
          const targets = stuckTogetherTargets(captain.id, state.draft.round);
          return targets.length
            ? target(base, '需选择选手', `从本阵营全池选择1名${maxTier}费及以下、未被选走的选手；若到第 ${state.draft.round + 1} 轮仍未被买走，将直接入队。`, { targetCount: targets.length, maxTier })
            : blocked(base, '无可锁定目标', `当前没有${maxTier}费及以下、可锁定的本阵营未入队选手。`);
        }
        if (hex.id === 'storm-fog') {
          const targets = weatherFogTargets(captain.id);
          return targets.length
            ? target(base, '需选择队长', '选择1名队长作为起点，按顺位环形向后影响最多3名仍有购买权且未满员的非使用者队长；刷新不会清除血雾。', { targetCount: targets.length })
            : blocked(base, '无可用目标', '当前和下一轮没有可影响的非使用者队长。');
        }
        if (hex.id === 'snow-cat') {
          const targets = openCaptainTargets(captain.id, false);
          return targets.length
            ? target(base, '需选择队长', `可影响 ${targets.length} 名未满员队长的下一次商店，显示身份和费用会被打乱。`, { targetCount: targets.length })
            : blocked(base, '无可用目标', '当前没有未满员队长可被影响。');
        }
        if (hex.id === 'charged-cannon') {
          return passive(base, '轮初决策', '只在每轮开始前弹窗询问；加速之门和雷霆一击本轮二选一。');
        }
        if (hex.id === 'heavenly-descent') {
          return passive(base, '等待窗口', '任意队长确认购买后的10秒内，页面顶部会出现神兵天降发动入口。');
        }
        return active(base, '可执行', '当前条件满足。');
      });
    },

    activate(hexcoreId, options = {}) {
      const state = Hexcore2.state;
      const captain = currentCaptain();
      if (!captain) return logFail('当前没有可操作队长');
      const hexcore = (state.hexcoreAssignments[captain.id] || []).find(item => item.id === hexcoreId);
      if (!hexcore || hexcore.mode === 'passive') return logFail('请选择可手动执行的新海克斯');
      if (!CAMP_HEXCORE_IDS.has(hexcore.id)) return logFail('阵营锁定模式不执行旧海克斯');
      if (hexcore.status === 'used') return logFail(`【${hexcore.name}】已经使用过`);
      if (usedThisRound(hexcore)) return logFail(`【${hexcore.name}】本轮已经使用过`);
      if (!Hexcore2.selectors.isHexcoreEnabled(hexcore.id)) return logFail(`【${hexcore.name}】已被规则设置禁用`);
      if (hexcore.id === 'heavenly-descent') return logFail('神兵天降需在购买成功后的顶部10秒发动窗口中使用');
      if (hexcore.id === 'charged-cannon') return logFail('大炮已充能只能在轮次开始前的转换技弹窗中使用');

      if (hexcore.id === 'camp-scout') {
        if (isShopOpenFor(captain.id)) return logFail('阵营侦察必须在开店前使用');
        pushEffect({ type: 'camp_scout', captainId: captain.id, countBonus: 1, reason: `${captain.name} 使用阵营侦察` });
      }

      if (hexcore.id === 'discount-coupon') {
        if (!isShopOpenFor(captain.id)) return logFail('压价券必须在商店打开后使用');
        pushEffect({ type: 'discount_coupon', captainId: captain.id, reason: `${captain.name} 使用压价券` });
      }

      if (hexcore.id === 'reserved-seat') {
        const draw = state.draft.currentDraw;
        if (!draw || draw.captainId !== captain.id) return logFail('保留席位必须在当前商店打开后使用');
        const card = draw.cards[Number(options.shopCardIndex)] || draw.cards.find(item => item.playerId === options.targetPlayerId) || draw.cards[state.draft.selectedSlot];
        const player = activeCardPlayer(card);
        if (!player || player.camp !== captainCamp(captain.id)) return logFail('请选择当前商店中的同阵营卡牌');
        pushEffect({ type: 'reserved_seat', captainId: captain.id, playerId: player.id, reason: `${captain.name} 保留 ${player.name}` });
      }

      if (hexcore.id === 'urgent-restock') {
        const draw = state.draft.currentDraw;
        if (!draw || draw.captainId !== captain.id) return logFail('加急调货必须在当前商店打开后使用');
        const cardIndex = Number.isInteger(Number(options.shopCardIndex)) ? Number(options.shopCardIndex) : state.draft.selectedSlot;
        const card = draw.cards[cardIndex];
        const player = activeCardPlayer(card);
        if (!player) return logFail('请选择当前商店中的卡牌');
        const shown = new Set(draw.cards.map(item => item.playerId));
        const candidates = Hexcore2.selectors.availableCampPlayers(captain.id, shown)
          .filter(item => item.tier === player.tier);
        if (!candidates.length) return logFail('没有同阵营同费用的替换目标');
        const replacement = candidates[Math.floor(Math.random() * candidates.length)];
        draw.cards[cardIndex] = { ...card, playerId: replacement.id, tier: replacement.tier, price: replacement.tier, camp: replacement.camp };
        refreshSnowCatDisplayForDraw(draw);
      }

      if (hexcore.id === 'camp-blockade') {
        const target = targetableCaptains(captain.id).find(item => item.id === options.targetCaptainId);
        if (!target) return logFail('阵营封锁需要选择一名仍有生效窗口的队长');
        pushEffect({ type: 'camp_blockade', sourceCaptainId: captain.id, captainId: target.id, countPenalty: 1, reason: `${captain.name} 对 ${target.name} 使用阵营封锁，目标下次商店少展示 1 张卡` });
      }

      if (hexcore.id === 'price-interference') {
        const target = targetableCaptains(captain.id).find(item => item.id === options.targetCaptainId);
        if (!target) return logFail('抬价干扰需要选择一名仍有生效窗口的队长');
        pushEffect({ type: 'price_interference', sourceCaptainId: captain.id, captainId: target.id, reason: `${captain.name} 对 ${target.name} 使用抬价干扰，目标下次购买费用 +1 金币` });
      }

      if (hexcore.id === 'steady-reinforce') {
        const roundState = currentRoundState(captain.id);
        if (roundState.purchaseUsed || roundState.skipped) return logFail('本轮购买权已使用或已跳过');
        const floor = steadyReinforceFloorTier();
        const player = steadyReinforcePlayer(captain.id);
        if (!player) return logFail(`同阵营没有${floor}费及以上可抽选手`);
        const assigned = Hexcore2.assignmentEngine.assign(captain.id, player.id, 'steady_reinforce');
        if (!assigned) return logFail('稳健补强分配失败');
        roundState.purchaseUsed = true;
        state.draft.pickedThisTurn = true;
        state.draft.currentDraw = null;
        Hexcore2.eventStore.append('稳健补强', `${captain.name} 从${floor}费及以上最低可用池获得「${player.name}」`, 'success');
        markUsed(hexcore);
        return {
          ok: true,
          advanceTurn: true,
          reveal: {
            title: '稳健补强入队揭示',
            source: hexcore.name,
            captainId: captain.id,
            playerIds: [player.id],
            summary: `${captain.name} 从${floor}费及以上最低可用池获得队员`,
            detail: '该海克斯已消耗本轮购买权，确认后进入下一位队长。',
          },
        };
      }

      if (hexcore.id === 'vampiric-habit') {
        const targets = [...state.captains]
          .filter(item => item.id !== captain.id && item.economy && Number(item.economy.gold) > 0)
          .sort((a, b) => Number(b.economy.gold) - Number(a.economy.gold))
          .slice(0, 3);
        if (!targets.length) return logFail('当前没有可吸取金币的队长');
        const drained = targets.map(target => ({
          captainId: target.id,
          captainName: target.name,
          beforeGold: Number(target.economy.gold) || 0,
          amount: 1,
        }));
        targets.forEach(target => {
          target.economy.gold -= 1;
          captain.economy.gold += 1;
        });
        Hexcore2.eventStore.append('吸血习性', `${captain.name} 从 ${targets.map(item => item.name).join('、')} 处共获得 ${targets.length} 金币`, 'warn');
        markUsed(hexcore);
        Hexcore2.eventStore.append('海克斯激活', `${captain.name} 使用【${hexcore.name}】`, 'info');
        return {
          ok: true,
          economyReveal: {
            title: '吸血习性结算',
            source: hexcore.name,
            captainId: captain.id,
            total: drained.reduce((sum, item) => sum + item.amount, 0),
            rows: drained.map(item => ({
              captainId: item.captainId,
              name: item.captainName,
              amount: item.amount,
              beforeGold: item.beforeGold,
              afterGold: Math.max(0, item.beforeGold - item.amount),
            })),
            summary: `${captain.name} 从 ${targets.map(item => item.name).join('、')} 处获得金币`,
            detail: `共获得 ${targets.length} 金币，已实时加入当前队长资金。`,
          },
        };
      }

      if (hexcore.id === 'last-stand') {
        const oldTeamIds = [...(captain.team || [])];
        if (oldTeamIds.length < 4) return logFail('背水一战需要当前已有4名队员');
        const roundState = currentRoundState(captain.id);
        if (roundState.purchaseUsed || roundState.skipped) return logFail('本轮购买权已使用或已跳过，不能发动背水一战');
        const candidates = lastStandCandidates(captain.id);
        if (candidates.length < 4) return logFail(`本阵营可置换候选不足4人，当前 ${candidates.length} 人`);
        const picked = [...candidates].sort(() => Math.random() - 0.5).slice(0, 4);
        const oldPlayers = oldTeamIds
          .map(playerId => state.players.find(player => player.id === playerId))
          .filter(Boolean)
          .sort(() => Math.random() - 0.5);
        const compensationQueue = [...oldPlayers];
        const transfers = [];

        oldPlayers.forEach(player => {
          player.status = 'available';
          delete player.teamId;
        });
        captain.team = [];

        picked.forEach(player => {
          const previousOwner = lastStandOwner(player);
          if (previousOwner) {
            previousOwner.team = previousOwner.team.filter(playerId => playerId !== player.id);
            const compensation = compensationQueue.shift();
            if (compensation) {
              previousOwner.team.push(compensation.id);
              compensation.status = 'drafted';
              compensation.teamId = previousOwner.id;
              transfers.push(`${previousOwner.name} 失去「${player.name}」，获得补偿「${compensation.name}」`);
            } else {
              transfers.push(`${previousOwner.name} 失去「${player.name}」，无可用补偿`);
            }
          }
          captain.team.push(player.id);
          player.status = 'drafted';
          player.teamId = captain.id;
        });

        compensationQueue.forEach(player => {
          player.status = 'available';
          delete player.teamId;
        });
        currentRoundState(captain.id).purchaseUsed = true;
        state.draft.currentDraw = null;
        state.draft.pickedThisTurn = true;
        Hexcore2.eventStore.append(
          '背水一战',
          `${captain.name} 放弃原4名队员，随机换入 ${picked.map(player => `「${player.name}」`).join('、')}${transfers.length ? `；${transfers.join('；')}` : ''}`,
          'warn',
          { captainId: captain.id, pickedPlayerIds: picked.map(player => player.id), oldPlayerIds: oldTeamIds }
        );
        markUsed(hexcore);
        return {
          ok: true,
          advanceTurn: true,
          reveal: {
            title: '背水一战置换揭示',
            source: hexcore.name,
            captainId: captain.id,
            playerIds: picked.map(player => player.id),
            summary: `${captain.name} 从本阵营全场候选中重组4名队员`,
            detail: transfers.length
              ? `已完成别队置换补偿：${transfers.join('；')}`
              : '本次抽中均为可选池选手，原队员已回到可选池。',
          },
        };
      }

      if (hexcore.id === 'origin-sage') {
        return logFail('神秘贤者·启元在轮次开始自动生效，无需手动执行');
      }

      if (hexcore.id === 'mystery-box') {
        if (isShopOpenFor(captain.id)) return logFail('神秘贤者·盲盒需在商店打开前使用');
        const roundState = currentRoundState(captain.id);
        if (roundState.purchaseUsed || roundState.skipped) return logFail('本轮购买权已使用或已跳过');
        if (!captain.economy || Number(captain.economy.gold) < 3) return logFail('金币不足，神秘贤者·盲盒需要3金币');
        const targets = Hexcore2.selectors.availableCampPlayers(captain.id)
          .filter(player => player.tier >= 2 && player.tier <= 5);
        if (!targets.length) return logFail('同阵营没有2-5费可选选手');
        const player = targets[Math.floor(Math.random() * targets.length)];
        captain.economy.gold -= 3;
        const assigned = Hexcore2.assignmentEngine.assign(captain.id, player.id, 'mystery_box');
        if (!assigned) {
          captain.economy.gold += 3;
          return logFail('盲盒抽取失败，队伍容量或选手状态已变化');
        }
        roundState.purchaseUsed = true;
        state.draft.pickedThisTurn = true;
        state.draft.currentDraw = null;
        Hexcore2.eventStore.append('神秘贤者·盲盒', `${captain.name} 支付3金币，盲抽获得「${player.name}」`, 'success');
        markUsed(hexcore);
        return {
          ok: true,
          advanceTurn: true,
          reveal: {
            title: '盲盒入队揭示',
            source: hexcore.name,
            captainId: captain.id,
            playerIds: [player.id],
            summary: `${captain.name} 支付3金币，盲抽获得队员`,
            detail: '该海克斯已消耗本轮购买权，确认后进入下一位队长。',
          },
        };
      }

      if (hexcore.id === 'transmute-gold' || hexcore.id === 'transmute-prismatic') {
        if (isShopOpenFor(captain.id)) return logFail('质变必须在商店打开前使用');
        const roundState = currentRoundState(captain.id);
        if (roundState.purchaseUsed || roundState.skipped) return logFail('本轮购买权已使用或已跳过');
        const plan = transmutePlan(captain.id, hexcore.id);
        if (!plan.targets.length) return logFail(`同阵营${plan.requestedTier}费及以下卡池均无可选选手，质变失败`);
        const player = plan.targets[Math.floor(Math.random() * plan.targets.length)];
        const source = hexcore.id === 'transmute-gold' ? 'transmute_gold' : 'transmute_prismatic';
        const assigned = Hexcore2.assignmentEngine.assign(captain.id, player.id, source);
        if (!assigned) return logFail('质变入队失败，队伍容量或选手状态已变化');
        roundState.purchaseUsed = true;
        state.draft.pickedThisTurn = true;
        state.draft.currentDraw = null;
        const tierNote = plan.downgraded ? `（原${plan.requestedTier}费池为空，已降级）` : '';
        Hexcore2.eventStore.append(hexcore.name, `${captain.name} 免费质变${tierNote}，从${plan.tier}费池获得「${player.name}」`, 'success');
        markUsed(hexcore);
        return {
          ok: true,
          advanceTurn: true,
          reveal: {
            title: '质变入队揭示',
            source: hexcore.name,
            captainId: captain.id,
            playerIds: [player.id],
            summary: `${captain.name} 免费质变，从${plan.tier}费池获得队员`,
            detail: '该海克斯已消耗本轮购买权，确认后进入下一位队长。',
          },
        };
      }

      if (hexcore.id === 'decompose-knowledge') {
        const hexcoreEconomy = ensureHexcoreEconomy(captain);
        if (hexcoreEconomy.decomposeKnowledgeStacks < 3) return logFail('解构层数不足，需要3层才能发动');
        const targets = decomposeTargets(captain.id);
        const targetPlayer = targets.find(player => player.id === options.targetPlayerId || player.id === options.firstPlayerId);
        if (!targetPlayer) return logFail('请选择当前允许自选的目标选手');
        const targetPrice = Math.max(1, Number(targetPlayer.tier) || 1);
        const sacrifice = decomposableTeamPlayers(captain).find(player => player.id === options.secondPlayerId);
        let offset = 0;
        if (captain.economy.gold < targetPrice) {
          if (!sacrifice) return logFail(`金币不足，需要 ${targetPrice} 金币；请选择一名队内2/3费队员分解抵扣`);
          offset = Math.max(0, Number(sacrifice.tier) || 0);
          if (captain.economy.gold + offset < targetPrice) return logFail(`分解「${sacrifice.name}」后仍金币不足`);
          captain.team = captain.team.filter(playerId => playerId !== sacrifice.id);
          sacrifice.status = 'available';
          delete sacrifice.teamId;
          Hexcore2.eventStore.append('知识来源于分解', `${captain.name} 分解队员「${sacrifice.name}」，抵扣 ${offset} 金币，该选手回到可选池`, 'warn');
        }
        const result = Hexcore2.assignmentEngine.purchaseWithOffset(captain.id, targetPlayer.id, offset, 'decompose_knowledge');
        if (!result.ok) {
          if (sacrifice && !captain.team.includes(sacrifice.id)) {
            captain.team.push(sacrifice.id);
            sacrifice.status = 'drafted';
            sacrifice.teamId = captain.id;
          }
          return logFail(result.reason || '知识来源于分解执行失败');
        }
        hexcoreEconomy.decomposeKnowledgeStacks = 0;
        state.draft.pickedThisTurn = true;
        state.draft.currentDraw = null;
        Hexcore2.eventStore.append('知识来源于分解', `${captain.name} 消耗3层解构，自选「${targetPlayer.name}」入队`, 'success');
        return {
          ok: true,
          advanceTurn: true,
          reveal: {
            title: '知识来源于分解入队揭示',
            source: hexcore.name,
            captainId: captain.id,
            playerIds: [targetPlayer.id],
            summary: `${captain.name} 消耗3层解构，自选队员入队`,
            detail: sacrifice
              ? `已分解「${sacrifice.name}」抵扣 ${offset} 金币；确认后进入下一位队长。`
              : '该海克斯已消耗本轮购买权，确认后进入下一位队长。',
          },
        };
      }

      if (hexcore.id === 'stuck-together') {
        if (state.draft.round >= state.draft.maxRounds) return logFail('最后一轮无法使用【和我困在一起】');
        const maxTier = stuckTogetherMaxTier(state.draft.round);
        const targetPlayer = stuckTogetherTargets(captain.id, state.draft.round).find(player => player.id === options.targetPlayerId || player.id === options.firstPlayerId);
        if (!targetPlayer) return logFail(`请选择一名同阵营、未被选走且不高于${maxTier}费的可选选手`);
        pushEffect({
          type: 'stuck_together',
          captainId: captain.id,
          sourceCaptainId: captain.id,
          playerId: targetPlayer.id,
          triggerRound: state.draft.round + 1,
          reason: `${captain.name} 与「${targetPlayer.name}」困在一起，若到下一轮仍可选则直接入队`,
        });
        Hexcore2.eventStore.append('和我困在一起', `${captain.name} 指定「${targetPlayer.name}」，将在第 ${state.draft.round + 1} 轮开始时检查`, 'warn');
      }

      if (hexcore.id === 'storm-fog') {
        const targets = weatherFogTargetChain(captain.id, options.targetCaptainId || options.firstCaptainId);
        if (!targets.length) return logFail('请选择当前或下一轮仍有购买权且未满员的非使用者队长');
        targets.forEach(({ captain: target, triggerRound }) => {
          pushEffect({
            type: 'weather_fog',
            captainId: target.id,
            sourceCaptainId: captain.id,
            triggerRound,
            reason: `${captain.name} 使用骤雨 血雾 清风，${target.name} 第 ${triggerRound} 轮下一次商店进入天气迷雾`,
          });
        });
        Hexcore2.eventStore.append('骤雨 血雾 清风', `${captain.name} 使 ${targets.map(item => `${item.captain.name}（第${item.triggerRound}轮）`).join('、')} 的下一次商店进入天气迷雾；刷新不会清除血雾`, 'warn');
      }

      if (hexcore.id === 'snow-cat') {
        const target = openCaptainTargets(captain.id, false).find(item => item.id === (options.targetCaptainId || options.firstCaptainId));
        if (!target) return logFail('雪定饿的喵需要选择一名非自己的未满员队长');
        pushEffect({
          type: 'snow_cat_shuffle',
          captainId: target.id,
          sourceCaptainId: captain.id,
          reason: `${captain.name} 对 ${target.name} 使用雪定饿的喵，目标下一次商店显示信息被打乱`,
        });
        Hexcore2.eventStore.append('雪定饿的喵', `${captain.name} 影响 ${target.name} 的下一次商店，购买后揭示真实选手`, 'warn');
      }

      if (hexcore.id !== 'decompose-knowledge') markUsed(hexcore);
      const targetLabel = state.captains.some(item => item.id === options.targetCaptainId)
        ? `，目标：${captainName(options.targetCaptainId)}`
        : '';
      Hexcore2.eventStore.append('海克斯激活', `${captain.name} 使用【${hexcore.name}】${targetLabel}`, 'info');
      return { ok: true, advanceTurn: hexcore.id === 'steady-reinforce' || hexcore.id === 'decompose-knowledge' || hexcore.id === 'mystery-box' || hexcore.id === 'transmute-gold' || hexcore.id === 'transmute-prismatic' || hexcore.id === 'last-stand' };
    },

    decomposeTargets,
    transmutePlan,
    transmuteTargets,
    lastStandCandidates,
    decomposableTeamPlayers,
    stuckTogetherMaxTier,
    stuckTogetherTargets,
    weatherFogTargets,
    openCaptainTargets,
    cannonTargets,
    chargedCannonOrder,
    chargedCannonPendingOwners,
    chargedCannonBoostPreview,
    chargedCannonDelayTargets,
    activateChargedCannonBoost,
    activateChargedCannonDelay,
    skipChargedCannon,
    targetableCaptains,
    targetConflictReasons(sourceCaptainId) {
      const state = Hexcore2.state;
      const order = state.draft.currentOrder || [];
      const currentIndex = Number(state.draft.currentIndex) || 0;
      return state.captains
        .filter(captain => captain.id !== sourceCaptainId)
        .map(captain => {
          let reason = '';
          const index = order.indexOf(captain.id);
          if (isHungryWaveImmune(captain.id)) {
            reason = '本轮触发海浪，我没吃饭，免疫其他目标型海克斯';
          } else if (Hexcore2.selectors.teamSize(captain.id) >= Hexcore2.selectors.teamMemberCapacity(captain.id)) {
            reason = '队伍已满员，目标效果无法落地';
          } else if (index >= 0 && index < currentIndex && state.draft.round >= state.draft.maxRounds) {
            reason = '行动窗口已过，且没有下一轮可延后生效';
          }
          return reason ? { id: captain.id, name: captain.name, reason } : null;
        })
        .filter(Boolean);
    },
    isHungryWaveImmune,
    activeHungryWave,
    clearWeatherFogForCaptain,

    effectStatusForCaptain(captainId) {
      const effects = Hexcore2.state.draft.runtimeEffects || [];
      const wave = activeHungryWave();
      const pending = effects
        .filter(effect => effect.captainId === captainId && !effect.consumed)
        .map(effect => effectStatus(effect, '待生效'));
      if (wave && wave.captainId !== captainId && !wave.checkedCaptainIds?.includes(captainId)) {
        pending.push({
          type: 'hungry_wave_watch',
          status: '待判定',
          sourceCaptainId: wave.captainId,
          sourceCaptainName: captainName(wave.captainId),
          label: `${captainName(wave.captainId)} 的【海浪，我没吃饭】：本轮购买后可能被海浪命中`,
          reason: '购买成功后进行海浪判定；命中同阵营会夺取，命中异阵营会退回购买并登记轮末奖励',
        });
      }
      const draw = Hexcore2.state.draft.currentDraw;
      const appliedFromShop = draw && draw.captainId === captainId && Array.isArray(draw.appliedEffects)
        ? draw.appliedEffects.map(effect => effectStatus(effect, '已生效'))
        : [];
      const appliedFromPurchase = draw && draw.captainId === captainId && Array.isArray(draw.purchaseEffects)
        ? draw.purchaseEffects.map(effect => effectStatus(effect, '已生效'))
        : [];
      return [...pending, ...appliedFromShop, ...appliedFromPurchase].slice(0, 4);
    },

    isBlinded() { return false; },
    blindUsedBy() { return false; },
    blindTargetOptions(sourceCaptainId) { return sameCampCaptains(sourceCaptainId); },
    snowCatUsedBy(sourceCaptainId) {
      return (Hexcore2.state.hexcoreAssignments[sourceCaptainId] || []).some(hexcore => hexcore.id === 'snow-cat' && hexcore.status === 'used');
    },
    infoBoostFor() { return null; },
    powerRank(playerId) {
      const sorted = [...Hexcore2.state.players].sort((a, b) => b.score - a.score);
      return sorted.findIndex(player => player.id === playerId) + 1;
    },
    lockContractPairs() { return []; },
    resolveLockContracts() { return false; },
    grantCompensationTurn() { return false; },
    currentHellhoundSequence() { return null; },
    startHellhoundStep() { return { completed: true }; },
    advanceHellhound() { return { handled: false }; },
    extraDrawCount() { return 0; },
    drawReasons() { return []; },
    ensureHungryWaveForRound(round = Hexcore2.state.draft.round) {
      const state = Hexcore2.state;
      if (state.settings && state.settings.economyMode !== 'gold_shop') return { ok: false, reason: '非金币模式' };
      const workflow = Hexcore2.selectors.workflowStatus ? Hexcore2.selectors.workflowStatus() : {};
      if (!workflow.playersDraftReady) return { ok: false, reason: '前置流程未完成' };
      const existing = hungryWaveAlreadyCreated(round);
      if (existing) return { ok: true, existing: true, effect: existing };
      const candidates = hungryWaveEligibleCaptains(round);
      if (!candidates.length) return { ok: false, reason: '没有可触发海浪的队长' };
      const captain = candidates[Math.floor(Math.random() * candidates.length)];
      const roundState = Hexcore2.economyEngine.roundState(captain.id, round);
      const goldBefore = captain.economy ? Math.max(0, Number(captain.economy.gold) || 0) : 0;
      if (Hexcore2.historyService && typeof Hexcore2.historyService.push === 'function') {
        Hexcore2.historyService.push(`海浪触发前：第 ${round} 轮`);
      }
      if (!captain.economy) Hexcore2.economyEngine.ensureAll();
      captain.economy.gold = 0;
      roundState.skipped = true;
      roundState.purchaseUsed = false;
      roundState.freeShopUsed = true;
      const effect = {
        type: 'hungry_wave_round',
        round,
        captainId: captain.id,
        sourceCaptainId: captain.id,
        consumed: false,
        triggered: false,
        immune: true,
        skipped: true,
        mandatory: true,
        goldBefore,
        checkedCaptainIds: [],
        failedRolls: [],
        reason: `${captain.name} 饿坏了，失去全部金币并跳过本轮，等待判定其他队长购买结果`,
        createdAt: new Date().toISOString(),
      };
      state.draft.runtimeEffects.push(effect);
      state.draft.runtimeEffects.push({
        type: 'skip_round',
        round,
        captainId: captain.id,
        sourceCaptainId: captain.id,
        consumed: false,
        reason: `${captain.name} 触发海浪，我没吃饭，本轮自动跳过并免疫其他海克斯`,
      });
      if (Hexcore2.turnOrderEngine) {
        const beforeCurrent = Hexcore2.selectors.currentCaptain();
        Hexcore2.turnOrderEngine.recompute();
        if (beforeCurrent && beforeCurrent.id === captain.id) {
          state.draft.currentIndex = Math.max(0, Math.min(state.draft.currentIndex, Math.max(0, state.draft.currentOrder.length - 1)));
        }
      }
      Hexcore2.eventStore.append('海浪触发', `${captain.name} 触发【海浪，我没吃饭】：金币清零，跳过本轮并免疫其他海克斯，本轮会随机命中一次其他队长购买；同阵营夺取，异阵营退回购买并在轮末补偿同阵营选手`, 'warn', { captainId: captain.id, goldBefore });
      return { ok: true, created: true, effect };
    },

    ensureOriginSageForRound(round = Hexcore2.state.draft.round) {
      const state = Hexcore2.state;
      if (state.settings && state.settings.economyMode !== 'gold_shop') return { ok: false, reason: '非金币模式' };
      const workflow = Hexcore2.selectors.workflowStatus ? Hexcore2.selectors.workflowStatus() : {};
      if (!workflow.playersDraftReady) return { ok: false, reason: '前置流程未完成' };
      if (Number(round) !== Number(state.draft.round)) return { ok: false, reason: '轮次不匹配' };
      if (Number(state.draft.currentIndex) !== 0 || state.draft.currentDraw || state.draft.pickedThisTurn) {
        return { ok: false, reason: '不是轮次开始窗口' };
      }
      if (originSageAlreadyCreated(round)) return { ok: true, existing: true };
      const order = state.draft.currentOrder && state.draft.currentOrder.length
        ? state.draft.currentOrder
        : state.draft.baseOrder;
      const candidates = order
        .map(captainId => state.captains.find(captain => captain.id === captainId))
        .filter(captain => {
          if (!captain || !hasHexcore(captain.id, 'origin-sage') || !hasOpenSlot(captain.id)) return false;
          const hexcore = (state.hexcoreAssignments[captain.id] || []).find(hex => hex.id === 'origin-sage');
          const roundState = Hexcore2.economyEngine.roundState(captain.id, round);
          return hexcore
            && !usedThisRound(hexcore)
            && !roundState.purchaseUsed
            && !roundState.skipped
            && order.indexOf(captain.id) > 0;
        });
      if (!candidates.length) return { ok: false, reason: '没有需要调整的启元持有者' };
      candidates.slice().reverse().forEach((captain, index) => {
        const hexcore = (state.hexcoreAssignments[captain.id] || []).find(hex => hex.id === 'origin-sage');
        pushEffect({
          type: 'move_first',
          sourceHexcoreId: 'origin-sage',
          captainId: captain.id,
          sourceCaptainId: captain.id,
          priority: 540 + index,
          reason: `${captain.name} 的神秘贤者·启元在轮次开始时生效，本轮提到第一顺位，原第一及后续顺延`,
        });
        if (hexcore) markUsed(hexcore);
      });
      if (Hexcore2.turnOrderEngine) {
        Hexcore2.turnOrderEngine.recompute();
        state.draft.currentIndex = 0;
      }
      Hexcore2.eventStore.append(
        '神秘贤者·启元',
        `第 ${round} 轮开始自动生效：${candidates.map(captain => captain.name).join('、')} 提到第一顺位队列`,
        'warn',
        { captainIds: candidates.map(captain => captain.id), round }
      );
      return { ok: true, created: true, captainIds: candidates.map(captain => captain.id) };
    },

    autoAssignBeforeDraw(captainId = currentCaptain() && currentCaptain().id) {
      const captain = Hexcore2.state.captains.find(item => item.id === captainId);
      const wave = activeHungryWave();
      if (captain && wave && wave.captainId === captain.id && !wave.consumed) {
        const roundState = Hexcore2.economyEngine.roundState(captain.id, wave.round);
        roundState.skipped = true;
        Hexcore2.state.draft.currentDraw = null;
        Hexcore2.state.draft.pickedThisTurn = true;
        Hexcore2.eventStore.append('海浪免疫', `${captain.name} 本轮已触发【海浪，我没吃饭】，自动跳过自己的商店`, 'warn');
        return { handled: true, advance: true };
      }
      const effect = captain ? pendingStuckTogether(captain.id) : null;
      if (!captain || !effect) return { handled: false };
      effect.consumed = true;
      effect.appliedRound = Hexcore2.state.draft.round;
      effect.appliedAt = new Date().toISOString();
      const player = Hexcore2.state.players.find(item => item.id === effect.playerId);
      if (!player || player.status !== 'available') {
        Hexcore2.eventStore.append('和我困在一起', `${captain.name} 的锁定目标已不在可选池，效果失效`, 'warn');
        return { handled: true, assigned: false };
      }
      const assigned = Hexcore2.assignmentEngine.assign(captain.id, player.id, 'stuck_together');
      if (!assigned) {
        Hexcore2.eventStore.append('和我困在一起', `${captain.name} 自动获得「${player.name}」失败，可能队伍已满或阵营状态变化`, 'warn');
        return { handled: true, assigned: false };
      }
      Hexcore2.economyEngine.roundState(captain.id).purchaseUsed = true;
      Hexcore2.state.draft.pickedThisTurn = true;
      Hexcore2.state.draft.currentDraw = null;
      Hexcore2.eventStore.append('和我困在一起', `${captain.name} 的目标「${player.name}」仍在卡池，已直接加入队伍`, 'success');
      return {
        handled: true,
        assigned: true,
        player,
        reveal: {
          title: '延迟入队揭示',
          source: '和我困在一起',
          captainId: captain.id,
          playerIds: [player.id],
          summary: `${captain.name} 的锁定目标仍在卡池，已自动入队`,
          detail: '该延迟效果已结算并消耗本轮购买权，确认后进入下一位队长。',
        },
      };
    },
    resolveHungryWaveAfterPurchase(buyerId, playerId, paidPrice) {
      const state = Hexcore2.state;
      const buyer = state.captains.find(captain => captain.id === buyerId);
      const player = state.players.find(item => item.id === playerId);
      if (!buyer || !player) return { handled: false };
      const effect = activeHungryWave();
      const hungryCaptain = effect && state.captains.find(captain => captain.id === effect.captainId);
      if (!effect || !hungryCaptain || effect.captainId === buyerId || effect.triggered) return { handled: false };
      effect.checkedCaptainIds = Array.isArray(effect.checkedCaptainIds) ? effect.checkedCaptainIds : [];
      effect.failedRolls = Array.isArray(effect.failedRolls) ? effect.failedRolls : [];
      if (!buyer.team.includes(player.id) || player.teamId !== buyer.id) return { handled: false };
      const candidates = remainingHungryWaveCandidates(effect, buyerId);
      const remaining = Math.max(1, candidates.length || 1);
      const roll = Math.random();
      const success = remaining <= 1 || roll < (1 / remaining);
      if (!success) {
        effect.checkedCaptainIds.push(buyer.id);
        effect.failedRolls.push({
          buyerId: buyer.id,
          playerId: player.id,
          remaining,
          probability: 1 / remaining,
          roll,
          checkedAt: new Date().toISOString(),
        });
        Hexcore2.eventStore.append('海浪判定未命中', `${hungryCaptain.name} 的【海浪，我没吃饭】已判定 ${buyer.name} 刚购买的「${player.name}」：本次未命中，触发概率 ${Math.round((1 / remaining) * 100)}%，后续购买继续判定`, 'warn', { sourceCaptainId: hungryCaptain.id, buyerId: buyer.id, playerId: player.id, remaining, roll });
        return { handled: false, rolled: true, success: false };
      }
      const hungryCamp = captainCamp(hungryCaptain.id);
      const sameCamp = hungryCamp && player.camp === hungryCamp;
      const appliedPrice = Math.max(0, Number(paidPrice) || 0);
      if (!sameCamp) {
        returnPurchasedPlayerToPool(buyer, player);
        const compensation = Hexcore2.economyEngine.compensateHungryWaveVictim
          ? Hexcore2.economyEngine.compensateHungryWaveVictim(buyer.id, paidPrice, state.draft.round)
          : { ok: false };
        effect.consumed = true;
        effect.triggered = true;
        effect.outcome = 'opposite_camp_returned';
        effect.checkedCaptainIds.push(buyer.id);
        effect.returnedPlayerId = player.id;
        effect.appliedBuyerId = buyer.id;
        effect.appliedPrice = appliedPrice;
        effect.pendingRoundReward = true;
        effect.rewardRound = state.draft.round;
        effect.rewardProbabilityRound = state.draft.round;
        effect.appliedAt = new Date().toISOString();
        Hexcore2.eventStore.append(
          '海浪异阵营命中',
          `${hungryCaptain.name} 的【海浪，我没吃饭】命中 ${buyer.name} 刚购买的异阵营选手「${player.name}」：不夺取，已退回卡池，返还 ${buyer.name} ${appliedPrice} 金币、1 次免费刷新和购买权；${hungryCaptain.name} 将在本轮结束后按第 ${state.draft.round} 轮概率从同阵营卡池随机获得 1 名选手`,
          'warn',
          { sourceCaptainId: hungryCaptain.id, buyerId: buyer.id, playerId: player.id, price: appliedPrice, compensation }
        );
        return { handled: true, returned: true, captainId: hungryCaptain.id, buyerId: buyer.id, playerId: player.id, price: appliedPrice };
      }
      if (Hexcore2.selectors.teamSize(hungryCaptain.id) >= Hexcore2.selectors.teamMemberCapacity(hungryCaptain.id)) {
        effect.consumed = true;
        effect.failedReason = '队伍已满';
        Hexcore2.eventStore.append('海浪失效', `${hungryCaptain.name} 队伍已满，无法夺取「${player.name}」`, 'warn');
        return { handled: false };
      }
      buyer.team = buyer.team.filter(id => id !== player.id);
      hungryCaptain.team.push(player.id);
      player.teamId = hungryCaptain.id;
      player.status = 'drafted';
      delete player.teamBypassReason;
      const compensation = Hexcore2.economyEngine.compensateHungryWaveVictim
        ? Hexcore2.economyEngine.compensateHungryWaveVictim(buyer.id, paidPrice, state.draft.round)
        : { ok: false };
      effect.consumed = true;
      effect.triggered = true;
      effect.outcome = 'same_camp_stolen';
      effect.checkedCaptainIds.push(buyer.id);
      effect.appliedPlayerId = player.id;
      effect.appliedBuyerId = buyer.id;
      effect.appliedPrice = appliedPrice;
      effect.appliedAt = new Date().toISOString();
      Hexcore2.eventStore.append(
        '海浪夺取成功',
        `${hungryCaptain.name} 的【海浪，我没吃饭】夺取了 ${buyer.name} 刚购买的「${player.name}」，返还 ${buyer.name} ${effect.appliedPrice} 金币，并补偿 1 次免费刷新与购买权`,
        'warn',
        { sourceCaptainId: hungryCaptain.id, buyerId: buyer.id, playerId: player.id, price: effect.appliedPrice, compensation }
      );
      return {
        handled: true,
        captainId: hungryCaptain.id,
        buyerId: buyer.id,
        playerId: player.id,
        price: effect.appliedPrice,
        reveal: {
          title: '海浪夺取入队揭示',
          source: '海浪，我没吃饭',
          captainId: hungryCaptain.id,
          playerIds: [player.id],
          summary: `${hungryCaptain.name} 夺取了 ${buyer.name} 刚购买的队员`,
          detail: `${buyer.name} 已返还 ${effect.appliedPrice} 金币、1次免费刷新和购买权。`,
        },
      };
    },
    resolveHungryWaveRoundEnd(round = Hexcore2.state.draft.round) {
      const effects = (Hexcore2.state.draft.runtimeEffects || []).filter(effect =>
        effect.type === 'hungry_wave_round'
        && Number(effect.rewardRound) === Number(round)
        && effect.pendingRoundReward
        && !effect.roundRewardResolved
      );
      const resolved = [];
      effects.forEach(effect => {
        const captain = Hexcore2.state.captains.find(item => item.id === effect.captainId);
        effect.pendingRoundReward = false;
        effect.roundRewardResolved = true;
        effect.roundRewardAt = new Date().toISOString();
        if (!captain) {
          effect.roundRewardFailedReason = '队长不存在';
          return;
        }
        if (Hexcore2.selectors.teamSize(captain.id) >= Hexcore2.selectors.teamMemberCapacity(captain.id)) {
          effect.roundRewardFailedReason = '队伍已满';
          Hexcore2.eventStore.append('海浪轮末奖励失败', `${captain.name} 队伍已满，无法获得异阵营命中的轮末补偿`, 'warn', { sourceCaptainId: captain.id });
          resolved.push({ effect, assigned: false });
          return;
        }
        const rewardRound = Number(effect.rewardProbabilityRound) || round;
        const player = hungryWaveRewardPlayer(captain.id, rewardRound);
        if (!player) {
          effect.roundRewardFailedReason = '同阵营可用卡池为空';
          Hexcore2.eventStore.append('海浪轮末奖励失败', `${captain.name} 同阵营没有可用选手，无法获得异阵营命中的轮末补偿`, 'warn', { sourceCaptainId: captain.id });
          resolved.push({ effect, assigned: false });
          return;
        }
        const assigned = Hexcore2.assignmentEngine.assign(captain.id, player.id, 'hungry_wave');
        if (!assigned) {
          effect.roundRewardFailedReason = '入队校验失败';
          Hexcore2.eventStore.append('海浪轮末奖励失败', `${captain.name} 抽中「${player.name}」但入队失败，可能队伍已满或阵营状态变化`, 'warn', { sourceCaptainId: captain.id, playerId: player.id });
          resolved.push({ effect, assigned: false, playerId: player.id });
          return;
        }
        effect.roundRewardPlayerId = player.id;
        Hexcore2.eventStore.append(
          '海浪轮末奖励',
          `${captain.name} 因本轮【海浪，我没吃饭】命中异阵营购买，按第 ${rewardRound} 轮概率从同阵营卡池随机获得「${player.name}」`,
          'success',
          { sourceCaptainId: captain.id, playerId: player.id, rewardRound }
        );
        resolved.push({
          effect,
          assigned: true,
          playerId: player.id,
          reveal: {
            title: '海浪轮末补偿揭示',
            source: '海浪，我没吃饭',
            captainId: captain.id,
            playerIds: [player.id],
            summary: `${captain.name} 获得海浪轮末补偿队员`,
            detail: `按第 ${rewardRound} 轮金币商店概率，从同阵营可用卡池随机获得。`,
          },
        });
      });
      return { handled: effects.length > 0, resolved };
    },
    drawOverrideBeforeDraw() { return { handled: false }; },
    nextCaptain(captainId) {
      const order = Hexcore2.state.draft.currentOrder;
      const index = order.indexOf(captainId);
      const nextId = order[index + 1];
      return Hexcore2.state.captains.find(captain => captain.id === nextId);
    },
  };
})(window);
