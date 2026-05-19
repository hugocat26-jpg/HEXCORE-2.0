(function initAppState(global) {
  const Hexcore2 = global.Hexcore2 || (global.Hexcore2 = {});
  const seed = Hexcore2.sampleData;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function reconcileBaseOrder(captains, baseOrder) {
    const captainIds = captains.map(captain => captain.id);
    const current = Array.isArray(baseOrder) ? baseOrder.filter(id => captainIds.includes(id)) : [];
    captainIds.forEach(id => {
      if (!current.includes(id)) current.push(id);
    });
    return current;
  }

  const defaultState = {
    mode: 'referee_single_client',
    settings: {
      minTeams: 5,
      maxTeams: 20,
      totalTeams: seed.captains.length,
      playersPerTeam: 4,
      tierNames: { 1: '侏儒马', 2: '中等马', 3: '上等马', 4: '猛犸' },
    },
    captains: clone(seed.captains),
    players: clone(seed.players),
    hexcoreAssignments: clone(seed.hexcoreAssignments || { c7: seed.hexcores }),
    draft: {
      phase: 'captain_action',
      round: 2,
      maxRounds: 4,
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
    undoStack: [],
    ui: {
      eventFilter: 'all',
    },
  };

  Hexcore2.normalizeState = function normalizeState(state) {
    state.settings = state.settings || clone(defaultState.settings);
    state.settings.tierNames = state.settings.tierNames || clone(defaultState.settings.tierNames);
    state.settings.minTeams = state.settings.minTeams || defaultState.settings.minTeams;
    state.settings.maxTeams = state.settings.maxTeams || defaultState.settings.maxTeams;
    state.settings.playersPerTeam = state.settings.playersPerTeam || defaultState.settings.playersPerTeam;
    state.captains = state.captains || clone(defaultState.captains);
    state.settings.totalTeams = state.captains.length;
    state.players = state.players || clone(defaultState.players);
    state.hexcoreAssignments = state.hexcoreAssignments || {};
    state.draft = state.draft || clone(defaultState.draft);
    state.draft.baseOrder = reconcileBaseOrder(state.captains, state.draft.baseOrder);
    state.draft.maxRounds = state.draft.maxRounds || defaultState.draft.maxRounds;
    state.draft.phase = state.draft.phase || 'captain_action';
    state.draft.currentOrder = state.draft.currentOrder || [...state.draft.baseOrder];
    state.draft.currentIndex = Number.isInteger(state.draft.currentIndex) ? state.draft.currentIndex : 0;
    state.draft.selectedSlot = Number.isInteger(state.draft.selectedSlot) ? state.draft.selectedSlot : 0;
    state.draft.runtimeEffects = state.draft.runtimeEffects || [];
    state.draft.explanations = state.draft.explanations || [];
    state.draft.pickedThisTurn = Boolean(state.draft.pickedThisTurn);
    state.draft.paused = Boolean(state.draft.paused);
    state.events = state.events || [];
    state.undoStack = state.undoStack || [];
    state.ui = state.ui || { eventFilter: 'all' };
    state.ui.eventFilter = state.ui.eventFilter || 'all';
    return state;
  };

  const savedState = Hexcore2.storageService ? Hexcore2.storageService.load() : null;
  Hexcore2.state = Hexcore2.normalizeState(savedState || clone(defaultState));

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
    teamCount() {
      return Hexcore2.state.captains.length;
    },
  };
})(window);
