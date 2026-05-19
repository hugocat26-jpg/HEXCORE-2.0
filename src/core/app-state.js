(function initAppState(global) {
  const Hexcore2 = global.Hexcore2 || (global.Hexcore2 = {});
  const seed = Hexcore2.sampleData;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  Hexcore2.state = {
    mode: 'referee_single_client',
    settings: {
      totalTeams: 12,
      playersPerTeam: 4,
      tierNames: { 1: '侏儒马', 2: '中等马', 3: '上等马', 4: '猛犸' },
    },
    captains: clone(seed.captains),
    players: clone(seed.players),
    hexcoreAssignments: {
      c7: clone(seed.hexcores),
    },
    draft: {
      phase: 'captain_action',
      round: 2,
      baseOrder: seed.captains.map(captain => captain.id),
      currentOrder: seed.captains.map(captain => captain.id),
      currentIndex: 6,
      selectedSlot: 1,
      currentDraw: null,
      runtimeEffects: [],
      explanations: [],
      pickedThisTurn: false,
      paused: false,
    },
    events: [],
  };

  Hexcore2.selectors = {
    currentCaptain() {
      const state = Hexcore2.state;
      const id = state.draft.currentOrder[state.draft.currentIndex];
      return state.captains.find(captain => captain.id === id);
    },
    teamSize(captainId) {
      const captain = Hexcore2.state.captains.find(item => item.id === captainId);
      return captain ? captain.team.length : 0;
    },
    availablePlayers(tier) {
      return Hexcore2.state.players.filter(player => player.tier === tier && player.status === 'available');
    },
    currentHexcores() {
      const captain = Hexcore2.selectors.currentCaptain();
      return captain ? (Hexcore2.state.hexcoreAssignments[captain.id] || []) : [];
    },
  };
})(window);
