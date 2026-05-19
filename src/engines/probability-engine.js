(function initProbabilityEngine(global) {
  const Hexcore2 = global.Hexcore2 || (global.Hexcore2 = {});

  function shuffle(items) {
    return [...items].sort(() => Math.random() - 0.5);
  }

  Hexcore2.probabilityEngine = {
    draw(captainId, tier, count) {
      const candidates = Hexcore2.selectors.availablePlayers(tier);
      const picked = shuffle(candidates).slice(0, Math.min(count, candidates.length));
      return {
        id: `draw_${Date.now()}`,
        captainId,
        round: Hexcore2.state.draft.round,
        effectiveTier: tier,
        cards: picked.map((player, index) => ({
          slotId: `slot_${index + 1}`,
          playerId: player.id,
          visibleToReferee: true,
          visibleToCaptain: !Hexcore2.hexcoreEngine.isBlinded(captainId),
        })),
      };
    },

    drawAll(captainId, tier, reason) {
      const candidates = Hexcore2.selectors.availablePlayers(tier)
        .sort((a, b) => b.score - a.score);
      return {
        id: `draw_${Date.now()}`,
        captainId,
        round: Hexcore2.state.draft.round,
        effectiveTier: tier,
        pickMode: 'open_pick',
        reason,
        cards: candidates.map((player, index) => ({
          slotId: `slot_${index + 1}`,
          playerId: player.id,
          visibleToReferee: true,
          visibleToCaptain: !Hexcore2.hexcoreEngine.isBlinded(captainId),
        })),
      };
    },

    drawHighestLowestSwap(captainId, tier, reason) {
      const candidates = Hexcore2.selectors.availablePlayers(tier)
        .sort((a, b) => b.score - a.score);
      const highest = candidates[0];
      const lowest = candidates[candidates.length - 1];
      const picked = highest && lowest && highest.id !== lowest.id ? [highest, lowest] : candidates.slice(0, 1);
      const swapped = picked.length === 2 && Math.random() >= 0.5;
      const displayed = swapped ? [...picked].reverse() : picked;
      return {
        id: `draw_${Date.now()}`,
        captainId,
        round: Hexcore2.state.draft.round,
        effectiveTier: tier,
        pickMode: 'mystery_swap',
        reason,
        mysterySwapped: swapped,
        cards: picked.map((player, index) => ({
          slotId: `slot_${index + 1}`,
          playerId: player.id,
          displayPlayerId: displayed[index] ? displayed[index].id : player.id,
          visibleToReferee: true,
          visibleToCaptain: true,
        })),
      };
    },

    drawTierIncludingDrafted(captainId, tier, count, reason) {
      const candidates = Hexcore2.state.players.filter(player => player.tier === tier);
      const picked = shuffle(candidates).slice(0, Math.min(count, candidates.length));
      return {
        id: `draw_${Date.now()}`,
        captainId,
        round: Hexcore2.state.draft.round,
        effectiveTier: tier,
        pickMode: 'blind_box',
        reason,
        cards: picked.map((player, index) => ({
          slotId: `slot_${index + 1}`,
          playerId: player.id,
          visibleToReferee: true,
          visibleToCaptain: true,
        })),
      };
    },
  };
})(window);
