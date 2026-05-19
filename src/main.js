(function bootstrap(global) {
  const Hexcore2 = global.Hexcore2;

  Hexcore2.turnOrderEngine.recompute();

  function persist() {
    if (Hexcore2.storageService) Hexcore2.storageService.save(Hexcore2.state);
  }

  function renderAndPersist() {
    persist();
    Hexcore2.ui.render();
  }

  function snapshot(label) {
    if (Hexcore2.historyService) Hexcore2.historyService.push(label);
  }

  Hexcore2.actions = {
    selectCard(index) {
      Hexcore2.state.draft.selectedSlot = index;
      Hexcore2.state.draft.pickedThisTurn = false;
      renderAndPersist();
    },

    drawCards() {
      const captain = Hexcore2.selectors.currentCaptain();
      if (Hexcore2.state.draft.phase === 'completed') {
        Hexcore2.eventStore.append('裁判操作', '选秀已完成，无法继续抽卡', 'warn');
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
        Hexcore2.ui.render();
        return;
      }

      const tier = Hexcore2.poolEngine.effectiveTier(captain.id);
      const drawReasons = Hexcore2.hexcoreEngine.drawReasons(captain.id);
      const drawCount = 3 + Hexcore2.hexcoreEngine.extraDrawCount(captain.id);
      Hexcore2.state.draft.currentDraw = Hexcore2.probabilityEngine.draw(captain.id, tier, drawCount);
      Hexcore2.state.draft.currentDraw.reason = drawReasons.join('；');
      Hexcore2.state.draft.selectedSlot = 0;
      Hexcore2.state.draft.pickedThisTurn = false;

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
      Hexcore2.assignmentEngine.assign(captain.id, slot.playerId, 'normal_pick');
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
      Hexcore2.state.draft.pickedThisTurn = true;
      renderAndPersist();
    },

    nextCaptain() {
      const previous = Hexcore2.selectors.currentCaptain();
      snapshot(`切换队长前：${previous ? previous.name : '未知'}`);
      const transition = Hexcore2.turnOrderEngine.advance();

      if (transition.type === 'next_round') {
        const captain = Hexcore2.selectors.currentCaptain();
        Hexcore2.eventStore.append('回合推进', `进入第 ${transition.round} 轮，当前队长为 ${captain ? captain.name : '无'}`, 'info');
      } else if (transition.type === 'completed') {
        Hexcore2.eventStore.append('选秀完成', '所有轮次已结束或队伍均已满员', 'success');
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
      });
      if (result && result.advanceTurn) {
        this.nextCaptain();
      } else {
        Hexcore2.ui.render();
      }
    },

    skipTurn() {
      const captain = Hexcore2.selectors.currentCaptain();
      Hexcore2.eventStore.append('裁判操作', `${captain ? captain.name : '无队长'} 跳过本轮选人`, 'warn');
      this.nextCaptain();
    },

    pause() {
      snapshot('暂停状态切换前');
      Hexcore2.state.draft.paused = !Hexcore2.state.draft.paused;
      Hexcore2.eventStore.append('裁判操作', Hexcore2.state.draft.paused ? '裁判暂停了选秀流程' : '裁判恢复了选秀流程', 'warn');
      Hexcore2.ui.render();
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

    exportState() {
      if (Hexcore2.exportService.exportState()) Hexcore2.ui.render();
    },

    setEventFilter(filter) {
      Hexcore2.state.ui = Hexcore2.state.ui || {};
      Hexcore2.state.ui.eventFilter = filter;
      renderAndPersist();
    },

    importState(file) {
      Hexcore2.exportService.readStateFile(file, state => {
        snapshot('导入状态备份前');
        Hexcore2.state.settings = state.settings;
        Hexcore2.state.captains = state.captains;
        Hexcore2.state.players = state.players;
        Hexcore2.state.hexcoreAssignments = state.hexcoreAssignments || {};
        Hexcore2.state.draft = state.draft;
        Hexcore2.state.events = state.events || [];
        Hexcore2.state.undoStack = state.undoStack || [];
        Hexcore2.state.ui = state.ui || { eventFilter: 'all' };
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
  };

  global.hexcoreUI = Hexcore2.actions;
  if (Hexcore2.state.draft.currentDraw) {
    Hexcore2.ui.render();
  } else {
    Hexcore2.actions.drawCards();
  }
})(window);
