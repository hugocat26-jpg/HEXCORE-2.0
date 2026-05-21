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

  function availableCards(excludedIds = new Set()) {
    return Hexcore2.state.players.filter(player =>
      player.status === 'available'
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

  function buildCandidatesByTier(excludedIds) {
    const map = new Map([1, 2, 3, 4, 5].map(tier => [tier, []]));
    availableCards(excludedIds).forEach(player => {
      map.get(player.tier).push(player);
    });
    map.forEach((players, tier) => {
      map.set(tier, shuffle(players));
    });
    return map;
  }

  Hexcore2.shopEngine = {
    probabilities: ROUND_PROBABILITIES,

    probabilityForRound(round = Hexcore2.state.draft.round) {
      return ROUND_PROBABILITIES[roundNumber(round)] || ROUND_PROBABILITIES[1];
    },

    generate(captainId, options = {}) {
      const round = roundNumber(options.round);
      const excludedIds = new Set();
      const targetCount = Math.min(Hexcore2.state.settings.shopSize || 5, availableCards().length);
      const cards = [];
      const weights = this.probabilityForRound(round);

      for (let index = 0; index < targetCount; index += 1) {
        const candidatesByTier = buildCandidatesByTier(excludedIds);
        const tier = chooseWeightedTier(weights, candidatesByTier);
        const candidates = candidatesByTier.get(tier) || [];
        const player = candidates[0];
        if (!player) break;
        excludedIds.add(player.id);
        cards.push({
          slotId: `slot_${index + 1}`,
          playerId: player.id,
          tier: player.tier,
          price: player.tier,
          visibleToReferee: true,
          visibleToCaptain: true,
        });
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
