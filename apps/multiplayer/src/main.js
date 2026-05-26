(function bootstrap(global) {
  const Hexcore2 = global.Hexcore2;
  const HEXCORE_CANDIDATE_COUNT = 5;
  const HEXCORE_PICK_LIMIT = 1;
  const MULTIPLAYER_SESSION_KEY = 'hexcore2_multiplayer_session_v1';
  let hexDetailHideTimer = null;

  if (global.location && global.location.protocol === 'file:') {
    document.getElementById('app').innerHTML = `
      <main class="launch-warning">
        <section>
          <h1>请通过部署服务访问 HEXCORE 2.0</h1>
          <p>当前页面不支持 file:// 直接打开。请在项目目录执行 npm start，然后访问 http://127.0.0.1:4176/。</p>
        </section>
      </main>
    `;
    return;
  }

  if (Hexcore2.economyEngine) {
    Hexcore2.economyEngine.ensureAll();
    Hexcore2.economyEngine.applyRoundIncome(Hexcore2.state.draft.round);
  }
  Hexcore2.turnOrderEngine.recompute();

  function persist() {
    if (Hexcore2.storageService) Hexcore2.storageService.save(Hexcore2.state);
  }

  function renderAndPersist() {
    persist();
    Hexcore2.ui.render();
  }

  function openRecruitReveal(reveal, options = {}) {
    if (!reveal || !Hexcore2.state.ui) return false;
    const playerIds = Array.isArray(reveal.playerIds)
      ? reveal.playerIds.map(id => String(id || '')).filter(Boolean).slice(0, 6)
      : (reveal.playerId ? [String(reveal.playerId)] : []);
    if (!playerIds.length) return false;
    Hexcore2.state.ui.recruitReveal = {
      title: String(reveal.title || '海克斯入队揭示').slice(0, 40),
      source: String(reveal.source || '海克斯效果').slice(0, 40),
      captainId: String(reveal.captainId || '').slice(0, 48),
      playerIds,
      summary: String(reveal.summary || '海克斯获得选手').slice(0, 140),
      detail: String(reveal.detail || '确认后继续流程。').slice(0, 180),
      advanceTurn: Boolean(options.advanceTurn),
      createdAt: Date.now(),
    };
    return true;
  }

  function openEconomyReveal(reveal) {
    if (!reveal || !Hexcore2.state.ui) return false;
    const rows = Array.isArray(reveal.rows)
      ? reveal.rows
        .map(row => ({
          captainId: String(row.captainId || '').slice(0, 48),
          name: String(row.name || '未知队长').slice(0, 40),
          amount: Math.max(0, Math.round(Number(row.amount) || 0)),
          beforeGold: Math.max(0, Math.round(Number(row.beforeGold) || 0)),
          afterGold: Math.max(0, Math.round(Number(row.afterGold) || 0)),
        }))
        .filter(row => row.amount > 0)
        .slice(0, 6)
      : [];
    if (!rows.length) return false;
    Hexcore2.state.ui.economyReveal = {
      title: String(reveal.title || '经济结算').slice(0, 40),
      source: String(reveal.source || '海克斯效果').slice(0, 40),
      captainId: String(reveal.captainId || '').slice(0, 48),
      total: Math.max(0, Math.round(Number(reveal.total) || rows.reduce((sum, row) => sum + row.amount, 0))),
      rows,
      summary: String(reveal.summary || '经济效果已结算').slice(0, 140),
      detail: String(reveal.detail || '确认后继续流程。').slice(0, 180),
      createdAt: Date.now(),
    };
    return true;
  }

  function playersDraftReady() {
    const workflow = Hexcore2.selectors.workflowStatus();
    return workflow.playersDraftReady;
  }

  function goldShopMode() {
    return Hexcore2.state.settings.economyMode === 'gold_shop';
  }

  function goldDraftStarted() {
    if (!goldShopMode()) return false;
    const draft = Hexcore2.state.draft || {};
    const economyTouched = Hexcore2.state.captains.some(captain => {
      const roundState = captain.economy && captain.economy.roundState ? captain.economy.roundState : {};
      return Object.values(roundState).some(item =>
        item && (item.freeShopUsed || item.refreshCount > 0 || item.purchaseUsed || item.skipped)
      );
    });
    return draft.round > 1
      || draft.phase === 'completed'
      || Boolean(draft.currentDraw)
      || Boolean(draft.pickedThisTurn)
      || Hexcore2.state.captains.some(captain => (captain.team || []).length > 0)
      || economyTouched;
  }

  function queryParam(name) {
    const search = global.location && typeof global.location.search === 'string' ? global.location.search : '';
    const pattern = new RegExp(`[?&]${name}=([^&]*)`);
    const match = search.match(pattern);
    return match ? decodeURIComponent(match[1].replace(/\+/g, ' ')) : '';
  }

  function isCaptainClient() {
    const role = (queryParam('role') || queryParam('view') || queryParam('mode') || '').toLowerCase();
    return role === 'captain';
  }

  function isViewerClient() {
    const role = (queryParam('role') || queryParam('view') || queryParam('mode') || '').toLowerCase();
    return role === 'viewer';
  }

  function rejectViewerClient(actionLabel) {
    if (!isViewerClient()) return false;
    Hexcore2.eventStore.append(actionLabel || '观众端操作失败', '观众端只读，无法操作', 'warn');
    Hexcore2.ui.render();
    return true;
  }

  function clientTeamId() {
    if (!isCaptainClient()) return '';
    const requested = queryParam('teamId') || queryParam('captainId');
    if (requested && Hexcore2.state.captains.some(captain => captain.id === requested)) return requested;
    const current = Hexcore2.selectors.currentCaptain && Hexcore2.selectors.currentCaptain();
    return current ? current.id : (Hexcore2.state.captains[0] ? Hexcore2.state.captains[0].id : '');
  }

  function captainClientCanActOn(captainId, actionLabel) {
    if (rejectViewerClient(actionLabel)) return false;
    if (!isCaptainClient()) return true;
    if (captainId && captainId === clientTeamId()) return true;
    Hexcore2.eventStore.append(actionLabel || '队长操作失败', '队长端无权操作其它队伍', 'warn');
    Hexcore2.ui.render();
    return false;
  }

  function captainClientCanOperateCurrentTurn(actionLabel) {
    if (rejectViewerClient(actionLabel)) return false;
    if (!isCaptainClient()) return true;
    const current = Hexcore2.selectors.currentCaptain && Hexcore2.selectors.currentCaptain();
    if (current && current.id === clientTeamId()) return true;
    Hexcore2.eventStore.append(actionLabel || '队长操作失败', '非你的回合，仅可查看', 'warn');
    Hexcore2.ui.render();
    return false;
  }

  function captainClientCanUseHexcoreSession(actionLabel) {
    if (rejectViewerClient(actionLabel)) return false;
    if (!isCaptainClient()) return true;
    const session = Hexcore2.state.hexcoreDraft || {};
    if (session.captainId && session.captainId === clientTeamId()) return true;
    Hexcore2.eventStore.append(actionLabel || '海克斯操作失败', '队长端不可执行裁判海克斯动作', 'warn');
    Hexcore2.ui.render();
    return false;
  }

  function captainClientCanUseOwnedHexcore(hexcoreId, actionLabel) {
    if (rejectViewerClient(actionLabel)) return false;
    if (!isCaptainClient()) return true;
    const teamId = clientTeamId();
    const list = Hexcore2.state.hexcoreAssignments[teamId] || [];
    if (list.some(hexcore => hexcore && hexcore.id === hexcoreId && hexcore.status !== 'used')) return true;
    Hexcore2.eventStore.append(actionLabel || '海克斯执行失败', '队长端仅可发动自己的海克斯', 'warn');
    Hexcore2.ui.render();
    return false;
  }

  function rejectGoldLockedMutation(title) {
    if (!goldDraftStarted()) return false;
    Hexcore2.eventStore.append(title, '金币抽卡开始后阵容、基础顺位和规则配置已固化，请使用撤销或重置流程处理', 'warn');
    Hexcore2.ui.render();
    return true;
  }

  function snapshot(label) {
    if (Hexcore2.historyService) Hexcore2.historyService.push(label);
  }

  function appendAppliedHexcoreEvents(draw) {
    if (!draw || !Array.isArray(draw.appliedEffects) || !draw.appliedEffects.length) return;
    const captain = Hexcore2.state.captains.find(item => item.id === draw.captainId);
    draw.appliedEffects.forEach(effect => {
      Hexcore2.eventStore.append(
        '海克斯生效',
        `${captain ? captain.name : '当前队长'} 开店时触发：${effect.reason || effect.type}`,
        'warn',
        { effectType: effect.type, sourceCaptainId: effect.sourceCaptainId, captainId: draw.captainId }
      );
    });
  }

  function normalizeAfterConfigChange() {
    if (Hexcore2.normalizeState) Hexcore2.normalizeState(Hexcore2.state);
    Hexcore2.turnOrderEngine.recompute();
    Hexcore2.state.draft.currentIndex = Math.max(0, Math.min(
      Hexcore2.state.draft.currentIndex,
      Math.max(0, Hexcore2.state.draft.currentOrder.length - 1)
    ));
    Hexcore2.state.draft.currentDraw = null;
    Hexcore2.state.draft.selectedSlot = 0;
    Hexcore2.state.draft.pickedThisTurn = false;
    Hexcore2.state.draft.finalFillCompleted = false;
    if (Hexcore2.economyEngine) Hexcore2.economyEngine.ensureAll();
  }

  function resetCaptainProgressForRestart(captain, keepHexcores) {
    if (!captain) return;
    captain.economy = {
      gold: Hexcore2.state.settings.initialGold,
      incomeAppliedRounds: [1],
      roundState: {},
    };
    captain.hexcoreEconomy = {};
    captain.sponsorFlowUsed = 0;
    captain.giantSlayerDiscountUsed = {};
    if (!keepHexcores) return;
    (Hexcore2.state.hexcoreAssignments[captain.id] || []).forEach(hexcore => {
      if (!hexcore) return;
      const baseHexcore = Hexcore2.sampleData.hexcores.find(item => item.id === hexcore.id) || hexcore;
      hexcore.status = baseHexcore.mode === 'passive' ? 'passive' : 'available';
      delete hexcore.lastUsedRound;
      if (hexcore.id === 'donation' && !captain.hexcoreEconomy.donationApplied) {
        captain.economy.gold += 2;
        captain.hexcoreEconomy.donationApplied = true;
      }
      if (hexcore.id === 'origin-sage' && !captain.hexcoreEconomy.originSageBonusApplied) {
        captain.economy.gold += 2;
        captain.hexcoreEconomy.originSageBonusApplied = true;
      }
    });
  }

  function resetHexcoreDraftSession() {
    Hexcore2.state.hexcoreDraft = {
      captainId: '',
      slots: [],
      chosen: [],
      seenIds: [],
      refreshUsed: false,
      drawOrder: [],
    };
  }

  function resetDraftForRestart() {
    const baseOrder = Hexcore2.state.draft.baseOrder && Hexcore2.state.draft.baseOrder.length
      ? [...Hexcore2.state.draft.baseOrder]
      : Hexcore2.state.captains.map(captain => captain.id);
    Hexcore2.state.draft = {
      ...Hexcore2.state.draft,
      phase: 'setup',
      round: 1,
      maxRounds: 4,
      baseOrder,
      currentOrder: [...baseOrder],
      currentIndex: 0,
      selectedSlot: 0,
      currentDraw: null,
      runtimeEffects: [],
      explanations: [],
      pickedThisTurn: false,
      finalFillCompleted: false,
      started: false,
      heavenlyWindow: null,
    };
    Hexcore2.state.tournament = { status: 'empty', championId: '', rounds: [] };
  }

  function nextCaptainNumber() {
    return Hexcore2.state.captains.reduce((max, captain) => {
      const match = String(captain.id).match(/^c(\d+)$/);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0) + 1;
  }

  function nextPlayerId() {
    return Hexcore2.state.players.reduce((max, player) => {
      const match = String(player.id).match(/^p(\d+)$/);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0) + 1;
  }

  function markPlayerAvailable(player) {
    if (!player) return;
    player.status = 'available';
    delete player.teamId;
    delete player.isCaptain;
    delete player.role;
  }

  function bindCaptainPlayer(captain, player) {
    captain.playerId = player.id;
    captain.playerGameId = player.gameId || '';
    player.status = 'captain';
    delete player.teamId;
    delete player.isCaptain;
    delete player.role;
  }

  function clearCaptainBinding(captain) {
    if (!captain) return;
    delete captain.playerId;
    delete captain.playerGameId;
  }

  function demoteCaptainPlayerToTeam(captain, player) {
    if (!captain || !player || captain.team.includes(player.id)) return false;
    const capacity = Hexcore2.selectors.teamMemberCapacity(captain.id);
    if (captain.team.length >= capacity) return false;
    captain.team.push(player.id);
    player.status = 'drafted';
    player.teamId = captain.id;
    delete player.isCaptain;
    delete player.role;
    return true;
  }

  function allocatePlayerId(preferredId, usedIds) {
    if (preferredId && /^p[\w-]+$/i.test(preferredId) && !usedIds.has(preferredId)) {
      usedIds.add(preferredId);
      return preferredId;
    }
    let number = nextPlayerId();
    let id = `p${number}`;
    while (usedIds.has(id)) {
      number += 1;
      id = `p${number}`;
    }
    usedIds.add(id);
    return id;
  }

  function ownedHexIds(captainId) {
    const list = Hexcore2.state.hexcoreAssignments[captainId] || [];
    return new Set((Array.isArray(list) ? list : []).filter(Boolean).map(hex => hex.id));
  }

  function occupiedHexIds(exceptCaptainId = '') {
    const assigned = new Set();
    Object.entries(Hexcore2.state.hexcoreAssignments || {}).forEach(([captainId, list]) => {
      if (captainId === exceptCaptainId || !Array.isArray(list)) return;
      list.forEach(hex => {
        if (hex && hex.id) assigned.add(hex.id);
      });
    });
    return assigned;
  }

  function isHexcoreOccupiedByOtherCaptain(hexcoreId, captainId) {
    return occupiedHexIds(captainId).has(hexcoreId);
  }

  function isGoldModeAllowedHexcore(hexcore) {
    return Boolean(hexcore)
      && (!Hexcore2.hexcoreEngine
        || !Hexcore2.hexcoreEngine.isDisabledInGoldMode
        || !Hexcore2.hexcoreEngine.isDisabledInGoldMode(hexcore.id));
  }

  function drawHexcoreSlots(captainId, count, extraExcludes = []) {
    const excluded = new Set([...ownedHexIds(captainId), ...occupiedHexIds(captainId), ...extraExcludes]);
    const candidates = Hexcore2.sampleData.hexcores
      .filter(hex => !excluded.has(hex.id))
      .filter(hex => isGoldModeAllowedHexcore(hex))
      .filter(hex => Hexcore2.selectors.isHexcoreEnabled(hex.id));
    return [...candidates].sort(() => Math.random() - 0.5).slice(0, count).map(hex => hex.id);
  }

  function resetHexcoreSession() {
    Hexcore2.state.hexcoreDraft = Hexcore2.state.hexcoreDraft || {};
    Hexcore2.state.hexcoreDraft.captainId = '';
    Hexcore2.state.hexcoreDraft.slots = [];
    Hexcore2.state.hexcoreDraft.chosen = [];
    Hexcore2.state.hexcoreDraft.seenIds = [];
    Hexcore2.state.hexcoreDraft.refreshUsed = false;
  }

  function applyHexcoreOnAcquire(captain, hexcore) {
    if (!captain || !hexcore || !captain.economy) return;
    captain.hexcoreEconomy = captain.hexcoreEconomy || {};
    if (hexcore.id === 'donation' && !captain.hexcoreEconomy.donationApplied) {
      captain.economy.gold += 2;
      captain.hexcoreEconomy.donationApplied = true;
      Hexcore2.eventStore.append('捐赠', `${captain.name} 获得赞助捐赠，初始资金 +2`, 'success');
    }
    if (hexcore.id === 'origin-sage' && !captain.hexcoreEconomy.originSageBonusApplied) {
      captain.economy.gold += 2;
      captain.hexcoreEconomy.originSageBonusApplied = true;
      Hexcore2.eventStore.append('神秘贤者·启元', `${captain.name} 获得启元祝福，初始资金 +2`, 'success');
    }
  }

  function browserTimerAvailable() {
    return typeof global.setTimeout === 'function'
      && typeof global.clearTimeout === 'function'
      && global.document
      && typeof global.document.querySelector === 'function';
  }

  function updateCountdownNode(name, expiresAt) {
    if (!global.document || !expiresAt) return 0;
    const node = global.document.querySelector(`[data-countdown="${name}"]`);
    const remaining = Math.max(0, Math.ceil((Number(expiresAt) - Date.now()) / 1000));
    if (node && node.textContent !== String(remaining)) {
      node.textContent = String(remaining);
    }
    return remaining;
  }

  function clearHeavenlyWindow() {
    if (Hexcore2.heavenlyWindowTimer && typeof global.clearTimeout === 'function') {
      global.clearTimeout(Hexcore2.heavenlyWindowTimer);
    }
    Hexcore2.heavenlyWindowTimer = null;
    if (Hexcore2.heavenlyWindowTickTimer && typeof global.clearInterval === 'function') {
      global.clearInterval(Hexcore2.heavenlyWindowTickTimer);
    }
    Hexcore2.heavenlyWindowTickTimer = null;
    const windowState = Hexcore2.state.draft && Hexcore2.state.draft.heavenlyWindow;
    if (windowState && windowState.active && !windowState.resolved) {
      windowState.active = false;
      windowState.resolved = true;
    }
  }

  function activeHeavenlyWindow() {
    const windowState = Hexcore2.state.draft && Hexcore2.state.draft.heavenlyWindow;
    if (!windowState || !windowState.active || windowState.resolved) return null;
    if (windowState.expiresAt && Date.now() > windowState.expiresAt) {
      clearHeavenlyWindow();
      return null;
    }
    return windowState;
  }

  function scheduleHeavenlyWindowTick() {
    if (!browserTimerAvailable()) return;
    if (Hexcore2.heavenlyWindowTimer && typeof global.clearTimeout === 'function') {
      global.clearTimeout(Hexcore2.heavenlyWindowTimer);
    }
    Hexcore2.heavenlyWindowTimer = null;
    const windowState = Hexcore2.state.draft && Hexcore2.state.draft.heavenlyWindow;
    if (!windowState || !windowState.active || windowState.resolved) return;
    const delay = Math.max(0, Number(windowState.expiresAt) - Date.now());
    Hexcore2.heavenlyWindowTimer = global.setTimeout(() => {
      activeHeavenlyWindow();
      Hexcore2.ui.render();
    }, delay || 1);
    if (Hexcore2.heavenlyWindowTimer && typeof Hexcore2.heavenlyWindowTimer.unref === 'function') {
      Hexcore2.heavenlyWindowTimer.unref();
    }
    if (typeof global.setInterval === 'function') {
      if (Hexcore2.heavenlyWindowTickTimer && typeof global.clearInterval === 'function') {
        global.clearInterval(Hexcore2.heavenlyWindowTickTimer);
      }
      Hexcore2.heavenlyWindowTickTimer = global.setInterval(() => {
        const active = activeHeavenlyWindow();
        if (active) updateCountdownNode('heavenly-window', active.expiresAt);
        if (!active && Hexcore2.heavenlyWindowTickTimer && typeof global.clearInterval === 'function') {
          global.clearInterval(Hexcore2.heavenlyWindowTickTimer);
          Hexcore2.heavenlyWindowTickTimer = null;
          Hexcore2.ui.render();
        }
      }, 250);
      if (Hexcore2.heavenlyWindowTickTimer && typeof Hexcore2.heavenlyWindowTickTimer.unref === 'function') {
        Hexcore2.heavenlyWindowTickTimer.unref();
      }
    }
  }

  function clearOriginSageNoticeTimer() {
    if (Hexcore2.originSageNoticeTimer && typeof global.clearTimeout === 'function') {
      global.clearTimeout(Hexcore2.originSageNoticeTimer);
    }
    Hexcore2.originSageNoticeTimer = null;
    if (Hexcore2.originSageNoticeTickTimer && typeof global.clearInterval === 'function') {
      global.clearInterval(Hexcore2.originSageNoticeTickTimer);
    }
    Hexcore2.originSageNoticeTickTimer = null;
  }

  function dismissOriginSageNotice(shouldRender = true) {
    const notice = Hexcore2.state.ui && Hexcore2.state.ui.originSageNotice;
    const round = notice && notice.round ? notice.round : Hexcore2.state.draft.round;
    clearOriginSageNoticeTimer();
    if (Hexcore2.state.ui) Hexcore2.state.ui.originSageNotice = null;
    openNextChargedCannonDecision(round);
    if (shouldRender && Hexcore2.ui) Hexcore2.ui.render();
  }

  function showOriginSageNotice(result, round) {
    if (!result || !result.created || !result.captainIds || !result.captainIds.length) return;
    const captainNames = result.captainIds
      .map(captainId => Hexcore2.state.captains.find(captain => captain.id === captainId))
      .filter(Boolean)
      .map(captain => captain.name);
    if (!captainNames.length) return;
    const now = Date.now();
    Hexcore2.state.ui = Hexcore2.state.ui || {};
    Hexcore2.state.ui.originSageNotice = {
      round,
      captainIds: [...result.captainIds],
      captainNames,
      createdAt: now,
      expiresAt: now + 5000,
    };
    clearOriginSageNoticeTimer();
    if (browserTimerAvailable()) {
      Hexcore2.originSageNoticeTimer = global.setTimeout(() => dismissOriginSageNotice(true), 5000);
      if (Hexcore2.originSageNoticeTimer && typeof Hexcore2.originSageNoticeTimer.unref === 'function') {
        Hexcore2.originSageNoticeTimer.unref();
      }
      if (typeof global.setInterval === 'function') {
        Hexcore2.originSageNoticeTickTimer = global.setInterval(() => {
          const notice = Hexcore2.state.ui && Hexcore2.state.ui.originSageNotice;
          if (!notice) {
            clearOriginSageNoticeTimer();
            return;
          }
          if (notice.expiresAt && Date.now() >= Number(notice.expiresAt)) {
            dismissOriginSageNotice(true);
            return;
          }
          updateCountdownNode('origin-sage', notice.expiresAt);
        }, 250);
        if (Hexcore2.originSageNoticeTickTimer && typeof Hexcore2.originSageNoticeTickTimer.unref === 'function') {
          Hexcore2.originSageNoticeTickTimer.unref();
        }
      }
    }
  }

  function heavenlyOwners() {
    return Hexcore2.state.captains.filter(captain =>
      (Hexcore2.state.hexcoreAssignments[captain.id] || []).some(hexcore =>
        hexcore.id === 'heavenly-descent'
        && hexcore.mode !== 'passive'
        && hexcore.status !== 'used'
        && Hexcore2.selectors.isHexcoreEnabled(hexcore.id)
      )
    );
  }

  function eligibleHeavenlyOwnersForPlayer(player) {
    if (!player || !player.camp) return [];
    return heavenlyOwners().filter(owner => Hexcore2.selectors.captainCamp(owner.id) === player.camp);
  }

  function openHeavenlyWindow(captain, slot, price) {
    const player = slot && Hexcore2.state.players.find(item => item.id === slot.playerId);
    if (!captain || !slot) {
      Hexcore2.state.draft.heavenlyWindow = null;
      return;
    }
    const eligibleOwners = eligibleHeavenlyOwnersForPlayer(player)
      .filter(owner => owner.id !== captain.id);
    if (!eligibleOwners.length) {
      Hexcore2.state.draft.heavenlyWindow = null;
      return;
    }
    const now = Date.now();
    Hexcore2.state.draft.heavenlyWindow = {
      active: true,
      resolved: false,
      round: Hexcore2.state.draft.round,
      captainId: captain.id,
      playerId: slot.playerId,
      slotId: slot.slotId || '',
      price: Math.max(0, Number(price) || 0),
      createdAt: now,
      expiresAt: now + 10000,
    };
    scheduleHeavenlyWindowTick();
  }

  function openLastStandConfirm(captain, options = {}) {
    if (!captain || !Hexcore2.state.ui) return false;
    Hexcore2.state.ui.lastStandConfirm = {
      captainId: captain.id,
      createdAt: Date.now(),
      autoOneChance: Boolean(options.autoOneChance),
      reason: options.reason || '',
    };
    return true;
  }

  function maybeOpenAutoLastStandPrompt(captainId, reason = 'team_full') {
    const captain = Hexcore2.state.captains.find(item => item.id === captainId);
    const current = Hexcore2.selectors.currentCaptain();
    if (!captain || !current || captain.id !== current.id) return false;
    if (Hexcore2.state.ui && (Hexcore2.state.ui.lastStandConfirm || Hexcore2.state.ui.recruitReveal)) return false;
    if (activeHeavenlyWindow()) return false;
    if (
      Hexcore2.hexcoreEngine
      && typeof Hexcore2.hexcoreEngine.lastStandDeclinedThisRound === 'function'
      && Hexcore2.hexcoreEngine.lastStandDeclinedThisRound(captain.id)
    ) {
      return false;
    }
    const item = Hexcore2.hexcoreEngine && Hexcore2.hexcoreEngine.executionQueue
      ? Hexcore2.hexcoreEngine.executionQueue(captain.id).find(entry => entry.id === 'last-stand')
      : null;
    if (!item || !item.executable) return false;
    const opened = openLastStandConfirm(captain, { autoOneChance: true, reason });
    if (opened) {
      Hexcore2.eventStore.append(
        '背水一战可发动',
        `${captain.name} 已满 4 名队员，背水一战现在可用。系统已弹出唯一一次确认窗口，请立即决定是否发动。`,
        'warn',
        { captainId: captain.id, reason }
      );
    }
    return opened;
  }

  function prepareCompensationTurn(captainId) {
    const state = Hexcore2.state;
    const order = state.draft.currentOrder || [];
    const isRepeatedTurn = order.slice(0, state.draft.currentIndex).includes(captainId);
    if (!isRepeatedTurn) return false;
    const effect = (state.draft.runtimeEffects || []).find(item =>
      item.type === 'compensation_turn'
      && item.captainId === captainId
      && Number(item.round) === Number(state.draft.round)
      && !item.consumed
    );
    if (!effect) return false;
    const captain = state.captains.find(item => item.id === captainId);
    const roundState = Hexcore2.economyEngine.roundState(captainId, state.draft.round);
    roundState.purchaseUsed = false;
    roundState.skipped = false;
    roundState.freeShopUsed = false;
    effect.consumed = true;
    effect.appliedRound = state.draft.round;
    effect.appliedAt = new Date().toISOString();
    state.draft.currentDraw = null;
    state.draft.selectedSlot = 0;
    state.draft.pickedThisTurn = false;
    Hexcore2.eventStore.append('补偿回合', `${captain ? captain.name : '目标队长'} 进入神兵天降补偿回合，可重新购买1名队员`, 'warn');
    return true;
  }

  function captainName(captainId) {
    const captain = Hexcore2.state.captains.find(item => item.id === captainId);
    return captain ? captain.name : '待定';
  }

  function buildTournamentRound(roundNumber, entrants, oldRound) {
    const matches = [];
    const pairCount = Math.floor(entrants.length / 2);
    for (let index = 0; index < pairCount; index += 1) {
      const teamAId = entrants[index] || '';
      const teamBId = entrants[entrants.length - 1 - index] || '';
      const id = `r${roundNumber}m${index + 1}`;
      const oldMatch = oldRound && oldRound.matches
        ? oldRound.matches.find(match => match.id === id && match.teamAId === teamAId && match.teamBId === teamBId)
        : null;
      const isBye = Boolean(teamAId && !teamBId);
      matches.push(oldMatch ? { ...oldMatch } : {
        id,
        teamAId,
        teamBId,
        scoreA: '',
        scoreB: '',
        winnerId: isBye ? teamAId : '',
        status: isBye ? 'bye' : 'pending',
      });
    }
    if (entrants.length % 2 === 1) {
      const teamAId = entrants[pairCount] || '';
      const id = `r${roundNumber}m${matches.length + 1}`;
      const oldMatch = oldRound && oldRound.matches
        ? oldRound.matches.find(match => match.id === id && match.teamAId === teamAId && !match.teamBId)
        : null;
      matches.push(oldMatch ? { ...oldMatch } : {
        id,
        teamAId,
        teamBId: '',
        scoreA: '',
        scoreB: '',
        winnerId: teamAId,
        status: 'bye',
      });
    }
    return {
      id: `r${roundNumber}`,
      name: entrants.length <= 2 ? '决赛' : `第 ${roundNumber} 轮`,
      matches,
    };
  }

  function buildCampVersusTournamentRound(roundNumber, campAEntrants, campBEntrants, oldRound) {
    const matches = [];
    const teamAIds = Array.isArray(campAEntrants) ? campAEntrants : [];
    const teamBIds = Array.isArray(campBEntrants) ? campBEntrants : [];
    const totalMatches = Math.max(teamAIds.length, teamBIds.length);
    for (let index = 0; index < totalMatches; index += 1) {
      const id = `r${roundNumber}m${index + 1}`;
      const oldMatch = oldRound && oldRound.matches
        ? oldRound.matches.find(match => match.id === id && match.teamAId === teamAIds[index] && match.teamBId === teamBIds[index])
        : null;
      matches.push(oldMatch ? { ...oldMatch } : {
        id,
        teamAId: teamAIds[index] || '',
        teamBId: teamBIds[index] || '',
        scoreA: '',
        scoreB: '',
        winnerId: '',
        status: teamAIds[index] && teamBIds[index] ? 'pending' : 'empty',
        byeConfirmed: false,
        pairingMode: 'camp_versus',
        expectedCampA: 'local',
        expectedCampB: 'outsider',
      });
    }
    return {
      id: `r${roundNumber}`,
      name: '阵营对抗首轮',
      matches,
      pairingMode: 'camp_versus',
    };
  }

  function isCampVersusTournamentContext(tournament, round, match) {
    return Boolean(
      (tournament && tournament.pairingMode === 'camp_versus')
      || (round && round.pairingMode === 'camp_versus')
      || (match && match.pairingMode === 'camp_versus')
      || (round && String(round.name || '').includes('阵营对抗'))
    );
  }

  function normalizeTournamentMatchStatus(match) {
    if (!match) return;
    const hasA = Boolean(match.teamAId);
    const hasB = Boolean(match.teamBId);
    if (match.pairingMode === 'camp_versus') {
      if (match.byeConfirmed && (hasA || hasB) && !(hasA && hasB)) {
        match.status = 'bye';
        match.winnerId = match.teamAId || match.teamBId;
        match.scoreA = '';
        match.scoreB = '';
        return;
      }
      if (hasA && hasB && match.status === 'completed' && match.winnerId) return;
      match.byeConfirmed = false;
      match.winnerId = '';
      if (!hasA && !hasB) {
        match.status = 'empty';
      } else if (hasA && hasB) {
        match.status = 'pending';
      } else {
        match.status = 'pending_opponent';
      }
      return;
    }
    if (hasA && !hasB) {
      match.status = 'bye';
      match.winnerId = match.teamAId;
      match.scoreA = '';
      match.scoreB = '';
      return;
    }
    if (hasA && hasB && match.status === 'completed' && match.winnerId) return;
    match.winnerId = '';
    match.status = hasA || hasB ? 'pending' : 'empty';
  }

  function clearTournamentMatchResult(match, options = {}) {
    if (!match) return;
    if (options.clearTeams) {
      match.teamAId = '';
      match.teamBId = '';
    }
    match.scoreA = '';
    match.scoreB = '';
    match.winnerId = '';
    match.byeConfirmed = false;
    normalizeTournamentMatchStatus(match);
  }

  function tournamentChangeNeedsConfirm(roundIndex, match) {
    return Boolean(
      match
      && (
        match.winnerId
        || match.status === 'completed'
        || match.status === 'bye'
        || roundIndex < ((Hexcore2.state.tournament && Hexcore2.state.tournament.rounds || []).length - 1)
      )
    );
  }

  function shuffledEntrants(entrants) {
    const pool = [...entrants];
    for (let index = pool.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
    }
    return pool;
  }

  function recomputeTournamentAdvancement() {
    const tournament = Hexcore2.state.tournament || { status: 'empty', championId: '', rounds: [] };
    if (tournament.type === 'bandle_defense') {
      recomputeBandleDefenseTournament(tournament);
      return;
    }
    if (!tournament.rounds.length) {
      tournament.status = 'empty';
      tournament.championId = '';
      Hexcore2.state.tournament = tournament;
      return;
    }

    tournament.status = 'running';
    tournament.championId = '';
    for (let roundIndex = 0; roundIndex < tournament.rounds.length; roundIndex += 1) {
      const round = tournament.rounds[roundIndex];
      round.matches.forEach(match => normalizeTournamentMatchStatus(match));

      const allDone = round.matches.length > 0 && round.matches.every(match =>
        (match.status === 'completed' || match.status === 'bye') && match.winnerId
      );
      if (!allDone) {
        tournament.rounds = tournament.rounds.slice(0, roundIndex + 1);
        break;
      }

      const winners = round.matches.map(match => match.winnerId).filter(Boolean);
      if (winners.length <= 1) {
        tournament.status = 'completed';
        tournament.championId = winners[0] || '';
        tournament.rounds = tournament.rounds.slice(0, roundIndex + 1);
        break;
      }

      const oldNextRound = tournament.rounds[roundIndex + 1];
      tournament.rounds[roundIndex + 1] = buildTournamentRound(roundIndex + 2, winners, oldNextRound);
    }
    Hexcore2.state.tournament = tournament;
  }

  function bandleDefenseSummary(tournament = Hexcore2.state.tournament) {
    const matches = (tournament.rounds || []).flatMap(round => round.matches || []);
    const completedMatches = matches.filter(match => match.status === 'completed').length;
    const bandlePoints = matches.reduce((sum, match) => sum + (Number(match.bandlePoints) || 0), 0);
    const invaderPoints = matches.reduce((sum, match) => sum + (Number(match.invaderPoints) || 0), 0);
    const finalBattle = tournament.finalBattle || {};
    const bonus = Number(finalBattle.bonusPoints) || 10;
    const finalBattleCompleted = finalBattle.enabled && finalBattle.winnerCamp;
    return {
      totalMatches: matches.length,
      completedMatches,
      bandlePoints,
      invaderPoints,
      gap: Math.abs(bandlePoints - invaderPoints),
      finalBandlePoints: bandlePoints + (finalBattleCompleted && finalBattle.winnerCamp === 'bandle' ? bonus : 0),
      finalInvaderPoints: invaderPoints + (finalBattleCompleted && finalBattle.winnerCamp === 'invader' ? bonus : 0),
    };
  }

  function bandleDefenseContribution(tournament = Hexcore2.state.tournament) {
    const result = {};
    Hexcore2.state.captains.forEach(captain => {
      result[captain.id] = { wins: 0, points: 0, yordlePoints: 0 };
    });
    (tournament.rounds || []).forEach(round => {
      (round.matches || []).forEach(match => {
        if (match.status !== 'completed') return;
        if (match.winnerId && result[match.winnerId]) result[match.winnerId].wins += 1;
        if (result[match.teamAId]) {
          result[match.teamAId].points += Number(match.bandlePoints) || 0;
          result[match.teamAId].yordlePoints += (Number(match.yordleCount) || 0) * 0.5;
        }
        if (result[match.teamBId]) result[match.teamBId].points += Number(match.invaderPoints) || 0;
      });
    });
    return result;
  }

  function strongestCaptainByCamp(camp, tournament = Hexcore2.state.tournament) {
    const contribution = bandleDefenseContribution(tournament);
    return [...Hexcore2.state.captains]
      .filter(captain => Hexcore2.selectors.captainCamp(captain.id) === camp)
      .sort((a, b) => {
        const left = contribution[a.id] || {};
        const right = contribution[b.id] || {};
        return (right.points || 0) - (left.points || 0)
          || (right.wins || 0) - (left.wins || 0)
          || Hexcore2.state.draft.baseOrder.indexOf(a.id) - Hexcore2.state.draft.baseOrder.indexOf(b.id);
      })[0];
  }

  function ensureBandleFinalBattle(tournament) {
    tournament.finalBattle = tournament.finalBattle || {};
    tournament.finalBattle.enabled = true;
    tournament.finalBattle.bonusPoints = Number(tournament.finalBattle.bonusPoints) || 10;
    if (!Array.isArray(tournament.finalBattle.games) || tournament.finalBattle.games.length !== 5) {
      tournament.finalBattle.games = Array.from({ length: 5 }, (_, index) => ({
        id: `bo5g${index + 1}`,
        bandleScore: '',
        invaderScore: '',
        winnerCamp: '',
        status: 'pending',
      }));
    }
    const bestBandle = strongestCaptainByCamp('local', tournament);
    const bestInvader = strongestCaptainByCamp('outsider', tournament);
    if (!tournament.finalBattle.bandleTeamId && bestBandle) tournament.finalBattle.bandleTeamId = bestBandle.id;
    if (!tournament.finalBattle.invaderTeamId && bestInvader) tournament.finalBattle.invaderTeamId = bestInvader.id;
  }

  function recomputeBandleDefenseTournament(tournament) {
    if (!tournament.rounds.length) {
      tournament.status = 'empty';
      tournament.winnerCamp = '';
      tournament.winnerReason = '';
      Hexcore2.state.tournament = tournament;
      return;
    }
    const summary = bandleDefenseSummary(tournament);
    tournament.championId = '';
    tournament.status = 'running';
    tournament.winnerCamp = '';
    tournament.winnerReason = '';
    tournament.finalBandlePoints = summary.bandlePoints;
    tournament.finalInvaderPoints = summary.invaderPoints;
    if (summary.completedMatches < summary.totalMatches) {
      if (tournament.finalBattle) tournament.finalBattle.enabled = false;
      Hexcore2.state.tournament = tournament;
      return;
    }
    if (summary.gap > 5) {
      tournament.status = 'completed';
      tournament.winnerCamp = summary.bandlePoints > summary.invaderPoints ? 'bandle' : 'invader';
      tournament.winnerReason = 'points';
      tournament.finalBandlePoints = summary.bandlePoints;
      tournament.finalInvaderPoints = summary.invaderPoints;
      if (tournament.finalBattle) tournament.finalBattle.enabled = false;
      Hexcore2.state.tournament = tournament;
      return;
    }
    ensureBandleFinalBattle(tournament);
    const wins = (tournament.finalBattle.games || []).reduce((acc, game) => {
      if (game.status === 'completed' && game.winnerCamp) acc[game.winnerCamp] += 1;
      return acc;
    }, { bandle: 0, invader: 0 });
    tournament.finalBattle.winnerCamp = wins.bandle >= 3 ? 'bandle' : (wins.invader >= 3 ? 'invader' : '');
    if (tournament.finalBattle.winnerCamp) {
      const finalSummary = bandleDefenseSummary(tournament);
      tournament.status = 'completed';
      tournament.winnerCamp = tournament.finalBattle.winnerCamp;
      tournament.winnerReason = 'final_battle';
      tournament.finalBandlePoints = finalSummary.finalBandlePoints;
      tournament.finalInvaderPoints = finalSummary.finalInvaderPoints;
    }
    Hexcore2.state.tournament = tournament;
  }

  function buildBandleDefenseRounds(localIds, outsiderIds) {
    return [1, 2].map(day => ({
      id: `day${day}`,
      name: `Day ${day}`,
      day,
      pairingMode: 'camp_versus',
      matches: localIds.flatMap((localId, localIndex) =>
        outsiderIds.map((outsiderId, outsiderIndex) => ({
          id: `d${day}m${localIndex + 1}${outsiderIndex + 1}`,
          teamAId: localId,
          teamBId: outsiderId,
          scoreA: '',
          scoreB: '',
          winnerId: '',
          status: 'pending',
          pairingMode: 'camp_versus',
          expectedCampA: 'local',
          expectedCampB: 'outsider',
          yordleCount: 0,
          bandlePoints: 0,
          invaderPoints: 0,
        }))
      ),
    }));
  }

  function findNextHexcoreCaptain(currentCaptainId) {
    const order = (Hexcore2.state.hexcoreDraft && Hexcore2.state.hexcoreDraft.drawOrder && Hexcore2.state.hexcoreDraft.drawOrder.length)
      ? Hexcore2.state.hexcoreDraft.drawOrder
      : Hexcore2.state.captains.map(captain => captain.id);
    const currentIndex = Math.max(0, order.indexOf(currentCaptainId));
    for (let offset = 1; offset <= order.length; offset += 1) {
      const captainId = order[(currentIndex + offset) % order.length];
      const captain = Hexcore2.state.captains.find(item => item.id === captainId);
      if (captain && (Hexcore2.state.hexcoreAssignments[captain.id] || []).length < HEXCORE_PICK_LIMIT) return captain;
    }
    return null;
  }

  function syncDraftOrderFromHexcoreDrawOrder() {
    const captainIds = Hexcore2.state.captains.map(captain => captain.id);
    const validCaptainIds = new Set(captainIds);
    const seen = new Set();
    const drawOrder = (Hexcore2.state.hexcoreDraft && Array.isArray(Hexcore2.state.hexcoreDraft.drawOrder))
      ? Hexcore2.state.hexcoreDraft.drawOrder
      : [];
    const ordered = drawOrder
      .filter(captainId => validCaptainIds.has(captainId) && !seen.has(captainId) && seen.add(captainId));
    captainIds.forEach(captainId => {
      if (!seen.has(captainId)) ordered.push(captainId);
    });
    Hexcore2.state.draft.baseOrder = ordered;
  }

  function openNextChargedCannonDecision(round = Hexcore2.state.draft.round) {
    if (!Hexcore2.hexcoreEngine || !Hexcore2.hexcoreEngine.chargedCannonPendingOwners) return false;
    Hexcore2.state.ui = Hexcore2.state.ui || {};
    const notice = Hexcore2.state.ui.originSageNotice;
    if (notice && Number(notice.round) === Number(round)) return false;
    const current = Hexcore2.state.ui.chargedCannonDecision;
    if (current && Number(current.round) === Number(round)) return true;
    const pending = Hexcore2.hexcoreEngine.chargedCannonPendingOwners(round);
    if (!pending.length) {
      delete Hexcore2.state.ui.chargedCannonDecision;
      return false;
    }
    Hexcore2.state.ui.chargedCannonDecision = {
      round,
      captainId: pending[0].id,
      step: 'choose',
      openedAt: Date.now(),
    };
    return true;
  }

  function closeOrContinueChargedCannonDecision(round = Hexcore2.state.draft.round) {
    if (Hexcore2.state.ui) delete Hexcore2.state.ui.chargedCannonDecision;
    return openNextChargedCannonDecision(round);
  }

  function setChargedCannonDecisionError(decision, message) {
    if (!decision) return;
    decision.error = String(message || '大炮已充能当前无法执行').slice(0, 120);
  }

  function multiplayerSession() {
    try {
      const raw = global.localStorage && global.localStorage.getItem(MULTIPLAYER_SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function saveMultiplayerSession(session) {
    if (!session || !global.localStorage) return;
    global.localStorage.setItem(MULTIPLAYER_SESSION_KEY, JSON.stringify(session));
  }

  function persistJoinedSession(apiBase, tournamentId, payload) {
    const session = {
      ...payload.session,
      apiBase,
      tournamentId,
      stateVersion: Number((payload.tournament && payload.tournament.stateVersion) || 0),
      savedAt: new Date().toISOString(),
    };
    saveMultiplayerSession(session);
    return session;
  }

  function redirectForSession(session) {
    const role = session.role === 'viewer' ? 'viewer' : (session.role === 'captain' ? 'captain' : 'referee');
    const query = role === 'captain'
      ? `role=captain&teamId=${encodeURIComponent(session.teamId || '')}`
      : (role === 'viewer' ? 'role=viewer' : 'role=referee');
    global.location.href = `${global.location.pathname || '/'}?${query}`;
  }

  async function joinRoomWithCode(apiBase, tournamentId, code) {
    const response = await fetch(`${apiBase}/api/tournaments/${encodeURIComponent(tournamentId)}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok || !payload.session || !payload.session.sessionToken) {
      throw new Error(payload && payload.error ? payload.error : '加入失败');
    }
    return payload;
  }

  function applyTeamProjection(teams) {
    if (!Array.isArray(teams) || !teams.length) return false;
    let changed = false;
    teams.forEach(team => {
      const teamId = String(team && (team.teamId || team.id) || '').trim();
      const captain = teamId ? Hexcore2.state.captains.find(item => item.id === teamId) : null;
      if (!captain) return;
      const name = String(team.name || '').trim();
      if (name && captain.name !== name) {
        captain.name = name;
        changed = true;
      }
      if (Object.prototype.hasOwnProperty.call(team, 'renameUsed') && captain.renameUsed !== Boolean(team.renameUsed)) {
        captain.renameUsed = Boolean(team.renameUsed);
        changed = true;
      }
    });
    return changed;
  }

  function applyRoomProjection(tournament) {
    if (!tournament || typeof tournament !== 'object') return false;
    const snapshot = tournament.snapshot || {};
    let changed = false;
    if (applyTeamProjection(snapshot.teams)) changed = true;
    const currentTeamId = String(snapshot.currentTeamId || '').trim();
    if (currentTeamId && Array.isArray(Hexcore2.state.draft.currentOrder)) {
      const index = Hexcore2.state.draft.currentOrder.indexOf(currentTeamId);
      if (index >= 0 && Hexcore2.state.draft.currentIndex !== index) {
        Hexcore2.state.draft.currentIndex = index;
        changed = true;
      }
    }
    if (Number.isInteger(Number(tournament.stateVersion))) {
      Hexcore2.state.multiplayer = Hexcore2.state.multiplayer || {};
      const version = Number(tournament.stateVersion);
      if (Hexcore2.state.multiplayer.stateVersion !== version) {
        Hexcore2.state.multiplayer.stateVersion = version;
        changed = true;
      }
    }
    if (changed) {
      if (Hexcore2.storageService && Hexcore2.storageService.save) Hexcore2.storageService.save(Hexcore2.state);
      Hexcore2.ui.render();
    }
    return changed;
  }

  function syncSessionFromTournament(tournament) {
    const session = multiplayerSession();
    if (!session || !tournament) return;
    session.stateVersion = Number(tournament.stateVersion || session.stateVersion || 0);
    session.syncedAt = new Date().toISOString();
    saveMultiplayerSession(session);
  }

  async function submitRoomCommand(type, payload = {}, options = {}) {
    const session = multiplayerSession();
    if (!session || options.skipRoomCommand) return { ok: true, skipped: true };
    const response = await fetch(`${session.apiBase}/api/tournaments/${encodeURIComponent(session.tournamentId)}/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionToken: session.sessionToken,
        command: {
          commandId: `${type}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          tournamentId: session.tournamentId,
          type,
          teamId: payload.teamId || session.teamId || '',
          baseVersion: Number(session.stateVersion || 0),
          payload,
        },
      }),
    });
    const responsePayload = await response.json();
    if (!response.ok || !responsePayload.ok) {
      const message = responsePayload && responsePayload.error ? responsePayload.error : '服务端拒绝操作';
      if (global.sessionStorage && /状态版本过期/.test(message)) {
        global.sessionStorage.setItem('hexcore2_last_command_error', message);
      }
      throw new Error(message);
    }
    syncSessionFromTournament(responsePayload.tournament);
    applyRoomProjection(responsePayload.tournament);
    return responsePayload;
  }

  function applyRoomEvent(event) {
    if (!event || typeof event !== 'object') return false;
    if (event.type === 'TeamRenamed' && event.payload) {
      return applyRoomProjection({
        stateVersion: event.stateVersion,
        snapshot: {
          teams: [{
            teamId: event.payload.teamId,
            name: event.payload.name,
            renameUsed: true,
          }],
        },
      });
    }
    if (Number.isInteger(Number(event.stateVersion))) {
      return applyRoomProjection({ stateVersion: event.stateVersion, snapshot: {} });
    }
    return false;
  }

  function connectRoomEventStream() {
    const session = multiplayerSession();
    if (!session || !session.apiBase || !session.tournamentId || !global.EventSource) return;
    if (Hexcore2.roomEventSource && Hexcore2.roomEventSource.readyState !== 2) return;
    const view = session.role === 'captain' ? 'captain' : 'viewer';
    const url = `${session.apiBase}/api/tournaments/${encodeURIComponent(session.tournamentId)}/events?view=${encodeURIComponent(view)}`;
    const eventSource = new global.EventSource(url);
    Hexcore2.roomEventSource = eventSource;
    eventSource.addEventListener('snapshot', event => {
      try {
        const tournament = JSON.parse(event.data);
        syncSessionFromTournament(tournament);
        applyRoomProjection(tournament);
      } catch (error) {
        Hexcore2.eventStore.append('同步失败', '无法解析服务端快照', 'warn');
        Hexcore2.ui.render();
      }
    });
    eventSource.addEventListener('TeamRenamed', event => {
      try {
        applyRoomEvent(JSON.parse(event.data));
      } catch (error) {
        Hexcore2.eventStore.append('同步失败', '无法解析服务端改名事件', 'warn');
        Hexcore2.ui.render();
      }
    });
    eventSource.onmessage = event => {
      try {
        applyRoomEvent(JSON.parse(event.data));
      } catch (error) {
        Hexcore2.eventStore.append('同步失败', '无法解析服务端事件', 'warn');
        Hexcore2.ui.render();
      }
    };
    eventSource.onerror = () => {
      Hexcore2.state.ui = Hexcore2.state.ui || {};
      Hexcore2.state.ui.roomSyncStatus = 'reconnecting';
    };
  }

  Hexcore2.actions = {
    async joinRoom() {
      const apiBaseInput = document.getElementById('join-api-base');
      const tournamentInput = document.getElementById('join-tournament-id');
      const codeInput = document.getElementById('join-room-code');
      const apiBase = String(apiBaseInput && apiBaseInput.value ? apiBaseInput.value : 'http://127.0.0.1:4196').replace(/\/+$/, '');
      const tournamentId = String(tournamentInput && tournamentInput.value ? tournamentInput.value : '').trim();
      const code = String(codeInput && codeInput.value ? codeInput.value : '').trim();
      if (!tournamentId || !code) {
        Hexcore2.eventStore.append('加入房间失败', '请填写赛事 ID 和加入码', 'warn');
        Hexcore2.ui.render();
        return;
      }
      try {
        const payload = await joinRoomWithCode(apiBase, tournamentId, code);
        const session = persistJoinedSession(apiBase, tournamentId, payload);
        redirectForSession(session);
      } catch (error) {
        Hexcore2.eventStore.append('加入房间失败', error && error.message ? error.message : String(error), 'warn');
        Hexcore2.ui.render();
      }
    },

    async createTournamentRoom() {
      const apiBaseInput = document.getElementById('join-api-base');
      const tournamentInput = document.getElementById('create-tournament-id');
      const nameInput = document.getElementById('create-tournament-name');
      const apiBase = String(apiBaseInput && apiBaseInput.value ? apiBaseInput.value : 'http://127.0.0.1:4196').replace(/\/+$/, '');
      const providedId = String(tournamentInput && tournamentInput.value ? tournamentInput.value : '').trim();
      const tournamentId = providedId || `hexcore-${Date.now()}`;
      const name = String(nameInput && nameInput.value ? nameInput.value : 'HEXCORE 多人赛事').trim();
      if (!/^[A-Za-z0-9._:-]{1,80}$/.test(tournamentId)) {
        Hexcore2.eventStore.append('创建赛事失败', '赛事 ID 必须是 1-80 位安全标识，可使用字母、数字、点、下划线、冒号和短横线', 'warn');
        Hexcore2.ui.render();
        return;
      }
      try {
        const response = await fetch(`${apiBase}/api/tournaments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: tournamentId, name, actorId: 'local-referee' }),
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok || !payload.tournament || !payload.room) {
          throw new Error(payload && payload.error ? payload.error : '创建失败');
        }
        Hexcore2.state.ui = Hexcore2.state.ui || {};
        Hexcore2.state.ui.createdRoom = {
          apiBase,
          tournamentId: payload.tournament.tournamentId || tournamentId,
          room: payload.room,
          createdAt: new Date().toISOString(),
        };
        Hexcore2.eventStore.append('创建赛事成功', '房间码明文只显示一次，请立即分发给对应身份', 'success');
      } catch (error) {
        Hexcore2.eventStore.append('创建赛事失败', error && error.message ? error.message : String(error), 'warn');
      }
      Hexcore2.ui.render();
    },

    async enterCreatedRefereeRoom() {
      const created = Hexcore2.state.ui && Hexcore2.state.ui.createdRoom;
      const room = created && created.room;
      if (!created || !room || !room.refereeCode) {
        Hexcore2.eventStore.append('进入裁判端失败', '当前页面没有可用的裁判房间码', 'warn');
        Hexcore2.ui.render();
        return;
      }
      try {
        const payload = await joinRoomWithCode(created.apiBase, created.tournamentId, room.refereeCode);
        const session = persistJoinedSession(created.apiBase, created.tournamentId, payload);
        redirectForSession(session);
      } catch (error) {
        Hexcore2.eventStore.append('进入裁判端失败', error && error.message ? error.message : String(error), 'warn');
        Hexcore2.ui.render();
      }
    },

    startDraft(options = {}) {
      if (rejectViewerClient('开始抽选失败')) return;
      if (isCaptainClient()) {
        Hexcore2.eventStore.append('队长操作失败', '队长端不可执行裁判海克斯动作', 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (!playersDraftReady()) {
        Hexcore2.eventStore.append('流程未就绪', '请先完成队伍、队长和海克斯配置，再开始金币商店抽选队员', 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (Hexcore2.state.draft.phase === 'completed') {
        Hexcore2.eventStore.append('裁判操作', '选人流程已完成，无法重新开始', 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (!options.skipSnapshot) snapshot('开始第一轮抽卡前');
      Hexcore2.state.draft.phase = 'captain_action';
      Hexcore2.state.draft.round = 1;
      Hexcore2.state.draft.currentIndex = 0;
      Hexcore2.state.draft.currentDraw = null;
      Hexcore2.state.draft.pickedThisTurn = false;
      Hexcore2.state.draft.started = true;
      syncDraftOrderFromHexcoreDrawOrder();
      if (Hexcore2.turnOrderEngine) {
        Hexcore2.turnOrderEngine.recompute();
        Hexcore2.state.draft.currentIndex = 0;
      }
      if (Hexcore2.hexcoreEngine && Hexcore2.hexcoreEngine.ensureOriginSageForRound) {
        const originResult = Hexcore2.hexcoreEngine.ensureOriginSageForRound(1);
        showOriginSageNotice(originResult, 1);
      }
      if (Hexcore2.hexcoreEngine && Hexcore2.hexcoreEngine.ensureHungryWaveForRound) {
        Hexcore2.hexcoreEngine.ensureHungryWaveForRound(1);
      }
      openNextChargedCannonDecision(1);
      const captain = Hexcore2.selectors.currentCaptain();
      Hexcore2.eventStore.append('抽卡开始', `第 1 轮金币商店开始，当前队长为 ${captain ? captain.name : '无'}`, 'info');
      renderAndPersist();
    },

    selectCard(index) {
      Hexcore2.state.draft.selectedSlot = index;
      Hexcore2.state.draft.pickedThisTurn = false;
      renderAndPersist();
    },

    async drawCards(options = {}) {
      if (rejectViewerClient('开店失败')) return;
      if (!captainClientCanOperateCurrentTurn('开店失败')) return;
      if (!playersDraftReady()) {
        Hexcore2.eventStore.append('流程未就绪', '请先完成队伍、队长和海克斯配置，再开始金币商店抽选队员', 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (Hexcore2.state.draft.phase === 'completed') {
        Hexcore2.eventStore.append('裁判操作', '选人流程已完成，无法继续生成商店', 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (Hexcore2.state.draft.phase === 'setup') {
        Hexcore2.eventStore.append('裁判操作', '请先点击“开始抽卡”，再生成第一位队长的商店', 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (Hexcore2.state.ui && Hexcore2.state.ui.chargedCannonDecision) {
        Hexcore2.eventStore.append('大炮已充能', '请先处理轮初大炮已充能转换技，再生成商店', 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (Hexcore2.state.ui && Hexcore2.state.ui.originSageNotice) {
        Hexcore2.eventStore.append('神秘贤者·启元', '请先关闭神秘贤者·启元提示并处理轮初海克斯，再生成商店', 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (Hexcore2.hexcoreEngine && Hexcore2.hexcoreEngine.ensureOriginSageForRound) {
        const originResult = Hexcore2.hexcoreEngine.ensureOriginSageForRound(Hexcore2.state.draft.round);
        showOriginSageNotice(originResult, Hexcore2.state.draft.round);
        if (Hexcore2.state.ui && Hexcore2.state.ui.originSageNotice) {
          renderAndPersist();
          return;
        }
      }
      if (Hexcore2.hexcoreEngine && Hexcore2.hexcoreEngine.ensureHungryWaveForRound) {
        Hexcore2.hexcoreEngine.ensureHungryWaveForRound(Hexcore2.state.draft.round);
      }
      if (openNextChargedCannonDecision(Hexcore2.state.draft.round)) {
        Hexcore2.eventStore.append('大炮已充能', '请先处理轮初大炮已充能转换技，再生成商店', 'warn');
        renderAndPersist();
        return;
      }
      const captain = Hexcore2.selectors.currentCaptain();
      if (!captain) {
        Hexcore2.eventStore.append('裁判操作', '当前没有可操作队长，无法生成商店', 'warn');
        Hexcore2.ui.render();
        return;
      }
      prepareCompensationTurn(captain.id);

      const teamSize = Hexcore2.selectors.teamSize(captain.id);
      if (teamSize >= Hexcore2.selectors.teamMemberCapacity(captain.id)) {
        Hexcore2.eventStore.append('裁判操作', `${captain.name} 队伍已满，自动进入下一位`, 'warn');
        this.nextCaptain();
        return;
      }

      Hexcore2.economyEngine.applyRoundIncome(Hexcore2.state.draft.round);
      Hexcore2.economyEngine.applyCaptainTurnStart(captain.id);
      const autoBeforeDraw = Hexcore2.hexcoreEngine.autoAssignBeforeDraw(captain.id);
        if (autoBeforeDraw.handled) {
          if (autoBeforeDraw.assigned && autoBeforeDraw.reveal && openRecruitReveal(autoBeforeDraw.reveal, { advanceTurn: true })) {
          renderAndPersist();
          return;
        }
        if (autoBeforeDraw.advance) {
          this.nextCaptain({ skipSnapshot: true });
          return;
        }
        renderAndPersist();
        return;
      }
      const roundState = Hexcore2.economyEngine.roundState(captain.id);
      if (roundState.freeShopUsed) {
        const operate = Hexcore2.economyEngine.canOperate(captain.id);
        if (!operate.ok) {
          Hexcore2.eventStore.append('刷新失败', operate.reason, 'warn');
          Hexcore2.ui.render();
          return;
        }
        this.refreshShop();
        return;
      }

      try {
        await submitRoomCommand('OpenShop', { teamId: captain.id }, options);
      } catch (error) {
        Hexcore2.eventStore.append('开店失败', error && error.message ? error.message : String(error), 'warn');
        Hexcore2.ui.render();
        return;
      }

      snapshot(`免费开店前：${captain.name}`);
      Hexcore2.state.draft.currentDraw = Hexcore2.shopEngine.generate(captain.id, {
        generatedBy: 'free_shop',
        reason: '本轮首次免费商店',
      });
      appendAppliedHexcoreEvents(Hexcore2.state.draft.currentDraw);
      Hexcore2.economyEngine.markFreeShop(captain.id);
      Hexcore2.state.draft.selectedSlot = 0;
      Hexcore2.state.draft.pickedThisTurn = false;
      const drawn = Hexcore2.state.draft.currentDraw.cards.length;
      Hexcore2.eventStore.append(
        drawn > 0 ? '免费商店生成' : '卡池不足',
        drawn > 0 ? `${captain.name} 第 ${Hexcore2.state.draft.round} 轮免费生成 ${drawn} 张商店卡` : '剩余队员不足，无法生成商店',
        drawn > 0 ? 'draw' : 'warn'
      );
      Hexcore2.ui.render();
    },

    async refreshShop(options = {}) {
      if (rejectViewerClient('刷新失败')) return;
      const captain = Hexcore2.selectors.currentCaptain();
      if (!captainClientCanOperateCurrentTurn('刷新失败')) return;
      if (!captain) {
        Hexcore2.eventStore.append('刷新失败', '当前没有可操作队长', 'warn');
        Hexcore2.ui.render();
        return;
      }
      Hexcore2.economyEngine.applyRoundIncome(Hexcore2.state.draft.round);
      Hexcore2.economyEngine.applyCaptainTurnStart(captain.id);
      const roundState = Hexcore2.economyEngine.roundState(captain.id);
      if (!roundState.freeShopUsed) {
        this.drawCards();
        return;
      }
      try {
        await submitRoomCommand('RefreshShop', { teamId: captain.id }, options);
      } catch (error) {
        Hexcore2.eventStore.append('刷新失败', error && error.message ? error.message : String(error), 'warn');
        Hexcore2.ui.render();
        return;
      }
      snapshot(`刷新商店前：${captain.name}`);
      const result = Hexcore2.economyEngine.payRefresh(captain.id);
      if (!result.ok) {
        if (Hexcore2.state.undoStack) Hexcore2.state.undoStack.shift();
        Hexcore2.eventStore.append('刷新失败', result.reason, 'warn');
        Hexcore2.ui.render();
        return;
      }
      Hexcore2.state.draft.currentDraw = Hexcore2.shopEngine.generate(captain.id, {
        generatedBy: 'paid_refresh',
        refreshCostPaid: result.cost,
        reason: result.cost === 0
          ? (result.freeReason === 'round_one_tier_one'
            ? '第一轮未见1费卡，免费刷新'
            : (result.freeReason === 'wise_benevolence' ? '贤者的博爱免费刷新' : '海克斯免费刷新'))
          : `付费刷新，消耗 ${result.cost} 金币`,
      });
      appendAppliedHexcoreEvents(Hexcore2.state.draft.currentDraw);
      Hexcore2.state.draft.selectedSlot = 0;
      Hexcore2.state.draft.pickedThisTurn = false;
      Hexcore2.eventStore.append(
        result.cost === 0 ? '免费刷新' : '商店刷新',
        result.cost === 0
          ? `${captain.name} 免费刷新商店，原因：${result.freeReason === 'round_one_tier_one' ? '第一轮商店未出现1费卡' : (result.freeReason === 'wise_benevolence' ? '贤者的博爱' : '摄影艺术家')}`
          : `${captain.name} 花费 ${result.cost} 金币刷新商店，剩余 ${result.gold} 金币`,
        'draw'
      );
      renderAndPersist();
    },

    async pickCard(index, options = {}) {
      if (rejectViewerClient('购买失败')) return;
      if (!captainClientCanOperateCurrentTurn('购买失败')) return;
      if (!playersDraftReady()) {
        Hexcore2.eventStore.append('流程未就绪', '前置流程未完成，暂不能购买队员', 'warn');
        Hexcore2.ui.render();
        return;
      }
      const draw = Hexcore2.state.draft.currentDraw;
      const captain = Hexcore2.selectors.currentCaptain();
      if (Number.isInteger(Number(index))) {
        Hexcore2.state.draft.selectedSlot = Number(index);
      }
      if (Hexcore2.state.draft.pickedThisTurn) {
        Hexcore2.eventStore.append('购买失败', '本轮购买权已使用，不能重复购买', 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (!draw || !captain) {
        Hexcore2.eventStore.append('购买失败', '当前没有可购买的商店卡', 'warn');
        Hexcore2.ui.render();
        return;
      }
      const roundState = Hexcore2.economyEngine ? Hexcore2.economyEngine.roundState(captain.id) : null;
      if (roundState && (roundState.purchaseUsed || roundState.skipped)) {
        Hexcore2.eventStore.append('购买失败', roundState.skipped ? '本轮已跳过，购买权已结束' : '本轮已购买，购买权已结束', 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (Hexcore2.selectors.teamSize(captain.id) >= Hexcore2.selectors.teamMemberCapacity(captain.id)) {
        Hexcore2.eventStore.append('购买失败', '当前队伍已满员，不能继续购买', 'warn');
        Hexcore2.ui.render();
        return;
      }

      const slot = draw.cards[Hexcore2.state.draft.selectedSlot];
      if (!slot) {
        Hexcore2.eventStore.append('购买失败', '当前卡槽为空，无法购买', 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (slot.purchased) {
        Hexcore2.eventStore.append('购买失败', '该卡槽已完成购买，不能重复购买', 'warn');
        Hexcore2.ui.render();
        return;
      }

      try {
        await submitRoomCommand('PurchaseShopCard', { teamId: captain.id, slotId: String(index) }, options);
      } catch (error) {
        Hexcore2.eventStore.append('购买失败', error && error.message ? error.message : String(error), 'warn');
        Hexcore2.ui.render();
        return;
      }

      snapshot(`购买队员前：${captain.name}`);
      const result = Hexcore2.assignmentEngine.purchase(captain.id, slot.playerId, 'gold_shop_purchase', {
        basePriceOverride: slot.price,
        displayPlayerId: slot.displayPlayerId || '',
      });
      if (!result.ok) {
        Hexcore2.eventStore.append('购买失败', result.reason, 'warn');
        Hexcore2.ui.render();
        return;
      }
      draw.purchaseEffects = Array.isArray(result.appliedEffects) ? result.appliedEffects : [];
      slot.purchased = true;
      slot.purchasedAt = new Date().toISOString();
      const weatherFogActive = Array.isArray(draw.appliedEffects)
        && draw.appliedEffects.some(effect => effect && effect.type === 'weather_fog');
      const snowCatRevealActive = Boolean(slot.snowCatShuffled && slot.displayPlayerId && slot.displayPlayerId !== slot.playerId);
      if (weatherFogActive || snowCatRevealActive) {
        slot.revealUntil = Date.now() + 5000;
        slot.purchaseRevealReason = weatherFogActive ? 'weather_fog' : 'snow_cat';
        global.setTimeout(() => {
          const activeDraw = Hexcore2.state.draft.currentDraw;
          const activeSlot = activeDraw && Array.isArray(activeDraw.cards)
            ? activeDraw.cards.find(card => card && card.slotId === slot.slotId)
            : null;
          if (
            activeSlot
            && activeSlot.purchased
            && (activeSlot.purchaseRevealReason === 'weather_fog' || activeSlot.purchaseRevealReason === 'snow_cat')
            && Number(activeSlot.revealUntil) <= Date.now()
          ) {
            activeSlot.revealFlipUntil = Date.now() + 520;
            delete activeSlot.revealUntil;
            Hexcore2.ui.render();
            global.setTimeout(() => Hexcore2.ui.render(), 560);
          }
        }, 5000);
      } else {
        delete slot.revealUntil;
        delete slot.revealFlipUntil;
        delete slot.purchaseRevealReason;
      }
      Hexcore2.state.draft.pickedThisTurn = true;
      if (slot.snowCatShuffled && slot.displayPlayerId && slot.displayPlayerId !== slot.playerId) {
        const displayedPlayer = Hexcore2.state.players.find(item => item.id === slot.displayPlayerId);
        const realPlayer = Hexcore2.state.players.find(item => item.id === slot.playerId);
        Hexcore2.eventStore.append(
          '雪定饿的喵揭示',
          `${captain.name} 点击显示卡「${displayedPlayer ? displayedPlayer.name : slot.displayPlayerId}」，实际支付 ${result.price} 金币，揭示真实选手「${realPlayer ? realPlayer.name : slot.playerId}」`,
          'warn',
          { displayPlayerId: slot.displayPlayerId, playerId: slot.playerId, price: result.price }
        );
      }
      const hungryWave = Hexcore2.hexcoreEngine.resolveHungryWaveAfterPurchase
        ? Hexcore2.hexcoreEngine.resolveHungryWaveAfterPurchase(captain.id, slot.playerId, result.price, {
          keepShopPurchasedOnReturn: weatherFogActive,
        })
        : { handled: false };
      if (hungryWave.handled) {
        if (weatherFogActive && (hungryWave.returnedToPool || !hungryWave.returned)) {
          delete slot.revealUntil;
          delete slot.revealFlipUntil;
          delete slot.purchaseRevealReason;
        }
        Hexcore2.state.draft.pickedThisTurn = false;
        const nextSlotIndex = draw.cards.findIndex(card => !card.purchased);
        Hexcore2.state.draft.selectedSlot = nextSlotIndex >= 0 ? nextSlotIndex : 0;
        if (hungryWave.reveal) {
          openRecruitReveal(hungryWave.reveal, { advanceTurn: false });
        }
      } else {
        openHeavenlyWindow(captain, slot, result.price);
        maybeOpenAutoLastStandPrompt(captain.id, 'team_full_after_purchase');
      }
      renderAndPersist();
    },

    buyCard(index) {
      this.pickCard(index);
    },

    nextCaptain(options = {}) {
      if (rejectViewerClient('下一位失败')) return;
      if (isCaptainClient() && !options.skipCaptainClientGuard) {
        Hexcore2.eventStore.append('队长操作失败', '队长端不可执行裁判海克斯动作', 'warn');
        Hexcore2.ui.render();
        return;
      }
      const previous = Hexcore2.selectors.currentCaptain();
      if (!options.skipSnapshot) snapshot(`切换队长前：${previous ? previous.name : '未知'}`);
      clearHeavenlyWindow();
      if (previous && Hexcore2.state.draft.phase !== 'completed') {
        const state = Hexcore2.economyEngine.roundState(previous.id);
        const full = Hexcore2.selectors.teamSize(previous.id) >= Hexcore2.selectors.teamMemberCapacity(previous.id);
        if (!state.purchaseUsed && !state.skipped && !full) {
          Hexcore2.economyEngine.markSkipped(previous.id);
          Hexcore2.eventStore.append('购买权作废', `${previous.name} 未完成购买即进入下一位，第 ${Hexcore2.state.draft.round} 轮购买权限作废`, 'warn');
        }
        if (state.purchaseUsed || state.skipped || full) {
          Hexcore2.hexcoreEngine.clearWeatherFogForCaptain(previous.id, Hexcore2.state.draft.round, full ? '队伍满员' : '购买权结束');
        }
      }
      const transition = Hexcore2.turnOrderEngine.advance();

      if (transition.type === 'next_round') {
        if (Hexcore2.hexcoreEngine && Hexcore2.hexcoreEngine.ensureOriginSageForRound) {
          const originResult = Hexcore2.hexcoreEngine.ensureOriginSageForRound(transition.round);
          showOriginSageNotice(originResult, transition.round);
        }
        if (Hexcore2.hexcoreEngine && Hexcore2.hexcoreEngine.ensureHungryWaveForRound) {
          Hexcore2.hexcoreEngine.ensureHungryWaveForRound(transition.round);
        }
        openNextChargedCannonDecision(transition.round);
        const captain = Hexcore2.selectors.currentCaptain();
        Hexcore2.eventStore.append('回合推进', `进入第 ${transition.round} 轮，当前队长为 ${captain ? captain.name : '无'}`, 'info');
      } else if (transition.type === 'completed') {
        Hexcore2.eventStore.append('选人完成', '四轮金币抽卡已结束，系统已检查并处理阵容随机补位', 'success');
      } else {
        const captain = Hexcore2.selectors.currentCaptain();
        if (captain) prepareCompensationTurn(captain.id);
        Hexcore2.eventStore.append('裁判操作', `进入 ${captain ? captain.name : '无'} 的选人环节`, 'info');
      }
      Hexcore2.ui.render();
    },

    useHeavenlyDescent(sourceCaptainId) {
      if (!captainClientCanActOn(sourceCaptainId, '神兵天降失败')) return { ok: false, reason: '队长端无权操作其它队伍' };
      if (!captainClientCanUseOwnedHexcore('heavenly-descent', '神兵天降失败')) return { ok: false, reason: '队长端仅可发动自己的海克斯' };
      const windowState = activeHeavenlyWindow();
      if (!windowState) {
        Hexcore2.eventStore.append('神兵天降失败', '当前没有可发动的10秒窗口', 'warn');
        Hexcore2.ui.render();
        return { ok: false, reason: '当前没有可发动窗口' };
      }
      const sourceCaptain = Hexcore2.state.captains.find(item => item.id === sourceCaptainId);
      const sourceHexcore = sourceCaptain && (Hexcore2.state.hexcoreAssignments[sourceCaptain.id] || [])
        .find(hexcore => hexcore.id === 'heavenly-descent' && hexcore.status !== 'used');
      const targetCaptain = Hexcore2.state.captains.find(item => item.id === windowState.captainId);
      const player = Hexcore2.state.players.find(item => item.id === windowState.playerId);
      if (!sourceCaptain || !sourceHexcore || !Hexcore2.selectors.isHexcoreEnabled('heavenly-descent')) {
        Hexcore2.eventStore.append('神兵天降失败', '请选择仍持有且未使用神兵天降的队长', 'warn');
        Hexcore2.ui.render();
        return { ok: false, reason: '没有可用神兵天降' };
      }
      if (!targetCaptain || !player || player.teamId !== targetCaptain.id || !targetCaptain.team.includes(player.id)) {
        windowState.active = false;
        windowState.resolved = true;
        Hexcore2.eventStore.append('神兵天降失败', '目标购买结果已变化，无法回滚', 'warn');
        Hexcore2.ui.render();
        return { ok: false, reason: '目标购买结果已变化' };
      }
      const sourceCamp = Hexcore2.selectors.captainCamp(sourceCaptain.id);
      if (!sourceCamp || player.camp !== sourceCamp) {
        Hexcore2.eventStore.append(
          '神兵天降失败',
          `${sourceCaptain.name} 只能夺取同阵营选手，「${player.name}」属于${Hexcore2.selectors.campLabel(player.camp)}，不可发动`,
          'warn',
          { sourceCaptainId: sourceCaptain.id, targetCaptainId: targetCaptain.id, playerId: player.id }
        );
        Hexcore2.ui.render();
        return { ok: false, reason: '神兵天降只能夺取同阵营选手' };
      }
      if (sourceCaptain.id === targetCaptain.id) {
        Hexcore2.eventStore.append('神兵天降失败', '神兵天降不能响应自己刚完成的购买', 'warn', {
          sourceCaptainId: sourceCaptain.id,
          targetCaptainId: targetCaptain.id,
          playerId: player.id,
        });
        Hexcore2.ui.render();
        return { ok: false, reason: '神兵天降不能响应自己的购买' };
      }

      snapshot(`神兵天降发动前：${sourceCaptain.name}`);
      targetCaptain.team = targetCaptain.team.filter(playerId => playerId !== player.id);
      player.status = 'available';
      delete player.teamId;
      delete player.teamBypassReason;
      targetCaptain.economy.gold += Math.max(0, Number(windowState.price) || 0);
      const roundState = Hexcore2.economyEngine.roundState(targetCaptain.id, windowState.round);
      roundState.purchaseUsed = false;
      roundState.skipped = false;
      if (Hexcore2.state.draft.currentDraw && Hexcore2.state.draft.currentDraw.captainId === targetCaptain.id) {
        Hexcore2.state.draft.pickedThisTurn = false;
      }

      const draw = Hexcore2.state.draft.currentDraw;
      if (draw && Array.isArray(draw.cards)) {
        draw.cards.forEach(card => {
          if (card.playerId === player.id || card.slotId === windowState.slotId) {
            card.purchased = true;
            card.purchasedAt = card.purchasedAt || new Date().toISOString();
            card.heavenlyResolved = true;
          }
        });
      }

      const sourceCapacity = Hexcore2.selectors.teamMemberCapacity(sourceCaptain.id);
      const sourceHadRoom = sourceCaptain.team.length < sourceCapacity;
      const assignedToSource = sourceHadRoom
        ? Hexcore2.assignmentEngine.assign(sourceCaptain.id, player.id, 'heavenly_descent')
        : false;
      if (assignedToSource) {
        const skipRound = Number(windowState.round || Hexcore2.state.draft.round) + 1;
        const alreadySkipped = (Hexcore2.state.draft.runtimeEffects || []).some(effect =>
          effect.type === 'skip_round'
          && effect.captainId === sourceCaptain.id
          && Number(effect.round) === skipRound
          && effect.sourceHexcoreId === 'heavenly-descent'
        );
        if (!alreadySkipped) {
          Hexcore2.state.draft.runtimeEffects.push({
            type: 'skip_round',
            captainId: sourceCaptain.id,
            round: skipRound,
            sourceHexcoreId: 'heavenly-descent',
            sourceCaptainId: sourceCaptain.id,
            reason: `${sourceCaptain.name} 发动神兵天降获得队员，跳过第 ${skipRound} 轮选人`,
            createdAt: new Date().toISOString(),
          });
        }
      }
      sourceHexcore.status = 'used';
      windowState.active = false;
      windowState.resolved = true;
      Hexcore2.eventStore.append(
        '神兵天降',
        assignedToSource
          ? `${sourceCaptain.name} 发动神兵天降，夺取 ${targetCaptain.name} 刚购买的「${player.name}」；${targetCaptain.name} 返还 ${windowState.price} 金币并恢复本轮购买权`
          : `${sourceCaptain.name} 发动神兵天降，但队伍已满，「${player.name}」回到卡池；${targetCaptain.name} 返还 ${windowState.price} 金币并恢复本轮购买权`,
        'warn',
        { sourceCaptainId: sourceCaptain.id, targetCaptainId: targetCaptain.id, playerId: player.id, assignedToSource }
      );
      if (assignedToSource) {
        openRecruitReveal({
          title: '神兵天降夺取揭示',
          source: '神兵天降',
          captainId: sourceCaptain.id,
          playerIds: [player.id],
          summary: `${sourceCaptain.name} 夺取了 ${targetCaptain.name} 刚购买的队员`,
          detail: `${targetCaptain.name} 已返还 ${windowState.price} 金币和本轮购买权；确认后继续当前流程。`,
        }, { advanceTurn: false });
      }
      renderAndPersist();
      return { ok: true };
    },

    closeOriginSageNotice() {
      dismissOriginSageNotice(true);
    },

    chooseChargedCannonMode(mode) {
      const decision = Hexcore2.state.ui && Hexcore2.state.ui.chargedCannonDecision;
      if (!decision) return;
      decision.step = mode === 'delay' ? 'delay' : 'boost';
      delete decision.error;
      renderAndPersist();
    },

    backChargedCannonDecision() {
      const decision = Hexcore2.state.ui && Hexcore2.state.ui.chargedCannonDecision;
      if (!decision) return;
      decision.step = 'choose';
      delete decision.error;
      renderAndPersist();
    },

    skipChargedCannonDecision() {
      const decision = Hexcore2.state.ui && Hexcore2.state.ui.chargedCannonDecision;
      if (!decision || !Hexcore2.hexcoreEngine || !Hexcore2.hexcoreEngine.skipChargedCannon) return;
      snapshot('跳过大炮已充能前');
      const result = Hexcore2.hexcoreEngine.skipChargedCannon(decision.captainId);
      if (!result.ok) {
        const reason = result.reason || '跳过失败';
        setChargedCannonDecisionError(decision, reason);
        Hexcore2.eventStore.append('大炮已充能失败', reason, 'warn');
        renderAndPersist();
        return result;
      }
      closeOrContinueChargedCannonDecision(decision.round);
      renderAndPersist();
      return result;
    },

    confirmChargedCannonBoost() {
      const decision = Hexcore2.state.ui && Hexcore2.state.ui.chargedCannonDecision;
      if (!decision || !Hexcore2.hexcoreEngine || !Hexcore2.hexcoreEngine.activateChargedCannonBoost) return;
      snapshot('使用大炮已充能加速之门前');
      const result = Hexcore2.hexcoreEngine.activateChargedCannonBoost(decision.captainId);
      if (!result.ok) {
        const reason = result.reason || '加速之门无法使用';
        setChargedCannonDecisionError(decision, reason);
        Hexcore2.eventStore.append('大炮已充能失败', reason, 'warn');
        renderAndPersist();
        return result;
      }
      closeOrContinueChargedCannonDecision(decision.round);
      renderAndPersist();
      return result;
    },

    confirmChargedCannonDelay(targetCaptainId) {
      const decision = Hexcore2.state.ui && Hexcore2.state.ui.chargedCannonDecision;
      if (!decision || !Hexcore2.hexcoreEngine || !Hexcore2.hexcoreEngine.activateChargedCannonDelay) return;
      snapshot('使用大炮已充能雷霆一击前');
      const result = Hexcore2.hexcoreEngine.activateChargedCannonDelay(decision.captainId, targetCaptainId);
      if (!result.ok) {
        const reason = result.reason || '雷霆一击无法使用';
        setChargedCannonDecisionError(decision, reason);
        Hexcore2.eventStore.append('大炮已充能失败', reason, 'warn');
        renderAndPersist();
        return result;
      }
      closeOrContinueChargedCannonDecision(decision.round);
      renderAndPersist();
      return result;
    },

    cancelLastStand() {
      const confirmState = Hexcore2.state.ui && Hexcore2.state.ui.lastStandConfirm;
      const captain = confirmState && Hexcore2.state.captains.find(item => item.id === confirmState.captainId);
      const autoOneChance = Boolean(confirmState && confirmState.autoOneChance);
      if (autoOneChance && captain) {
        Hexcore2.state.draft.runtimeEffects = Hexcore2.state.draft.runtimeEffects || [];
        Hexcore2.state.draft.runtimeEffects.push({
          type: 'last_stand_declined',
          captainId: captain.id,
          round: Hexcore2.state.draft.round,
          reason: `${captain.name} 放弃满员后的背水一战唯一确认机会`,
          createdAt: new Date().toISOString(),
        });
        Hexcore2.eventStore.append('背水一战已放弃', `${captain.name} 放弃本轮满员后的背水一战唯一机会。`, 'warn', { captainId: captain.id });
      }
      if (Hexcore2.state.ui) delete Hexcore2.state.ui.lastStandConfirm;
      if (autoOneChance) {
        this.nextCaptain({ skipSnapshot: true });
        return;
      }
      renderAndPersist();
    },

    confirmLastStand() {
      const confirmState = Hexcore2.state.ui && Hexcore2.state.ui.lastStandConfirm;
      const captain = Hexcore2.selectors.currentCaptain();
      if (!confirmState || !captain || confirmState.captainId !== captain.id) {
        if (Hexcore2.state.ui) delete Hexcore2.state.ui.lastStandConfirm;
        Hexcore2.eventStore.append('背水一战失败', '当前确认窗口已失效，请重新打开', 'warn');
        Hexcore2.ui.render();
        return { ok: false, reason: '确认窗口已失效' };
      }
      snapshot(`使用背水一战前：${captain.name}`);
      const result = Hexcore2.hexcoreEngine.activate('last-stand', { confirmed: true });
      if (result && result.ok && Hexcore2.state.ui) delete Hexcore2.state.ui.lastStandConfirm;
      if (result && result.ok && result.reveal && openRecruitReveal(result.reveal, { advanceTurn: result.advanceTurn })) {
        renderAndPersist();
        return result;
      }
      if (result && result.advanceTurn) {
        this.nextCaptain();
      } else {
        Hexcore2.ui.render();
      }
      return result;
    },

    useHexcore(id, targetCaptainId, secondTargetCaptainId, sourceCaptainId = '') {
      if (rejectViewerClient('海克斯执行失败')) return { ok: false, reason: '观众端只读，无法操作' };
      if (!captainClientCanUseOwnedHexcore(id, '海克斯执行失败')) return { ok: false, reason: '队长端仅可发动自己的海克斯' };
      const captain = sourceCaptainId
        ? Hexcore2.state.captains.find(item => item.id === sourceCaptainId)
        : Hexcore2.selectors.currentCaptain();
      if (id === 'last-stand') {
        const item = captain && Hexcore2.hexcoreEngine && Hexcore2.hexcoreEngine.executionQueue
          ? Hexcore2.hexcoreEngine.executionQueue(captain.id).find(entry => entry.id === 'last-stand')
          : null;
        if (!item || !item.executable) {
          Hexcore2.eventStore.append('背水一战失败', item ? item.reason : '当前队长不能发动背水一战', 'warn');
          Hexcore2.ui.render();
          return { ok: false, reason: item ? item.reason : '当前不能发动' };
        }
        Hexcore2.state.ui = Hexcore2.state.ui || {};
        openLastStandConfirm(captain);
        renderAndPersist();
        return { ok: true, pendingConfirm: true };
      }
      snapshot(`使用海克斯前：${captain ? captain.name : '未知'}`);
      const shopCardIndex = targetCaptainId === '' ? Hexcore2.state.draft.selectedSlot : Number(targetCaptainId);
      const result = Hexcore2.hexcoreEngine.activate(id, {
        targetCaptainId,
        targetPlayerId: targetCaptainId,
        targetLane: targetCaptainId,
        lane: targetCaptainId,
        shopCardIndex: Number.isFinite(shopCardIndex) ? shopCardIndex : Hexcore2.state.draft.selectedSlot,
        firstCaptainId: targetCaptainId,
        secondCaptainId: secondTargetCaptainId,
        firstPlayerId: targetCaptainId,
        secondPlayerId: secondTargetCaptainId,
        sourceCaptainId: captain ? captain.id : '',
      });
      if (result && result.ok && Hexcore2.state.ui) {
        delete Hexcore2.state.ui.hexTargetPicker;
      }
      if (result && result.ok && result.reveal && openRecruitReveal(result.reveal, { advanceTurn: result.advanceTurn })) {
        renderAndPersist();
        return result;
      }
      if (result && result.ok && result.economyReveal && openEconomyReveal(result.economyReveal)) {
        renderAndPersist();
        return result;
      }
      if (result && result.advanceTurn) {
        this.nextCaptain();
      } else {
        Hexcore2.ui.render();
      }
      return result;
    },

    confirmRecruitReveal() {
      const reveal = Hexcore2.state.ui && Hexcore2.state.ui.recruitReveal;
      if (!reveal) return;
      const shouldAdvance = Boolean(reveal.advanceTurn);
      delete Hexcore2.state.ui.recruitReveal;
      if (shouldAdvance) {
        this.nextCaptain();
      } else {
        renderAndPersist();
      }
    },

    confirmEconomyReveal() {
      if (!Hexcore2.state.ui || !Hexcore2.state.ui.economyReveal) return;
      delete Hexcore2.state.ui.economyReveal;
      renderAndPersist();
    },

    showHexDetail(hexcoreId) {
      if (hexDetailHideTimer && typeof global.clearTimeout === 'function') {
        global.clearTimeout(hexDetailHideTimer);
      }
      hexDetailHideTimer = null;
      const hexcore = Hexcore2.sampleData.hexcores.find(item => item.id === hexcoreId);
      if (!hexcore) return;
      Hexcore2.state.ui = Hexcore2.state.ui || {};
      Hexcore2.state.ui.hexDetailModal = {
        hexcoreId,
        openedAt: Date.now(),
      };
      Hexcore2.ui.render();
    },

    keepHexDetail() {
      if (hexDetailHideTimer && typeof global.clearTimeout === 'function') {
        global.clearTimeout(hexDetailHideTimer);
      }
      hexDetailHideTimer = null;
    },

    hideHexDetail(delay = 90) {
      if (hexDetailHideTimer && typeof global.clearTimeout === 'function') {
        global.clearTimeout(hexDetailHideTimer);
      }
      const clear = () => {
        if (Hexcore2.state.ui) {
          delete Hexcore2.state.ui.hexDetailPopover;
          delete Hexcore2.state.ui.hexDetailModal;
        }
        hexDetailHideTimer = null;
        Hexcore2.ui.render();
      };
      if (delay > 0 && typeof global.setTimeout === 'function') {
        hexDetailHideTimer = global.setTimeout(clear, delay);
        if (hexDetailHideTimer && typeof hexDetailHideTimer.unref === 'function') hexDetailHideTimer.unref();
      } else {
        clear();
      }
    },

    closeHexDetail() {
      if (hexDetailHideTimer && typeof global.clearTimeout === 'function') {
        global.clearTimeout(hexDetailHideTimer);
      }
      hexDetailHideTimer = null;
      if (Hexcore2.state.ui) {
        delete Hexcore2.state.ui.hexDetailPopover;
        delete Hexcore2.state.ui.hexDetailModal;
      }
      Hexcore2.ui.render();
    },

    openHexTargetPicker(hexcoreId) {
      if (rejectViewerClient('海克斯执行失败')) return;
      if (!captainClientCanUseOwnedHexcore(hexcoreId, '海克斯执行失败')) return;
      const ownerId = isCaptainClient()
        ? clientTeamId()
        : (Hexcore2.selectors.currentCaptain() ? Hexcore2.selectors.currentCaptain().id : '');
      Hexcore2.state.ui = Hexcore2.state.ui || {};
      Hexcore2.state.ui.hexTargetPicker = { hexcoreId, captainId: ownerId };
      renderAndPersist();
    },

    closeHexTargetPicker() {
      Hexcore2.state.ui = Hexcore2.state.ui || {};
      delete Hexcore2.state.ui.hexTargetPicker;
      renderAndPersist();
    },

    useSelectedHexTarget(hexcoreId) {
      if (rejectViewerClient('海克斯执行失败')) return;
      if (!captainClientCanUseOwnedHexcore(hexcoreId, '海克斯执行失败')) return;
      const picker = Hexcore2.state.ui && Hexcore2.state.ui.hexTargetPicker;
      const sourceCaptainId = picker && picker.captainId ? picker.captainId : '';
      const firstInput = document.getElementById('hex-target-first');
      const secondInput = document.getElementById('hex-target-second');
      const firstValue = firstInput ? firstInput.value : '';
      const secondValue = secondInput ? secondInput.value : '';

      if (!firstValue) {
        Hexcore2.eventStore.append('海克斯执行失败', '请先选择目标', 'warn');
        Hexcore2.ui.render();
        return;
      }

      if ((hexcoreId === 'order-swap' || hexcoreId === 'lock-contract') && (!secondValue || firstValue === secondValue)) {
        Hexcore2.eventStore.append('海克斯执行失败', '请选择两个不同目标', 'warn');
        Hexcore2.ui.render();
        return;
      }

      this.useHexcore(hexcoreId, firstValue, secondValue, sourceCaptainId);
    },

    async skipTurn(options = {}) {
      if (rejectViewerClient('跳过失败')) return;
      if (!captainClientCanOperateCurrentTurn('跳过失败')) return;
      const captain = Hexcore2.selectors.currentCaptain();
      if (captain) {
        try {
          await submitRoomCommand('SkipTurn', { teamId: captain.id }, options);
        } catch (error) {
          Hexcore2.eventStore.append('跳过失败', error && error.message ? error.message : String(error), 'warn');
          Hexcore2.ui.render();
          return;
        }
      }
      snapshot(`跳过本轮前：${captain ? captain.name : '未知'}`);
      if (captain) {
        const result = Hexcore2.economyEngine.markSkipped(captain.id);
        if (!result.ok) {
          if (Hexcore2.state.undoStack) Hexcore2.state.undoStack.shift();
          Hexcore2.eventStore.append('跳过失败', result.reason, 'warn');
          Hexcore2.ui.render();
          return;
        }
      }
      Hexcore2.state.draft.currentDraw = null;
      Hexcore2.state.draft.pickedThisTurn = true;
      Hexcore2.eventStore.append('裁判操作', `${captain ? captain.name : '无队长'} 跳过本轮购买，购买权限立即作废`, 'warn');
      this.nextCaptain({ skipSnapshot: true, skipCaptainClientGuard: true });
    },

    undo() {
      const snapshot = Hexcore2.historyService.undo();
      if (snapshot) {
        Hexcore2.eventStore.append('撤销完成', `已恢复到「${snapshot.label}」之前的状态`, 'warn');
      } else {
        Hexcore2.eventStore.append('撤销失败', '没有可撤销的操作快照', 'warn');
      }
      Hexcore2.turnOrderEngine.recompute();
      renderAndPersist();
    },

    exportEvents() {
      if (Hexcore2.exportService.exportEvents()) Hexcore2.ui.render();
    },

    exportEventsJson() {
      if (Hexcore2.exportService.exportEventsJson()) Hexcore2.ui.render();
    },

    exportRecapText() {
      if (Hexcore2.exportService.exportRecapText()) Hexcore2.ui.render();
    },

    exportState() {
      if (Hexcore2.exportService.exportState()) Hexcore2.ui.render();
    },

    setEventFilter(filter) {
      Hexcore2.state.ui = Hexcore2.state.ui || {};
      Hexcore2.state.ui.eventFilter = filter;
      renderAndPersist();
    },

    setEventCaptainFilter(captainId) {
      Hexcore2.state.ui = Hexcore2.state.ui || {};
      Hexcore2.state.ui.eventCaptainFilter = captainId || 'all';
      renderAndPersist();
    },

    setEventSearch() {
      const input = document.getElementById('event-search');
      Hexcore2.state.ui = Hexcore2.state.ui || {};
      Hexcore2.state.ui.eventSearch = input ? input.value.trim() : '';
      renderAndPersist();
    },

    clearEvents() {
      const confirmed = typeof confirm === 'function'
        ? confirm('确认清空当前事件日志？此操作会保留当前选人状态。')
        : true;
      if (!confirmed) return;

      snapshot('清空事件日志前');
      Hexcore2.state.events = [];
      Hexcore2.eventStore.append('日志清理', '裁判清空了事件日志', 'warn');
      renderAndPersist();
    },

    importState(file) {
      Hexcore2.exportService.readStateFile(file, state => {
        snapshot('导入状态备份前');
        Hexcore2.state.settings = state.settings;
        Hexcore2.state.captains = state.captains;
        Hexcore2.state.players = state.players;
        Hexcore2.state.hexcoreAssignments = state.hexcoreAssignments || {};
        Hexcore2.state.hexcoreDraft = state.hexcoreDraft || {};
        Hexcore2.state.draft = state.draft;
        Hexcore2.state.events = state.events || [];
        Hexcore2.state.tournament = state.tournament || {};
        Hexcore2.state.undoStack = state.undoStack || [];
        Hexcore2.state.ui = state.ui || { activeView: 'draft', eventFilter: 'all' };
        if (Hexcore2.normalizeState) Hexcore2.normalizeState(Hexcore2.state);
        Hexcore2.turnOrderEngine.recompute();
        Hexcore2.eventStore.append('数据导入', '裁判导入了状态备份', 'info');
        renderAndPersist();
      }, error => {
        Hexcore2.eventStore.append('导入失败', error.message, 'warn');
        Hexcore2.ui.render();
      });
    },

    resetLocalState() {
      const confirmed = typeof confirm === 'function'
        ? confirm('确认清除本地状态并恢复默认空状态？此操作会覆盖当前裁判端进度。')
        : true;
      if (!confirmed) return;

      if (Hexcore2.storageService) Hexcore2.storageService.clear();
      Hexcore2.state = Hexcore2.createDefaultState
        ? Hexcore2.createDefaultState()
        : Hexcore2.normalizeState({});
      if (Hexcore2.economyEngine) {
        Hexcore2.economyEngine.ensureAll();
        Hexcore2.economyEngine.applyRoundIncome(Hexcore2.state.draft.round);
      }
      Hexcore2.turnOrderEngine.recompute();
      Hexcore2.eventStore.append('状态重置', '已恢复默认空状态，请先导入或添加选手并配置队长', 'warn');
      renderAndPersist();
    },

    setActiveView(view) {
      Hexcore2.state.ui = Hexcore2.state.ui || {};
      const nextView = view || 'draft';
      const viewChanged = Hexcore2.state.ui.activeView !== nextView;
      Hexcore2.state.ui.activeView = nextView;
      Hexcore2.state.ui.orderDrawerOpen = false;
      if (viewChanged) Hexcore2.state.ui.resetScrollOnRender = true;
      renderAndPersist();
    },

    focusTeamFromRoster(captainId) {
      const captain = Hexcore2.state.captains.find(item => item.id === captainId);
      Hexcore2.state.ui = Hexcore2.state.ui || {};
      if (!captain) {
        Hexcore2.state.ui.feedback = {
          title: '队伍定位失败',
          body: '目标队伍不存在，可能已被删除或状态未同步',
          level: 'warn',
          time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
          createdAt: Date.now(),
        };
        Hexcore2.ui.render();
        return;
      }
      Hexcore2.state.ui.activeView = 'teams';
      Hexcore2.state.ui.highlightCaptainId = captain.id;
      Hexcore2.state.ui.scrollCaptainIntoViewId = captain.id;
      Hexcore2.state.ui.orderDrawerOpen = false;
      Hexcore2.state.ui.resetScrollOnRender = true;
      Hexcore2.state.ui.feedback = {
        title: '已定位队伍',
        body: `已切换到队伍管理并高亮 ${captain.name}`,
        level: 'info',
        time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        createdAt: Date.now(),
      };
      renderAndPersist();
    },

    locateEvent(index) {
      const event = Hexcore2.state.events[Number(index)];
      if (!event) {
        Hexcore2.eventStore.append('日志定位失败', '目标事件不存在或已被清理', 'warn');
        Hexcore2.ui.render();
        return;
      }
      const payload = event.payload || {};
      const text = `${event.title || ''} ${event.body || ''}`;
      const matchedCaptain = payload.captainId
        ? Hexcore2.state.captains.find(captain => captain.id === payload.captainId)
        : Hexcore2.state.captains.find(captain => text.includes(captain.name) || text.includes(captain.id));
      const matchedPlayer = payload.playerId
        ? Hexcore2.state.players.find(player => player.id === payload.playerId)
        : Hexcore2.state.players.find(player =>
          !Hexcore2.selectors.isCaptainPlayer(player.id)
          && (text.includes(player.name) || text.includes(player.gameId || player.id))
        );
      const matchedHexcore = payload.hexcoreId
        ? Hexcore2.sampleData.hexcores.find(hex => hex.id === payload.hexcoreId)
        : Hexcore2.sampleData.hexcores.find(hex => text.includes(hex.name));

      Hexcore2.state.ui = Hexcore2.state.ui || {};
      Hexcore2.state.ui.highlightEventIndex = Number(index);
      Hexcore2.state.ui.highlightCaptainId = matchedCaptain ? matchedCaptain.id : '';
      Hexcore2.state.ui.highlightPlayerId = matchedPlayer ? matchedPlayer.id : '';
      Hexcore2.state.ui.highlightHexcoreId = matchedHexcore ? matchedHexcore.id : '';
      Hexcore2.state.ui.highlightTournament = text.includes('赛程') || text.includes('比分') || text.includes('淘汰赛');

      if (matchedPlayer) {
        Hexcore2.state.ui.activeView = 'players';
        Hexcore2.state.ui.playerFilter = 'all';
        Hexcore2.state.ui.resetScrollOnRender = true;
      } else if (matchedHexcore) {
        Hexcore2.state.ui.activeView = 'hexcores';
        Hexcore2.state.ui.hexFilter = 'all';
        if (matchedCaptain) Hexcore2.state.ui.hexCaptainId = matchedCaptain.id;
        Hexcore2.state.ui.resetScrollOnRender = true;
      } else if (Hexcore2.state.ui.highlightTournament) {
        Hexcore2.state.ui.activeView = 'tournament';
        Hexcore2.state.ui.resetScrollOnRender = true;
      } else if (matchedCaptain) {
        Hexcore2.state.ui.activeView = 'teams';
        Hexcore2.state.ui.resetScrollOnRender = true;
      } else {
        Hexcore2.eventStore.append('日志定位', '该事件没有可定位的队长、选手、海克斯或赛程目标', 'info');
      }
      renderAndPersist();
    },

    recoverDraftState() {
      const draft = Hexcore2.state.draft;
      const fixes = [];
      if (draft.round < 1 || draft.round > draft.maxRounds) {
        draft.round = Math.max(1, Math.min(draft.maxRounds || 4, Number(draft.round) || 1));
        fixes.push(`轮次修正为第 ${draft.round} 轮`);
      }

      const captainIds = new Set(Hexcore2.state.captains.map(captain => captain.id));
      const orderInvalid = !Array.isArray(draft.currentOrder)
        || !draft.currentOrder.length
        || draft.currentOrder.some(captainId => !captainIds.has(captainId));
      if (orderInvalid) {
        Hexcore2.turnOrderEngine.recompute();
        draft.currentIndex = Math.max(0, Math.min(Number(draft.currentIndex) || 0, draft.currentOrder.length - 1));
        fixes.push('顺位队列已重算');
      }

      const currentCaptainId = draft.currentOrder[draft.currentIndex];
      const currentCaptain = Hexcore2.state.captains.find(captain => captain.id === currentCaptainId);
      if (draft.currentOrder.length && (!currentCaptain || Hexcore2.selectors.teamSize(currentCaptain.id) >= Hexcore2.selectors.teamMemberCapacity(currentCaptain.id))) {
        Hexcore2.turnOrderEngine.recompute();
        const nextIndex = draft.currentOrder.findIndex(captainId =>
          Hexcore2.selectors.teamSize(captainId) < Hexcore2.selectors.teamMemberCapacity(captainId)
        );
        draft.currentIndex = Math.max(0, nextIndex);
        draft.currentDraw = null;
        draft.pickedThisTurn = false;
        fixes.push('当前队长已满员，已切换到下一名可抽队长');
      }

      if (!draft.currentOrder.length && draft.phase !== 'completed') {
        draft.phase = 'completed';
        draft.currentDraw = null;
        draft.pickedThisTurn = false;
        if (Hexcore2.assignmentEngine) Hexcore2.assignmentEngine.fillIncompleteRosters();
        fixes.push('无可抽队长，流程已收束为完成状态');
      } else if (draft.phase !== 'completed' && draft.phase !== 'captain_action') {
        draft.phase = 'captain_action';
        fixes.push('流程阶段已恢复为队长操作');
      }

      const activeCaptainId = draft.currentOrder[draft.currentIndex];
      if (draft.currentDraw && draft.currentDraw.captainId !== activeCaptainId) {
        draft.currentDraw = null;
        draft.pickedThisTurn = false;
        draft.selectedSlot = 0;
        fixes.push('旧商店归属与当前队长不一致，已清空');
      }

      if (!fixes.length) {
        Hexcore2.eventStore.append('异常恢复检查', '当前轮次、顺位和队长状态未发现可自动修正项', 'info');
        Hexcore2.ui.render();
        return;
      }
      snapshot('修正抽选异常前');
      Hexcore2.eventStore.append('异常恢复', fixes.join('；'), 'warn');
      renderAndPersist();
    },

    openOrderDrawer() {
      Hexcore2.state.ui = Hexcore2.state.ui || {};
      Hexcore2.state.ui.orderDrawerOpen = true;
      renderAndPersist();
    },

    closeOrderDrawer() {
      Hexcore2.state.ui = Hexcore2.state.ui || {};
      Hexcore2.state.ui.orderDrawerOpen = false;
      renderAndPersist();
    },

    setTheme(theme) {
      const nextTheme = ['default', 'neon', 'apple'].includes(theme) ? theme : 'default';
      Hexcore2.state.ui = Hexcore2.state.ui || {};
      if (Hexcore2.state.ui.theme === nextTheme) return;
      Hexcore2.state.ui.theme = nextTheme;
      renderAndPersist();
    },

    drawHexcoreForCurrentCaptain() {
      const captain = Hexcore2.selectors.currentCaptain();
      return this.drawHexcoreForCaptain(captain ? captain.id : '');
    },

    drawHexcoreForCaptain(captainId) {
      if (!captainClientCanActOn(captainId, '抽取海克斯失败')) return;
      const captain = Hexcore2.state.captains.find(item => item.id === captainId);
      if (!captain) {
        Hexcore2.eventStore.append('抽取海克斯失败', '请选择有效队长', 'warn');
        Hexcore2.ui.render();
        return;
      }

      if ((Hexcore2.state.hexcoreAssignments[captain.id] || []).length >= HEXCORE_PICK_LIMIT) {
        Hexcore2.eventStore.append('抽取海克斯失败', `${captain.name} 已完成海克斯选择`, 'warn');
        Hexcore2.ui.render();
        return;
      }

      const activeSession = Hexcore2.state.hexcoreDraft && Hexcore2.state.hexcoreDraft.captainId === captain.id && Hexcore2.state.hexcoreDraft.slots.length;
      if (!activeSession) {
        snapshot(`抽取海克斯前：${captain.name}`);
        const slots = drawHexcoreSlots(captain.id, HEXCORE_CANDIDATE_COUNT);
        if (slots.length < 1) {
          Hexcore2.eventStore.append('抽取海克斯失败', '全局剩余可用海克斯不足 1个', 'warn');
          Hexcore2.ui.render();
          return;
        }
        Hexcore2.state.hexcoreDraft = Hexcore2.state.hexcoreDraft || {};
        Hexcore2.state.hexcoreDraft.captainId = captain.id;
        Hexcore2.state.hexcoreDraft.slots = slots;
        Hexcore2.state.hexcoreDraft.chosen = [];
        Hexcore2.state.hexcoreDraft.seenIds = [...slots];
        Hexcore2.state.hexcoreDraft.refreshUsed = false;
        Hexcore2.eventStore.append('抽取海克斯', `${captain.name} 抽出 ${slots.length} 个海克斯候选，等待队长选择 1 个`, 'draw');
      } else {
        Hexcore2.eventStore.append('抽取海克斯', `${captain.name} 已有进行中的海克斯五抽一`, 'info');
      }
      renderAndPersist();
    },

    selectHexcoreFromDraw(captainId, hexcoreId) {
      if (!captainClientCanActOn(captainId, '选择海克斯失败')) return;
      if (!captainClientCanUseHexcoreSession('选择海克斯失败')) return;
      const captain = Hexcore2.state.captains.find(item => item.id === captainId);
      const session = Hexcore2.state.hexcoreDraft || {};
      const hexcore = Hexcore2.sampleData.hexcores.find(item => item.id === hexcoreId);
      if (!captain || !hexcore || session.captainId !== captainId || !session.slots.includes(hexcoreId)) {
        Hexcore2.eventStore.append('选择海克斯失败', '当前海克斯抽取会话无效', 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (!isGoldModeAllowedHexcore(hexcore)) {
        Hexcore2.eventStore.append('选择海克斯失败', `【${hexcore.name}】是旧海克斯，金币模式不允许选择`, 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (!Hexcore2.selectors.isHexcoreEnabled(hexcore.id)) {
        Hexcore2.eventStore.append('选择海克斯失败', `【${hexcore.name}】已被规则设置禁用`, 'warn');
        Hexcore2.ui.render();
        return;
      }
      if ((Hexcore2.state.hexcoreAssignments[captainId] || []).some(item => item.id === hexcoreId)) {
        Hexcore2.eventStore.append('选择海克斯失败', `${captain.name} 已持有【${hexcore.name}】`, 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (isHexcoreOccupiedByOtherCaptain(hexcoreId, captainId)) {
        Hexcore2.eventStore.append('选择海克斯失败', `【${hexcore.name}】已被其他队长选择`, 'warn');
        Hexcore2.ui.render();
        return;
      }
      if ((Hexcore2.state.hexcoreAssignments[captainId] || []).length >= HEXCORE_PICK_LIMIT) {
        Hexcore2.eventStore.append('选择海克斯失败', `${captain.name} 已完成海克斯选择`, 'warn');
        Hexcore2.ui.render();
        return;
      }

      snapshot(`选择海克斯前：${captain.name}`);
      const list = Hexcore2.state.hexcoreAssignments[captainId] || [];
      Hexcore2.state.hexcoreAssignments[captainId] = list;
      list.push({ ...hexcore, status: hexcore.mode === 'passive' ? 'passive' : 'available' });
      applyHexcoreOnAcquire(captain, hexcore);
      session.chosen = [...(session.chosen || []), hexcoreId];
      const ownedCount = list.length;

      Hexcore2.state.ui.hexCaptainId = captain.id;
      resetHexcoreSession();
      const nextCaptain = findNextHexcoreCaptain(captainId);
      Hexcore2.eventStore.append(
        '海克斯完成',
        nextCaptain
          ? `${captain.name} 选择【${hexcore.name}】，已完成 ${ownedCount}/${HEXCORE_PICK_LIMIT}，请裁判点击“下一位”切换到 ${nextCaptain.name}`
          : `${captain.name} 选择【${hexcore.name}】，全部队长海克斯抽取已完成`,
        'success'
      );
      renderAndPersist();
    },

    nextHexcoreCaptain() {
      if (isCaptainClient()) {
        Hexcore2.eventStore.append('队长操作失败', '队长端不可执行裁判海克斯动作', 'warn');
        Hexcore2.ui.render();
        return;
      }
      const currentCaptain = Hexcore2.selectors.currentCaptain();
      const currentCaptainId = (Hexcore2.state.ui && Hexcore2.state.ui.hexCaptainId) || (currentCaptain && currentCaptain.id) || '';
      const nextCaptain = findNextHexcoreCaptain(currentCaptainId);
      if (!nextCaptain) {
        resetHexcoreSession();
        Hexcore2.eventStore.append('海克斯抽取顺序', '全部队长都已完成海克斯选择', 'success');
        renderAndPersist();
        return;
      }

      resetHexcoreSession();
      Hexcore2.state.ui.hexCaptainId = nextCaptain.id;
      Hexcore2.eventStore.append('海克斯抽取顺序', `裁判手动切换到下一位：${nextCaptain.name}`, 'info');
      renderAndPersist();
    },

    refreshHexcoreSlot(slotIndex) {
      if (!captainClientCanUseHexcoreSession('刷新海克斯失败')) return;
      const session = Hexcore2.state.hexcoreDraft || {};
      const index = Number(slotIndex);
      if (!session.captainId || !Number.isInteger(index) || index < 0 || index >= session.slots.length) {
        Hexcore2.eventStore.append('刷新海克斯失败', '当前没有可刷新的候选槽', 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (session.refreshUsed) {
        Hexcore2.eventStore.append('刷新海克斯失败', '本次五抽一已使用过刷新', 'warn');
        Hexcore2.ui.render();
        return;
      }
      const excludes = [...(session.seenIds || []), ...(session.chosen || [])];
      const replacement = drawHexcoreSlots(session.captainId, 1, excludes)[0];
      if (!replacement) {
        Hexcore2.eventStore.append('刷新海克斯失败', '没有更多可用海克斯', 'warn');
        Hexcore2.ui.render();
        return;
      }
      snapshot('刷新海克斯候选前');
      session.slots[index] = replacement;
      session.seenIds = [...excludes, replacement];
      session.refreshUsed = true;
      const captain = Hexcore2.state.captains.find(item => item.id === session.captainId);
      Hexcore2.eventStore.append('刷新海克斯', `${captain ? captain.name : '当前队长'} 刷新了第 ${index + 1} 个候选`, 'warn');
      renderAndPersist();
    },

    cancelHexcoreDraw() {
      if (isCaptainClient()) {
        Hexcore2.eventStore.append('队长操作失败', '队长端不可执行裁判海克斯动作', 'warn');
        Hexcore2.ui.render();
        return;
      }
      snapshot('取消海克斯抽取前');
      resetHexcoreSession();
      Hexcore2.eventStore.append('海克斯抽取', '裁判取消了当前海克斯抽取会话', 'warn');
      renderAndPersist();
    },

    randomizeHexcoreDrawOrder() {
      if (isCaptainClient()) {
        Hexcore2.eventStore.append('队长操作失败', '队长端不可执行裁判海克斯动作', 'warn');
        Hexcore2.ui.render();
        return;
      }
      snapshot('制定海克斯抽取顺序前');
      Hexcore2.state.hexcoreDraft = Hexcore2.state.hexcoreDraft || {};
      const drawOrder = [...Hexcore2.state.captains]
        .sort(() => Math.random() - 0.5)
        .map(captain => captain.id);
      Hexcore2.state.hexcoreAssignments = {};
      Hexcore2.state.captains.forEach(captain => {
        Hexcore2.state.hexcoreAssignments[captain.id] = [];
      });
      resetHexcoreSession();
      Hexcore2.state.hexcoreDraft.drawOrder = drawOrder;
      Hexcore2.state.draft.runtimeEffects = [];
      Hexcore2.state.ui = Hexcore2.state.ui || {};
      Hexcore2.state.ui.hexCaptainId = drawOrder[0] || '';
      Hexcore2.eventStore.append('海克斯抽取顺序', '裁判已清空所有队长海克斯，随机生成抽取顺序，并切换到第一顺位队长', 'success');
      renderAndPersist();
    },

    resetAllHexcores() {
      if (isCaptainClient()) {
        Hexcore2.eventStore.append('队长操作失败', '队长端不可执行裁判海克斯动作', 'warn');
        Hexcore2.ui.render();
        return;
      }
      const confirmed = typeof confirm === 'function'
        ? confirm('确认重置所有队长的海克斯？该操作会移除所有队长已持有海克斯，并清空当前海克斯抽取会话。')
        : true;
      if (!confirmed) return;

      snapshot('重置所有海克斯前');
      Hexcore2.state.hexcoreAssignments = {};
      Hexcore2.state.captains.forEach(captain => {
        Hexcore2.state.hexcoreAssignments[captain.id] = [];
      });
      resetHexcoreSession();
      Hexcore2.state.hexcoreDraft.drawOrder = [];
      Hexcore2.state.draft.runtimeEffects = [];
      Hexcore2.state.ui.hexCaptainId = Hexcore2.state.captains[0] ? Hexcore2.state.captains[0].id : '';
      Hexcore2.eventStore.append('海克斯重置', '裁判已移除所有队长持有海克斯，并清空当前抽取会话', 'warn');
      renderAndPersist();
    },

    advanceToNextHexcoreCaptain(captainId) {
      const captain = Hexcore2.state.captains.find(item => item.id === captainId);
      if (!captain) return;
      Hexcore2.state.ui.hexCaptainId = captain.id;
      renderAndPersist();
      this.drawHexcoreForCaptain(captain.id);
    },

    removeHexcore(captainId, hexcoreId) {
      if (isCaptainClient()) {
        Hexcore2.eventStore.append('队长操作失败', '队长端不可执行裁判海克斯动作', 'warn');
        Hexcore2.ui.render();
        return;
      }
      const captain = Hexcore2.state.captains.find(item => item.id === captainId);
      const list = Hexcore2.state.hexcoreAssignments[captainId] || [];
      const hexcore = list.find(item => item.id === hexcoreId);
      if (!captain || !hexcore) {
        Hexcore2.eventStore.append('移除海克斯失败', '目标队长或海克斯不存在', 'warn');
        Hexcore2.ui.render();
        return;
      }

      snapshot(`移除海克斯前：${captain.name}`);
      Hexcore2.state.hexcoreAssignments[captainId] = list.filter(item => item.id !== hexcoreId);
      Hexcore2.eventStore.append('移除海克斯', `${captain.name} 移除了【${hexcore.name}】`, 'warn');
      renderAndPersist();
    },

    assignHexcoreToCaptain(captainId, hexcoreId) {
      if (isCaptainClient()) {
        Hexcore2.eventStore.append('队长操作失败', '队长端不可执行裁判海克斯动作', 'warn');
        Hexcore2.ui.render();
        return;
      }
      const captain = Hexcore2.state.captains.find(item => item.id === captainId);
      const hexcore = Hexcore2.sampleData.hexcores.find(item => item.id === hexcoreId);
      if (!captain || !hexcore) {
        Hexcore2.eventStore.append('分配海克斯失败', '目标队长或海克斯不存在', 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (!isGoldModeAllowedHexcore(hexcore)) {
        Hexcore2.eventStore.append('分配海克斯失败', `【${hexcore.name}】是旧海克斯，金币模式不允许分配`, 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (!Hexcore2.selectors.isHexcoreEnabled(hexcore.id)) {
        Hexcore2.eventStore.append('分配海克斯失败', `【${hexcore.name}】已被规则设置禁用`, 'warn');
        Hexcore2.ui.render();
        return;
      }

      const list = Hexcore2.state.hexcoreAssignments[captainId] || [];
      if (list.length >= HEXCORE_PICK_LIMIT) {
        Hexcore2.eventStore.append('分配海克斯失败', `${captain.name} 已完成海克斯选择`, 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (list.some(item => item.id === hexcoreId)) {
        Hexcore2.eventStore.append('分配海克斯失败', `${captain.name} 已持有【${hexcore.name}】`, 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (isHexcoreOccupiedByOtherCaptain(hexcoreId, captainId)) {
        Hexcore2.eventStore.append('分配海克斯失败', `【${hexcore.name}】已被其他队长选择`, 'warn');
        Hexcore2.ui.render();
        return;
      }

      snapshot(`分配海克斯前：${captain.name}`);
      Hexcore2.state.hexcoreAssignments[captainId] = list;
      list.push({ ...hexcore, status: hexcore.mode === 'passive' ? 'passive' : 'available' });
      applyHexcoreOnAcquire(captain, hexcore);
      Hexcore2.eventStore.append('分配海克斯', `${captain.name} 获得指定海克斯【${hexcore.name}】`, 'success');
      renderAndPersist();
    },

    async saveCaptainName(captainId, options = {}) {
      const captain = Hexcore2.state.captains.find(item => item.id === captainId);
      if (!captain) return;
      const input = document.getElementById(`captain-name-${captainId}`);
      const nextName = input ? input.value : '';
      if (!nextName || !nextName.trim()) {
        Hexcore2.eventStore.append('队伍改名失败', '队伍名称不能为空', 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (nextName.trim() === captain.name) {
        Hexcore2.eventStore.append('队伍改名', `${captain.name} 名称未变化`, 'info');
        Hexcore2.ui.render();
        return;
      }

      try {
        await submitRoomCommand('RenameTeam', { teamId: captain.id, name: nextName.trim() }, options);
      } catch (error) {
        Hexcore2.eventStore.append('队伍改名失败', error && error.message ? error.message : String(error), 'warn');
        Hexcore2.ui.render();
        return;
      }

      snapshot(`重命名队伍前：${captain.name}`);
      const oldName = captain.name;
      captain.name = nextName.trim();
      Hexcore2.eventStore.append('队伍管理', `队伍「${oldName}」重命名为「${captain.name}」`, 'info');
      renderAndPersist();
    },

    renameCaptain(captainId) {
      this.saveCaptainName(captainId);
    },

    setCurrentCaptain(captainId) {
      const index = Hexcore2.state.draft.currentOrder.indexOf(captainId);
      const captain = Hexcore2.state.captains.find(item => item.id === captainId);
      if (index < 0 || !captain) {
        Hexcore2.eventStore.append('切换队长失败', '目标队长不在当前顺位中', 'warn');
        Hexcore2.ui.render();
        return;
      }

      snapshot(`切换当前队长前：${captain.name}`);
      Hexcore2.state.draft.currentIndex = index;
      Hexcore2.state.draft.currentDraw = null;
      Hexcore2.state.draft.selectedSlot = 0;
      Hexcore2.state.draft.pickedThisTurn = false;
      Hexcore2.eventStore.append('队伍管理', `裁判将当前队长切换为 ${captain.name}`, 'warn');
      renderAndPersist();
    },

    jumpToScheduleSlot(round, captainId) {
      const targetRound = Number(round);
      const captain = Hexcore2.state.captains.find(item => item.id === captainId);
      if (!captain || !Number.isInteger(targetRound) || targetRound < 1 || targetRound > Hexcore2.state.draft.maxRounds) {
        Hexcore2.eventStore.append('轮次跳转失败', '目标轮次或队长无效', 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (goldShopMode() && targetRound !== Hexcore2.state.draft.round) {
        Hexcore2.eventStore.append('轮次跳转失败', '金币模式必须按当前轮次顺序执行，不能手动跳转到其他轮次', 'warn');
        Hexcore2.ui.render();
        return;
      }

      snapshot(`轮次跳转前：第${targetRound}轮 ${captain.name}`);
      Hexcore2.state.draft.round = targetRound;
      Hexcore2.turnOrderEngine.recompute();
      const index = Hexcore2.state.draft.currentOrder.indexOf(captainId);
      Hexcore2.state.draft.currentIndex = index >= 0 ? index : 0;
      Hexcore2.state.draft.currentDraw = null;
      Hexcore2.state.draft.selectedSlot = 0;
      Hexcore2.state.draft.pickedThisTurn = false;
      Hexcore2.eventStore.append('轮次跳转', `裁判跳转到第 ${targetRound} 轮：${captain.name}`, 'warn');
      renderAndPersist();
    },

    addCaptain() {
      if (rejectGoldLockedMutation('新增队伍失败')) return;
      if (Hexcore2.state.captains.length >= Hexcore2.state.settings.maxTeams) {
        Hexcore2.eventStore.append('新增队伍失败', `队伍数量不能超过 ${Hexcore2.state.settings.maxTeams}`, 'warn');
        Hexcore2.ui.render();
        return;
      }

      const number = nextCaptainNumber();
      const name = prompt('请输入新队伍名称', `海斗${number}队`);
      if (!name || !name.trim()) return;

      snapshot('新增队伍前');
      const captain = { id: `c${number}`, name: name.trim(), record: '', team: [] };
      Hexcore2.state.settings.teamCountCustomized = true;
      Hexcore2.state.captains.push(captain);
      Hexcore2.state.hexcoreAssignments[captain.id] = [];
      Hexcore2.state.draft.baseOrder.push(captain.id);
      normalizeAfterConfigChange();
      Hexcore2.eventStore.append('队伍管理', `新增队伍 ${captain.name}`, 'success');
      renderAndPersist();
    },

    removeCaptain(captainId) {
      if (rejectGoldLockedMutation('删除队伍失败')) return;
      if (Hexcore2.state.captains.length <= Hexcore2.state.settings.minTeams) {
        Hexcore2.eventStore.append('删除队伍失败', `队伍数量不能少于 ${Hexcore2.state.settings.minTeams}`, 'warn');
        Hexcore2.ui.render();
        return;
      }

      const captain = Hexcore2.state.captains.find(item => item.id === captainId);
      if (!captain) return;
      const confirmed = confirm(`确认删除 ${captain.name}？该队伍已有选手会回到可选状态。`);
      if (!confirmed) return;

      snapshot(`删除队伍前：${captain.name}`);
      captain.team.forEach(playerId => {
        const player = Hexcore2.state.players.find(item => item.id === playerId);
        markPlayerAvailable(player);
      });
      markPlayerAvailable(Hexcore2.selectors.captainPlayer(captain.id));
      Hexcore2.state.captains = Hexcore2.state.captains.filter(item => item.id !== captainId);
      Hexcore2.state.settings.teamCountCustomized = true;
      delete Hexcore2.state.hexcoreAssignments[captainId];
      Hexcore2.state.draft.baseOrder = Hexcore2.state.draft.baseOrder.filter(id => id !== captainId);
      Hexcore2.state.draft.runtimeEffects = Hexcore2.state.draft.runtimeEffects.filter(effect =>
        effect.captainId !== captainId && effect.sourceCaptainId !== captainId
      );
      normalizeAfterConfigChange();
      Hexcore2.eventStore.append('队伍管理', `删除队伍 ${captain.name}`, 'warn');
      renderAndPersist();
    },

    openDissolveTeamsDialog() {
      Hexcore2.state.ui = Hexcore2.state.ui || {};
      Hexcore2.state.ui.dissolveTeamsConfirm = { createdAt: Date.now() };
      Hexcore2.ui.render();
    },

    closeDissolveTeamsDialog() {
      if (Hexcore2.state.ui) delete Hexcore2.state.ui.dissolveTeamsConfirm;
      Hexcore2.ui.render();
    },

    dissolveAllTeams(keepCaptains) {
      if (!Hexcore2.state.captains.length) return;
      snapshot(`一键解散队伍前：${keepCaptains ? '保留队长' : '不保留队长'}`);
      let releasedMembers = 0;
      let releasedCaptains = 0;
      Hexcore2.state.captains.forEach(captain => {
        (captain.team || []).forEach(playerId => {
          const player = Hexcore2.state.players.find(item => item.id === playerId);
          if (player) {
            markPlayerAvailable(player);
            releasedMembers += 1;
          }
        });
        captain.team = [];
        const captainPlayer = Hexcore2.selectors.captainPlayer(captain.id);
        if (keepCaptains) {
          if (captainPlayer) bindCaptainPlayer(captain, captainPlayer);
          return;
        }
        if (captainPlayer) {
          markPlayerAvailable(captainPlayer);
          releasedCaptains += 1;
        }
        clearCaptainBinding(captain);
        Hexcore2.state.hexcoreAssignments[captain.id] = [];
      });
      Hexcore2.state.captains.forEach(captain => resetCaptainProgressForRestart(captain, keepCaptains));
      Hexcore2.state.ui = Hexcore2.state.ui || {};
      delete Hexcore2.state.ui.dissolveTeamsConfirm;
      delete Hexcore2.state.ui.recruitReveal;
      delete Hexcore2.state.ui.economyReveal;
      delete Hexcore2.state.ui.lastStandConfirm;
      delete Hexcore2.state.ui.chargedCannonDecision;
      if (!keepCaptains) {
        resetHexcoreDraftSession();
      }
      resetDraftForRestart();
      normalizeAfterConfigChange();
      Hexcore2.eventStore.append(
        '一键解散队伍',
        keepCaptains
          ? `已保留队长和海克斯，${releasedMembers} 名队员返回可选池，流程回到第1轮开始前`
          : `已清空队长身份和海克斯，${releasedCaptains + releasedMembers} 名成员返回可选池，请先重新设置队长并抽海克斯`,
        'warn'
      );
      renderAndPersist();
    },

    removePlayerFromTeam(captainId, playerId) {
      const captain = Hexcore2.state.captains.find(item => item.id === captainId);
      const player = Hexcore2.state.players.find(item => item.id === playerId);
      if (!captain || !player) return;
      if (!captain.team.includes(playerId)) {
        Hexcore2.eventStore.append('移除队员失败', `${player.name} 不在 ${captain.name} 队伍中`, 'warn');
        Hexcore2.ui.render();
        return;
      }

      snapshot(`移除队员前：${captain.name}`);
      captain.team = captain.team.filter(id => id !== playerId);
      markPlayerAvailable(player);
      if (Hexcore2.normalizeState) Hexcore2.normalizeState(Hexcore2.state);
      Hexcore2.turnOrderEngine.recompute();
      Hexcore2.eventStore.append(
        goldShopMode() ? '队伍纠错' : '队伍管理',
        `裁判将 ${player.name} 从 ${captain.name} 移回可选池`,
        'warn'
      );
      renderAndPersist();
    },

    assignPlayerToTeam(captainId, playerId) {
      const captain = Hexcore2.state.captains.find(item => item.id === captainId);
      const selectedPlayerId = playerId || (document.getElementById(`team-add-player-${captainId}`) || {}).value;
      const player = Hexcore2.state.players.find(item => item.id === selectedPlayerId);
      const capacity = captain ? Hexcore2.selectors.teamMemberCapacity(captain.id) : Math.max(0, Hexcore2.state.settings.playersPerTeam - 1);
      if (!captain || !player) {
        Hexcore2.eventStore.append('补录队员失败', '请选择有效队伍和选手', 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (captain.team.length >= capacity) {
        Hexcore2.eventStore.append('补录队员失败', `${captain.name} 已满员`, 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (player.status !== 'available') {
        Hexcore2.eventStore.append('补录队员失败', `${player.name} 当前不可选`, 'warn');
        Hexcore2.ui.render();
        return;
      }

      snapshot(`补录队员前：${captain.name}`);
      const assigned = Hexcore2.assignmentEngine.assign(captain.id, player.id, 'manual_backfill');
      if (!assigned) {
        Hexcore2.eventStore.append('补录队员失败', `${player.name} 不满足补录条件，请确认阵营、队长锁定和队伍容量`, 'warn');
        Hexcore2.ui.render();
        return;
      }
      Hexcore2.eventStore.append(
        goldShopMode() ? '队伍纠错' : '队伍管理',
        `裁判为 ${captain.name} 补录队员 ${player.name}`,
        'success'
      );
      renderAndPersist();
    },

    repairTeamIssues(captainId) {
      const draft = Hexcore2.state.draft || {};
      if (draft.round > 1 || draft.currentDraw || draft.pickedThisTurn || draft.phase === 'completed') {
        Hexcore2.eventStore.append('修复队伍异常失败', '当前抽选流程已开始，请先撤销或重置流程后再修复阵容异常', 'warn');
        Hexcore2.ui.render();
        return;
      }
      const captain = Hexcore2.state.captains.find(item => item.id === captainId);
      if (!captain) return;
      const capacity = Hexcore2.selectors.teamMemberCapacity(captain.id);
      const invalidCaptainBinding = Boolean(captain.playerId && !Hexcore2.state.players.find(player => player.id === captain.playerId));
      const firstOwner = new Map();
      Hexcore2.state.captains.forEach(item => {
        (item.team || []).forEach(playerId => {
          if (!firstOwner.has(playerId)) firstOwner.set(playerId, item.id);
        });
      });
      const kept = [];
      const removed = [];
      const captainCamp = Hexcore2.selectors.captainCamp(captain.id);
      (captain.team || []).forEach(playerId => {
        const player = Hexcore2.state.players.find(item => item.id === playerId);
        const duplicatedElsewhere = firstOwner.get(playerId) !== captain.id;
        const duplicatedInCurrentTeam = kept.includes(playerId);
        const illegalCrossCamp = Boolean(player && captainCamp && player.camp !== captainCamp);
        if (!player || player.status === 'disabled' || duplicatedElsewhere || duplicatedInCurrentTeam || illegalCrossCamp || kept.length >= capacity) {
          removed.push(playerId);
          if (player && player.teamId === captain.id && player.status !== 'disabled' && !duplicatedInCurrentTeam) markPlayerAvailable(player);
          return;
        }
        kept.push(playerId);
        player.teamId = captain.id;
        player.status = 'drafted';
      });
      if (!removed.length && !invalidCaptainBinding) {
        Hexcore2.eventStore.append('队伍异常检查', `${captain.name} 暂无可自动修复项；未设置队长等问题需裁判手动处理`, 'info');
        Hexcore2.ui.render();
        return;
      }

      snapshot(`修复队伍异常前：${captain.name}`);
      if (invalidCaptainBinding) captain.playerId = null;
      captain.team = kept;
      normalizeAfterConfigChange();
      Hexcore2.eventStore.append('队伍异常修复', `${captain.name} 已清理 ${removed.length} 个无效、重复或超员成员`, removed.length ? 'warn' : 'info');
      renderAndPersist();
    },

    repairSystemIntegrityIssues() {
      const confirmed = typeof confirm === 'function'
        ? confirm('确认自动修复可处理的完整性异常？非法跨阵营、重复、缺失、禁用或超员成员会被移出队伍并回到可选池。')
        : true;
      if (!confirmed) return;

      snapshot('修复完整性异常前');
      const result = Hexcore2.integrityService.repairState();
      if (Hexcore2.normalizeState) Hexcore2.normalizeState(Hexcore2.state);
      Hexcore2.turnOrderEngine.recompute();
      Hexcore2.eventStore.append(
        '完整性修复',
        `已移出 ${result.removedCount} 个非法成员，同步 ${result.syncedCount} 个归属字段`,
        result.removedCount ? 'warn' : 'success'
      );
      this.runSystemCheck();
      renderAndPersist();
    },

    promotePlayerToCaptain(playerId) {
      if (rejectGoldLockedMutation('设为队长失败')) return;
      const player = Hexcore2.state.players.find(item => item.id === playerId);
      if (!player) {
        Hexcore2.eventStore.append('设为队长失败', '目标选手不存在', 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (player.status === 'disabled') {
        Hexcore2.eventStore.append('设为队长失败', `${player.name} 当前已禁用，不能设为队长`, 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (player.status === 'captain' || Hexcore2.state.captains.some(captain => captain.playerId === player.id)) {
        Hexcore2.eventStore.append('设为队长失败', `${player.name} 已经是队长`, 'warn');
        Hexcore2.ui.render();
        return;
      }

      const owner = Hexcore2.state.captains.find(captain =>
        captain.id === player.teamId || (captain.team || []).includes(player.id)
      );
      const emptyCaptain = !owner
        ? Hexcore2.state.captains.find(captain => !captain.playerId)
        : null;
      if (!owner && !emptyCaptain && Hexcore2.state.captains.length >= Hexcore2.state.settings.maxTeams) {
        Hexcore2.eventStore.append('设为队长失败', `队伍数量不能超过 ${Hexcore2.state.settings.maxTeams}，请先删除或替换现有队伍`, 'warn');
        Hexcore2.ui.render();
        return;
      }
      const existingTargetCaptain = owner || emptyCaptain || null;
      const replacedCamp = existingTargetCaptain ? Hexcore2.selectors.captainCamp(existingTargetCaptain.id) : '';
      if (!Hexcore2.selectors.canAddCampCaptain(player.camp, replacedCamp)) {
        const campName = Hexcore2.selectors.campLabel(player.camp);
        const limit = Hexcore2.selectors.campTeamLimit(player.camp);
        Hexcore2.eventStore.append('设为队长失败', `${campName}队伍数量不能超过 ${campName}人数/5，当前上限为 ${limit} 队`, 'warn');
        Hexcore2.ui.render();
        return;
      }

      snapshot(`设为队长前：${player.name}`);
      const targetCaptain = existingTargetCaptain || (() => {
        const number = nextCaptainNumber();
        const captain = {
          id: `c${number}`,
          name: `海斗${number}队`,
          record: '',
          team: [],
        };
        Hexcore2.state.captains.push(captain);
        Hexcore2.state.hexcoreAssignments[captain.id] = [];
        Hexcore2.state.draft.baseOrder.push(captain.id);
        return captain;
      })();

      const oldCaptainPlayer = Hexcore2.state.players.find(item => item.id === targetCaptain.playerId);
      if (oldCaptainPlayer && oldCaptainPlayer.id !== player.id) {
        markPlayerAvailable(oldCaptainPlayer);
      }

      Hexcore2.state.captains.forEach(captain => {
        captain.team = (captain.team || []).filter(id => id !== player.id);
        if (captain.id !== targetCaptain.id && captain.playerId === player.id) {
          clearCaptainBinding(captain);
        }
      });
      bindCaptainPlayer(targetCaptain, player);
      if (oldCaptainPlayer && oldCaptainPlayer.id !== player.id && !targetCaptain.team.includes(oldCaptainPlayer.id)) {
        demoteCaptainPlayerToTeam(targetCaptain, oldCaptainPlayer);
      }
      normalizeAfterConfigChange();
      Hexcore2.eventStore.append(
        '队长设置',
        owner
          ? `${player.name} 晋升为 ${targetCaptain.name} 的队长${oldCaptainPlayer && oldCaptainPlayer.id !== player.id ? `，${oldCaptainPlayer.name} 回到自由选手池` : ''}`
          : emptyCaptain
            ? `${player.name} 设为 ${targetCaptain.name} 的队长`
          : `${player.name} 设为队长并新建队伍 ${targetCaptain.name}`,
        'success'
      );
      renderAndPersist();
    },

    releaseCaptain(playerId) {
      if (rejectGoldLockedMutation('解除队长失败')) return;
      const player = Hexcore2.state.players.find(item => item.id === playerId);
      const captain = player && Hexcore2.state.captains.find(item => item.playerId === player.id);
      if (!player || !captain) {
        Hexcore2.eventStore.append('解除队长失败', '目标队长不存在', 'warn');
        Hexcore2.ui.render();
        return;
      }

      snapshot(`解除队长前：${player.name}`);
      clearCaptainBinding(captain);
      markPlayerAvailable(player);
      normalizeAfterConfigChange();
      Hexcore2.eventStore.append('队长设置', `${player.name} 已解除 ${captain.name} 队长身份，回到普通选手池`, 'warn');
      renderAndPersist();
    },

    moveCaptainOrder(captainId, direction) {
      if (rejectGoldLockedMutation('顺位调整失败')) return;
      const order = Hexcore2.state.draft.baseOrder;
      const index = order.indexOf(captainId);
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      const captain = Hexcore2.state.captains.find(item => item.id === captainId);
      if (index < 0 || targetIndex < 0 || targetIndex >= order.length || !captain) {
        Hexcore2.eventStore.append('顺位调整失败', '目标顺位无效', 'warn');
        Hexcore2.ui.render();
        return;
      }

      snapshot(`调整基础顺位前：${captain.name}`);
      const [item] = order.splice(index, 1);
      order.splice(targetIndex, 0, item);
      normalizeAfterConfigChange();
      Hexcore2.eventStore.append('队伍管理', `${captain.name} 基础顺位调整为第 ${targetIndex + 1}`, 'warn');
      renderAndPersist();
    },

    setCaptainOrderPosition(captainId) {
      if (rejectGoldLockedMutation('顺位调整失败')) return;
      const input = document.getElementById(`captain-order-${captainId}`);
      const position = Number(input && input.value);
      const order = Hexcore2.state.draft.baseOrder;
      const index = order.indexOf(captainId);
      const captain = Hexcore2.state.captains.find(item => item.id === captainId);
      if (!Number.isInteger(position) || position < 1 || position > order.length || index < 0 || !captain) {
        Hexcore2.eventStore.append('顺位调整失败', `基础顺位必须在 1-${order.length} 之间`, 'warn');
        Hexcore2.ui.render();
        return;
      }

      snapshot(`设置基础顺位前：${captain.name}`);
      const [item] = order.splice(index, 1);
      order.splice(position - 1, 0, item);
      normalizeAfterConfigChange();
      Hexcore2.eventStore.append('队伍管理', `${captain.name} 基础顺位设置为第 ${position}`, 'warn');
      renderAndPersist();
    },

    updateTeamCountFromTeams() {
      if (rejectGoldLockedMutation('队伍数量失败')) return;
      const input = document.getElementById('teams-team-count');
      const teamCount = Number(input && input.value);
      const minTeams = Hexcore2.state.settings.minTeams;
      const maxTeams = Hexcore2.state.settings.maxTeams;
      if (!Number.isInteger(teamCount) || teamCount < minTeams || teamCount > maxTeams) {
        Hexcore2.eventStore.append('队伍数量失败', `队伍数量必须在 ${minTeams}-${maxTeams} 之间`, 'warn');
        Hexcore2.ui.render();
        return;
      }
      const confirmed = typeof confirm === 'function'
        ? confirm('队伍数量修改会重算流程并清空当前商店结果，确认保存？')
        : true;
      if (!confirmed) return;

      snapshot('队伍数量调整前');
      Hexcore2.state.settings.teamCountCustomized = true;
      while (Hexcore2.state.captains.length < teamCount) {
        const number = nextCaptainNumber();
        const captain = { id: `c${number}`, name: `海斗${number}队`, record: '', team: [] };
        Hexcore2.state.captains.push(captain);
        Hexcore2.state.hexcoreAssignments[captain.id] = [];
        Hexcore2.state.draft.baseOrder.push(captain.id);
      }
      while (Hexcore2.state.captains.length > teamCount) {
        const captain = Hexcore2.state.captains[Hexcore2.state.captains.length - 1];
        captain.team.forEach(playerId => {
          const player = Hexcore2.state.players.find(item => item.id === playerId);
          markPlayerAvailable(player);
        });
        markPlayerAvailable(Hexcore2.selectors.captainPlayer(captain.id));
        Hexcore2.state.captains.pop();
        delete Hexcore2.state.hexcoreAssignments[captain.id];
        Hexcore2.state.draft.baseOrder = Hexcore2.state.draft.baseOrder.filter(id => id !== captain.id);
      }
      normalizeAfterConfigChange();
      Hexcore2.eventStore.append('队伍管理', `队伍数量调整为 ${teamCount} 队`, 'success');
      renderAndPersist();
    },

    updateRules(fromTeamPage = false) {
      if (rejectGoldLockedMutation('规则保存失败')) return;
      const teamCountInput = document.getElementById('rules-team-count');
      const teamPageCountInput = document.getElementById('teams-team-count');
      const playersPerTeamInput = document.getElementById('rules-players-per-team');
      const roundInput = document.getElementById('rules-current-round');
      const maxRoundsInput = document.getElementById('rules-max-rounds');
      const drawCountInput = document.getElementById('rules-draw-count');
      const teamCount = Number((teamCountInput && teamCountInput.value) || (teamPageCountInput && teamPageCountInput.value));
      const playersPerTeam = Number(playersPerTeamInput && playersPerTeamInput.value);
      const round = Number(roundInput && roundInput.value);
      const maxRounds = Number(maxRoundsInput && maxRoundsInput.value);
      const drawCount = Number(drawCountInput && drawCountInput.value);
      const minTeams = Hexcore2.state.settings.minTeams;
      const maxTeams = Hexcore2.state.settings.maxTeams;
      const nextMaxRounds = 4;
      const nextDrawCount = 5;
      const roundTiers = Array.from({ length: nextMaxRounds }, (_, index) => {
        const input = document.getElementById(`rules-round-tier-${index + 1}`);
        return Number(input && input.value) || Hexcore2.selectors.roundTier(index + 1);
      });
      const tierNames = [0, 1, 2, 3, 4, 5].reduce((result, tier) => {
        const input = document.getElementById(`rules-tier-name-${tier}`);
        const fallback = Hexcore2.state.settings.tierNames[tier] || '';
        const value = String((input && input.value) || fallback).trim().slice(0, 12);
        result[tier] = value;
        return result;
      }, {});

      if (!Number.isInteger(teamCount) || teamCount < minTeams || teamCount > maxTeams) {
        Hexcore2.eventStore.append('规则保存失败', `队伍数量必须在 ${minTeams}-${maxTeams} 之间`, 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (!Number.isInteger(playersPerTeam) || playersPerTeam < 2 || playersPerTeam > 8) {
        Hexcore2.eventStore.append('规则保存失败', '每队人数必须在 2-8 之间，且包含队长', 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (!Number.isInteger(round) || round < 1 || round > nextMaxRounds) {
        Hexcore2.eventStore.append('规则保存失败', `当前轮次必须在 1-${nextMaxRounds} 之间`, 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (roundTiers.some(tier => !Number.isInteger(tier) || tier < 1 || tier > 5)) {
        Hexcore2.eventStore.append('规则保存失败', '每轮卡池必须在 1-5 之间', 'warn');
        Hexcore2.ui.render();
        return;
      }
      if ([0, 1, 2, 3, 4, 5].some(tier => !tierNames[tier])) {
        Hexcore2.eventStore.append('规则保存失败', '卡池名称不能为空', 'warn');
        Hexcore2.ui.render();
        return;
      }
      const confirmed = typeof confirm === 'function'
        ? confirm(`${fromTeamPage ? '队伍数量' : '规则'}修改会重算流程并清空当前商店结果，确认保存？`)
        : true;
      if (!confirmed) return;

      snapshot('规则设置保存前');
      Hexcore2.state.settings.teamCountCustomized = true;
      while (Hexcore2.state.captains.length < teamCount) {
        const number = nextCaptainNumber();
        const captain = { id: `c${number}`, name: `海斗${number}队`, record: '', team: [] };
        Hexcore2.state.captains.push(captain);
        Hexcore2.state.hexcoreAssignments[captain.id] = [];
        Hexcore2.state.draft.baseOrder.push(captain.id);
      }
      while (Hexcore2.state.captains.length > teamCount) {
        const captain = Hexcore2.state.captains[Hexcore2.state.captains.length - 1];
        captain.team.forEach(playerId => {
          const player = Hexcore2.state.players.find(item => item.id === playerId);
          if (player) {
            player.status = 'available';
            delete player.teamId;
          }
        });
        Hexcore2.state.captains.pop();
        delete Hexcore2.state.hexcoreAssignments[captain.id];
        Hexcore2.state.draft.baseOrder = Hexcore2.state.draft.baseOrder.filter(id => id !== captain.id);
      }
      Hexcore2.state.settings.playersPerTeam = playersPerTeam;
      Hexcore2.state.settings.teamSizeIncludesCaptain = true;
      Hexcore2.state.settings.drawCount = nextDrawCount;
      Hexcore2.state.settings.shopSize = 5;
      Hexcore2.state.settings.roundTiers = roundTiers;
      Hexcore2.state.settings.tierNames = tierNames;
      Hexcore2.state.draft.round = round;
      Hexcore2.state.draft.maxRounds = nextMaxRounds;
      normalizeAfterConfigChange();
      Hexcore2.eventStore.append('规则设置', `保存金币模式规则：${teamCount} 队，每队 ${playersPerTeam} 人（含队长），固定4轮，每次商店5张`, 'success');
      renderAndPersist();
    },

    toggleHexcoreEnabled(hexcoreId) {
      const hexcore = Hexcore2.sampleData.hexcores.find(item => item.id === hexcoreId);
      if (!hexcore) return;
      const disabled = new Set(Hexcore2.state.settings.disabledHexcores || []);
      const willDisable = !disabled.has(hexcoreId);
      const confirmed = typeof confirm === 'function'
        ? confirm(`${willDisable ? '禁用' : '启用'}【${hexcore.name}】会影响后续海克斯执行，确认修改？`)
        : true;
      if (!confirmed) return;

      snapshot(`切换海克斯启用状态前：${hexcore.name}`);
      if (willDisable) disabled.add(hexcoreId);
      else disabled.delete(hexcoreId);
      Hexcore2.state.settings.disabledHexcores = Array.from(disabled);
      Hexcore2.turnOrderEngine.recompute();
      Hexcore2.eventStore.append('规则设置', `${willDisable ? '禁用' : '启用'}海克斯【${hexcore.name}】`, willDisable ? 'warn' : 'success');
      renderAndPersist();
    },

    saveRuleTemplate() {
      const name = prompt('请输入规则模板名称', `规则模板 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`);
      if (!name || !name.trim()) return;
      snapshot('保存规则模板前');
      Hexcore2.state.settings.ruleTemplates = Hexcore2.state.settings.ruleTemplates || [];
      Hexcore2.state.settings.ruleTemplates.unshift({
        name: name.trim(),
        savedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
        teamCount: Hexcore2.selectors.teamCount(),
        playersPerTeam: Hexcore2.state.settings.playersPerTeam,
        teamSizeIncludesCaptain: true,
        maxRounds: Hexcore2.state.draft.maxRounds,
        drawCount: Hexcore2.state.settings.drawCount,
        roundTiers: [...Hexcore2.state.settings.roundTiers],
        tierNames: { ...Hexcore2.state.settings.tierNames },
        disabledHexcores: [...Hexcore2.state.settings.disabledHexcores],
      });
      Hexcore2.state.settings.ruleTemplates = Hexcore2.state.settings.ruleTemplates.slice(0, 8);
      Hexcore2.eventStore.append('规则设置', `保存规则模板「${name.trim()}」`, 'success');
      renderAndPersist();
    },

    loadRuleTemplate(index) {
      if (rejectGoldLockedMutation('加载规则模板失败')) return;
      const templates = Hexcore2.state.settings.ruleTemplates || [];
      const template = templates[Number(index)];
      if (!template) {
        Hexcore2.eventStore.append('加载规则模板失败', '模板不存在或已被删除', 'warn');
        Hexcore2.ui.render();
        return;
      }
      const confirmed = typeof confirm === 'function'
        ? confirm(`确认加载规则模板「${template.name}」？这会覆盖当前规则参数、重算流程并清空当前商店结果。`)
        : true;
      if (!confirmed) return;

      snapshot(`加载规则模板前：${template.name}`);
      const minTeams = Hexcore2.state.settings.minTeams;
      const maxTeams = Hexcore2.state.settings.maxTeams;
      const teamCount = Math.max(minTeams, Math.min(maxTeams, Number(template.teamCount) || Hexcore2.selectors.teamCount()));
      while (Hexcore2.state.captains.length < teamCount) {
        const number = nextCaptainNumber();
        const captain = { id: `c${number}`, name: `海斗${number}队`, record: '', team: [] };
        Hexcore2.state.captains.push(captain);
        Hexcore2.state.hexcoreAssignments[captain.id] = [];
        Hexcore2.state.draft.baseOrder.push(captain.id);
      }
      while (Hexcore2.state.captains.length > teamCount) {
        const captain = Hexcore2.state.captains[Hexcore2.state.captains.length - 1];
        captain.team.forEach(playerId => markPlayerAvailable(Hexcore2.state.players.find(player => player.id === playerId)));
        markPlayerAvailable(Hexcore2.selectors.captainPlayer(captain.id));
        Hexcore2.state.captains.pop();
        delete Hexcore2.state.hexcoreAssignments[captain.id];
        Hexcore2.state.draft.baseOrder = Hexcore2.state.draft.baseOrder.filter(id => id !== captain.id);
      }
      Hexcore2.state.settings.teamCountCustomized = true;
      Hexcore2.state.settings.playersPerTeam = Math.max(2, Math.min(8, Number(template.playersPerTeam) || Hexcore2.state.settings.playersPerTeam));
      Hexcore2.state.settings.teamSizeIncludesCaptain = true;
      Hexcore2.state.settings.drawCount = 5;
      Hexcore2.state.settings.shopSize = 5;
      Hexcore2.state.settings.roundTiers = Array.isArray(template.roundTiers)
        ? template.roundTiers.slice(0, 4).map(tier => Math.max(1, Math.min(5, Number(tier) || 1)))
        : Hexcore2.state.settings.roundTiers;
      Hexcore2.state.settings.tierNames = template.tierNames ? { ...Hexcore2.state.settings.tierNames, ...template.tierNames } : Hexcore2.state.settings.tierNames;
      Hexcore2.state.settings.disabledHexcores = Array.isArray(template.disabledHexcores) ? [...template.disabledHexcores] : [];
      Hexcore2.state.draft.round = 1;
      Hexcore2.state.draft.maxRounds = 4;
      Hexcore2.state.draft.currentDraw = null;
      Hexcore2.state.draft.pickedThisTurn = false;
      Hexcore2.state.draft.runtimeEffects = [];
      normalizeAfterConfigChange();
      Hexcore2.eventStore.append('规则设置', `已加载规则模板「${template.name}」并重算流程`, 'warn');
      renderAndPersist();
    },

    setPlayerFilter(filter) {
      Hexcore2.state.ui = Hexcore2.state.ui || {};
      Hexcore2.state.ui.playerFilter = filter || 'all';
      renderAndPersist();
    },

    setPlayerCampFilter(camp, filter) {
      Hexcore2.state.ui = Hexcore2.state.ui || {};
      Hexcore2.state.ui.playerCampFilters = Hexcore2.state.ui.playerCampFilters || {};
      if (['local', 'outsider'].includes(camp)) {
        Hexcore2.state.ui.playerCampFilters[camp] = filter || 'all';
      }
      renderAndPersist();
    },

    setHexFilter(filter) {
      Hexcore2.state.ui = Hexcore2.state.ui || {};
      Hexcore2.state.ui.hexFilter = filter || 'all';
      renderAndPersist();
    },

    setHexCaptain(captainId) {
      Hexcore2.state.ui = Hexcore2.state.ui || {};
      Hexcore2.state.ui.hexCaptainId = captainId;
      renderAndPersist();
    },

    openHexcoreForCaptain(captainId) {
      Hexcore2.state.ui = Hexcore2.state.ui || {};
      Hexcore2.state.ui.activeView = 'hexcores';
      Hexcore2.state.ui.hexCaptainId = captainId;
      renderAndPersist();
    },

    addPlayer() {
      if (rejectGoldLockedMutation('新增选手失败')) return;
      Hexcore2.state.ui = Hexcore2.state.ui || {};
      Hexcore2.state.ui.addPlayerModal = true;
      renderAndPersist();
    },

    cancelAddPlayer() {
      Hexcore2.state.ui = Hexcore2.state.ui || {};
      Hexcore2.state.ui.addPlayerModal = false;
      renderAndPersist();
    },

    confirmAddPlayer() {
      const nameInput = document.getElementById('add-player-name');
      const laneInput = document.getElementById('add-player-lane');
      const campInput = document.getElementById('add-player-camp');
      const scoreInput = document.getElementById('add-player-score');
      const gameIdInput = document.getElementById('add-player-game-id');
      const name = nameInput ? nameInput.value.trim() : '';
      const lane = laneInput ? laneInput.value.trim() : '';
      const camp = campInput ? campInput.value : '';
      const score = Number(scoreInput && scoreInput.value);
      const gameId = gameIdInput ? gameIdInput.value.trim() : '';

      if (!name || !lane || !['local', 'outsider'].includes(camp) || !Number.isInteger(score) || score < 0 || score > 120) {
        Hexcore2.eventStore.append('新增选手失败', '请填写有效的姓名、位置、阵营和评分', 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (gameId && Hexcore2.state.players.some(player => String(player.gameId || '').toLowerCase() === gameId.toLowerCase())) {
        Hexcore2.eventStore.append('新增选手失败', `游戏ID「${gameId}」已存在`, 'warn');
        Hexcore2.ui.render();
        return;
      }
      const number = nextPlayerId();
      const player = {
        id: `p${number}`,
        camp,
        lane,
        name,
        gameId: gameId || `NEW_${number}`,
        score,
        tier: 1,
        kda: '0.0',
        damage: '0K',
        winRate: '0%',
        heroes: [lane.slice(0, 1) || '待', '定', '位'],
        status: 'available',
      };

      snapshot('新增选手前');
      Hexcore2.state.players.push(player);
      Hexcore2.state.ui.addPlayerModal = false;
      Hexcore2.state.ui.playerImportPage = 1;
      if (Hexcore2.normalizeState) Hexcore2.normalizeState(Hexcore2.state);
      Hexcore2.eventStore.append('选手库', `新增选手 ${player.name}`, 'success');
      renderAndPersist();
    },

    importPlayers(file) {
      if (rejectGoldLockedMutation('选手导入失败')) return;
      Hexcore2.exportService.readPlayerImportPreview(file, Hexcore2.state.players, preview => {
        Hexcore2.state.ui = Hexcore2.state.ui || {};
        Hexcore2.state.ui.playerImportPreview = preview;
        Hexcore2.state.ui.playerImportPage = 1;
        Hexcore2.state.ui.playerImportTab = preview.accepted && preview.accepted.length ? 'accepted' : 'skipped';
        Hexcore2.state.ui.playerImportSelected = (preview.accepted || []).map((_, index) => index);
        Hexcore2.eventStore.append(
          '选手导入预览',
          `读取 ${preview.fileName}：可导入 ${preview.accepted.length} 名，跳过 ${preview.skipped.length} 条`,
          preview.accepted.length ? 'info' : 'warn'
        );
        renderAndPersist();
      }, error => {
        Hexcore2.eventStore.append('选手导入失败', error.message, 'warn');
        Hexcore2.ui.render();
      });
    },

    confirmPlayerImport() {
      if (rejectGoldLockedMutation('选手导入失败')) return;
      const preview = Hexcore2.state.ui && Hexcore2.state.ui.playerImportPreview;
      const accepted = preview && Array.isArray(preview.accepted) ? preview.accepted : [];
      const selected = new Set(Array.isArray(Hexcore2.state.ui.playerImportSelected)
        ? Hexcore2.state.ui.playerImportSelected.map(index => Number(index)).filter(index => Number.isInteger(index) && index >= 0 && index < accepted.length)
        : accepted.map((_, index) => index));
      const players = accepted.filter((_, index) => selected.has(index));
      if (!players.length) {
        Hexcore2.eventStore.append('选手导入失败', '请至少勾选1名要导入的选手', 'warn');
        renderAndPersist();
        return;
      }

      snapshot('导入选手前');
      const usedIds = new Set(Hexcore2.state.players.map(player => player.id));
      const gameIds = new Set(Hexcore2.state.players.map(player => String(player.gameId || '').toLowerCase()).filter(Boolean));
      let skipped = 0;
      const imported = [];

      players.forEach(player => {
        const gameIdKey = String(player.gameId || '').toLowerCase();
        if (gameIdKey && gameIds.has(gameIdKey)) {
          skipped += 1;
          return;
        }
        const nextPlayer = {
          ...player,
          id: allocatePlayerId(player.id, usedIds),
        };
        delete nextPlayer.teamId;
        gameIds.add(gameIdKey);
        imported.push(nextPlayer);
      });

      Hexcore2.state.players.push(...imported);
      if (Hexcore2.state.ui) {
        Hexcore2.state.ui.playerImportPreview = null;
        Hexcore2.state.ui.playerImportPage = 1;
        Hexcore2.state.ui.playerImportTab = 'accepted';
        Hexcore2.state.ui.playerImportSelected = [];
      }
      if (Hexcore2.normalizeState) Hexcore2.normalizeState(Hexcore2.state);
      Hexcore2.eventStore.append(
        '选手导入',
        `确认导入 ${imported.length} 名选手${skipped ? `，确认时跳过 ${skipped} 名重复游戏ID` : ''}`,
        imported.length ? 'success' : 'warn'
      );
      renderAndPersist();
    },

    setPlayerImportTab(tab) {
      if (!Hexcore2.state.ui || !Hexcore2.state.ui.playerImportPreview) return;
      Hexcore2.state.ui.playerImportTab = tab === 'skipped' ? 'skipped' : 'accepted';
      Hexcore2.state.ui.playerImportPage = 1;
      renderAndPersist();
    },

    setPlayerImportPage(page) {
      if (!Hexcore2.state.ui || !Hexcore2.state.ui.playerImportPreview) return;
      const preview = Hexcore2.state.ui.playerImportPreview;
      const tab = Hexcore2.state.ui.playerImportTab === 'skipped' ? 'skipped' : 'accepted';
      const list = Array.isArray(preview[tab]) ? preview[tab] : [];
      const pageSize = 20;
      const maxPage = Math.max(1, Math.ceil(list.length / pageSize));
      Hexcore2.state.ui.playerImportPage = Math.max(1, Math.min(maxPage, Math.round(Number(page) || 1)));
      renderAndPersist();
    },

    togglePlayerImportSelection(index) {
      if (!Hexcore2.state.ui || !Hexcore2.state.ui.playerImportPreview) return;
      const accepted = Array.isArray(Hexcore2.state.ui.playerImportPreview.accepted)
        ? Hexcore2.state.ui.playerImportPreview.accepted
        : [];
      const numericIndex = Math.round(Number(index));
      if (!Number.isInteger(numericIndex) || numericIndex < 0 || numericIndex >= accepted.length) return;
      const selected = new Set(Array.isArray(Hexcore2.state.ui.playerImportSelected) ? Hexcore2.state.ui.playerImportSelected : accepted.map((_, itemIndex) => itemIndex));
      if (selected.has(numericIndex)) selected.delete(numericIndex);
      else selected.add(numericIndex);
      Hexcore2.state.ui.playerImportSelected = [...selected].sort((a, b) => a - b);
      renderAndPersist();
    },

    setPlayerImportSelection(mode) {
      if (!Hexcore2.state.ui || !Hexcore2.state.ui.playerImportPreview) return;
      const accepted = Array.isArray(Hexcore2.state.ui.playerImportPreview.accepted)
        ? Hexcore2.state.ui.playerImportPreview.accepted
        : [];
      const selected = new Set(Array.isArray(Hexcore2.state.ui.playerImportSelected) ? Hexcore2.state.ui.playerImportSelected : accepted.map((_, itemIndex) => itemIndex));
      const pageSize = 20;
      const currentPage = Math.max(1, Math.round(Number(Hexcore2.state.ui.playerImportPage) || 1));
      const pageIndexes = accepted
        .map((_, itemIndex) => itemIndex)
        .slice((currentPage - 1) * pageSize, currentPage * pageSize);
      if (mode === 'none') {
        selected.clear();
      } else if (mode === 'page') {
        pageIndexes.forEach(itemIndex => selected.add(itemIndex));
      } else if (mode === 'page-none') {
        pageIndexes.forEach(itemIndex => selected.delete(itemIndex));
      } else {
        accepted.forEach((_, itemIndex) => selected.add(itemIndex));
      }
      Hexcore2.state.ui.playerImportSelected = [...selected].sort((a, b) => a - b);
      renderAndPersist();
    },

    cancelPlayerImport() {
      if (Hexcore2.state.ui) {
        Hexcore2.state.ui.playerImportPreview = null;
        Hexcore2.state.ui.playerImportPage = 1;
        Hexcore2.state.ui.playerImportTab = 'accepted';
        Hexcore2.state.ui.playerImportSelected = [];
      }
      Hexcore2.eventStore.append('选手导入取消', '裁判关闭了导入预览', 'info');
      renderAndPersist();
    },

    clearAllPlayers() {
      const firstConfirmed = typeof confirm === 'function'
        ? confirm('高风险操作：将清空所有选手，并移除所有队伍中的队长和队员，所有卡池会变为空。是否继续？')
        : true;
      if (!firstConfirmed) return;

      const secondConfirmed = typeof confirm === 'function'
        ? confirm('二次确认：清空后选人流程会初始化到第1轮，海克斯、商店结果、赛程也会清空。确认执行？')
        : true;
      if (!secondConfirmed) return;

      snapshot('清空所有选手前');
      Hexcore2.state.players = [];
      Hexcore2.state.captains.forEach(captain => {
        captain.team = [];
        clearCaptainBinding(captain);
        captain.economy = {
          gold: Hexcore2.state.settings.initialGold,
          incomeAppliedRounds: [1],
          roundState: {
            1: { freeShopUsed: false, refreshCount: 0, purchaseUsed: false, skipped: false },
            2: { freeShopUsed: false, refreshCount: 0, purchaseUsed: false, skipped: false },
            3: { freeShopUsed: false, refreshCount: 0, purchaseUsed: false, skipped: false },
            4: { freeShopUsed: false, refreshCount: 0, purchaseUsed: false, skipped: false },
          },
        };
      });
      Hexcore2.state.hexcoreAssignments = Hexcore2.state.captains.reduce((result, captain) => {
        result[captain.id] = [];
        return result;
      }, {});
      Hexcore2.state.hexcoreDraft = {
        captainId: '',
        slots: [],
        chosen: [],
        seenIds: [],
        refreshUsed: false,
        drawOrder: [],
      };
      Hexcore2.state.draft = {
        phase: 'captain_action',
        round: 1,
        maxRounds: Hexcore2.state.draft.maxRounds || 4,
        baseOrder: Hexcore2.state.captains.map(captain => captain.id),
        currentOrder: Hexcore2.state.captains.map(captain => captain.id),
        currentIndex: 0,
        selectedSlot: 0,
        currentDraw: null,
        runtimeEffects: [],
        explanations: [],
        pickedThisTurn: false,
        finalFillCompleted: false,
      };
      Hexcore2.state.tournament = { status: 'empty', championId: '', rounds: [] };
      Hexcore2.state.ui = Hexcore2.state.ui || {};
      Hexcore2.state.ui.activeView = 'players';
      Hexcore2.state.ui.playerFilter = 'all';
      if (Hexcore2.normalizeState) Hexcore2.normalizeState(Hexcore2.state);
      Hexcore2.turnOrderEngine.recompute();
      Hexcore2.eventStore.append('选手库清空', '裁判清空了所有选手，队伍、卡池、海克斯和选人流程已初始化', 'warn');
      renderAndPersist();
    },

    savePlayer(playerId) {
      const player = Hexcore2.state.players.find(item => item.id === playerId);
      if (!player) return;
      const lane = document.getElementById(`player-lane-${playerId}`);
      const heroes = document.getElementById(`player-heroes-${playerId}`);
      const manifesto = document.getElementById(`player-manifesto-${playerId}`);
      const nextName = player.name;
      const nextLane = lane ? lane.value.trim() : '';
      const nextHeroes = heroes
        ? heroes.value.split(/[，,、|/]/).map(hero => hero.trim()).filter(Boolean).slice(0, 5)
        : (player.heroes || []);
      const nextManifesto = manifesto ? manifesto.value.trim().slice(0, 80) : (player.manifesto || '');

      if (!nextName || !nextLane) {
        Hexcore2.eventStore.append('保存选手失败', '选手名称或位置无效', 'warn');
        Hexcore2.ui.render();
        return;
      }

      snapshot(`保存选手前：${player.name}`);
      player.name = nextName;
      player.lane = nextLane;
      player.heroes = nextHeroes.length ? nextHeroes : ['待', '定', '位'];
      player.manifesto = nextManifesto;
      if (Hexcore2.normalizeState) Hexcore2.normalizeState(Hexcore2.state);
      Hexcore2.eventStore.append('选手库', `保存选手 ${player.name} 的基础信息`, 'success');
      renderAndPersist();
    },

    autoSavePlayerIfChanged(playerId) {
      const player = Hexcore2.state.players.find(item => item.id === playerId);
      if (!player) return;
      const lane = document.getElementById(`player-lane-${playerId}`);
      const heroes = document.getElementById(`player-heroes-${playerId}`);
      const manifesto = document.getElementById(`player-manifesto-${playerId}`);
      const nextLane = lane ? lane.value.trim() : '';
      const nextHeroes = heroes
        ? heroes.value.split(/[，,、|/]/).map(hero => hero.trim()).filter(Boolean).slice(0, 5)
        : (player.heroes || []);
      const nextManifesto = manifesto ? manifesto.value.trim().slice(0, 80) : (player.manifesto || '');
      const currentHeroes = Array.isArray(player.heroes) ? player.heroes : [];
      const changed = nextLane !== (player.lane || '')
        || nextHeroes.join('|') !== currentHeroes.join('|')
        || nextManifesto !== (player.manifesto || '');

      if (changed) this.savePlayer(playerId);
    },

    editPlayerGameId(playerId) {
      const player = Hexcore2.state.players.find(item => item.id === playerId);
      if (!player) return;
      Hexcore2.state.ui.editingGameIdPlayerId = playerId;
      Hexcore2.ui.render();
      setTimeout(() => {
        const input = document.getElementById(`player-game-id-${playerId}`);
        if (input) {
          input.focus();
          input.select();
        }
      }, 0);
    },

    editPlayerName(playerId) {
      const player = Hexcore2.state.players.find(item => item.id === playerId);
      if (!player) return;
      Hexcore2.state.ui.editingNamePlayerId = playerId;
      Hexcore2.ui.render();
      setTimeout(() => {
        const input = document.getElementById(`player-display-name-${playerId}`);
        if (input) {
          input.focus();
          input.select();
        }
      }, 0);
    },

    cancelPlayerNameEdit() {
      Hexcore2.state.ui.editingNamePlayerId = '';
      Hexcore2.ui.render();
    },

    savePlayerName(playerId) {
      const player = Hexcore2.state.players.find(item => item.id === playerId);
      const input = document.getElementById(`player-display-name-${playerId}`);
      if (!player || !input) return;
      const nextName = String(input.value || '').trim().slice(0, 32);
      if (!nextName) {
        Hexcore2.eventStore.append('保存选手名称失败', '选手名称不能为空', 'warn');
        Hexcore2.ui.render();
        return;
      }
      const duplicated = Hexcore2.state.players.some(item =>
        item.id !== player.id && String(item.name || '').toLowerCase() === nextName.toLowerCase()
      );
      if (duplicated) {
        Hexcore2.eventStore.append('保存选手名称失败', `选手名称「${nextName}」已存在`, 'warn');
        Hexcore2.ui.render();
        return;
      }

      snapshot(`保存选手名称前：${player.name}`);
      const oldName = player.name;
      player.name = nextName;
      Hexcore2.state.captains.forEach(captain => {
        if (captain.playerId === player.id) {
          captain.name = captain.name === `${oldName}队` || captain.name === oldName ? `${nextName}队` : captain.name;
        }
      });
      Hexcore2.state.ui.editingNamePlayerId = '';
      if (Hexcore2.normalizeState) Hexcore2.normalizeState(Hexcore2.state);
      Hexcore2.eventStore.append('选手库', `${oldName} 更名为 ${player.name}`, 'success');
      renderAndPersist();
    },

    cancelPlayerGameIdEdit() {
      Hexcore2.state.ui.editingGameIdPlayerId = '';
      Hexcore2.ui.render();
    },

    savePlayerGameId(playerId) {
      const player = Hexcore2.state.players.find(item => item.id === playerId);
      const input = document.getElementById(`player-game-id-${playerId}`);
      if (!player || !input) return;
      const nextGameId = String(input.value || '').trim().slice(0, 40);
      if (!nextGameId) {
        Hexcore2.eventStore.append('保存游戏ID失败', '游戏ID不能为空', 'warn');
        Hexcore2.ui.render();
        return;
      }
      const duplicated = Hexcore2.state.players.some(item =>
        item.id !== player.id && String(item.gameId || '').toLowerCase() === nextGameId.toLowerCase()
      );
      if (duplicated) {
        Hexcore2.eventStore.append('保存游戏ID失败', `游戏ID「${nextGameId}」已存在`, 'warn');
        Hexcore2.ui.render();
        return;
      }

      snapshot(`保存游戏ID前：${player.name}`);
      player.gameId = nextGameId;
      Hexcore2.state.captains.forEach(captain => {
        if (captain.playerId === player.id) {
          captain.playerGameId = nextGameId;
        }
      });
      Hexcore2.state.ui.editingGameIdPlayerId = '';
      if (Hexcore2.normalizeState) Hexcore2.normalizeState(Hexcore2.state);
      Hexcore2.eventStore.append('选手库', `${player.name} 游戏ID更新为 ${player.gameId}`, 'success');
      renderAndPersist();
    },

    togglePlayerDisabled(playerId) {
      if (rejectGoldLockedMutation('选手状态失败')) return;
      const player = Hexcore2.state.players.find(item => item.id === playerId);
      if (!player) return;
      if (player.status === 'captain') {
        Hexcore2.eventStore.append('选手状态失败', '队长专属选手不能禁用', 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (player.status === 'drafted') {
        Hexcore2.eventStore.append('选手状态失败', '已入队选手不能直接禁用，请先从队伍移回可选池', 'warn');
        Hexcore2.ui.render();
        return;
      }

      snapshot(`切换选手状态前：${player.name}`);
      player.status = player.status === 'disabled' ? 'available' : 'disabled';
      Hexcore2.eventStore.append('选手库', `${player.name} 已${player.status === 'disabled' ? '禁用' : '恢复可选'}`, player.status === 'disabled' ? 'warn' : 'success');
      renderAndPersist();
    },

    deletePlayer(playerId) {
      if (rejectGoldLockedMutation('删除选手失败')) return;
      const player = Hexcore2.state.players.find(item => item.id === playerId);
      if (!player) return;
      const confirmed = typeof confirm === 'function'
        ? confirm(`确认删除选手 ${player.name}？若已入队，会同时从队伍中移除。`)
        : true;
      if (!confirmed) return;

      snapshot(`删除选手前：${player.name}`);
      Hexcore2.state.captains.forEach(captain => {
        captain.team = captain.team.filter(id => id !== playerId);
      });
      Hexcore2.state.players = Hexcore2.state.players.filter(item => item.id !== playerId);
      if (Hexcore2.state.draft.currentDraw) {
        Hexcore2.state.draft.currentDraw.cards = Hexcore2.state.draft.currentDraw.cards.filter(card => card.playerId !== playerId);
      }
      Hexcore2.state.draft.runtimeEffects = Hexcore2.state.draft.runtimeEffects.filter(effect =>
        effect.playerId !== playerId && effect.firstPlayerId !== playerId && effect.secondPlayerId !== playerId
      );
      if (Hexcore2.normalizeState) Hexcore2.normalizeState(Hexcore2.state);
      Hexcore2.eventStore.append('选手库', `删除选手 ${player.name}`, 'warn');
      renderAndPersist();
    },

    generateTournamentSchedule() {
      const orderedEntrants = Hexcore2.state.draft.baseOrder
        .filter(id => Hexcore2.state.captains.some(captain => captain.id === id));
      if (orderedEntrants.length < 2) {
        Hexcore2.eventStore.append('生成赛程失败', '至少需要 2 支队伍才能生成赛程', 'warn');
        Hexcore2.ui.render();
        return;
      }
      const optionInput = document.getElementById('tournament-camp-versus-toggle');
      const useCampVersus = optionInput && typeof optionInput.checked === 'boolean'
        ? Boolean(optionInput.checked)
        : !(Hexcore2.state.ui && Hexcore2.state.ui.tournamentCampVersus === false);
      Hexcore2.state.ui = Hexcore2.state.ui || {};
      Hexcore2.state.ui.tournamentCampVersus = useCampVersus;
      const campAEntrants = orderedEntrants.filter(id => Hexcore2.selectors.captainCamp(id) === 'local');
      const campBEntrants = orderedEntrants.filter(id => Hexcore2.selectors.captainCamp(id) === 'outsider');
      const assignedCaptainCount = orderedEntrants.filter(id => Boolean(Hexcore2.selectors.captainPlayer(id))).length;
      if (assignedCaptainCount < orderedEntrants.length) {
        Hexcore2.eventStore.append(
          '生成赛程失败',
          `当前已有 ${orderedEntrants.length} 支队伍，但只有 ${assignedCaptainCount} 支队伍已指定队长选手。请先补齐队伍人员并设置队长，再生成赛程。`,
          'warn'
        );
        Hexcore2.ui.render();
        return;
      }
      if (useCampVersus && (!campAEntrants.length || !campBEntrants.length || campAEntrants.length !== campBEntrants.length)) {
        Hexcore2.eventStore.append('生成赛程失败', `阵营对抗需要本地队伍和外地队伍数量一致，当前本地 ${campAEntrants.length} 队、外地 ${campBEntrants.length} 队。`, 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (Hexcore2.state.tournament && Hexcore2.state.tournament.rounds && Hexcore2.state.tournament.rounds.length) {
        const confirmed = typeof confirm === 'function'
          ? confirm('当前已有赛程，重新生成会清空现有比分和晋级结果。确认继续？')
          : true;
        if (!confirmed) return;
      }

      snapshot('生成赛程前');
      const entrants = shuffledEntrants(orderedEntrants);
      const rounds = useCampVersus
        ? [buildCampVersusTournamentRound(1, shuffledEntrants(campAEntrants), shuffledEntrants(campBEntrants), null)]
        : [buildTournamentRound(1, entrants, null)];
      Hexcore2.state.tournament = {
        status: 'running',
        championId: '',
        rounds,
        pairingMode: useCampVersus ? 'camp_versus' : 'random',
      };
      recomputeTournamentAdvancement();
      Hexcore2.eventStore.append(
        '赛程生成',
        useCampVersus
          ? `已一键生成阵营对抗赛程：本地队伍在左侧，外地队伍在右侧，共 ${orderedEntrants.length} 支队伍。`
          : `已一键生成全随机赛程，共 ${orderedEntrants.length} 支队伍。`,
        'success'
      );
      renderAndPersist();
    },

    generateBandleDefenseSchedule() {
      const orderedEntrants = Hexcore2.state.draft.baseOrder
        .filter(id => Hexcore2.state.captains.some(captain => captain.id === id));
      const assignedCaptainCount = orderedEntrants.filter(id => Boolean(Hexcore2.selectors.captainPlayer(id))).length;
      const localIds = orderedEntrants.filter(id => Hexcore2.selectors.captainCamp(id) === 'local');
      const outsiderIds = orderedEntrants.filter(id => Hexcore2.selectors.captainCamp(id) === 'outsider');
      if (assignedCaptainCount < orderedEntrants.length) {
        Hexcore2.eventStore.append(
          '生成班德尔赛程失败',
          `当前已有 ${orderedEntrants.length} 支队伍，但只有 ${assignedCaptainCount} 支队伍已指定队长选手。请先补齐队伍人员并设置队长。`,
          'warn'
        );
        Hexcore2.ui.render();
        return;
      }
      if (localIds.length !== 5 || outsiderIds.length !== 5) {
        Hexcore2.eventStore.append('生成班德尔赛程失败', `班德尔保卫战需要本地 5 队、外地 5 队，当前本地 ${localIds.length} 队、外地 ${outsiderIds.length} 队。`, 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (Hexcore2.state.tournament && Hexcore2.state.tournament.rounds && Hexcore2.state.tournament.rounds.length) {
        const confirmed = typeof confirm === 'function'
          ? confirm('当前已有赛程，生成班德尔保卫战会清空现有比分和晋级结果。确认继续？')
          : true;
        if (!confirmed) return;
      }

      snapshot('生成班德尔保卫战赛程前');
      Hexcore2.state.tournament = {
        status: 'running',
        type: 'bandle_defense',
        championId: '',
        winnerCamp: '',
        winnerReason: '',
        finalBandlePoints: 0,
        finalInvaderPoints: 0,
        pairingMode: 'camp_versus',
        rounds: buildBandleDefenseRounds(localIds, outsiderIds),
        finalBattle: {
          enabled: false,
          bandleTeamId: '',
          invaderTeamId: '',
          winnerCamp: '',
          bonusPoints: 10,
          games: Array.from({ length: 5 }, (_, index) => ({
            id: `bo5g${index + 1}`,
            bandleScore: '',
            invaderScore: '',
            winnerCamp: '',
            status: 'pending',
          })),
        },
      };
      recomputeBandleDefenseTournament(Hexcore2.state.tournament);
      Hexcore2.eventStore.append('班德尔保卫战赛程', '已生成两日 5x5 全交叉阵营积分赛，共 50 场。', 'success');
      renderAndPersist();
    },

    setTournamentCampVersus(enabled) {
      Hexcore2.state.ui = Hexcore2.state.ui || {};
      Hexcore2.state.ui.tournamentCampVersus = Boolean(enabled);
      Hexcore2.ui.render();
    },

    saveTournamentScore(roundId, matchId) {
      const tournament = Hexcore2.state.tournament || {};
      if (tournament.type === 'bandle_defense') {
        this.saveBandleDefenseScore(roundId, matchId);
        return;
      }
      const round = (tournament.rounds || []).find(item => item.id === roundId);
      const match = round && round.matches.find(item => item.id === matchId);
      if (!round || !match || !match.teamAId || !match.teamBId) {
        Hexcore2.eventStore.append('保存比分失败', '目标场次无效或为轮空场次', 'warn');
        Hexcore2.ui.render();
        return;
      }

      const inputA = document.getElementById(`tournament-score-${roundId}-${matchId}-a`);
      const inputB = document.getElementById(`tournament-score-${roundId}-${matchId}-b`);
      const scoreA = Number(inputA && inputA.value);
      const scoreB = Number(inputB && inputB.value);
      if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0) {
        Hexcore2.eventStore.append('保存比分失败', '比分必须是非负整数', 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (scoreA === scoreB) {
        Hexcore2.eventStore.append('保存比分失败', '淘汰赛比分不能相同，请录入胜负结果', 'warn');
        Hexcore2.ui.render();
        return;
      }

      snapshot(`保存赛程比分前：${match.id}`);
      match.scoreA = scoreA;
      match.scoreB = scoreB;
      match.winnerId = scoreA > scoreB ? match.teamAId : match.teamBId;
      match.status = 'completed';
      recomputeTournamentAdvancement();
      Hexcore2.eventStore.append(
        '赛程比分',
        `${captainName(match.teamAId)} ${scoreA}:${scoreB} ${captainName(match.teamBId)}，${captainName(match.winnerId)} 自动晋级`,
        Hexcore2.state.tournament.status === 'completed' ? 'success' : 'info'
      );
      renderAndPersist();
    },

    saveBandleDefenseScore(roundId, matchId) {
      const tournament = Hexcore2.state.tournament || {};
      const round = (tournament.rounds || []).find(item => item.id === roundId);
      const match = round && round.matches.find(item => item.id === matchId);
      if (!round || !match || tournament.type !== 'bandle_defense' || !match.teamAId || !match.teamBId) {
        Hexcore2.eventStore.append('保存班德尔比分失败', '目标场次无效', 'warn');
        Hexcore2.ui.render();
        return;
      }
      const inputA = document.getElementById(`bandle-score-${roundId}-${matchId}-a`);
      const inputB = document.getElementById(`bandle-score-${roundId}-${matchId}-b`);
      const yordleInput = document.getElementById(`bandle-yordle-${roundId}-${matchId}`);
      const scoreA = Number(inputA && inputA.value);
      const scoreB = Number(inputB && inputB.value);
      const yordleCount = Number(yordleInput && yordleInput.value);
      if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0) {
        Hexcore2.eventStore.append('保存班德尔比分失败', '比分必须是非负整数', 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (scoreA === scoreB) {
        Hexcore2.eventStore.append('保存班德尔比分失败', '阵营积分赛仍需分出胜负，请录入胜负结果', 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (!Number.isInteger(yordleCount) || yordleCount < 0 || yordleCount > 5) {
        Hexcore2.eventStore.append('保存班德尔比分失败', '约德尔登场人数必须是 0-5 的整数', 'warn');
        Hexcore2.ui.render();
        return;
      }

      snapshot(`保存班德尔保卫战比分前：${match.id}`);
      match.scoreA = scoreA;
      match.scoreB = scoreB;
      match.yordleCount = yordleCount;
      match.winnerId = scoreA > scoreB ? match.teamAId : match.teamBId;
      match.bandlePoints = (scoreA > scoreB ? 1 : 0) + yordleCount * 0.5;
      match.invaderPoints = scoreB > scoreA ? 1 : 0;
      match.status = 'completed';
      recomputeBandleDefenseTournament(tournament);
      Hexcore2.eventStore.append(
        '班德尔保卫战比分',
        `${captainName(match.teamAId)} ${scoreA}:${scoreB} ${captainName(match.teamBId)}，班德尔 +${match.bandlePoints}，入侵者 +${match.invaderPoints}`,
        tournament.status === 'completed' ? 'success' : 'info'
      );
      renderAndPersist();
    },

    saveBandleFinalBattleGame(gameIndex) {
      const tournament = Hexcore2.state.tournament || {};
      const finalBattle = tournament.finalBattle || {};
      const index = Number(gameIndex);
      const game = Array.isArray(finalBattle.games) ? finalBattle.games[index] : null;
      if (tournament.type !== 'bandle_defense' || !finalBattle.enabled || !game) {
        Hexcore2.eventStore.append('保存隐藏决战失败', '隐藏大决战尚未开启', 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (finalBattle.winnerCamp) {
        Hexcore2.eventStore.append('保存隐藏决战失败', '隐藏大决战已分出胜负', 'warn');
        Hexcore2.ui.render();
        return;
      }
      const inputA = document.getElementById(`bandle-final-${index}-a`);
      const inputB = document.getElementById(`bandle-final-${index}-b`);
      const bandleScore = Number(inputA && inputA.value);
      const invaderScore = Number(inputB && inputB.value);
      if (!Number.isInteger(bandleScore) || !Number.isInteger(invaderScore) || bandleScore < 0 || invaderScore < 0 || bandleScore === invaderScore) {
        Hexcore2.eventStore.append('保存隐藏决战失败', 'BO5 单局比分必须是非负整数且不能相同', 'warn');
        Hexcore2.ui.render();
        return;
      }

      snapshot(`保存隐藏大决战第${index + 1}局前`);
      game.bandleScore = bandleScore;
      game.invaderScore = invaderScore;
      game.winnerCamp = bandleScore > invaderScore ? 'bandle' : 'invader';
      game.status = 'completed';
      recomputeBandleDefenseTournament(tournament);
      Hexcore2.eventStore.append('隐藏大决战', `第 ${index + 1} 局已保存，${game.winnerCamp === 'bandle' ? '最强约德尔人' : '最强侵略者'} 拿下一局`, 'warn');
      renderAndPersist();
    },

    setTournamentDragCaptain(captainId) {
      const captain = Hexcore2.state.captains.find(item => item.id === captainId);
      if (!captain) return;
      Hexcore2.state.ui = Hexcore2.state.ui || {};
      Hexcore2.state.ui.tournamentDragCaptainId = captain.id;
    },

    openTournamentSlotPicker(roundId, matchId, side) {
      const tournament = Hexcore2.state.tournament || {};
      const roundIndex = (tournament.rounds || []).findIndex(item => item.id === roundId);
      const round = roundIndex >= 0 ? tournament.rounds[roundIndex] : null;
      const match = round && round.matches.find(item => item.id === matchId);
      if (!round || !match || (side !== 'A' && side !== 'B')) {
        Hexcore2.eventStore.append('打开队伍选择失败', '目标赛程槽无效', 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (roundIndex !== 0 || match.status === 'bye') {
        Hexcore2.eventStore.append('打开队伍选择失败', '只能调整首轮未轮空的队伍槽位', 'warn');
        Hexcore2.ui.render();
        return;
      }
      Hexcore2.state.ui = Hexcore2.state.ui || {};
      Hexcore2.state.ui.tournamentSlotPicker = { roundId, matchId, side };
      Hexcore2.ui.render();
    },

    closeTournamentSlotPicker() {
      if (Hexcore2.state.ui) delete Hexcore2.state.ui.tournamentSlotPicker;
      Hexcore2.ui.render();
    },

    selectTournamentSlotCaptain(roundId, matchId, side, captainId) {
      if (Hexcore2.state.ui) delete Hexcore2.state.ui.tournamentSlotPicker;
      this.assignTournamentSlot(roundId, matchId, side, captainId);
    },

    assignTournamentSlot(roundId, matchId, side, captainId) {
      const tournament = Hexcore2.state.tournament || {};
      const roundIndex = (tournament.rounds || []).findIndex(item => item.id === roundId);
      const round = roundIndex >= 0 ? tournament.rounds[roundIndex] : null;
      const match = round && round.matches.find(item => item.id === matchId);
      const targetCaptainId = captainId || (Hexcore2.state.ui && Hexcore2.state.ui.tournamentDragCaptainId);
      const captain = Hexcore2.state.captains.find(item => item.id === targetCaptainId);
      if (!round || !match || !captain || (side !== 'A' && side !== 'B')) {
        Hexcore2.eventStore.append('赛程拖拽失败', '目标队伍或赛程框无效', 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (roundIndex !== 0) {
        Hexcore2.eventStore.append('赛程拖拽失败', '当前仅支持调整首轮队伍位置，后续轮次由比分自动晋级生成', 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (isCampVersusTournamentContext(tournament, round, match)) {
        tournament.pairingMode = 'camp_versus';
        round.pairingMode = 'camp_versus';
        match.pairingMode = 'camp_versus';
        match.expectedCampA = 'local';
        match.expectedCampB = 'outsider';
        const expectedCamp = side === 'A' ? 'local' : 'outsider';
        if (Hexcore2.selectors.captainCamp(captain.id) !== expectedCamp) {
          Hexcore2.eventStore.append(
            '赛程拖拽失败',
            `${captain.name} 属于${Hexcore2.selectors.campLabel(Hexcore2.selectors.captainCamp(captain.id))}，只能放入${side === 'A' ? '阵营A' : '阵营B'}对应槽位`,
            'warn'
          );
          Hexcore2.ui.render();
          return;
        }
      }
      const affectedMatches = round.matches.filter(item =>
        item === match || item.teamAId === captain.id || item.teamBId === captain.id
      );
      if (affectedMatches.some(item => tournamentChangeNeedsConfirm(roundIndex, item))) {
        const confirmed = typeof confirm === 'function'
          ? confirm('调整队伍槽位会清空相关场次比分、轮空确认和后续晋级结果。确认继续？')
          : true;
        if (!confirmed) {
          Hexcore2.ui.render();
          return;
        }
      }

      snapshot(`调整赛程槽位前：${captain.name}`);
      round.matches.forEach(item => {
        if (item.teamAId === captain.id) {
          item.teamAId = '';
          clearTournamentMatchResult(item);
        }
        if (item.teamBId === captain.id) {
          item.teamBId = '';
          clearTournamentMatchResult(item);
        }
      });
      if (side === 'A') {
        match.teamAId = captain.id;
      } else {
        match.teamBId = captain.id;
      }
      clearTournamentMatchResult(match);
      tournament.rounds = tournament.rounds.slice(0, 1);
      tournament.status = 'running';
      tournament.championId = '';
      Hexcore2.state.ui.tournamentDragCaptainId = '';
      delete Hexcore2.state.ui.tournamentSlotPicker;
      recomputeTournamentAdvancement();
      Hexcore2.eventStore.append('赛程调整', `${captain.name} 已放入 ${match.id.toUpperCase()} 的 ${side} 槽位，比分和后续晋级已重算`, 'warn');
      renderAndPersist();
    },

    removeTournamentSlot(roundId, matchId, side) {
      const tournament = Hexcore2.state.tournament || {};
      const roundIndex = (tournament.rounds || []).findIndex(item => item.id === roundId);
      const round = roundIndex >= 0 ? tournament.rounds[roundIndex] : null;
      const match = round && round.matches.find(item => item.id === matchId);
      if (!round || !match || (side !== 'A' && side !== 'B')) {
        Hexcore2.eventStore.append('赛程移出失败', '目标赛程槽无效', 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (roundIndex !== 0) {
        Hexcore2.eventStore.append('赛程移出失败', '后续轮次由晋级自动生成，请调整首轮或上游比分', 'warn');
        Hexcore2.ui.render();
        return;
      }
      const removedId = side === 'A' ? match.teamAId : match.teamBId;
      if (!removedId) {
        Hexcore2.eventStore.append('赛程移出失败', '该槽位当前没有队伍', 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (tournamentChangeNeedsConfirm(roundIndex, match)) {
        const confirmed = typeof confirm === 'function'
          ? confirm('移出队伍会清空本场比分、轮空确认和后续晋级结果。确认继续？')
          : true;
        if (!confirmed) return;
      }

      snapshot(`移出赛程队伍前：${captainName(removedId)}`);
      if (side === 'A') {
        match.teamAId = '';
      } else {
        match.teamBId = '';
      }
      clearTournamentMatchResult(match);
      tournament.rounds = tournament.rounds.slice(0, 1);
      tournament.status = 'running';
      tournament.championId = '';
      if (Hexcore2.state.ui) delete Hexcore2.state.ui.tournamentSlotPicker;
      recomputeTournamentAdvancement();
      Hexcore2.eventStore.append('赛程移出', `${captainName(removedId)} 已从 ${match.id.toUpperCase()} 的 ${side} 槽位移出，可重新排位`, 'warn');
      renderAndPersist();
    },

    clearTournamentMatch(roundId, matchId) {
      const tournament = Hexcore2.state.tournament || {};
      const roundIndex = (tournament.rounds || []).findIndex(item => item.id === roundId);
      const round = roundIndex >= 0 ? tournament.rounds[roundIndex] : null;
      const match = round && round.matches.find(item => item.id === matchId);
      if (!round || !match) {
        Hexcore2.eventStore.append('清空场次失败', '目标场次无效', 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (roundIndex !== 0) {
        Hexcore2.eventStore.append('清空场次失败', '后续轮次由晋级自动生成，请调整首轮或上游比分', 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (!match.teamAId && !match.teamBId && !match.winnerId) {
        Hexcore2.eventStore.append('清空场次', '该场次已经为空', 'info');
        Hexcore2.ui.render();
        return;
      }
      if (tournamentChangeNeedsConfirm(roundIndex, match)) {
        const confirmed = typeof confirm === 'function'
          ? confirm('清空本场会移出两侧队伍，并清空本场比分、轮空确认和后续晋级结果。确认继续？')
          : true;
        if (!confirmed) return;
      }

      snapshot(`清空赛程场次前：${match.id}`);
      clearTournamentMatchResult(match, { clearTeams: true });
      tournament.rounds = tournament.rounds.slice(0, 1);
      tournament.status = 'running';
      tournament.championId = '';
      if (Hexcore2.state.ui) delete Hexcore2.state.ui.tournamentSlotPicker;
      recomputeTournamentAdvancement();
      Hexcore2.eventStore.append('赛程清空场次', `${match.id.toUpperCase()} 已清空，可重新拖入队伍`, 'warn');
      renderAndPersist();
    },

    confirmTournamentBye(roundId, matchId) {
      const tournament = Hexcore2.state.tournament || {};
      const roundIndex = (tournament.rounds || []).findIndex(item => item.id === roundId);
      const round = roundIndex >= 0 ? tournament.rounds[roundIndex] : null;
      const match = round && round.matches.find(item => item.id === matchId);
      if (!round || !match) {
        Hexcore2.eventStore.append('确认轮空失败', '目标场次无效', 'warn');
        Hexcore2.ui.render();
        return;
      }
      const hasA = Boolean(match.teamAId);
      const hasB = Boolean(match.teamBId);
      if ((hasA && hasB) || (!hasA && !hasB)) {
        Hexcore2.eventStore.append('确认轮空失败', '只有单边有队伍的场次才能确认轮空', 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (roundIndex !== 0 && match.pairingMode === 'camp_versus') {
        Hexcore2.eventStore.append('确认轮空失败', '该场次不支持手动轮空', 'warn');
        Hexcore2.ui.render();
        return;
      }

      snapshot(`确认轮空前：${match.id}`);
      match.byeConfirmed = true;
      match.scoreA = '';
      match.scoreB = '';
      match.winnerId = match.teamAId || match.teamBId;
      match.status = 'bye';
      recomputeTournamentAdvancement();
      Hexcore2.eventStore.append('赛程轮空', `${captainName(match.winnerId)} 在 ${match.id.toUpperCase()} 确认轮空晋级`, 'warn');
      renderAndPersist();
    },

    resetTournamentSchedule() {
      if (!Hexcore2.state.tournament || !Hexcore2.state.tournament.rounds.length) {
        Hexcore2.eventStore.append('赛程清空', '当前没有可清空的赛程', 'info');
        Hexcore2.ui.render();
        return;
      }
      const confirmed = typeof confirm === 'function'
        ? confirm('确认清空当前赛程、比分和晋级结果？')
        : true;
      if (!confirmed) return;

      snapshot('清空赛程前');
      Hexcore2.state.tournament = { status: 'empty', championId: '', rounds: [] };
      if (Hexcore2.state.ui) delete Hexcore2.state.ui.tournamentSlotPicker;
      Hexcore2.eventStore.append('赛程清空', '裁判清空了当前赛程', 'warn');
      renderAndPersist();
    },

    runSystemCheck() {
      const result = Hexcore2.integrityService.checkState();
      Hexcore2.state.ui = Hexcore2.state.ui || {};
      Hexcore2.state.ui.systemCheckResult = result;

      Hexcore2.eventStore.append(
        result.totalIssues ? '系统检查发现问题' : '系统检查通过',
        result.totalIssues ? result.issues.slice(0, 5).map(issue => issue.message).join('；') : '队伍、选手归属、顺位和卡池数据当前一致',
        result.totalIssues ? 'warn' : 'success'
      );
      Hexcore2.ui.render();
    },

    restoreLatestSnapshot() {
      this.undo();
    },

    clearBrowserData() {
      const confirmed = typeof confirm === 'function'
        ? confirm('确认清理浏览器本地保存数据？当前页面会立即恢复默认空状态。')
        : true;
      if (!confirmed) return;
      const ok = Hexcore2.storageService ? Hexcore2.storageService.clear() : false;
      if (ok) {
        Hexcore2.state = Hexcore2.createDefaultState
          ? Hexcore2.createDefaultState()
          : Hexcore2.normalizeState({});
        if (Hexcore2.economyEngine) {
          Hexcore2.economyEngine.ensureAll();
          Hexcore2.economyEngine.applyRoundIncome(Hexcore2.state.draft.round);
        }
        Hexcore2.turnOrderEngine.recompute();
      }
      Hexcore2.state.ui = Hexcore2.state.ui || {};
      Hexcore2.state.ui.feedback = {
        title: ok ? '本地数据已清理' : '本地数据清理失败',
        body: ok ? '页面已恢复默认空状态，请重新导入或添加选手' : '当前环境不支持 localStorage 或清理失败',
        level: ok ? 'success' : 'warn',
        time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        createdAt: Date.now(),
      };
      Hexcore2.ui.render();
    },
  };

  global.hexcoreUI = Hexcore2.actions;
  if (!Hexcore2.hexDetailEscHandler && global.document && typeof global.document.addEventListener === 'function') {
    Hexcore2.hexDetailEscHandler = event => {
      if (event && event.key === 'Escape' && Hexcore2.state.ui && Hexcore2.state.ui.tournamentSlotPicker) {
        Hexcore2.actions.closeTournamentSlotPicker();
      } else if (event && event.key === 'Escape' && Hexcore2.state.ui && Hexcore2.state.ui.hexDetailModal) {
        Hexcore2.actions.closeHexDetail();
      } else if (event && event.key === 'Escape' && Hexcore2.state.ui && Hexcore2.state.ui.lastStandConfirm) {
        Hexcore2.actions.cancelLastStand();
      }
    };
    global.document.addEventListener('keydown', Hexcore2.hexDetailEscHandler);
  }
  Hexcore2.ui.render();
  connectRoomEventStream();
  scheduleHeavenlyWindowTick();
})(window);
