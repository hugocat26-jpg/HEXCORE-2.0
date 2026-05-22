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
    return captains.some(captain => captain.playerId === player.id);
  }

  const RESULT_SCORE = {
    '未参赛': 0,
    '1轮游': 1,
    '4强': 4,
    '亚军': 7,
    '冠军': 10,
    FMVP: 12,
  };

  const RESULT_RANK = {
    '未参赛': 0,
    '1轮游': 1,
    '4强': 2,
    '亚军': 3,
    '冠军': 4,
    FMVP: 5,
  };

  const CAMPS = ['local', 'outsider'];
  const CAMP_LABELS = {
    local: '本地人',
    outsider: '外地人',
  };

  function normalizeCamp(value) {
    const text = String(value || '').trim().toLowerCase();
    if (text === 'local' || text === '本地' || text === '本地人') return 'local';
    if (text === 'outsider' || text === 'away' || text === '外地' || text === '外地人') return 'outsider';
    return '';
  }

  function normalizeResultLabel(value) {
    const text = String(value || '').trim();
    if (['FMVP', 'fmvp', 'MVP'].includes(text)) return 'FMVP';
    if (['冠军', '冠軍', 'champion'].includes(text)) return '冠军';
    if (['亚军', '亞軍', 'runner-up', 'runnerup'].includes(text)) return '亚军';
    if (['4强', '四强', '四強', 'top4', 'Top4'].includes(text)) return '4强';
    if (['1轮游', '一轮游', '一輪遊', '首轮', '首輪'].includes(text)) return '1轮游';
    return '未参赛';
  }

  function normalizeSeasonResults(value) {
    const result = {};
    if (Array.isArray(value)) {
      value.slice(0, 6).forEach((item, index) => {
        result[`s${index + 1}`] = normalizeResultLabel(item);
      });
    } else if (value && typeof value === 'object') {
      for (let index = 1; index <= 6; index += 1) {
        result[`s${index}`] = normalizeResultLabel(
          value[`s${index}`]
          || value[`S${index}`]
          || value[`season${index}`]
          || value[`第${index}届`]
          || value[`第${index}屆`]
        );
      }
    }
    for (let index = 1; index <= 6; index += 1) {
      if (!result[`s${index}`]) result[`s${index}`] = '未参赛';
    }
    return result;
  }

  function normalizeFmvpSeasons(item, seasonResults) {
    const raw = item && (item.fmvpSeasons || item.FMVP届数 || item.fmvp || item.FMVP);
    const source = Array.isArray(raw) ? raw : String(raw || '').split(/[，,、|/]/);
    const seasons = source
      .map(value => String(value || '').trim())
      .filter(Boolean)
      .map(value => value.replace(/^第?(\d+)届?$/u, 'S$1').toUpperCase());
    Object.entries(seasonResults).forEach(([key, value]) => {
      if (value === 'FMVP') seasons.push(key.toUpperCase());
    });
    return Array.from(new Set(seasons)).slice(0, 6);
  }

  function stableTieSeed(player) {
    const text = `${player.gameId || ''}|${player.id || ''}|${player.name || ''}`;
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
      hash = ((hash << 5) - hash) + text.charCodeAt(index);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  function performanceMeta(player) {
    const seasonResults = normalizeSeasonResults(player.seasonResults);
    const results = Object.values(seasonResults);
    const explicitScore = Number(player.resultScore);
    const resultScore = Number.isFinite(explicitScore) && explicitScore > 0
      ? Math.round(explicitScore)
      : results.reduce((sum, result) => sum + (RESULT_SCORE[result] || 0), 0);
    const latestResult = [...results].reverse().find(result => result && result !== '未参赛') || '未参赛';
    return {
      seasonResults,
      resultScore,
      tieBreakers: {
        championCount: results.filter(result => result === '冠军' || result === 'FMVP').length,
        runnerUpCount: results.filter(result => result === '亚军').length,
        top4Count: results.filter(result => ['4强', '亚军', '冠军', 'FMVP'].includes(result)).length,
        appearanceCount: results.filter(result => result !== '未参赛').length,
        latestResultRank: RESULT_RANK[latestResult] || 0,
      },
    };
  }

  function compareByOfficialTier(a, b) {
    const scoreDiff = (Number(b.resultScore) || 0) - (Number(a.resultScore) || 0);
    if (scoreDiff) return scoreDiff;
    const aTie = a.tieBreakers || {};
    const bTie = b.tieBreakers || {};
    const keys = ['championCount', 'runnerUpCount', 'top4Count', 'appearanceCount', 'latestResultRank'];
    for (const key of keys) {
      const diff = (Number(bTie[key]) || 0) - (Number(aTie[key]) || 0);
      if (diff) return diff;
    }
    return (Number(a.tieSeed) || 0) - (Number(b.tieSeed) || 0);
  }

  function isHistoricalFmvp(player) {
    return Boolean(player && (player.isFmvp || (Array.isArray(player.fmvpSeasons) && player.fmvpSeasons.length)));
  }

  function rebalancePlayerTiers(captains, players) {
    const captainPlayerIds = new Set(captains.map(captain => captain.playerId).filter(Boolean));
    players.forEach(player => {
      if (captainPlayerIds.has(player.id) || isCaptainPoolPlayer(player, captains)) {
        player.status = 'captain';
        delete player.teamId;
      } else {
        if (player.status === 'captain') player.status = 'available';
      }
    });

    CAMPS.forEach(camp => {
      const sorted = players
        .filter(player => player.camp === camp)
        .sort(compareByOfficialTier);
      sorted.forEach((player, index) => {
        player.tier = Math.max(1, Math.min(5, 5 - Math.floor(index / 5)));
      });
    });
  }

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, Math.round(number)));
  }

  function teamMemberCapacityFromTotal(playersPerTeam, hasCaptainPlayer) {
    const totalCapacity = clampNumber(playersPerTeam, 1, 8, defaultState.settings.playersPerTeam);
    return Math.max(0, hasCaptainPlayer ? totalCapacity - 1 : totalCapacity);
  }

  const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,48}$/;
  const OFFICIAL_PLAYER_LIMIT = 50;

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
    return source.slice(0, OFFICIAL_PLAYER_LIMIT).map((player, index) => {
      const item = player && typeof player === 'object' ? player : {};
      const oldId = String(item.id ?? '').trim();
      const id = safeId(oldId, `p${index + 1}`, usedIds);
      if (oldId) playerIdMap.set(oldId, id);
      playerIdMap.set(id, id);
      const status = ['available', 'drafted', 'disabled', 'captain'].includes(item.status) ? item.status : 'available';
      const meta = performanceMeta(item);
      const seasonResults = meta.seasonResults;
      const fmvpSeasons = normalizeFmvpSeasons(item, seasonResults);
      const normalized = {
        id,
        camp: normalizeCamp(item.camp || item.阵营) || (index < 25 ? 'local' : 'outsider'),
        lane: sanitizeText(item.lane, '未分配', 16),
        name: sanitizeText(item.name, `选手${index + 1}`, 32),
        gameId: sanitizeText(item.gameId, id, 40),
        score: clampNumber(item.score, 0, 120, 60),
        tier: clampNumber(item.tier, 0, 5, 1),
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
        isFmvp: Boolean(item.isFmvp || fmvpSeasons.length),
        fmvpSeasons,
        seasonResults,
        resultScore: meta.resultScore || clampNumber(item.score, 0, 120, 60),
        tieBreakers: meta.tieBreakers,
        tieSeed: Number.isFinite(Number(item.tieSeed)) ? Number(item.tieSeed) : stableTieSeed({ ...item, id }),
        role: item.role === 'captain' ? 'captain' : undefined,
      };
      return player && typeof player === 'object' ? Object.assign(player, normalized) : normalized;
    });
  }

  function normalizeCaptainEconomy(economy) {
    const source = economy && typeof economy === 'object' ? economy : {};
    const roundStateSource = source.roundState && typeof source.roundState === 'object' ? source.roundState : {};
    const roundState = {};
    for (let round = 1; round <= 4; round += 1) {
      const item = roundStateSource[round] || roundStateSource[String(round)] || {};
      roundState[round] = {
        freeShopUsed: Boolean(item.freeShopUsed),
        refreshCount: clampNumber(item.refreshCount, 0, 99, 0),
        purchaseUsed: Boolean(item.purchaseUsed),
        skipped: Boolean(item.skipped),
      };
    }
    return {
      gold: clampNumber(source.gold, 0, 999, defaultState.settings.initialGold),
      incomeAppliedRounds: Array.isArray(source.incomeAppliedRounds)
        ? source.incomeAppliedRounds
          .map(round => clampNumber(round, 1, 4, 1))
          .filter((round, index, all) => all.indexOf(round) === index)
        : [1],
      roundState,
    };
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
      const captainPlayerId = remapId(item.playerId, playerIdMap);
      const captainGameId = captainPlayerId ? sanitizeText(item.playerGameId || item.gameId, '', 40) : '';
      const memberCapacity = teamMemberCapacityFromTotal(playersPerTeam, Boolean(captainPlayerId));
      const normalized = {
        id,
        name: sanitizeText(item.name, `C${index + 1} 队伍`, 40),
        record: sanitizeText(item.record, '待定', 24),
        team: (Array.isArray(item.team) ? item.team : [])
          .map(playerId => remapId(playerId, playerIdMap))
          .filter(Boolean)
          .filter((playerId, playerIndex, all) => all.indexOf(playerId) === playerIndex)
          .slice(0, memberCapacity),
        playerId: captainPlayerId,
        playerGameId: captainGameId,
        economy: normalizeCaptainEconomy(item.economy),
      };
      return captain && typeof captain === 'object' ? Object.assign(captain, normalized) : normalized;
    });
  }

  function releaseRemovedCaptains(keptCaptains, removedCaptains, players) {
    const keptCaptainPlayerIds = new Set(keptCaptains.map(captain => captain.playerId).filter(Boolean));
    removedCaptains.forEach(captain => {
      [...(captain.team || []), captain.playerId].forEach(playerId => {
        if (!playerId || keptCaptainPlayerIds.has(playerId)) return;
        const player = players.find(item => item.id === playerId);
        if (!player) return;
        player.status = 'available';
        delete player.teamId;
        delete player.isCaptain;
        delete player.role;
      });
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
        tier: clampNumber(item.tier, 1, 5, 1),
        price: clampNumber(item.price, 1, 5, item.tier || 1),
      };
    }).filter(card => card.playerId);

    const currentDrawSource = source.currentDraw && typeof source.currentDraw === 'object'
      ? source.currentDraw
      : null;
    const allowedPickModes = new Set(['normal', 'shop', 'open_pick', 'blind_box', 'mystery_swap', 'hellhound']);
    const pickMode = currentDrawSource
      ? sanitizeText(currentDrawSource.pickMode, 'normal', 32)
      : 'normal';
    const currentDraw = currentDrawSource
      ? {
        id: sanitizeText(currentDrawSource.id, `draw_${Date.now()}`, 48),
        captainId: remapCaptain(currentDrawSource.captainId),
        round: clampNumber(currentDrawSource.round, 1, 8, source.round || defaultState.draft.round),
        tier: clampNumber(currentDrawSource.tier, 1, 5, 1),
        effectiveTier: clampNumber(currentDrawSource.effectiveTier, 1, 5, currentDrawSource.tier || 1),
        cards: normalizeCards(currentDrawSource.cards),
        reason: sanitizeText(currentDrawSource.reason, '', 120),
        pickMode: allowedPickModes.has(pickMode) ? pickMode : 'normal',
        generatedBy: sanitizeText(currentDrawSource.generatedBy, 'free_shop', 32),
        refreshCostPaid: clampNumber(currentDrawSource.refreshCostPaid, 0, 4, 0),
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
      finalFillCompleted: Boolean(source.finalFillCompleted),
    };
  }

  function normalizeRuleTemplate(template) {
    const source = template && typeof template === 'object' ? template : {};
    const maxRounds = clampNumber(source.maxRounds, 1, 8, defaultState.draft.maxRounds);
    const roundTiers = Array.isArray(source.roundTiers)
      ? source.roundTiers.slice(0, maxRounds).map(tier => clampNumber(tier, 1, 5, 1))
      : [...defaultState.settings.roundTiers].slice(0, maxRounds);
    while (roundTiers.length < maxRounds) {
      roundTiers.push(Math.min(4, roundTiers.length + 1));
    }

    return {
      name: String(source.name || '未命名模板').slice(0, 40),
      savedAt: String(source.savedAt || '').slice(0, 40),
      teamCount: clampNumber(source.teamCount, defaultState.settings.minTeams, defaultState.settings.maxTeams, defaultState.settings.totalTeams),
      playersPerTeam: source.teamSizeIncludesCaptain === true
        ? clampNumber(source.playersPerTeam, 2, 8, defaultState.settings.playersPerTeam)
        : clampNumber(clampNumber(source.playersPerTeam, 1, 8, defaultState.settings.playersPerTeam) + 1, 2, 8, defaultState.settings.playersPerTeam),
      teamSizeIncludesCaptain: true,
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
    return [0, 1, 2, 3, 4, 5].reduce((result, tier) => {
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
      minTeams: 10,
      maxTeams: 10,
      totalTeams: 10,
      playersPerTeam: 5,
      teamSizeIncludesCaptain: true,
      teamCountCustomized: false,
      drawCount: 5,
      shopSize: 5,
      economyMode: 'gold_shop',
      initialGold: 6,
      roundIncome: 3,
      refreshCosts: [1, 2, 3, 4],
      pickTimeoutSeconds: 30,
      roundTiers: [1, 2, 3, 4],
      autoRandomStrategy: 'balanced',
      timeoutStrategy: 'random_available',
      disabledHexcores: [],
      ruleTemplates: [],
      tierNames: { 0: '队长锁定', 1: '1费基础', 2: '2费轮换', 3: '3费主力', 4: '4费顶配', 5: '5费核心' },
    },
    captains: clone(seed.captains.slice(0, 10)),
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
      round: 1,
      maxRounds: 4,
      baseOrder: seed.captains.slice(0, 10).map(captain => captain.id),
      currentOrder: seed.captains.slice(0, 10).map(captain => captain.id),
      currentIndex: 0,
      selectedSlot: 0,
      currentDraw: null,
      runtimeEffects: [],
      explanations: [],
      pickedThisTurn: false,
      paused: false,
      finalFillCompleted: false,
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
    const legacyNoGoldState = !state.settings || state.settings.economyMode !== 'gold_shop';
    state.settings = state.settings || clone(defaultState.settings);
    state.settings.tierNames = normalizeTierNames(state.settings.tierNames);
    state.settings.minTeams = 10;
    state.settings.maxTeams = 10;
    state.settings.totalTeams = 10;
    const savedPlayersPerTeam = clampNumber(state.settings.playersPerTeam, 1, 8, defaultState.settings.playersPerTeam);
    state.settings.playersPerTeam = state.settings.teamSizeIncludesCaptain === true
      ? clampNumber(savedPlayersPerTeam, 2, 8, defaultState.settings.playersPerTeam)
      : clampNumber(savedPlayersPerTeam + 1, 2, 8, defaultState.settings.playersPerTeam);
    state.settings.teamSizeIncludesCaptain = true;
    state.settings.teamCountCustomized = Boolean(state.settings.teamCountCustomized);
    state.settings.drawCount = 5;
    state.settings.shopSize = 5;
    state.settings.economyMode = 'gold_shop';
    state.settings.initialGold = clampNumber(state.settings.initialGold, 0, 99, defaultState.settings.initialGold);
    state.settings.roundIncome = clampNumber(state.settings.roundIncome, 0, 99, defaultState.settings.roundIncome);
    state.settings.refreshCosts = Array.isArray(state.settings.refreshCosts) && state.settings.refreshCosts.length
      ? state.settings.refreshCosts.slice(0, 4).map(cost => clampNumber(cost, 1, 4, 1))
      : [...defaultState.settings.refreshCosts];
    state.settings.pickTimeoutSeconds = clampNumber(state.settings.pickTimeoutSeconds, 1, 300, defaultState.settings.pickTimeoutSeconds);
    state.settings.roundTiers = Array.isArray(state.settings.roundTiers) && state.settings.roundTiers.length
      ? state.settings.roundTiers.map(tier => Math.max(1, Math.min(5, Number(tier) || 1)))
      : [...defaultState.settings.roundTiers];
    state.settings.roundTiers = [1, 2, 3, 4];
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
    if (state.captains.length !== defaultState.settings.totalTeams) {
      const keptCaptains = state.captains.slice(0, defaultState.settings.totalTeams);
      const removedCaptains = state.captains.slice(defaultState.settings.totalTeams);
      releaseRemovedCaptains(keptCaptains, removedCaptains, state.players);
      state.captains = keptCaptains;
      state.draft = {
        ...clone(defaultState.draft),
        baseOrder: state.captains.map(captain => captain.id),
        currentOrder: state.captains.map(captain => captain.id),
      };
    }
    state.settings.teamCountCustomized = false;
    if (legacyNoGoldState && !state.legacyNoGoldBackup) {
      state.legacyNoGoldBackup = {
        migratedAt: new Date().toISOString(),
        captains: clone(state.captains.map(captain => ({ id: captain.id, name: captain.name, team: captain.team }))),
        draft: clone(state.draft || {}),
      };
      state.captains.forEach(captain => {
        captain.team = [];
      });
      state.players.forEach(player => {
        if (player.status === 'drafted') {
          player.status = 'available';
          delete player.teamId;
        }
      });
      state.draft = {
        ...clone(defaultState.draft),
        baseOrder: state.captains.map(captain => captain.id),
        currentOrder: state.captains.map(captain => captain.id),
      };
    }
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
    state.draft.maxRounds = clampNumber(state.draft.maxRounds, 4, 4, defaultState.draft.maxRounds);
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
    const campFilters = state.ui.playerCampFilters && typeof state.ui.playerCampFilters === 'object' ? state.ui.playerCampFilters : {};
    state.ui.playerCampFilters = {
      local: ['all', '1', '2', '3', '4', '5'].includes(String(campFilters.local)) ? String(campFilters.local) : 'all',
      outsider: ['all', '1', '2', '3', '4', '5'].includes(String(campFilters.outsider)) ? String(campFilters.outsider) : 'all',
    };
    state.ui.hexFilter = typeof state.ui.hexFilter === 'string' ? state.ui.hexFilter.slice(0, 32) : 'all';
    state.ui.hexCaptainId = captainIdMap.get(String(state.ui.hexCaptainId || '')) || '';
    state.ui.editingNamePlayerId = playerIdMap.get(String(state.ui.editingNamePlayerId || '')) || '';
    state.ui.editingGameIdPlayerId = playerIdMap.get(String(state.ui.editingGameIdPlayerId || '')) || '';
    state.ui.addPlayerModal = Boolean(state.ui.addPlayerModal);
    state.ui.orderDrawerOpen = Boolean(state.ui.orderDrawerOpen);
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
    teamTotalSize(captainId) {
      const captain = Hexcore2.state.captains.find(item => item.id === captainId);
      if (!captain) return 0;
      return captain.team.length + (Hexcore2.selectors.captainPlayer(captainId) ? 1 : 0);
    },
    captainPlayer(captainId) {
      const captain = Hexcore2.state.captains.find(item => item.id === captainId);
      return captain && captain.playerId
        ? Hexcore2.state.players.find(player => player.id === captain.playerId) || null
        : null;
    },
    captainCamp(captainId) {
      const player = Hexcore2.selectors.captainPlayer(captainId);
      return player ? player.camp : '';
    },
    campLabel(camp) {
      return CAMP_LABELS[camp] || '未分阵营';
    },
    isCaptainPlayer(playerId) {
      return Hexcore2.state.captains.some(captain => captain.playerId === playerId);
    },
    teamMemberCapacity(captainId) {
      const captain = Hexcore2.state.captains.find(item => item.id === captainId);
      if (!captain) return Math.max(0, Hexcore2.state.settings.playersPerTeam - 1);
      return teamMemberCapacityFromTotal(
        Hexcore2.state.settings.playersPerTeam,
        Boolean(Hexcore2.selectors.captainPlayer(captainId))
      );
    },
    availablePlayers(tier, camp) {
      return Hexcore2.state.players.filter(player =>
        player.tier === tier
        && player.status === 'available'
        && (!camp || player.camp === camp)
        && !Hexcore2.selectors.isCaptainPlayer(player.id)
      );
    },
    availableCampPlayers(captainId, excludedIds = new Set()) {
      const camp = Hexcore2.selectors.captainCamp(captainId);
      return Hexcore2.state.players.filter(player =>
        player.status === 'available'
        && player.camp === camp
        && player.tier >= 1
        && player.tier <= 5
        && !Hexcore2.selectors.isCaptainPlayer(player.id)
        && !excludedIds.has(player.id)
      );
    },
    currentHexcores() {
      const captain = Hexcore2.selectors.currentCaptain();
      return captain ? (Hexcore2.state.hexcoreAssignments[captain.id] || []) : [];
    },
    teamCount() {
      return Hexcore2.state.captains.length;
    },
    campPlayerCount(camp) {
      return Hexcore2.state.players.filter(player => player.camp === camp).length;
    },
    campCaptainCount(camp) {
      return Hexcore2.state.captains.filter(captain => Hexcore2.selectors.captainCamp(captain.id) === camp).length;
    },
    campTeamLimit(camp) {
      const playerCount = Hexcore2.selectors.campPlayerCount(camp);
      const playersPerTeam = Math.max(1, Number(Hexcore2.state.settings.playersPerTeam) || 5);
      return Math.floor(playerCount / playersPerTeam);
    },
    canAddCampCaptain(camp, replacedCamp = '') {
      if (!camp) return false;
      const currentCount = Hexcore2.selectors.campCaptainCount(camp);
      const adjustedCount = currentCount - (replacedCamp === camp ? 1 : 0) + 1;
      return adjustedCount <= Hexcore2.selectors.campTeamLimit(camp);
    },
    isHexcoreEnabled(hexcoreId) {
      return !(Hexcore2.state.settings.disabledHexcores || []).includes(hexcoreId);
    },
    roundTier(round) {
      const tiers = Hexcore2.state.settings.roundTiers || [1, 2, 3, 4];
      const tier = tiers[Math.max(0, Number(round) - 1)] || Math.min(4, Number(round) || 1);
      return Math.max(1, Math.min(5, Number(tier) || 1));
    },
    workflowChecklist() {
      const state = Hexcore2.state;
      const teamCountOk = state.captains.length === 10;
      const namedCaptains = state.captains.filter(captain => String(captain.name || '').trim()).length;
      const assignedCaptainCount = state.captains.filter(captain => Boolean(Hexcore2.selectors.captainPlayer(captain.id))).length;
      const missingHexcoreCaptains = state.captains.filter(captain => (state.hexcoreAssignments[captain.id] || []).length < 3);
      const campCounts = CAMPS.reduce((result, camp) => {
        result[camp] = state.players.filter(player => player.camp === camp).length;
        return result;
      }, {});
      const captainCampCounts = CAMPS.reduce((result, camp) => {
        result[camp] = state.captains.filter(captain => Hexcore2.selectors.captainCamp(captain.id) === camp).length;
        return result;
      }, {});
      const assignedPlayerIds = new Map();
      const rosterIssues = [];
      state.captains.forEach(captain => {
        const captainCamp = Hexcore2.selectors.captainCamp(captain.id);
        if (captain.team.length > Hexcore2.selectors.teamMemberCapacity(captain.id)) {
          rosterIssues.push(`${captain.name} 超员`);
        }
        captain.team.forEach(playerId => {
          if (assignedPlayerIds.has(playerId)) rosterIssues.push(`${playerId} 重复归属`);
          assignedPlayerIds.set(playerId, captain.id);
          const player = state.players.find(item => item.id === playerId);
          if (!player) rosterIssues.push(`${captain.name} 包含缺失选手`);
          if (player && player.teamId !== captain.id) rosterIssues.push(`${player.name} 归属不一致`);
          if (player && captainCamp && player.camp !== captainCamp) rosterIssues.push(`${captain.name} 含异阵营队员 ${player.name}`);
        });
        if (captain.playerId && !Hexcore2.selectors.captainPlayer(captain.id)) {
          rosterIssues.push(`${captain.name} 队长不在选手库`);
        }
      });
      const openSlots = state.captains.reduce((sum, captain) => (
        sum + Math.max(0, Hexcore2.selectors.teamMemberCapacity(captain.id) - captain.team.length)
      ), 0);
      const availablePlayers = state.players.filter(player => player.status === 'available' && player.tier >= 1 && player.tier <= 5 && !Hexcore2.selectors.isCaptainPlayer(player.id));
      const tierCounts = [1, 2, 3, 4, 5].map(tier => ({
        tier,
        name: state.settings.tierNames[tier],
        count: availablePlayers.filter(player => player.tier === tier).length,
      }));
      const weakTiers = [];
      const campIssues = [];
      if (state.players.length !== 50) campIssues.push(`总人数 ${state.players.length}/50`);
      CAMPS.forEach(camp => {
        const limit = Hexcore2.selectors.campTeamLimit(camp);
        if (campCounts[camp] !== 25) campIssues.push(`${CAMP_LABELS[camp]} ${campCounts[camp]}/25`);
        if (captainCampCounts[camp] !== 5) campIssues.push(`${CAMP_LABELS[camp]}队长 ${captainCampCounts[camp]}/5`);
        if (captainCampCounts[camp] > limit) campIssues.push(`${CAMP_LABELS[camp]}队伍 ${captainCampCounts[camp]}/${limit}，超过阵营人数/5`);
        const drawablePool = state.players.filter(player =>
          player.camp === camp
          && player.tier >= 1
          && player.tier <= 5
          && player.status !== 'disabled'
          && !Hexcore2.selectors.isCaptainPlayer(player.id)
        ).length;
        if (drawablePool !== 20) campIssues.push(`${CAMP_LABELS[camp]}可抽池 ${drawablePool}/20`);
      });
      const items = [
        {
          id: 'team-count',
          label: '队伍数量',
          status: teamCountOk ? 'pass' : 'block',
          detail: `当前 ${state.captains.length}/10 队`,
          view: 'rules',
        },
        {
          id: 'camp-count',
          label: '阵营人数',
          status: campIssues.length ? 'block' : 'pass',
          detail: campIssues.length ? campIssues.slice(0, 4).join('；') : '本地人25/25，外地人25/25；双方队长各5/5',
          view: 'players',
        },
        {
          id: 'team-name',
          label: '队伍名称',
          status: namedCaptains === state.captains.length ? 'pass' : 'block',
          detail: `${namedCaptains}/${state.captains.length} 队已命名`,
          view: 'teams',
        },
        {
          id: 'captain-player',
          label: '队长确认',
          status: assignedCaptainCount === state.captains.length ? 'pass' : 'block',
          detail: `${assignedCaptainCount}/${state.captains.length} 队已指定队长选手`,
          view: 'teams',
        },
        {
          id: 'hexcore-draw',
          label: '海克斯抽取',
          status: missingHexcoreCaptains.length ? 'block' : 'pass',
          detail: missingHexcoreCaptains.length ? `${missingHexcoreCaptains.length} 队未抽满 3 个海克斯` : '全部队长已抽满 3 个',
          view: 'hexcores',
        },
        {
          id: 'roster-integrity',
          label: '阵容一致性',
          status: rosterIssues.length ? 'block' : 'pass',
          detail: rosterIssues.length ? rosterIssues.slice(0, 3).join('；') : '队伍、队长和选手归属一致',
          view: 'settings',
        },
        {
          id: 'player-capacity',
          label: '可选人数',
          status: availablePlayers.length >= openSlots ? 'pass' : 'block',
          detail: `可选 ${availablePlayers.length} 人，剩余队员空位 ${openSlots}`,
          view: 'players',
        },
        {
          id: 'pool-capacity',
          label: '卡池容量',
          status: weakTiers.length ? 'warn' : 'pass',
          detail: weakTiers.length
            ? `${weakTiers.map(item => `${item.name}${item.count}`).join('、')}，低于当前队伍数`
            : '每个阵营按评分独立分成 1-5 费各5人',
          view: 'players',
        },
      ];
      return {
        items,
        blockingItems: items.filter(item => item.status === 'block'),
        warningItems: items.filter(item => item.status === 'warn'),
        missingHexcoreCaptains: missingHexcoreCaptains.map(captain => captain.id),
      };
    },
    workflowStage() {
      const state = Hexcore2.state;
      const checklist = Hexcore2.selectors.workflowChecklist();
      const blockedIds = new Set(checklist.blockingItems.map(item => item.id));
      if (blockedIds.has('team-count') || blockedIds.has('camp-count') || blockedIds.has('team-name') || state.players.length === 0) {
        return { id: 'data-prep', label: '数据准备', order: 1, checklist };
      }
      if (blockedIds.has('captain-player') || blockedIds.has('roster-integrity') || blockedIds.has('player-capacity')) {
        return { id: 'captain-confirm', label: '队长确认', order: 2, checklist };
      }
      if (blockedIds.has('hexcore-draw')) {
        return { id: 'hexcore-draw', label: '队长抽海克斯', order: 3, checklist };
      }
      if (state.draft.phase === 'completed') {
        return { id: 'roster-confirm', label: '阵容确认', order: 5, checklist };
      }
      return { id: 'player-draft', label: '队员抽选', order: 4, checklist };
    },
    workflowStatus() {
      const stage = Hexcore2.selectors.workflowStage();
      const checklist = stage.checklist;
      const captainReady = !checklist.blockingItems.some(item =>
        ['team-count', 'camp-count', 'team-name', 'captain-player', 'roster-integrity', 'player-capacity'].includes(item.id)
      );
      const hexcoreReady = captainReady && !checklist.blockingItems.some(item => item.id === 'hexcore-draw');
      return {
        captainReady,
        hexcoreReady,
        playersDraftReady: captainReady && hexcoreReady,
        stage,
        checklist,
        missingHexcoreCaptains: checklist.missingHexcoreCaptains,
      };
    },
  };
})(window);
