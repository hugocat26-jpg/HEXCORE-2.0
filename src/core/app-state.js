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

  function reconcilePlayerTeamIds(captains, players) {
    players.forEach(player => {
      const owner = captains.find(captain => (captain.team || []).includes(player.id));
      if (owner) {
        player.status = 'drafted';
        player.teamId = owner.id;
      } else if (player.status === 'drafted') {
        player.status = 'available';
        delete player.teamId;
      }
    });
  }

  function isCaptainPoolPlayer(player, captains) {
    if (!player) return false;
    if (player.isCaptain || player.role === 'captain' || player.status === 'captain') return true;
    return captains.some(captain =>
      captain.playerId === player.id
      || captain.playerGameId === player.gameId
      || captain.gameId === player.gameId
    );
  }

  function rebalancePlayerTiers(captains, players) {
    const regularPlayers = [];
    players.forEach(player => {
      if (isCaptainPoolPlayer(player, captains)) {
        player.tier = 0;
        player.status = 'captain';
        delete player.teamId;
      } else {
        if (player.status === 'captain') player.status = 'available';
        regularPlayers.push(player);
      }
    });

    const sorted = regularPlayers
      .slice()
      .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0) || String(a.id).localeCompare(String(b.id)));
    const total = Math.max(1, sorted.length);
    sorted.forEach((player, index) => {
      const band = Math.floor((index * 4) / total);
      player.tier = Math.max(1, Math.min(4, 4 - band));
    });
  }

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, Math.round(number)));
  }

  function normalizeRuleTemplate(template) {
    const source = template && typeof template === 'object' ? template : {};
    const maxRounds = clampNumber(source.maxRounds, 1, 8, defaultState.draft.maxRounds);
    const roundTiers = Array.isArray(source.roundTiers)
      ? source.roundTiers.slice(0, maxRounds).map(tier => clampNumber(tier, 1, 4, 1))
      : [...defaultState.settings.roundTiers].slice(0, maxRounds);
    while (roundTiers.length < maxRounds) {
      roundTiers.push(Math.min(4, roundTiers.length + 1));
    }

    return {
      name: String(source.name || '未命名模板').slice(0, 40),
      savedAt: String(source.savedAt || '').slice(0, 40),
      teamCount: clampNumber(source.teamCount, defaultState.settings.minTeams, defaultState.settings.maxTeams, defaultState.settings.totalTeams),
      playersPerTeam: clampNumber(source.playersPerTeam, 1, 8, defaultState.settings.playersPerTeam),
      maxRounds,
      drawCount: clampNumber(source.drawCount, 1, 8, defaultState.settings.drawCount),
      roundTiers,
      disabledHexcores: Array.isArray(source.disabledHexcores)
        ? source.disabledHexcores.filter(id => typeof id === 'string').slice(0, 50)
        : [],
    };
  }

  function normalizeTournament(tournament, captains) {
    const captainIds = new Set(captains.map(captain => captain.id));
    const source = tournament && typeof tournament === 'object' ? tournament : {};
    const rounds = Array.isArray(source.rounds) ? source.rounds : [];
    return {
      status: ['empty', 'running', 'completed'].includes(source.status) ? source.status : 'empty',
      championId: captainIds.has(source.championId) ? source.championId : '',
      rounds: rounds.slice(0, 8).map((round, roundIndex) => ({
        id: String(round.id || `r${roundIndex + 1}`).slice(0, 24),
        name: String(round.name || `第 ${roundIndex + 1} 轮`).slice(0, 32),
        matches: (Array.isArray(round.matches) ? round.matches : []).slice(0, 32).map((match, matchIndex) => ({
          id: String(match.id || `r${roundIndex + 1}m${matchIndex + 1}`).slice(0, 32),
          teamAId: captainIds.has(match.teamAId) ? match.teamAId : '',
          teamBId: captainIds.has(match.teamBId) ? match.teamBId : '',
          scoreA: match.scoreA === '' || match.scoreA === undefined ? '' : Math.max(0, Number(match.scoreA) || 0),
          scoreB: match.scoreB === '' || match.scoreB === undefined ? '' : Math.max(0, Number(match.scoreB) || 0),
          winnerId: captainIds.has(match.winnerId) ? match.winnerId : '',
          status: ['pending', 'bye', 'completed'].includes(match.status) ? match.status : 'pending',
        })),
      })),
    };
  }

  const defaultState = {
    mode: 'referee_single_client',
    settings: {
      minTeams: 5,
      maxTeams: 20,
      totalTeams: seed.captains.length,
      playersPerTeam: 4,
      drawCount: 3,
      roundTiers: [1, 2, 3, 4],
      autoRandomStrategy: 'balanced',
      timeoutStrategy: 'random_available',
      disabledHexcores: [],
      ruleTemplates: [],
      tierNames: { 0: '队长专属', 1: '侏儒马', 2: '中等马', 3: '上等马', 4: '猛犸' },
    },
    captains: clone(seed.captains),
    players: clone(seed.players),
    hexcoreAssignments: clone(seed.hexcoreAssignments || { c7: seed.hexcores }),
    hexcoreDraft: {
      captainId: '',
      slots: [],
      chosen: [],
      seenIds: [],
      refreshUsed: false,
      drawOrder: [],
    },
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
    tournament: {
      status: 'empty',
      championId: '',
      rounds: [],
    },
    undoStack: [],
    ui: {
      activeView: 'draft',
      eventFilter: 'all',
    },
  };

  Hexcore2.normalizeState = function normalizeState(state) {
    state.settings = state.settings || clone(defaultState.settings);
    state.settings.tierNames = state.settings.tierNames || clone(defaultState.settings.tierNames);
    state.settings.tierNames[0] = state.settings.tierNames[0] || defaultState.settings.tierNames[0];
    state.settings.minTeams = state.settings.minTeams || defaultState.settings.minTeams;
    state.settings.maxTeams = state.settings.maxTeams || defaultState.settings.maxTeams;
    state.settings.playersPerTeam = state.settings.playersPerTeam || defaultState.settings.playersPerTeam;
    state.settings.drawCount = state.settings.drawCount || defaultState.settings.drawCount;
    state.settings.roundTiers = Array.isArray(state.settings.roundTiers) && state.settings.roundTiers.length
      ? state.settings.roundTiers.map(tier => Math.max(1, Math.min(4, Number(tier) || 1)))
      : [...defaultState.settings.roundTiers];
    state.settings.autoRandomStrategy = state.settings.autoRandomStrategy || defaultState.settings.autoRandomStrategy;
    state.settings.timeoutStrategy = state.settings.timeoutStrategy || defaultState.settings.timeoutStrategy;
    state.settings.disabledHexcores = Array.isArray(state.settings.disabledHexcores) ? state.settings.disabledHexcores : [];
    state.settings.ruleTemplates = Array.isArray(state.settings.ruleTemplates)
      ? state.settings.ruleTemplates.slice(0, 8).map(normalizeRuleTemplate)
      : [];
    state.captains = state.captains || clone(defaultState.captains);
    state.settings.totalTeams = state.captains.length;
    state.players = state.players || clone(defaultState.players);
    reconcilePlayerTeamIds(state.captains, state.players);
    rebalancePlayerTiers(state.captains, state.players);
    state.hexcoreAssignments = state.hexcoreAssignments || {};
    state.hexcoreDraft = state.hexcoreDraft || clone(defaultState.hexcoreDraft);
    state.hexcoreDraft.captainId = state.hexcoreDraft.captainId || '';
    state.hexcoreDraft.slots = Array.isArray(state.hexcoreDraft.slots) ? state.hexcoreDraft.slots : [];
    state.hexcoreDraft.chosen = Array.isArray(state.hexcoreDraft.chosen) ? state.hexcoreDraft.chosen : [];
    state.hexcoreDraft.seenIds = Array.isArray(state.hexcoreDraft.seenIds) ? state.hexcoreDraft.seenIds : [];
    state.hexcoreDraft.refreshUsed = Boolean(state.hexcoreDraft.refreshUsed);
    state.hexcoreDraft.drawOrder = Array.isArray(state.hexcoreDraft.drawOrder)
      ? state.hexcoreDraft.drawOrder.filter(id => state.captains.some(captain => captain.id === id))
      : [];
    state.draft = state.draft || clone(defaultState.draft);
    state.draft.baseOrder = reconcileBaseOrder(state.captains, state.draft.baseOrder);
    state.draft.maxRounds = state.draft.maxRounds || defaultState.draft.maxRounds;
    if (state.settings.roundTiers.length < state.draft.maxRounds) {
      while (state.settings.roundTiers.length < state.draft.maxRounds) {
        state.settings.roundTiers.push(Math.min(4, state.settings.roundTiers.length + 1));
      }
    }
    if (state.settings.roundTiers.length > state.draft.maxRounds) {
      state.settings.roundTiers = state.settings.roundTiers.slice(0, state.draft.maxRounds);
    }
    state.draft.phase = state.draft.phase || 'captain_action';
    state.draft.currentOrder = state.draft.currentOrder || [...state.draft.baseOrder];
    state.draft.currentIndex = Number.isInteger(state.draft.currentIndex) ? state.draft.currentIndex : 0;
    state.draft.selectedSlot = Number.isInteger(state.draft.selectedSlot) ? state.draft.selectedSlot : 0;
    state.draft.runtimeEffects = state.draft.runtimeEffects || [];
    state.draft.explanations = state.draft.explanations || [];
    state.draft.pickedThisTurn = Boolean(state.draft.pickedThisTurn);
    state.draft.paused = Boolean(state.draft.paused);
    state.events = state.events || [];
    state.tournament = normalizeTournament(state.tournament, state.captains);
    state.undoStack = state.undoStack || [];
    state.ui = state.ui || { activeView: 'draft', eventFilter: 'all' };
    state.ui.activeView = state.ui.activeView || 'draft';
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
    isHexcoreEnabled(hexcoreId) {
      return !(Hexcore2.state.settings.disabledHexcores || []).includes(hexcoreId);
    },
    roundTier(round) {
      const tiers = Hexcore2.state.settings.roundTiers || [1, 2, 3, 4];
      const tier = tiers[Math.max(0, Number(round) - 1)] || Math.min(4, Number(round) || 1);
      return Math.max(1, Math.min(4, Number(tier) || 1));
    },
    workflowStatus() {
      const state = Hexcore2.state;
      const captainReady = state.captains.length >= state.settings.minTeams
        && state.captains.length <= state.settings.maxTeams
        && state.captains.every(captain => String(captain.name || '').trim());
      const hexcoreReady = captainReady && state.captains.every(captain =>
        (state.hexcoreAssignments[captain.id] || []).length >= 3
      );
      return {
        captainReady,
        hexcoreReady,
        playersDraftReady: captainReady && hexcoreReady,
        missingHexcoreCaptains: state.captains
          .filter(captain => (state.hexcoreAssignments[captain.id] || []).length < 3)
          .map(captain => captain.id),
      };
    },
  };
})(window);
