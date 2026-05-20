(function bootstrap(global) {
  const Hexcore2 = global.Hexcore2;

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

  Hexcore2.turnOrderEngine.recompute();

  function persist() {
    if (Hexcore2.storageService) Hexcore2.storageService.save(Hexcore2.state);
  }

  function renderAndPersist() {
    persist();
    Hexcore2.ui.render();
  }

  function playersDraftReady() {
    const workflow = Hexcore2.selectors.workflowStatus();
    return workflow.playersDraftReady;
  }

  function snapshot(label) {
    if (Hexcore2.historyService) Hexcore2.historyService.push(label);
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
    return new Set((Hexcore2.state.hexcoreAssignments[captainId] || []).map(hex => hex.id));
  }

  function drawHexcoreSlots(captainId, count, extraExcludes = []) {
    const excluded = new Set([...ownedHexIds(captainId), ...extraExcludes]);
    const candidates = Hexcore2.sampleData.hexcores
      .filter(hex => !excluded.has(hex.id))
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

  function browserTimerAvailable() {
    return typeof global.setTimeout === 'function'
      && typeof global.clearTimeout === 'function'
      && global.document
      && typeof global.document.querySelector === 'function';
  }

  function clearPickTimeout(clearDrawMeta = false) {
    if (Hexcore2.pickTimeoutTimer && typeof global.clearTimeout === 'function') {
      global.clearTimeout(Hexcore2.pickTimeoutTimer);
    }
    Hexcore2.pickTimeoutTimer = null;
    const draw = Hexcore2.state.draft && Hexcore2.state.draft.currentDraw;
    if (clearDrawMeta && draw) {
      delete draw.timeoutStartedAt;
      delete draw.timeoutEndsAt;
      delete draw.timeoutSeconds;
    }
  }

  function drawTimeoutSeconds(draw) {
    const configured = Number(Hexcore2.state.settings.pickTimeoutSeconds);
    const seconds = Number(draw && draw.timeLimitSeconds) || configured || 30;
    return Math.max(1, Math.round(seconds));
  }

  function schedulePickTimeoutTick() {
    if (!browserTimerAvailable()) return;
    clearPickTimeout(false);
    Hexcore2.pickTimeoutTimer = global.setTimeout(() => {
      const draw = Hexcore2.state.draft.currentDraw;
      if (!draw || Hexcore2.state.draft.pickedThisTurn || !draw.timeoutEndsAt) {
        clearPickTimeout(false);
        return;
      }
      if (Date.now() >= draw.timeoutEndsAt) {
        Hexcore2.actions.timeoutRandomPick(true);
        return;
      }
      Hexcore2.ui.render();
      schedulePickTimeoutTick();
    }, 1000);
    if (Hexcore2.pickTimeoutTimer && typeof Hexcore2.pickTimeoutTimer.unref === 'function') {
      Hexcore2.pickTimeoutTimer.unref();
    }
  }

  function armPickTimeout(draw) {
    if (!draw || !draw.cards || !draw.cards.length) {
      clearPickTimeout(true);
      return;
    }
    clearPickTimeout(false);
    const seconds = drawTimeoutSeconds(draw);
    draw.timeoutSeconds = seconds;
    draw.timeoutStartedAt = Date.now();
    draw.timeoutEndsAt = draw.timeoutStartedAt + seconds * 1000;
    schedulePickTimeoutTick();
  }

  function captainName(captainId) {
    const captain = Hexcore2.state.captains.find(item => item.id === captainId);
    return captain ? captain.name : '待定';
  }

  function buildTournamentRound(roundNumber, entrants, oldRound) {
    const matches = [];
    const half = Math.ceil(entrants.length / 2);
    for (let index = 0; index < half; index += 1) {
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
    return {
      id: `r${roundNumber}`,
      name: entrants.length <= 2 ? '决赛' : `第 ${roundNumber} 轮`,
      matches,
    };
  }

  function recomputeTournamentAdvancement() {
    const tournament = Hexcore2.state.tournament || { status: 'empty', championId: '', rounds: [] };
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
      round.matches.forEach(match => {
        if (match.teamAId && !match.teamBId) {
          match.status = 'bye';
          match.winnerId = match.teamAId;
        }
      });

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

  function findNextHexcoreCaptain(currentCaptainId) {
    const order = (Hexcore2.state.hexcoreDraft && Hexcore2.state.hexcoreDraft.drawOrder && Hexcore2.state.hexcoreDraft.drawOrder.length)
      ? Hexcore2.state.hexcoreDraft.drawOrder
      : Hexcore2.state.captains.map(captain => captain.id);
    const currentIndex = Math.max(0, order.indexOf(currentCaptainId));
    for (let offset = 1; offset <= order.length; offset += 1) {
      const captainId = order[(currentIndex + offset) % order.length];
      const captain = Hexcore2.state.captains.find(item => item.id === captainId);
      if (captain && (Hexcore2.state.hexcoreAssignments[captain.id] || []).length < 3) return captain;
    }
    return null;
  }

  Hexcore2.actions = {
    selectCard(index) {
      Hexcore2.state.draft.selectedSlot = index;
      Hexcore2.state.draft.pickedThisTurn = false;
      renderAndPersist();
    },

    drawCards() {
      const captain = Hexcore2.selectors.currentCaptain();
      if (!playersDraftReady()) {
        Hexcore2.eventStore.append('流程未就绪', '请先完成全部队伍配置，并让所有队伍抽满 3 个海克斯，再开始实时抽选队员', 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (Hexcore2.state.draft.phase === 'completed') {
        Hexcore2.eventStore.append('裁判操作', '选人流程已完成，无法继续抽卡', 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (!captain) {
        Hexcore2.eventStore.append('裁判操作', '当前没有可操作队长，无法抽卡', 'warn');
        Hexcore2.ui.render();
        return;
      }

      const teamSize = Hexcore2.selectors.teamSize(captain.id);
      if (teamSize >= Hexcore2.state.settings.playersPerTeam) {
        Hexcore2.eventStore.append('裁判操作', `${captain.name} 队伍已满，自动跳过抽卡`, 'warn');
        this.nextCaptain();
        return;
      }

      snapshot(`抽卡前：${captain.name}`);
      const autoAssign = Hexcore2.hexcoreEngine.autoAssignBeforeDraw(captain.id);
      if (autoAssign.handled) {
        this.nextCaptain();
        return;
      }

      const drawOverride = Hexcore2.hexcoreEngine.drawOverrideBeforeDraw(captain.id);
      if (drawOverride.handled) {
        armPickTimeout(Hexcore2.state.draft.currentDraw);
        Hexcore2.ui.render();
        return;
      }

      const tier = Hexcore2.poolEngine.effectiveTier(captain.id);
      const drawReasons = Hexcore2.hexcoreEngine.drawReasons(captain.id);
      const drawCount = Hexcore2.state.settings.drawCount + Hexcore2.hexcoreEngine.extraDrawCount(captain.id);
      Hexcore2.state.draft.currentDraw = Hexcore2.probabilityEngine.draw(captain.id, tier, drawCount);
      Hexcore2.state.draft.currentDraw.reason = drawReasons.join('；');
      Hexcore2.state.draft.selectedSlot = 0;
      Hexcore2.state.draft.pickedThisTurn = false;
      armPickTimeout(Hexcore2.state.draft.currentDraw);

      const tierName = Hexcore2.state.settings.tierNames[tier];
      const drawn = Hexcore2.state.draft.currentDraw.cards.length;
      Hexcore2.eventStore.append(
        drawn > 0 ? '抽卡完成' : '卡池不足',
        drawn > 0 ? `${captain.name} 从${tierName}抽取 ${drawn} 张选手卡${drawReasons.length ? `（${drawReasons.join('；')}）` : ''}` : `${tierName}暂无可用选手，裁判需要跳过或手动处理`,
        drawn > 0 ? 'draw' : 'warn'
      );
      Hexcore2.ui.render();
    },

    pickCard() {
      if (!playersDraftReady()) {
        Hexcore2.eventStore.append('流程未就绪', '海克斯抽取未完成，暂不能选择队员', 'warn');
        Hexcore2.ui.render();
        return;
      }
      const draw = Hexcore2.state.draft.currentDraw;
      const captain = Hexcore2.selectors.currentCaptain();
      if (Hexcore2.state.draft.pickedThisTurn) return;
      if (!draw || !captain) {
        Hexcore2.eventStore.append('选卡失败', '当前没有可选择的抽卡结果', 'warn');
        Hexcore2.ui.render();
        return;
      }

      const slot = draw.cards[Hexcore2.state.draft.selectedSlot];
      if (!slot) {
        Hexcore2.eventStore.append('选卡失败', '当前卡槽为空，无法加入队伍', 'warn');
        Hexcore2.ui.render();
        return;
      }

      snapshot(`选卡前：${captain.name}`);
      clearPickTimeout(true);
      const selectedPlayer = Hexcore2.state.players.find(player => player.id === slot.playerId);
      if (draw.pickMode === 'blind_box' && selectedPlayer && selectedPlayer.status === 'drafted' && selectedPlayer.teamId !== captain.id) {
        const transfer = Hexcore2.assignmentEngine.transferDraftedPlayer(captain.id, slot.playerId, 'mystery_box_transfer');
        if (transfer) {
          Hexcore2.hexcoreEngine.grantCompensationTurn(
            transfer.sourceCaptain.id,
            `神秘贤者·盲盒：${transfer.player.name} 被 ${captain.name} 选中并转队`
          );
        }
      } else {
        Hexcore2.assignmentEngine.assign(captain.id, slot.playerId, draw.pickMode === 'blind_box' ? 'mystery_box_pick' : 'normal_pick');
      }
      if (draw.pickMode === 'mystery_swap') {
        const shown = Hexcore2.state.players.find(player => player.id === (slot.displayPlayerId || slot.playerId));
        const real = Hexcore2.state.players.find(player => player.id === slot.playerId);
        Hexcore2.eventStore.append(
          '暗牌揭示',
          shown && real
            ? `${captain.name} 选择了展示为「${shown.name}」的卡牌，真实入队选手为「${real.name}」`
            : `${captain.name} 完成雪定饿的喵暗牌选择`,
          'warn'
        );
      }
      if (draw.pickMode === 'hellhound') {
        Hexcore2.hexcoreEngine.advanceHellhound(captain.id);
        armPickTimeout(Hexcore2.state.draft.currentDraw);
      } else {
        Hexcore2.state.draft.pickedThisTurn = true;
      }
      renderAndPersist();
    },

    timeoutRandomPick(autoTriggered = false) {
      const draw = Hexcore2.state.draft.currentDraw;
      if (!draw || !draw.cards || !draw.cards.length || Hexcore2.state.draft.pickedThisTurn) {
        Hexcore2.eventStore.append('超时随机失败', '当前没有可随机选择的候选卡', 'warn');
        Hexcore2.ui.render();
        return;
      }

      const index = Math.floor(Math.random() * draw.cards.length);
      Hexcore2.state.draft.selectedSlot = index;
      const captain = Hexcore2.selectors.currentCaptain();
      Hexcore2.eventStore.append(
        draw.pickMode === 'hellhound' ? '地狱三头犬超时' : '超时随机',
        `${captain ? captain.name : '当前队长'} ${autoTriggered ? '倒计时结束' : '触发超时随机'}，系统从当前 ${draw.cards.length} 张候选卡中随机选择第 ${index + 1} 张`,
        'warn'
      );
      this.pickCard();
    },

    nextCaptain() {
      const previous = Hexcore2.selectors.currentCaptain();
      snapshot(`切换队长前：${previous ? previous.name : '未知'}`);
      clearPickTimeout(true);
      const transition = Hexcore2.turnOrderEngine.advance();

      if (transition.type === 'next_round') {
        const captain = Hexcore2.selectors.currentCaptain();
        Hexcore2.eventStore.append('回合推进', `进入第 ${transition.round} 轮，当前队长为 ${captain ? captain.name : '无'}`, 'info');
      } else if (transition.type === 'completed') {
        Hexcore2.eventStore.append('选人完成', '所有抽选轮次已结束或队伍均已满员', 'success');
      } else {
        const captain = Hexcore2.selectors.currentCaptain();
        Hexcore2.eventStore.append('裁判操作', `进入 ${captain ? captain.name : '无'} 的选人环节`, 'info');
      }
      Hexcore2.ui.render();
    },

    useHexcore(id, targetCaptainId, secondTargetCaptainId) {
      const captain = Hexcore2.selectors.currentCaptain();
      snapshot(`使用海克斯前：${captain ? captain.name : '未知'}`);
      const result = Hexcore2.hexcoreEngine.activate(id, {
        targetCaptainId,
        targetPlayerId: targetCaptainId,
        firstCaptainId: targetCaptainId,
        secondCaptainId: secondTargetCaptainId,
        firstPlayerId: targetCaptainId,
        secondPlayerId: secondTargetCaptainId,
      });
      if (result && result.advanceTurn) {
        clearPickTimeout(true);
        this.nextCaptain();
      } else {
        armPickTimeout(Hexcore2.state.draft.currentDraw);
        Hexcore2.ui.render();
      }
    },

    skipTurn() {
      const captain = Hexcore2.selectors.currentCaptain();
      clearPickTimeout(true);
      Hexcore2.eventStore.append('裁判操作', `${captain ? captain.name : '无队长'} 跳过本轮选人`, 'warn');
      this.nextCaptain();
    },

    pause() {
      snapshot('暂停状态切换前');
      Hexcore2.state.draft.paused = !Hexcore2.state.draft.paused;
      Hexcore2.eventStore.append('裁判操作', Hexcore2.state.draft.paused ? '裁判暂停了选人流程' : '裁判恢复了选人流程', 'warn');
      Hexcore2.ui.render();
    },

    undo() {
      clearPickTimeout(false);
      const snapshot = Hexcore2.historyService.undo();
      if (snapshot) {
        Hexcore2.eventStore.append('撤销完成', `已恢复到「${snapshot.label}」之前的状态`, 'warn');
        armPickTimeout(Hexcore2.state.draft.currentDraw);
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
        ? confirm('确认清除本地状态并恢复示例初始数据？此操作会覆盖当前裁判端进度。')
        : true;
      if (!confirmed) return;

      if (Hexcore2.storageService) Hexcore2.storageService.clear();
      location.reload();
    },

    setActiveView(view) {
      Hexcore2.state.ui = Hexcore2.state.ui || {};
      Hexcore2.state.ui.activeView = view || 'draft';
      renderAndPersist();
    },

    drawHexcoreForCurrentCaptain() {
      const captain = Hexcore2.selectors.currentCaptain();
      return this.drawHexcoreForCaptain(captain ? captain.id : '');
    },

    drawHexcoreForCaptain(captainId) {
      const captain = Hexcore2.state.captains.find(item => item.id === captainId);
      if (!captain) {
        Hexcore2.eventStore.append('抽取海克斯失败', '请选择有效队长', 'warn');
        Hexcore2.ui.render();
        return;
      }

      if ((Hexcore2.state.hexcoreAssignments[captain.id] || []).length >= 3) {
        Hexcore2.eventStore.append('抽取海克斯失败', `${captain.name} 已拥有 3 个海克斯`, 'warn');
        Hexcore2.ui.render();
        return;
      }

      const activeSession = Hexcore2.state.hexcoreDraft && Hexcore2.state.hexcoreDraft.captainId === captain.id && Hexcore2.state.hexcoreDraft.slots.length;
      if (!activeSession) {
        snapshot(`抽取海克斯前：${captain.name}`);
        const slots = drawHexcoreSlots(captain.id, 3);
        if (slots.length < 3) {
          Hexcore2.eventStore.append('抽取海克斯失败', '海克斯池可用数量不足 3 个', 'warn');
          Hexcore2.ui.render();
          return;
        }
        Hexcore2.state.hexcoreDraft = Hexcore2.state.hexcoreDraft || {};
        Hexcore2.state.hexcoreDraft.captainId = captain.id;
        Hexcore2.state.hexcoreDraft.slots = slots;
        Hexcore2.state.hexcoreDraft.chosen = [];
        Hexcore2.state.hexcoreDraft.seenIds = [...slots];
        Hexcore2.state.hexcoreDraft.refreshUsed = false;
        Hexcore2.eventStore.append('抽取海克斯', `${captain.name} 抽出 3 个海克斯候选，等待队长三选一`, 'draw');
      } else {
        Hexcore2.eventStore.append('抽取海克斯', `${captain.name} 已有进行中的海克斯三选一`, 'info');
      }
      renderAndPersist();
    },

    selectHexcoreFromDraw(captainId, hexcoreId) {
      const captain = Hexcore2.state.captains.find(item => item.id === captainId);
      const session = Hexcore2.state.hexcoreDraft || {};
      const hexcore = Hexcore2.sampleData.hexcores.find(item => item.id === hexcoreId);
      if (!captain || !hexcore || session.captainId !== captainId || !session.slots.includes(hexcoreId)) {
        Hexcore2.eventStore.append('选择海克斯失败', '当前海克斯抽取会话无效', 'warn');
        Hexcore2.ui.render();
        return;
      }
      if ((Hexcore2.state.hexcoreAssignments[captainId] || []).some(item => item.id === hexcoreId)) {
        Hexcore2.eventStore.append('选择海克斯失败', `${captain.name} 已持有【${hexcore.name}】`, 'warn');
        Hexcore2.ui.render();
        return;
      }

      snapshot(`选择海克斯前：${captain.name}`);
      const list = Hexcore2.state.hexcoreAssignments[captainId] || [];
      Hexcore2.state.hexcoreAssignments[captainId] = list;
      list.push({ ...hexcore, status: hexcore.mode === 'passive' ? 'passive' : 'available' });
      session.chosen = [...(session.chosen || []), hexcoreId];
      const ownedCount = list.length;
      const nextCaptain = ownedCount >= 3 ? findNextHexcoreCaptain(captainId) : null;

      if (ownedCount >= 3) {
        resetHexcoreSession();
        if (nextCaptain) Hexcore2.state.ui.hexCaptainId = nextCaptain.id;
        Hexcore2.eventStore.append('海克斯完成', nextCaptain
          ? `${captain.name} 已选满 3 个海克斯，下一位：${nextCaptain.name}`
          : `${captain.name} 已选满 3 个海克斯，全部队长海克斯抽取已完成`,
        'success');
      } else {
        const excludes = [...(session.seenIds || []), hexcoreId];
        const slots = drawHexcoreSlots(captainId, 3, excludes);
        session.slots = slots;
        session.seenIds = [...excludes, ...slots];
        session.refreshUsed = false;
        Hexcore2.eventStore.append('选择海克斯', `${captain.name} 选择【${hexcore.name}】，重新抽出 3 个候选，还需再选 ${3 - ownedCount} 个`, 'success');
      }
      renderAndPersist();
    },

    refreshHexcoreSlot(slotIndex) {
      const session = Hexcore2.state.hexcoreDraft || {};
      const index = Number(slotIndex);
      if (!session.captainId || !Number.isInteger(index) || index < 0 || index >= session.slots.length) {
        Hexcore2.eventStore.append('刷新海克斯失败', '当前没有可刷新的候选槽', 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (session.refreshUsed) {
        Hexcore2.eventStore.append('刷新海克斯失败', '本次三选一已使用过刷新', 'warn');
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
      snapshot('取消海克斯抽取前');
      resetHexcoreSession();
      Hexcore2.eventStore.append('海克斯抽取', '裁判取消了当前海克斯抽取会话', 'warn');
      renderAndPersist();
    },

    randomizeHexcoreDrawOrder() {
      snapshot('制定海克斯抽取顺序前');
      Hexcore2.state.hexcoreDraft = Hexcore2.state.hexcoreDraft || {};
      Hexcore2.state.hexcoreDraft.drawOrder = [...Hexcore2.state.captains]
        .sort(() => Math.random() - 0.5)
        .map(captain => captain.id);
      Hexcore2.eventStore.append('海克斯抽取顺序', '裁判随机生成队长海克斯抽取顺序', 'success');
      renderAndPersist();
    },

    resetAllHexcores() {
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
      const captain = Hexcore2.state.captains.find(item => item.id === captainId);
      const hexcore = Hexcore2.sampleData.hexcores.find(item => item.id === hexcoreId);
      if (!captain || !hexcore) {
        Hexcore2.eventStore.append('分配海克斯失败', '目标队长或海克斯不存在', 'warn');
        Hexcore2.ui.render();
        return;
      }

      const list = Hexcore2.state.hexcoreAssignments[captainId] || [];
      if (list.length >= 3) {
        Hexcore2.eventStore.append('分配海克斯失败', `${captain.name} 已拥有 3 个海克斯`, 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (list.some(item => item.id === hexcoreId)) {
        Hexcore2.eventStore.append('分配海克斯失败', `${captain.name} 已持有【${hexcore.name}】`, 'warn');
        Hexcore2.ui.render();
        return;
      }

      snapshot(`分配海克斯前：${captain.name}`);
      Hexcore2.state.hexcoreAssignments[captainId] = list;
      list.push({ ...hexcore, status: hexcore.mode === 'passive' ? 'passive' : 'available' });
      Hexcore2.eventStore.append('分配海克斯', `${captain.name} 获得指定海克斯【${hexcore.name}】`, 'success');
      renderAndPersist();
    },

    saveCaptainName(captainId) {
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
      if (Hexcore2.state.captains.length >= Hexcore2.state.settings.maxTeams) {
        Hexcore2.eventStore.append('新增队伍失败', `队伍数量不能超过 ${Hexcore2.state.settings.maxTeams}`, 'warn');
        Hexcore2.ui.render();
        return;
      }

      const number = nextCaptainNumber();
      const name = prompt('请输入新队伍名称', `C${number} 新队伍`);
      if (!name || !name.trim()) return;

      snapshot('新增队伍前');
      const captain = { id: `c${number}`, name: name.trim(), record: '待定', team: [] };
      Hexcore2.state.captains.push(captain);
      Hexcore2.state.hexcoreAssignments[captain.id] = [];
      Hexcore2.state.draft.baseOrder.push(captain.id);
      normalizeAfterConfigChange();
      Hexcore2.eventStore.append('队伍管理', `新增队伍 ${captain.name}`, 'success');
      renderAndPersist();
    },

    removeCaptain(captainId) {
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
        if (player) {
          player.status = 'available';
          delete player.teamId;
        }
      });
      Hexcore2.state.captains = Hexcore2.state.captains.filter(item => item.id !== captainId);
      delete Hexcore2.state.hexcoreAssignments[captainId];
      Hexcore2.state.draft.baseOrder = Hexcore2.state.draft.baseOrder.filter(id => id !== captainId);
      Hexcore2.state.draft.runtimeEffects = Hexcore2.state.draft.runtimeEffects.filter(effect =>
        effect.captainId !== captainId && effect.sourceCaptainId !== captainId
      );
      normalizeAfterConfigChange();
      Hexcore2.eventStore.append('队伍管理', `删除队伍 ${captain.name}`, 'warn');
      renderAndPersist();
    },

    removePlayerFromTeam(captainId, playerId) {
      const captain = Hexcore2.state.captains.find(item => item.id === captainId);
      const player = Hexcore2.state.players.find(item => item.id === playerId);
      if (!captain || !player) return;

      snapshot(`移除队员前：${captain.name}`);
      captain.team = captain.team.filter(id => id !== playerId);
      player.status = 'available';
      delete player.teamId;
      Hexcore2.eventStore.append('队伍管理', `裁判将 ${player.name} 从 ${captain.name} 移回可选池`, 'warn');
      renderAndPersist();
    },

    assignPlayerToTeam(captainId, playerId) {
      const captain = Hexcore2.state.captains.find(item => item.id === captainId);
      const selectedPlayerId = playerId || (document.getElementById(`team-add-player-${captainId}`) || {}).value;
      const player = Hexcore2.state.players.find(item => item.id === selectedPlayerId);
      if (!captain || !player) {
        Hexcore2.eventStore.append('补录队员失败', '请选择有效队伍和选手', 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (captain.team.length >= Hexcore2.state.settings.playersPerTeam) {
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
      Hexcore2.assignmentEngine.assign(captain.id, player.id, 'manual_backfill');
      Hexcore2.eventStore.append('队伍管理', `裁判为 ${captain.name} 补录队员 ${player.name}`, 'success');
      renderAndPersist();
    },

    promotePlayerToCaptain(playerId) {
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
        ? Hexcore2.state.captains.find(captain => !captain.playerId && !captain.playerGameId)
        : null;
      if (!owner && !emptyCaptain && Hexcore2.state.captains.length >= Hexcore2.state.settings.maxTeams) {
        Hexcore2.eventStore.append('设为队长失败', `队伍数量不能超过 ${Hexcore2.state.settings.maxTeams}，请先删除或替换现有队伍`, 'warn');
        Hexcore2.ui.render();
        return;
      }

      snapshot(`设为队长前：${player.name}`);
      const targetCaptain = owner || emptyCaptain || (() => {
        const number = nextCaptainNumber();
        const captain = {
          id: `c${number}`,
          name: `${player.name}队`,
          record: '待定',
          team: [],
        };
        Hexcore2.state.captains.push(captain);
        Hexcore2.state.hexcoreAssignments[captain.id] = [];
        Hexcore2.state.draft.baseOrder.push(captain.id);
        return captain;
      })();

      const oldCaptainPlayer = Hexcore2.state.players.find(item =>
        item.id === targetCaptain.playerId
        || (targetCaptain.playerGameId && item.gameId === targetCaptain.playerGameId)
      );
      if (oldCaptainPlayer && oldCaptainPlayer.id !== player.id) {
        oldCaptainPlayer.status = 'available';
        delete oldCaptainPlayer.teamId;
        delete oldCaptainPlayer.isCaptain;
        delete oldCaptainPlayer.role;
      }

      Hexcore2.state.captains.forEach(captain => {
        captain.team = (captain.team || []).filter(id => id !== player.id);
        if (captain.id !== targetCaptain.id && captain.playerId === player.id) {
          delete captain.playerId;
          delete captain.playerGameId;
        }
      });
      targetCaptain.playerId = player.id;
      targetCaptain.playerGameId = player.gameId || '';
      player.status = 'captain';
      delete player.teamId;
      Hexcore2.state.ui.playerFilter = '0';
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

    moveCaptainOrder(captainId, direction) {
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
        ? confirm('队伍数量修改会重算流程并清空当前抽卡结果，确认保存？')
        : true;
      if (!confirmed) return;

      snapshot('队伍数量调整前');
      while (Hexcore2.state.captains.length < teamCount) {
        const number = nextCaptainNumber();
        const captain = { id: `c${number}`, name: `C${number} 新队伍`, record: '待定', team: [] };
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
      normalizeAfterConfigChange();
      Hexcore2.eventStore.append('队伍管理', `队伍数量调整为 ${teamCount} 队`, 'success');
      renderAndPersist();
    },

    updateRules(fromTeamPage = false) {
      const teamCountInput = document.getElementById('rules-team-count');
      const teamPageCountInput = document.getElementById('teams-team-count');
      const playersPerTeamInput = document.getElementById('rules-players-per-team');
      const roundInput = document.getElementById('rules-current-round');
      const maxRoundsInput = document.getElementById('rules-max-rounds');
      const drawCountInput = document.getElementById('rules-draw-count');
      const autoRandomStrategyInput = document.getElementById('rules-auto-random-strategy');
      const timeoutStrategyInput = document.getElementById('rules-timeout-strategy');
      const teamCount = Number((teamCountInput && teamCountInput.value) || (teamPageCountInput && teamPageCountInput.value));
      const playersPerTeam = Number(playersPerTeamInput && playersPerTeamInput.value);
      const round = Number(roundInput && roundInput.value);
      const maxRounds = Number(maxRoundsInput && maxRoundsInput.value);
      const drawCount = Number(drawCountInput && drawCountInput.value);
      const minTeams = Hexcore2.state.settings.minTeams;
      const maxTeams = Hexcore2.state.settings.maxTeams;
      const nextMaxRounds = Number.isInteger(maxRounds) ? maxRounds : Hexcore2.state.draft.maxRounds;
      const nextDrawCount = Number.isInteger(drawCount) ? drawCount : Hexcore2.state.settings.drawCount;
      const roundTiers = Array.from({ length: nextMaxRounds }, (_, index) => {
        const input = document.getElementById(`rules-round-tier-${index + 1}`);
        return Number(input && input.value) || Hexcore2.selectors.roundTier(index + 1);
      });

      if (!Number.isInteger(teamCount) || teamCount < minTeams || teamCount > maxTeams) {
        Hexcore2.eventStore.append('规则保存失败', `队伍数量必须在 ${minTeams}-${maxTeams} 之间`, 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (!Number.isInteger(playersPerTeam) || playersPerTeam < 1 || playersPerTeam > 8) {
        Hexcore2.eventStore.append('规则保存失败', '每队人数必须在 1-8 之间', 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (!Number.isInteger(nextMaxRounds) || nextMaxRounds < 1 || nextMaxRounds > 8) {
        Hexcore2.eventStore.append('规则保存失败', '最大轮数必须在 1-8 之间', 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (!Number.isInteger(round) || round < 1 || round > nextMaxRounds) {
        Hexcore2.eventStore.append('规则保存失败', `当前轮次必须在 1-${nextMaxRounds} 之间`, 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (!Number.isInteger(nextDrawCount) || nextDrawCount < 1 || nextDrawCount > 8) {
        Hexcore2.eventStore.append('规则保存失败', '基础抽卡张数必须在 1-8 之间', 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (roundTiers.some(tier => !Number.isInteger(tier) || tier < 1 || tier > 4)) {
        Hexcore2.eventStore.append('规则保存失败', '每轮卡池必须在 1-4 之间', 'warn');
        Hexcore2.ui.render();
        return;
      }
      const confirmed = typeof confirm === 'function'
        ? confirm(`${fromTeamPage ? '队伍数量' : '规则'}修改会重算流程并清空当前抽卡结果，确认保存？`)
        : true;
      if (!confirmed) return;

      snapshot('规则设置保存前');
      while (Hexcore2.state.captains.length < teamCount) {
        const number = nextCaptainNumber();
        const captain = { id: `c${number}`, name: `C${number} 新队伍`, record: '待定', team: [] };
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
      Hexcore2.state.settings.drawCount = nextDrawCount;
      Hexcore2.state.settings.roundTiers = roundTiers;
      Hexcore2.state.settings.autoRandomStrategy = (autoRandomStrategyInput && autoRandomStrategyInput.value) || Hexcore2.state.settings.autoRandomStrategy;
      Hexcore2.state.settings.timeoutStrategy = (timeoutStrategyInput && timeoutStrategyInput.value) || Hexcore2.state.settings.timeoutStrategy;
      Hexcore2.state.draft.round = round;
      Hexcore2.state.draft.maxRounds = nextMaxRounds;
      normalizeAfterConfigChange();
      Hexcore2.eventStore.append('规则设置', `保存规则：${teamCount} 队，每队 ${playersPerTeam} 人，${nextMaxRounds} 轮，基础抽 ${nextDrawCount} 张`, 'success');
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
        maxRounds: Hexcore2.state.draft.maxRounds,
        drawCount: Hexcore2.state.settings.drawCount,
        roundTiers: [...Hexcore2.state.settings.roundTiers],
        disabledHexcores: [...Hexcore2.state.settings.disabledHexcores],
      });
      Hexcore2.state.settings.ruleTemplates = Hexcore2.state.settings.ruleTemplates.slice(0, 8);
      Hexcore2.eventStore.append('规则设置', `保存规则模板「${name.trim()}」`, 'success');
      renderAndPersist();
    },

    setPlayerFilter(filter) {
      Hexcore2.state.ui = Hexcore2.state.ui || {};
      Hexcore2.state.ui.playerFilter = filter || 'all';
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

    addPlayer() {
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
      const scoreInput = document.getElementById('add-player-score');
      const gameIdInput = document.getElementById('add-player-game-id');
      const name = nameInput ? nameInput.value.trim() : '';
      const lane = laneInput ? laneInput.value.trim() : '';
      const score = Number(scoreInput && scoreInput.value);
      const gameId = gameIdInput ? gameIdInput.value.trim() : '';

      if (!name || !lane || !Number.isInteger(score) || score < 0 || score > 120) {
        Hexcore2.eventStore.append('新增选手失败', '请填写有效的姓名、位置和评分', 'warn');
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
      if (Hexcore2.normalizeState) Hexcore2.normalizeState(Hexcore2.state);
      Hexcore2.eventStore.append('选手库', `新增选手 ${player.name}`, 'success');
      renderAndPersist();
    },

    importPlayers(file) {
      Hexcore2.exportService.readPlayerFile(file, players => {
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
        if (Hexcore2.normalizeState) Hexcore2.normalizeState(Hexcore2.state);
        Hexcore2.eventStore.append(
          '选手导入',
          `导入 ${imported.length} 名选手${skipped ? `，跳过 ${skipped} 名重复游戏ID` : ''}`,
          imported.length ? 'success' : 'warn'
        );
        renderAndPersist();
      }, error => {
        Hexcore2.eventStore.append('选手导入失败', error.message, 'warn');
        Hexcore2.ui.render();
      });
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
        if (captain.playerId === player.id || captain.playerGameId === player.gameId) {
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
      const oldGameId = player.gameId || '';
      player.gameId = nextGameId;
      Hexcore2.state.captains.forEach(captain => {
        if (captain.playerId === player.id || captain.playerGameId === oldGameId) {
          captain.playerGameId = nextGameId;
        }
      });
      Hexcore2.state.ui.editingGameIdPlayerId = '';
      if (Hexcore2.normalizeState) Hexcore2.normalizeState(Hexcore2.state);
      Hexcore2.eventStore.append('选手库', `${player.name} 游戏ID更新为 ${player.gameId}`, 'success');
      renderAndPersist();
    },

    togglePlayerDisabled(playerId) {
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
      const entrants = Hexcore2.state.draft.baseOrder
        .filter(id => Hexcore2.state.captains.some(captain => captain.id === id));
      if (entrants.length < 2) {
        Hexcore2.eventStore.append('生成赛程失败', '至少需要 2 支队伍才能生成赛程', 'warn');
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
      Hexcore2.state.tournament = {
        status: 'running',
        championId: '',
        rounds: [buildTournamentRound(1, entrants, null)],
      };
      recomputeTournamentAdvancement();
      Hexcore2.eventStore.append('赛程生成', `已为 ${entrants.length} 支队伍生成淘汰赛赛程`, 'success');
      renderAndPersist();
    },

    saveTournamentScore(roundId, matchId) {
      const tournament = Hexcore2.state.tournament || {};
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
      Hexcore2.eventStore.append('赛程清空', '裁判清空了当前赛程', 'warn');
      renderAndPersist();
    },

    runSystemCheck() {
      const issues = [];
      const captainIds = new Set(Hexcore2.state.captains.map(captain => captain.id));
      const assignedPlayers = new Set();

      Hexcore2.state.captains.forEach(captain => {
        if (captain.team.length > Hexcore2.state.settings.playersPerTeam) {
          issues.push(`${captain.name} 队伍人数超过上限`);
        }
        captain.team.forEach(playerId => {
          if (assignedPlayers.has(playerId)) issues.push(`选手 ${playerId} 被多个队伍占用`);
          assignedPlayers.add(playerId);
          const player = Hexcore2.state.players.find(item => item.id === playerId);
          if (!player) issues.push(`${captain.name} 包含不存在的选手 ${playerId}`);
          if (player && player.teamId !== captain.id) issues.push(`${player.name} 的归属字段与队伍列表不一致`);
        });
      });

      Hexcore2.state.draft.baseOrder.forEach(captainId => {
        if (!captainIds.has(captainId)) issues.push(`基础顺位包含不存在队长 ${captainId}`);
      });

      Hexcore2.state.players.forEach(player => {
        if (player.status === 'drafted' && !player.teamId) issues.push(`${player.name} 已入队但缺少队伍归属`);
        if (player.teamId && !captainIds.has(player.teamId)) issues.push(`${player.name} 指向不存在的队伍`);
      });

      Hexcore2.eventStore.append(
        issues.length ? '系统检查发现问题' : '系统检查通过',
        issues.length ? issues.slice(0, 5).join('；') : '队伍、选手归属、顺位数据当前一致',
        issues.length ? 'warn' : 'success'
      );
      Hexcore2.ui.render();
    },

    restoreLatestSnapshot() {
      this.undo();
    },

    clearBrowserData() {
      const confirmed = typeof confirm === 'function'
        ? confirm('确认清理浏览器本地保存数据？当前页面内存状态会保留到刷新前，刷新后回到默认示例状态。')
        : true;
      if (!confirmed) return;
      const ok = Hexcore2.storageService ? Hexcore2.storageService.clear() : false;
      Hexcore2.state.ui = Hexcore2.state.ui || {};
      Hexcore2.state.ui.feedback = {
        title: ok ? '本地数据已清理' : '本地数据清理失败',
        body: ok ? '刷新页面后将加载默认示例状态' : '当前环境不支持 localStorage 或清理失败',
        level: ok ? 'success' : 'warn',
        time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        createdAt: Date.now(),
      };
      Hexcore2.ui.render();
    },
  };

  global.hexcoreUI = Hexcore2.actions;
  if (Hexcore2.state.draft.currentDraw) {
    if (!Hexcore2.state.draft.currentDraw.timeoutEndsAt) {
      armPickTimeout(Hexcore2.state.draft.currentDraw);
    } else {
      schedulePickTimeoutTick();
    }
    Hexcore2.ui.render();
  } else if (playersDraftReady()) {
    Hexcore2.actions.drawCards();
  } else {
    Hexcore2.ui.render();
  }
})(window);
