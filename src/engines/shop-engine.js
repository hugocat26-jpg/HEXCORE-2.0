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

  function buildCandidatesByTier(captainId, excludedIds) {
    const map = new Map([1, 2, 3, 4, 5].map(tier => [tier, []]));
    availableCards(captainId, excludedIds).forEach(player => {
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
    if (effect) effect.consumed = true;
    return effect;
  }

  function shopSizeFor(captainId, baseSize) {
    let size = baseSize;
    runtimeEffectsFor(captainId, 'camp_scout').forEach(effect => {
      size += Number(effect.countBonus) || 1;
      effect.consumed = true;
    });
    runtimeEffectsFor(captainId, 'camp_blockade').forEach(effect => {
      size -= Number(effect.countPenalty) || 1;
      effect.consumed = true;
    });
    return Math.max(3, Math.min(6, size));
  }

  function reservedPlayerFor(captainId, excludedIds) {
    const effect = consumeOneEffect(captainId, 'reserved_seat');
    if (!effect || !effect.playerId || excludedIds.has(effect.playerId)) return null;
    const player = Hexcore2.state.players.find(item => item.id === effect.playerId);
    const camp = Hexcore2.selectors.captainCamp(captainId);
    if (!player || player.status !== 'available' || player.camp !== camp) return null;
    return player;
  }

  function directedPlayerFor(captainId, excludedIds) {
    const effect = consumeOneEffect(captainId, 'directed_recruit');
    if (!effect || !effect.lane) return null;
    const candidates = availableCards(captainId, excludedIds)
      .filter(player => String(player.lane || '') === String(effect.lane || ''));
    if (!candidates.length) return null;
    return shuffle(candidates)[0];
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
      const targetCount = Math.min(shopSizeFor(captainId, baseSize), availableCards(captainId).length);
      const cards = [];
      const weights = this.probabilityForRound(round);
      const seeded = [reservedPlayerFor(captainId, excludedIds), directedPlayerFor(captainId, excludedIds)].filter(Boolean);
      seeded.forEach(player => {
        if (cards.length >= targetCount || excludedIds.has(player.id)) return;
        excludedIds.add(player.id);
        cards.push(cardFromPlayer(player, cards.length));
      });

      while (cards.length < targetCount) {
        const candidatesByTier = buildCandidatesByTier(captainId, excludedIds);
        const tier = chooseWeightedTier(weights, candidatesByTier);
        const candidates = candidatesByTier.get(tier) || [];
        const player = candidates[0];
        if (!player) break;
        excludedIds.add(player.id);
        cards.push(cardFromPlayer(player, cards.length));
      }

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
        cards,
      };
    },
  };
})(window);
