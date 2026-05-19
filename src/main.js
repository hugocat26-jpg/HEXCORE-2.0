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

      Hexcore2.assignmentEngine.assign(captain.id, slot.playerId, 'normal_pick');
      Hexcore2.state.draft.pickedThisTurn = true;
      renderAndPersist();
    },

    nextCaptain() {
      Hexcore2.turnOrderEngine.advance();
      const captain = Hexcore2.selectors.currentCaptain();
      Hexcore2.eventStore.append('裁判操作', `进入 ${captain.name} 的选人环节`, 'info');
      Hexcore2.ui.render();
    },

    useHexcore(id) {
      Hexcore2.hexcoreEngine.activate(id);
      Hexcore2.ui.render();
    },

    skipTurn() {
      const captain = Hexcore2.selectors.currentCaptain();
      Hexcore2.eventStore.append('裁判操作', `${captain.name} 跳过本轮选人`, 'warn');
      this.nextCaptain();
    },

    pause() {
      Hexcore2.state.draft.paused = !Hexcore2.state.draft.paused;
      Hexcore2.eventStore.append('裁判操作', Hexcore2.state.draft.paused ? '裁判暂停了选秀流程' : '裁判恢复了选秀流程', 'warn');
      Hexcore2.ui.render();
    },

    undo() {
      Hexcore2.eventStore.append('裁判操作', '撤销上一步操作已进入待确认状态', 'warn');
      Hexcore2.ui.render();
    },

    exportEvents() {
      if (Hexcore2.exportService.exportEvents()) Hexcore2.ui.render();
    },

    exportState() {
      if (Hexcore2.exportService.exportState()) Hexcore2.ui.render();
    },
  };

  global.hexcoreUI = Hexcore2.actions;
  if (Hexcore2.state.draft.currentDraw) {
    Hexcore2.ui.render();
  } else {
    Hexcore2.actions.drawCards();
  }
})(window);
