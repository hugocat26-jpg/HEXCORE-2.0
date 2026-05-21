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
    if (player.isCaptain || player.role === 'captain') return true;
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

  const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,48}$/;

  function sanitizeText(value, fallback, maxLength) {
    const text = String(value ?? fallback ?? '').trim();
    return (text || String(fallback ?? '')).slice(0, maxLength);
  }

  function safeId(value, fallback, usedIds) {
    const raw = String(value ?? '').trim();
    const candidate = SAFE_ID_PATTERN.test(raw) ? raw : fallback;
    let id = SAFE_ID_PATTERN.test(candidate) ? candidate : fallback;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${fallback}_${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    return id;
  }

  function remapId(id, idMap) {
    return idMap.get(String(id ?? '').trim()) || '';
  }

  function sanitizePlayers(players, playerIdMap) {
    const source = Array.isArray(players) ? players : clone(defaultState.players);
    const usedIds = new Set();
    return source.slice(0, 600).map((player, index) => {
      const item = player && typeof player === 'object' ? player : {};
      const oldId = String(item.id ?? '').trim();
      const id = safeId(oldId, `p${index + 1}`, usedIds);
      if (oldId) playerIdMap.set(oldId, id);
      playerIdMap.set(id, id);
      const status = ['available', 'drafted', 'disabled', 'captain'].includes(item.status) ? item.status : 'available';
      const normalized = {
        id,
        lane: sanitizeText(item.lane, '未分配', 16),
        name: sanitizeText(item.name, `选手${index + 1}`, 32),
        gameId: sanitizeText(item.gameId, id, 40),
        score: clampNumber(item.score, 0, 120, 60),
        tier: clampNumber(item.tier, 0, 4, 1),
        kda: sanitizeText(item.kda, '0.0', 12),
        damage: sanitizeText(item.damage, '0K', 12),
        winRate: sanitizeText(item.winRate, '0%', 12),
        heroes: Array.isArray(item.heroes)
          ? item.heroes.map(hero => sanitizeText(hero, '', 8)).filter(Boolean).slice(0, 5)
          : sanitizeText(item.heroes, '待,定,位', 40).split(/[，,、|/]/).map(hero => hero.trim()).filter(Boolean).slice(0, 5),
        manifesto: sanitizeText(item.manifesto, '', 80),
        status,
        teamId: sanitizeText(item.teamId, '', 48),
        isCaptain: Boolean(item.isCaptain),
        role: item.role === 'captain' ? 'captain' : undefined,
      };
      return player && typeof player === 'object' ? Object.assign(player, normalized) : normalized;
    });
  }

  function sanitizeCaptains(captains, captainIdMap, playerIdMap, playersPerTeam) {
    const source = Array.isArray(captains) && captains.length ? captains : clone(defaultState.captains);
    const usedIds = new Set();
    return source.slice(0, defaultState.settings.maxTeams).map((captain, index) => {
      const item = captain && typeof captain === 'object' ? captain : {};
      const oldId = String(item.id ?? '').trim();
      const id = safeId(oldId, `c${index + 1}`, usedIds);
      if (oldId) captainIdMap.set(oldId, id);
      captainIdMap.set(id, id);
      const normalized = {
        id,
        name: sanitizeText(item.name, `C${index + 1} 队伍`, 40),
        record: sanitizeText(item.record, '待定', 24),
        team: (Array.isArray(item.team) ? item.team : [])
          .map(playerId => remapId(playerId, playerIdMap))
          .filter(Boolean)
          .filter((playerId, playerIndex, all) => all.indexOf(playerId) === playerIndex)
          .slice(0, playersPerTeam),
        playerId: remapId(item.playerId, playerIdMap),
        playerGameId: sanitizeText(item.playerGameId || item.gameId, '', 40),
      };
      return captain && typeof captain === 'object' ? Object.assign(captain, normalized) : normalized;
    });
  }

  function normalizeEvents(events) {
    const source = Array.isArray(events) ? events : [];
    return source.slice(0, 80).map(event => {
      const item = event && typeof event === 'object' ? event : {};
      return {
        time: sanitizeText(item.time, '', 16),
        title: sanitizeText(item.title, '事件', 40),
        body: sanitizeText(item.body, '', 240),
        level: ['info', 'draw', 'warn', 'success'].includes(item.level) ? item.level : 'info',
        payload: item.payload && typeof item.payload === 'object' && !Array.isArray(item.payload) ? item.payload : {},
      };
    });
  }

  function normalizeHexcoreAssignments(assignments, captains) {
    const source = assignments && typeof assignments === 'object' && !Array.isArray(assignments) ? assignments : {};
    const hexcoreById = new Map(seed.hexcores.map(hexcore => [hexcore.id, hexcore]));
    return captains.reduce((result, captain) => {
      const assigned = Array.isArray(source[captain.id]) ? source[captain.id] : [];
      result[captain.id] = assigned
        .map(hexcore => hexcoreById.get(String(hexcore && hexcore.id ? hexcore.id : hexcore)))
        .filter(Boolean)
        .filter((hexcore, index, all) => all.findIndex(item => item.id === hexcore.id) === index)
        .slice(0, 8)
        .map(hexcore => ({ ...hexcore }));
      return result;
    }, {});
  }

  function normalizeDraft(draft, captains, playerIdMap, captainIdMap) {
    const source = draft && typeof draft === 'object' ? draft : {};
    const captainIds = new Set(captains.map(captain => captain.id));
    const remapCaptain = value => {
      const id = remapId(value, captainIdMap);
      return captainIds.has(id) ? id : '';
    };
    const normalizeCards = cards => (Array.isArray(cards) ? cards : []).slice(0, 12).map(card => {
      const item = card && typeof card === 'object' ? card : {};
      return {
        ...item,
        playerId: remapId(item.playerId, playerIdMap),
        displayPlayerId: remapId(item.displayPlayerId, playerIdMap) || remapId(item.playerId, playerIdMap),
      };
    }).filter(card => card.playerId);

    const currentDrawSource = source.currentDraw && typeof source.currentDraw === 'object'
      ? source.currentDraw
      : null;
    const allowedPickModes = new Set(['normal', 'open_pick', 'blind_box', 'mystery_swap', 'hellhound']);
    const pickMode = currentDrawSource
      ? sanitizeText(currentDrawSource.pickMode, 'normal', 32)
      : 'normal';
    const currentDraw = currentDrawSource
      ? {
        id: sanitizeText(currentDrawSource.id, `draw_${Date.now()}`, 48),
        captainId: remapCaptain(currentDrawSource.captainId),
        round: clampNumber(currentDrawSource.round, 1, 8, source.round || defaultState.draft.round),
        tier: clampNumber(currentDrawSource.tier, 1, 4, 1),
        effectiveTier: clampNumber(currentDrawSource.effectiveTier, 1, 4, currentDrawSource.tier || 1),
        cards: normalizeCards(currentDrawSource.cards),
        reason: sanitizeText(currentDrawSource.reason, '', 120),
        pickMode: allowedPickModes.has(pickMode) ? pickMode : 'normal',
        timeoutEndsAt: currentDrawSource.timeoutEndsAt ? clampNumber(currentDrawSource.timeoutEndsAt, 0, Number.MAX_SAFE_INTEGER, 0) : undefined,
        timeoutPausedRemainingMs: currentDrawSource.timeoutPausedRemainingMs ? clampNumber(currentDrawSource.timeoutPausedRemainingMs, 0, 300000, 0) : undefined,
        timeLimitSeconds: currentDrawSource.timeLimitSeconds ? clampNumber(currentDrawSource.timeLimitSeconds, 1, 300, defaultState.settings.pickTimeoutSeconds) : undefined,
        hellhoundStep: currentDrawSource.hellhoundStep ? clampNumber(currentDrawSource.hellhoundStep, 0, 8, 0) : undefined,
        mysterySwapped: Boolean(currentDrawSource.mysterySwapped),
      }
      : null;

    return {
      ...clone(defaultState.draft),
      ...source,
      phase: ['setup', 'round_start', 'captain_action', 'completed'].includes(source.phase) ? source.phase : 'captain_action',
      round: clampNumber(source.round, 1, 8, defaultState.draft.round),
      maxRounds: clampNumber(source.maxRounds, 1, 8, defaultState.draft.maxRounds),
      baseOrder: reconcileBaseOrder(captains, Array.isArray(source.baseOrder) ? source.baseOrder.map(remapCaptain).filter(Boolean) : []),
      currentOrder: Array.isArray(source.currentOrder) ? source.currentOrder.map(remapCaptain).filter(Boolean) : [],
      currentIndex: clampNumber(source.currentIndex, 0, Math.max(0, captains.length - 1), 0),
      selectedSlot: clampNumber(source.selectedSlot, 0, 12, 0),
      currentDraw,
      runtimeEffects: Array.isArray(source.runtimeEffects) ? source.runtimeEffects.slice(0, 80).map(effect => {
        const item = effect && typeof effect === 'object' ? { ...effect } : {};
        ['captainId', 'sourceCaptainId', 'targetCaptainId', 'firstCaptainId', 'secondCaptainId'].forEach(key => {
          if (key in item) item[key] = remapCaptain(item[key]);
        });
        ['playerId', 'targetPlayerId', 'firstPlayerId', 'secondPlayerId'].forEach(key => {
          if (key in item) item[key] = remapId(item[key], playerIdMap);
        });
        item.type = sanitizeText(item.type, 'effect', 32);
        item.reason = sanitizeText(item.reason, '', 120);
        return item;
      }) : [],
      explanations: [],
      pickedThisTurn: Boolean(source.pickedThisTurn),
      paused: Boolean(source.paused),
    };
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
      tierNames: normalizeTierNames(source.tierNames),
      disabledHexcores: Array.isArray(source.disabledHexcores)
        ? source.disabledHexcores.filter(id => typeof id === 'string').slice(0, 50)
        : [],
    };
  }

  function normalizeTierNames(tierNames) {
    const source = tierNames && typeof tierNames === 'object' ? tierNames : {};
    return [0, 1, 2, 3, 4].reduce((result, tier) => {
      const fallback = defaultState.settings.tierNames[tier];
      const value = String(source[tier] || fallback).trim().slice(0, 12);
      result[tier] = value || fallback;
      return result;
    }, {});
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
      pickTimeoutSeconds: 30,
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
      theme: 'default',
    },
  };

  Hexcore2.normalizeState = function normalizeState(state) {
    if (!state || typeof state !== 'object') state = clone(defaultState);
    state.settings = state.settings || clone(defaultState.settings);
    state.settings.tierNames = normalizeTierNames(state.settings.tierNames);
    state.settings.minTeams = clampNumber(state.settings.minTeams, 5, 20, defaultState.settings.minTeams);
    state.settings.maxTeams = clampNumber(state.settings.maxTeams, state.settings.minTeams, 20, defaultState.settings.maxTeams);
    state.settings.playersPerTeam = clampNumber(state.settings.playersPerTeam, 1, 8, defaultState.settings.playersPerTeam);
    state.settings.drawCount = clampNumber(state.settings.drawCount, 1, 8, defaultState.settings.drawCount);
    state.settings.pickTimeoutSeconds = clampNumber(state.settings.pickTimeoutSeconds, 1, 300, defaultState.settings.pickTimeoutSeconds);
    state.settings.roundTiers = Array.isArray(state.settings.roundTiers) && state.settings.roundTiers.length
      ? state.settings.roundTiers.map(tier => Math.max(1, Math.min(4, Number(tier) || 1)))
      : [...defaultState.settings.roundTiers];
    state.settings.autoRandomStrategy = state.settings.autoRandomStrategy || defaultState.settings.autoRandomStrategy;
    state.settings.timeoutStrategy = state.settings.timeoutStrategy || defaultState.settings.timeoutStrategy;
    state.settings.disabledHexcores = Array.isArray(state.settings.disabledHexcores) ? state.settings.disabledHexcores : [];
    state.settings.ruleTemplates = Array.isArray(state.settings.ruleTemplates)
      ? state.settings.ruleTemplates.slice(0, 8).map(normalizeRuleTemplate)
      : [];

    const captainIdMap = new Map();
    const playerIdMap = new Map();
    state.players = sanitizePlayers(state.players, playerIdMap);
    state.captains = sanitizeCaptains(state.captains, captainIdMap, playerIdMap, state.settings.playersPerTeam);
    state.settings.totalTeams = state.captains.length;
    reconcilePlayerTeamIds(state.captains, state.players);
    rebalancePlayerTiers(state.captains, state.players);
    state.hexcoreAssignments = normalizeHexcoreAssignments(state.hexcoreAssignments, state.captains);

    const hexcoreDraft = state.hexcoreDraft && typeof state.hexcoreDraft === 'object' ? state.hexcoreDraft : clone(defaultState.hexcoreDraft);
    state.hexcoreDraft = {
      captainId: captainIdMap.get(String(hexcoreDraft.captainId || '')) || '',
      slots: Array.isArray(hexcoreDraft.slots) ? hexcoreDraft.slots.map(id => String(id || '').trim()).filter(Boolean).slice(0, 6) : [],
      chosen: Array.isArray(hexcoreDraft.chosen) ? hexcoreDraft.chosen.map(id => String(id || '').trim()).filter(Boolean).slice(0, 12) : [],
      seenIds: Array.isArray(hexcoreDraft.seenIds) ? hexcoreDraft.seenIds.map(id => String(id || '').trim()).filter(Boolean).slice(0, 80) : [],
      refreshUsed: Boolean(hexcoreDraft.refreshUsed),
      drawOrder: Array.isArray(hexcoreDraft.drawOrder)
        ? hexcoreDraft.drawOrder.map(id => captainIdMap.get(String(id || ''))).filter(id => state.captains.some(captain => captain.id === id))
        : [],
    };
    state.draft = normalizeDraft(state.draft, state.captains, playerIdMap, captainIdMap);
    if (!state.draft.currentOrder.length) state.draft.currentOrder = [...state.draft.baseOrder];
    if (state.draft.currentIndex >= state.draft.currentOrder.length) {
      state.draft.currentIndex = Math.max(0, state.draft.currentOrder.length - 1);
    }
    state.draft.baseOrder = reconcileBaseOrder(state.captains, state.draft.baseOrder);
    state.draft.maxRounds = clampNumber(state.draft.maxRounds, 1, 8, defaultState.draft.maxRounds);
    state.draft.round = clampNumber(state.draft.round, 1, state.draft.maxRounds, defaultState.draft.round);
    if (state.settings.roundTiers.length < state.draft.maxRounds) {
      while (state.settings.roundTiers.length < state.draft.maxRounds) {
        state.settings.roundTiers.push(Math.min(4, state.settings.roundTiers.length + 1));
      }
    }
    if (state.settings.roundTiers.length > state.draft.maxRounds) {
      state.settings.roundTiers = state.settings.roundTiers.slice(0, state.draft.maxRounds);
    }
    state.events = normalizeEvents(state.events);
    state.tournament = normalizeTournament(state.tournament, state.captains);
    state.undoStack = Array.isArray(state.undoStack) ? state.undoStack.slice(0, 30) : [];
    state.ui = state.ui && typeof state.ui === 'object' ? state.ui : { activeView: 'draft', eventFilter: 'all' };
    state.ui.activeView = ['draft', 'teams', 'players', 'hexcores', 'schedule', 'tournament', 'rules', 'logs', 'settings'].includes(state.ui.activeView)
      ? state.ui.activeView
      : 'draft';
    state.ui.eventFilter = ['all', 'hexcore', 'team', 'warning', 'draw'].includes(state.ui.eventFilter)
      ? state.ui.eventFilter
      : 'all';
    state.ui.eventCaptainFilter = typeof state.ui.eventCaptainFilter === 'string' ? state.ui.eventCaptainFilter.slice(0, 48) : 'all';
    state.ui.eventSearch = typeof state.ui.eventSearch === 'string' ? state.ui.eventSearch.slice(0, 80) : '';
    state.ui.theme = ['default', 'neon', 'apple'].includes(state.ui.theme) ? state.ui.theme : 'default';
    state.ui.playerFilter = typeof state.ui.playerFilter === 'string' ? state.ui.playerFilter.slice(0, 32) : 'all';
    state.ui.hexFilter = typeof state.ui.hexFilter === 'string' ? state.ui.hexFilter.slice(0, 32) : 'all';
    state.ui.hexCaptainId = captainIdMap.get(String(state.ui.hexCaptainId || '')) || '';
    state.ui.editingNamePlayerId = playerIdMap.get(String(state.ui.editingNamePlayerId || '')) || '';
    state.ui.editingGameIdPlayerId = playerIdMap.get(String(state.ui.editingGameIdPlayerId || '')) || '';
    state.ui.addPlayerModal = Boolean(state.ui.addPlayerModal);
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
