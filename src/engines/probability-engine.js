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
  };
})(window);
