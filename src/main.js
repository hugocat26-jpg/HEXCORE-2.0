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
      const drawCount = Hexcore2.state.settings.drawCount + Hexcore2.hexcoreEngine.extraDrawCount(captain.id);
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
      } else {
        Hexcore2.state.draft.pickedThisTurn = true;
      }
      renderAndPersist();
    },

    timeoutRandomPick() {
      const draw = Hexcore2.state.draft.currentDraw;
      if (!draw || draw.pickMode !== 'hellhound' || !draw.cards.length) {
        Hexcore2.eventStore.append('超时随机失败', '当前没有可随机分配的地狱三头犬候选卡', 'warn');
        Hexcore2.ui.render();
        return;
      }

      const index = Math.floor(Math.random() * draw.cards.length);
      Hexcore2.state.draft.selectedSlot = index;
      const captain = Hexcore2.selectors.currentCaptain();
      Hexcore2.eventStore.append('地狱三头犬超时', `${captain ? captain.name : '当前队长'} 本段超时，系统随机选择第 ${index + 1} 张`, 'warn');
      this.pickCard();
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
        firstPlayerId: targetCaptainId,
        secondPlayerId: secondTargetCaptainId,
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
        ? confirm('确认清空当前事件日志？此操作会保留当前比赛状态。')
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
        Hexcore2.state.draft = state.draft;
        Hexcore2.state.events = state.events || [];
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

      snapshot(`抽取海克斯前：${captain.name}`);
      const owned = new Set((Hexcore2.state.hexcoreAssignments[captain.id] || []).map(hex => hex.id));
      const candidates = Hexcore2.sampleData.hexcores
        .filter(hex => !owned.has(hex.id))
        .filter(hex => Hexcore2.selectors.isHexcoreEnabled(hex.id))
        .filter(hex => hex.status !== 'passive' || hex.mode === 'passive');
      if (!candidates.length) {
        Hexcore2.eventStore.append('抽取海克斯失败', `${captain.name} 没有可抽取的新海克斯`, 'warn');
        Hexcore2.ui.render();
        return;
      }

      const picked = candidates[Math.floor(Math.random() * candidates.length)];
      Hexcore2.state.hexcoreAssignments[captain.id] = Hexcore2.state.hexcoreAssignments[captain.id] || [];
      Hexcore2.state.hexcoreAssignments[captain.id].push({ ...picked, status: picked.mode === 'passive' ? 'passive' : 'available' });
      Hexcore2.eventStore.append('抽取海克斯', `${captain.name} 获得【${picked.name}】`, 'success');
      renderAndPersist();
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
        Hexcore2.eventStore.append('队伍改名失败', '队长名称不能为空', 'warn');
        Hexcore2.ui.render();
        return;
      }
      if (nextName.trim() === captain.name) {
        Hexcore2.eventStore.append('队伍改名', `${captain.name} 名称未变化`, 'info');
        Hexcore2.ui.render();
        return;
      }

      snapshot(`重命名队长前：${captain.name}`);
      const oldName = captain.name;
      captain.name = nextName.trim();
      Hexcore2.eventStore.append('队伍管理', `队长「${oldName}」重命名为「${captain.name}」`, 'info');
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
        Hexcore2.eventStore.append('赛程跳转失败', '目标轮次或队长无效', 'warn');
        Hexcore2.ui.render();
        return;
      }

      snapshot(`赛程跳转前：第${targetRound}轮 ${captain.name}`);
      Hexcore2.state.draft.round = targetRound;
      Hexcore2.turnOrderEngine.recompute();
      const index = Hexcore2.state.draft.currentOrder.indexOf(captainId);
      Hexcore2.state.draft.currentIndex = index >= 0 ? index : 0;
      Hexcore2.state.draft.currentDraw = null;
      Hexcore2.state.draft.selectedSlot = 0;
      Hexcore2.state.draft.pickedThisTurn = false;
      Hexcore2.eventStore.append('赛程跳转', `裁判跳转到第 ${targetRound} 轮：${captain.name}`, 'warn');
      renderAndPersist();
    },

    addCaptain() {
      if (Hexcore2.state.captains.length >= Hexcore2.state.settings.maxTeams) {
        Hexcore2.eventStore.append('新增队伍失败', `队伍数量不能超过 ${Hexcore2.state.settings.maxTeams}`, 'warn');
        Hexcore2.ui.render();
        return;
      }

      const number = nextCaptainNumber();
      const name = prompt('请输入新队长名称', `C${number} 新队长`);
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
        const captain = { id: `c${number}`, name: `C${number} 新队长`, record: '待定', team: [] };
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
        const captain = { id: `c${number}`, name: `C${number} 新队长`, record: '待定', team: [] };
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
      const number = nextPlayerId();
      const player = {
        id: `p${number}`,
        lane: '未分配',
        name: `新选手${number}`,
        gameId: `NEW_${number}`,
        score: 60,
        tier: 1,
        kda: '0.0',
        damage: '0K',
        winRate: '0%',
        heroes: ['待', '定', '位'],
        status: 'available',
      };

      snapshot('新增选手前');
      Hexcore2.state.players.push(player);
      Hexcore2.eventStore.append('选手库', `新增选手 ${player.name}`, 'success');
      renderAndPersist();
    },

    savePlayer(playerId) {
      const player = Hexcore2.state.players.find(item => item.id === playerId);
      if (!player) return;
      const name = document.getElementById(`player-name-${playerId}`);
      const lane = document.getElementById(`player-lane-${playerId}`);
      const tier = document.getElementById(`player-tier-${playerId}`);
      const score = document.getElementById(`player-score-${playerId}`);
      const nextName = name ? name.value.trim() : '';
      const nextLane = lane ? lane.value.trim() : '';
      const nextTier = Number(tier && tier.value);
      const nextScore = Number(score && score.value);

      if (!nextName || !nextLane || !Number.isInteger(nextTier) || nextTier < 1 || nextTier > 4 || !Number.isFinite(nextScore)) {
        Hexcore2.eventStore.append('保存选手失败', '选手名称、位置、卡池或评分无效', 'warn');
        Hexcore2.ui.render();
        return;
      }

      snapshot(`保存选手前：${player.name}`);
      player.name = nextName;
      player.lane = nextLane;
      player.tier = nextTier;
      player.score = Math.max(0, Math.min(120, Math.round(nextScore)));
      Hexcore2.eventStore.append('选手库', `保存选手 ${player.name} 的基础信息`, 'success');
      renderAndPersist();
    },

    togglePlayerDisabled(playerId) {
      const player = Hexcore2.state.players.find(item => item.id === playerId);
      if (!player) return;
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
    Hexcore2.ui.render();
  } else {
    Hexcore2.actions.drawCards();
  }
})(window);
