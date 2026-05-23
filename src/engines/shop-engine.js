(function initShopEngine(global) {
  const Hexcore2 = global.Hexcore2 || (global.Hexcore2 = {});

  const ROUND_PROBABILITIES = {
    1: { 1: 55, 2: 35, 3: 10, 4: 0, 5: 0 },
    2: { 1: 35, 2: 35, 3: 25, 4: 5, 5: 0 },
    3: { 1: 20, 2: 30, 3: 35, 4: 13, 5: 2 },
    4: { 1: 5, 2: 15, 3: 25, 4: 35, 5: 20 },
  };

  function shuffle(items) {
    return [...items].sort(() => Math.random() - 0.5);
  }

  function roundNumber(round) {
    const value = Number(round || Hexcore2.state.draft.round);
    return Math.max(1, Math.min(4, Math.round(value) || 1));
  }

  function availableCards(captainId, excludedIds = new Set()) {
    if (Hexcore2.selectors.availableCampPlayers) {
      return Hexcore2.selectors.availableCampPlayers(captainId, excludedIds);
    }
    const camp = Hexcore2.selectors.captainCamp ? Hexcore2.selectors.captainCamp(captainId) : '';
    return Hexcore2.state.players.filter(player =>
      player.status === 'available'
      && player.camp === camp
      && player.tier >= 1
      && player.tier <= 5
      && !excludedIds.has(player.id)
    );
  }

  function chooseWeightedTier(weights, candidatesByTier) {
    const entries = [1, 2, 3, 4, 5]
      .map(tier => ({ tier, weight: Number(weights[tier]) || 0, count: (candidatesByTier.get(tier) || []).length }))
      .filter(item => item.weight > 0 && item.count > 0);
    if (!entries.length) {
      const fallback = [1, 2, 3, 4, 5]
        .map(tier => ({ tier, weight: 1, count: (candidatesByTier.get(tier) || []).length }))
        .filter(item => item.count > 0);
      entries.push(...fallback);
    }
    const total = entries.reduce((sum, item) => sum + item.weight, 0);
    let roll = Math.random() * total;
    for (const item of entries) {
      roll -= item.weight;
      if (roll <= 0) return item.tier;
    }
    return entries[entries.length - 1].tier;
  }

  function hasHexcore(captainId, hexcoreId) {
    return Hexcore2.selectors.isHexcoreEnabled(hexcoreId)
      && (Hexcore2.state.hexcoreAssignments[captainId] || []).some(hexcore => hexcore.id === hexcoreId);
  }

  function buildCandidatesByTier(captainId, excludedIds, options = {}) {
    const minTier = Math.max(1, Math.min(5, Number(options.minTier) || 1));
    const map = new Map([1, 2, 3, 4, 5].map(tier => [tier, []]));
    availableCards(captainId, excludedIds).filter(player => player.tier >= minTier).forEach(player => {
      map.get(player.tier).push(player);
    });
    map.forEach((players, tier) => {
      map.set(tier, shuffle(players));
    });
    return map;
  }

  function runtimeEffectsFor(captainId, type) {
    return Hexcore2.state.draft.runtimeEffects.filter(effect =>
      effect.type === type && effect.captainId === captainId && !effect.consumed
    );
  }

  function consumeOneEffect(captainId, type) {
    const effect = runtimeEffectsFor(captainId, type)[0];
    if (effect) {
      effect.consumed = true;
      effect.appliedRound = Hexcore2.state.draft.round;
      effect.appliedAt = new Date().toISOString();
    }
    return effect;
  }

  function trackApplied(appliedEffects, effect, detail) {
    if (!effect) return;
    Object.assign(effect, detail || {});
    appliedEffects.push({ ...effect });
  }

  function shopSizeFor(captainId, baseSize, appliedEffects) {
    let size = baseSize;
    runtimeEffectsFor(captainId, 'camp_scout').forEach(effect => {
      const countBonus = Number(effect.countBonus) || 1;
      size += countBonus;
      effect.consumed = true;
      effect.appliedRound = Hexcore2.state.draft.round;
      effect.appliedAt = new Date().toISOString();
      trackApplied(appliedEffects, effect, { countBonus });
    });
    runtimeEffectsFor(captainId, 'camp_blockade').forEach(effect => {
      const countPenalty = Number(effect.countPenalty) || 1;
      size -= countPenalty;
      effect.consumed = true;
      effect.appliedRound = Hexcore2.state.draft.round;
      effect.appliedAt = new Date().toISOString();
      trackApplied(appliedEffects, effect, { countPenalty });
    });
    return Math.max(3, Math.min(6, size));
  }

  function reservedPlayerFor(captainId, excludedIds, appliedEffects) {
    const effect = consumeOneEffect(captainId, 'reserved_seat');
    if (!effect || !effect.playerId || excludedIds.has(effect.playerId)) return null;
    const player = Hexcore2.state.players.find(item => item.id === effect.playerId);
    const camp = Hexcore2.selectors.captainCamp(captainId);
    if (!player || player.status !== 'available' || player.camp !== camp) return null;
    trackApplied(appliedEffects, effect, { appliedPlayerId: player.id });
    return player;
  }

  function applyWeatherFog(captainId, appliedEffects) {
    const effect = consumeOneEffect(captainId, 'weather_fog');
    if (effect) trackApplied(appliedEffects, effect, { appliedCaptainId: captainId });
  }

  function applySnowCatShuffle(captainId, cards, appliedEffects) {
    const effect = consumeOneEffect(captainId, 'snow_cat_shuffle');
    if (!effect) return;
    if (cards.length > 1) {
      const offset = 1 + Math.floor(Math.random() * (cards.length - 1));
      const displayed = cards.map((card, index) => cards[(index + offset) % cards.length]);
      cards.forEach((card, index) => {
        const displayCard = displayed[index];
        card.displayPlayerId = displayCard.playerId;
        card.price = Math.max(1, Number(displayCard.tier) || Number(displayCard.price) || 1);
        card.snowCatShuffled = true;
      });
      trackApplied(appliedEffects, effect, {
        appliedCaptainId: captainId,
        displayOffset: offset,
        affectedSlots: cards.length,
      });
      return;
    }
    trackApplied(appliedEffects, effect, {
      appliedCaptainId: captainId,
      displayOffset: 0,
      affectedSlots: cards.length,
      degraded: true,
    });
  }

  function ballroomQueenPlan(captainId, targetCount, appliedEffects) {
    if (!hasHexcore(captainId, 'ballroom-queen')) {
      return { active: false, minTier: 1 };
    }
    const highTierCount = availableCards(captainId).filter(player => player.tier >= 3 && player.tier <= 5).length;
    const strictHighOnly = highTierCount >= targetCount;
    appliedEffects.push({
      type: 'ballroom_queen',
      captainId,
      round: Hexcore2.state.draft.round,
      preferredTiers: [3, 4, 5],
      highTierCount,
      targetCount,
      degraded: !strictHighOnly,
      reason: strictHighOnly
        ? '舞会女王：本次商店只抽3-5费卡'
        : `舞会女王：3-5费可选不足（${highTierCount}/${targetCount}），先抽高费后降级补足`,
    });
    return { active: true, minTier: strictHighOnly ? 3 : 1 };
  }

  function cardFromPlayer(player, slotIndex) {
    return {
      slotId: `slot_${slotIndex + 1}`,
      playerId: player.id,
      tier: player.tier,
      price: player.tier,
      camp: player.camp,
      visibleToReferee: true,
      visibleToCaptain: true,
    };
  }

  Hexcore2.shopEngine = {
    probabilities: ROUND_PROBABILITIES,

    probabilityForRound(round = Hexcore2.state.draft.round) {
      return ROUND_PROBABILITIES[roundNumber(round)] || ROUND_PROBABILITIES[1];
    },

    generate(captainId, options = {}) {
      const round = roundNumber(options.round);
      const excludedIds = new Set();
      const baseSize = Math.min(Hexcore2.state.settings.shopSize || 5, availableCards(captainId).length);
      const appliedEffects = [];
      const targetCount = Math.min(shopSizeFor(captainId, baseSize, appliedEffects), availableCards(captainId).length);
      applyWeatherFog(captainId, appliedEffects);
      const ballroomPlan = ballroomQueenPlan(captainId, targetCount, appliedEffects);
      const cards = [];
      const weights = ballroomPlan.active ? { 1: 0, 2: 0, 3: 34, 4: 33, 5: 33 } : this.probabilityForRound(round);
      const seeded = [reservedPlayerFor(captainId, excludedIds, appliedEffects)].filter(Boolean);
      seeded.forEach(player => {
        if (cards.length >= targetCount || excludedIds.has(player.id)) return;
        if (ballroomPlan.active && ballroomPlan.minTier >= 3 && player.tier < 3) return;
        excludedIds.add(player.id);
        cards.push(cardFromPlayer(player, cards.length));
      });

      while (cards.length < targetCount) {
        const candidatesByTier = buildCandidatesByTier(captainId, excludedIds, { minTier: ballroomPlan.minTier });
        const tier = chooseWeightedTier(weights, candidatesByTier);
        const candidates = candidatesByTier.get(tier) || [];
        const player = candidates[0];
        if (!player) break;
        excludedIds.add(player.id);
        cards.push(cardFromPlayer(player, cards.length));
      }
      applySnowCatShuffle(captainId, cards, appliedEffects);

      return {
        id: `shop_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        captainId,
        round,
        tier: 0,
        effectiveTier: 0,
        pickMode: 'shop',
        generatedBy: options.generatedBy || 'free_shop',
        refreshCostPaid: Math.max(0, Number(options.refreshCostPaid) || 0),
        reason: options.reason || '',
        appliedEffects,
        cards,
      };
    },
  };
})(window);
