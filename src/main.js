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
      if (!captain) return;

      const teamSize = Hexcore2.selectors.teamSize(captain.id);
      if (teamSize >= Hexcore2.state.settings.playersPerTeam) {
        Hexcore2.eventStore.append('裁判操作', `${captain.name} 队伍已满，自动跳过抽卡`, 'warn');
        this.nextCaptain();
        return;
      }

      snapshot(`抽卡前：${captain.name}`);
      const tier = Hexcore2.poolEngine.effectiveTier(captain.id);
      const drawCount = 3 + Hexcore2.hexcoreEngine.extraDrawCount(captain.id);
      Hexcore2.state.draft.currentDraw = Hexcore2.probabilityEngine.draw(captain.id, tier, drawCount);
      Hexcore2.state.draft.selectedSlot = 0;
      Hexcore2.state.draft.pickedThisTurn = false;

      const tierName = Hexcore2.state.settings.tierNames[tier];
      Hexcore2.eventStore.append('抽卡完成', `${captain.name} 从${tierName}抽取 ${Hexcore2.state.draft.currentDraw.cards.length} 张选手卡`, 'draw');
      Hexcore2.ui.render();
    },

    pickCard() {
      const draw = Hexcore2.state.draft.currentDraw;
      const captain = Hexcore2.selectors.currentCaptain();
      if (Hexcore2.state.draft.pickedThisTurn) return;
      if (!draw || !captain) return;

      const slot = draw.cards[Hexcore2.state.draft.selectedSlot];
      if (!slot) return;

      snapshot(`选卡前：${captain.name}`);
      Hexcore2.assignmentEngine.assign(captain.id, slot.playerId, 'normal_pick');
      Hexcore2.state.draft.pickedThisTurn = true;
      renderAndPersist();
    },

    nextCaptain() {
      const previous = Hexcore2.selectors.currentCaptain();
      snapshot(`切换队长前：${previous ? previous.name : '未知'}`);
      Hexcore2.turnOrderEngine.advance();
      const captain = Hexcore2.selectors.currentCaptain();
      Hexcore2.eventStore.append('裁判操作', `进入 ${captain.name} 的选人环节`, 'info');
      Hexcore2.ui.render();
    },

    useHexcore(id) {
      const captain = Hexcore2.selectors.currentCaptain();
      snapshot(`使用海克斯前：${captain ? captain.name : '未知'}`);
      Hexcore2.hexcoreEngine.activate(id);
      Hexcore2.ui.render();
    },

    skipTurn() {
      const captain = Hexcore2.selectors.currentCaptain();
      Hexcore2.eventStore.append('裁判操作', `${captain.name} 跳过本轮选人`, 'warn');
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
