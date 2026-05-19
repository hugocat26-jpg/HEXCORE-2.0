(function initRefereeConsole(global) {
  const Hexcore2 = global.Hexcore2 || (global.Hexcore2 = {});

  function playerById(playerId) {
    return Hexcore2.state.players.find(player => player.id === playerId);
  }

  function currentCards() {
    const draw = Hexcore2.state.draft.currentDraw;
    if (!draw) return [];
    return draw.cards.map(slot => {
      const player = playerById(slot.displayPlayerId || slot.playerId);
      const realPlayer = playerById(slot.playerId);
      return player && realPlayer ? { slot, player, realPlayer } : null;
    }).filter(Boolean);
  }

  function currentDrawLabel() {
    const draw = Hexcore2.state.draft.currentDraw;
    if (!draw || draw.pickMode !== 'open_pick') return '本轮抽卡';
    return '全池自选';
  }

  function currentExplanation() {
    const captain = Hexcore2.selectors.currentCaptain();
    if (!captain) return [];
    const explanation = Hexcore2.state.draft.explanations.find(item => item.captainId === captain.id);
    return explanation ? explanation.reasons : [];
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeJsonString(value) {
    return JSON.stringify(String(value ?? '')).replace(/</g, '\\u003c');
  }

  function eventLevelClass(level) {
    return ['info', 'draw', 'warn', 'success'].includes(level) ? level : 'info';
  }

  function sidebar() {
    const icon = Hexcore2.icon;
    const teamCount = Hexcore2.selectors.teamCount();
    const items = [
      ['draft', '实时选秀', true],
      ['team', '队伍管理'],
      ['users', '选手库'],
      ['hex', '海克斯库'],
      ['calendar', '赛程进度'],
      ['rule', '规则设置'],
      ['log', '日志导出'],
      ['cog', '系统设置'],
    ];

    return `
      <aside class="side-nav">
        <div class="brand">
          <span class="brand-mark">${icon('cube')}</span>
          <span>HEXCORE 2.0</span>
        </div>
        <div class="nav-section">赛事控制台</div>
        <nav class="nav-list">
          ${items.map(([name, label, active]) => `
            <button class="nav-item ${active ? 'active' : ''}">
              ${icon(name)}
              <span>${label}</span>
            </button>
          `).join('')}
        </nav>
        <div class="event-info">
          <div>赛事信息</div>
          <p>赛事名称：HEXCORE 杯 S2</p>
          <p>赛制：${teamCount} 队征召制</p>
          <p>队伍范围：${Hexcore2.state.settings.minTeams}-${Hexcore2.state.settings.maxTeams} 队</p>
          <p>版本：2.0 裁判端</p>
          <p>模式：裁判代执行</p>
          <p>创建时间：2026-05-19 09:00</p>
          <p>可撤销步骤：${(Hexcore2.state.undoStack || []).length}</p>
          <button onclick="window.hexcoreUI.exportState()">导出状态备份</button>
          <button onclick="document.getElementById('state-import-input').click()">导入状态备份</button>
          <button class="danger-mini" onclick="window.hexcoreUI.resetLocalState()">重置本地状态</button>
          <input id="state-import-input" type="file" accept=".json,application/json" hidden onchange="window.hexcoreUI.importState(this.files[0]); this.value = ''">
        </div>
      </aside>
    `;
  }

  function topbar() {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const captain = Hexcore2.selectors.currentCaptain();
    const tier = captain ? Hexcore2.poolEngine.effectiveTier(captain.id) : Math.max(1, Math.min(4, Hexcore2.state.draft.round));
    const tierName = Hexcore2.state.settings.tierNames[tier];
    const statusText = Hexcore2.state.draft.phase === 'completed'
      ? '选秀已完成'
      : (Hexcore2.state.draft.paused ? '流程已暂停' : '比赛进行中');
    return `
      <header class="topbar">
        <div class="mode">裁判代执行</div>
        <div class="phase">当前阶段：<strong>第 ${Hexcore2.state.draft.round} 轮 / ${tierName}池</strong></div>
        <div class="captain-title">当前队长：<strong>${captain ? escapeHtml(captain.name) : '无'}</strong></div>
        <div class="top-spacer"></div>
        <div class="live-status ${Hexcore2.state.draft.phase === 'completed' ? 'done' : ''}"><span></span>${statusText}</div>
        <div class="clock">${time}</div>
        <button class="ghost-btn" onclick="window.hexcoreUI.drawCards()">${Hexcore2.icon('refresh')}刷新</button>
      </header>
    `;
  }

  function turnOrder() {
    const state = Hexcore2.state;
    const orderColumns = Math.max(1, state.draft.currentOrder.length);
    return `
      <section class="turn-panel">
        <div class="panel-title-row">
          <h2>顺位顺序 <span>当前第 ${state.draft.round} 轮 / 有效队伍 ${state.draft.currentOrder.length}</span></h2>
          <button class="subtle-btn">顺位详情</button>
        </div>
        <div class="turn-strip" style="grid-template-columns: repeat(${orderColumns}, minmax(92px, 1fr));">
          ${state.draft.currentOrder.map((captainId, index) => {
            const captain = state.captains.find(item => item.id === captainId);
            return `
              <div class="turn-card ${index === state.draft.currentIndex ? 'current' : ''} ${index < state.draft.currentIndex ? 'done' : ''}">
                <strong>${escapeHtml(captain.name)}</strong>
                <span>${escapeHtml(captain.record)}</span>
              </div>
            `;
          }).join('')}
        </div>
        <div class="turn-note">顺位变更说明：${escapeHtml(currentExplanation().join('；') || '按基础蛇形顺位执行')}。</div>
      </section>
    `;
  }

  function playerCards() {
    const cards = currentCards();
    const captain = Hexcore2.selectors.currentCaptain();
    const selected = Hexcore2.state.draft.selectedSlot;
    const blinded = captain ? Hexcore2.hexcoreEngine.isBlinded(captain.id) : false;
    const tier = captain ? Hexcore2.poolEngine.effectiveTier(captain.id) : Math.max(1, Math.min(4, Hexcore2.state.draft.round));
    const draw = Hexcore2.state.draft.currentDraw;
    return `
      <section class="draw-panel">
        <div class="panel-title-row">
          <h2>${escapeHtml(currentDrawLabel())} <span>${escapeHtml(Hexcore2.state.settings.tierNames[tier])}池${draw && draw.reason ? ` / ${escapeHtml(draw.reason)}` : ''}</span></h2>
          <button class="subtle-btn" onclick="window.hexcoreUI.drawCards()">${Hexcore2.icon('refresh')}刷新池子</button>
        </div>
        <div class="cards-grid ${draw && draw.pickMode === 'open_pick' ? 'open-pick-grid' : ''}">
          ${cards.map(({ slot, player, realPlayer }, index) => `
            <button class="player-card ${index === selected ? 'selected' : ''} ${blinded ? 'blind-card' : ''} ${draw && draw.pickMode === 'mystery_swap' ? 'mystery-card' : ''}" onclick="window.hexcoreUI.selectCard(${index})">
              <span class="card-index">${index + 1}</span>
              <span class="lane">${blinded ? '致盲' : escapeHtml(player.lane)}</span>
              <span class="check">${index === selected ? '✓' : ''}</span>
              <strong>${blinded ? '身份隐藏' : escapeHtml(player.name)}</strong>
              <small>${blinded ? '选中后揭示' : `ID: ${escapeHtml(player.gameId)}${draw && draw.pickMode === 'mystery_swap' ? ' / 真实身份待揭示' : ''}`}</small>
              <div class="score-row">评分 <b>${blinded ? '??' : player.score}</b></div>
              <div class="history-title">历史表现（近5场）</div>
              <div class="stat-grid">
                <span>KDA<b>${blinded ? '?' : escapeHtml(player.kda)}</b></span>
                <span>场均伤害<b>${blinded ? '?' : escapeHtml(player.damage)}</b></span>
                <span>胜率<b>${blinded ? '?' : escapeHtml(player.winRate)}</b></span>
              </div>
              <div class="hero-title">擅长英雄</div>
              <div class="hero-row">
                ${(blinded ? ['?', '?', '?'] : player.heroes).map(hero => `<span>${escapeHtml(hero)}</span>`).join('')}
              </div>
              ${draw && draw.pickMode === 'mystery_swap' && slot.displayPlayerId !== slot.playerId ? `<em>选择后揭示：真实选中并非当前展示身份</em>` : ''}
            </button>
          `).join('')}
        </div>
        <p class="hint">提示：${captain ? `${draw && draw.pickMode === 'open_pick' ? '开饭啦已展开当前池全部可选选手，' : ''}请选择一名选手加入 ${escapeHtml(captain.name)} 的队伍（${Hexcore2.selectors.teamSize(captain.id)}/4）` : '当前没有可操作队长'}</p>
      </section>
    `;
  }

  function refereeControls() {
    const icon = Hexcore2.icon;
    return `
      <section class="control-panel">
        <h2>裁判操作</h2>
        <div class="control-grid">
          <button class="action-btn cyan" onclick="window.hexcoreUI.drawCards()">${icon('cube')}<strong>抽卡</strong><span>抽取本轮选手</span></button>
          <button class="action-btn green ${Hexcore2.state.draft.pickedThisTurn ? 'disabled' : ''}" onclick="window.hexcoreUI.pickCard()">${icon('pick')}<strong>${Hexcore2.state.draft.pickedThisTurn ? '已选择' : '选择此卡'}</strong><span>将选手加入队伍</span></button>
          <button class="action-btn amber" onclick="window.hexcoreUI.skipTurn()"><span class="fast-icon">»</span><strong>跳过本轮</strong><span>不选择，跳过此轮</span></button>
          <button class="action-btn blue" onclick="window.hexcoreUI.nextCaptain()">${icon('team')}<strong>下一位</strong><span>交给下一队长</span></button>
          <button class="action-btn muted" onclick="window.hexcoreUI.pause()">${icon('pause')}<strong>暂停</strong><span>暂停选秀流程</span></button>
          <button class="action-btn muted ${(Hexcore2.state.undoStack || []).length === 0 ? 'disabled' : ''}" onclick="window.hexcoreUI.undo()">${icon('undo')}<strong>撤销上一步</strong><span>可撤销 ${(Hexcore2.state.undoStack || []).length} 步</span></button>
        </div>
      </section>
    `;
  }

  function hexcorePanel() {
    const captain = Hexcore2.selectors.currentCaptain();
    if (!captain) {
      return `
        <section class="hexcore-panel">
          <h2>当前队长的海克斯</h2>
          <div class="empty-log">当前没有可操作队长</div>
        </section>
      `;
    }
    const hexcores = Hexcore2.selectors.currentHexcores();
    const blindTargets = Hexcore2.hexcoreEngine.blindTargetOptions(captain.id);
    const swapPairs = [];
    Hexcore2.state.captains.forEach((first, firstIndex) => {
      Hexcore2.state.captains.slice(firstIndex + 1).forEach(second => {
        swapPairs.push([first, second]);
      });
    });
    return `
      <section class="hexcore-panel">
        <h2>${escapeHtml(captain.name)} 的海克斯</h2>
        <div class="hex-list">
          ${hexcores.map(hex => {
            const blindUsed = hex.id === 'blind' && Hexcore2.hexcoreEngine.blindUsedBy(captain.id);
            const snowUsed = hex.id === 'snow-cat' && Hexcore2.hexcoreEngine.snowCatUsedBy(captain.id);
            const isUsed = hex.mode === 'passive' || (hex.status === 'used' && hex.id !== 'blind' && hex.id !== 'snow-cat') || blindUsed || snowUsed;
            return `
              <div class="hex-row ${hex.type} ${hex.id === 'blind' || hex.id === 'order-swap' ? 'targetable' : ''}">
                <div class="hex-symbol">${Hexcore2.icon('hex')}</div>
                <div>
                  <strong>${escapeHtml(hex.name)}</strong>
                  <p>${escapeHtml(hex.desc)}</p>
                  <span>${hex.mode === 'passive' ? '被动规则：自动生效' : (hex.id === 'blind' ? (blindUsed ? '本轮已使用' : '本轮可指定目标') : (hex.id === 'snow-cat' ? (snowUsed ? '本轮已使用' : '本轮可用') : `可用次数：${hex.status === 'used' ? 0 : hex.uses}`))}</span>
                  ${hex.id === 'blind' && !blindUsed ? `
                    <div class="target-grid">
                      ${blindTargets.map(target => `
                        <button onclick="window.hexcoreUI.useHexcore(${safeJsonString(hex.id)}, ${safeJsonString(target.id)})">${escapeHtml(target.name)}</button>
                      `).join('') || '<span>本轮没有可致盲目标</span>'}
                    </div>
                  ` : ''}
                  ${hex.id === 'order-swap' && hex.status !== 'used' ? `
                    <div class="target-grid pair-grid">
                      ${swapPairs.map(([first, second]) => `
                        <button onclick="window.hexcoreUI.useHexcore(${safeJsonString(hex.id)}, ${safeJsonString(first.id)}, ${safeJsonString(second.id)})">${escapeHtml(first.name)} ↔ ${escapeHtml(second.name)}</button>
                      `).join('')}
                    </div>
                  ` : ''}
                </div>
                <button class="${isUsed ? 'used' : ''}" ${hex.mode === 'passive' || blindUsed || snowUsed || hex.id === 'blind' || hex.id === 'order-swap' ? 'disabled' : ''} onclick="window.hexcoreUI.useHexcore(${safeJsonString(hex.id)})">${hex.mode === 'passive' ? '被动' : (isUsed ? '已使用' : (hex.id === 'blind' || hex.id === 'order-swap' ? '选下方' : '使用'))}</button>
              </div>
            `;
          }).join('')}
        </div>
      </section>
    `;
  }

  function rulePanel() {
    const captain = Hexcore2.selectors.currentCaptain();
    const reasons = currentExplanation();
    const poolReasons = captain ? Hexcore2.poolEngine.explain(captain.id).reasons : [];
    const lines = [
      ...poolReasons.map(reason => ({ label: '卡池原因', body: reason })),
      ...(reasons.length ? reasons : ['基础顺位：按当前轮次蛇形顺位执行']).map(reason => ({ label: '顺位原因', body: reason })),
    ];
    return `
      <section class="rule-panel">
        <h2>规则说明</h2>
        ${lines.map((line, index) => `
          <div class="rule-line ${index % 2 ? 'cyan' : 'amber'}"><strong>${escapeHtml(line.label)}</strong><span>${escapeHtml(line.body)}</span></div>
        `).join('')}
        <button class="subtle-btn full">查看完整规则</button>
      </section>
    `;
  }

  function eventLog() {
    const filter = (Hexcore2.state.ui && Hexcore2.state.ui.eventFilter) || 'all';
    const filteredEvents = Hexcore2.state.events.filter(event => {
      if (filter === 'all') return true;
      if (filter === 'hexcore') return event.title.includes('海克斯');
      if (filter === 'team') return event.title.includes('入队') || event.body.includes('加入队伍');
      if (filter === 'warning') return event.level === 'warn';
      return true;
    });

    return `
      <aside class="event-rail">
        <div class="panel-title-row">
          <h2>事件日志</h2>
          <select aria-label="事件筛选" onchange="window.hexcoreUI.setEventFilter(this.value)">
            <option value="all" ${filter === 'all' ? 'selected' : ''}>全部事件</option>
            <option value="hexcore" ${filter === 'hexcore' ? 'selected' : ''}>海克斯</option>
            <option value="team" ${filter === 'team' ? 'selected' : ''}>选手入队</option>
            <option value="warning" ${filter === 'warning' ? 'selected' : ''}>警告</option>
          </select>
        </div>
        <div class="event-list">
          ${filteredEvents.map(event => `
            <div class="event-item ${eventLevelClass(event.level)}">
              <time>${escapeHtml(event.time)}</time>
              <div class="event-dot"></div>
              <div>
                <strong>${escapeHtml(event.title)}</strong>
                <p>${escapeHtml(event.body)}</p>
              </div>
            </div>
          `).join('') || '<div class="empty-log">当前筛选下没有事件</div>'}
        </div>
        <button class="export-btn" onclick="window.hexcoreUI.exportEvents()">导出日志</button>
      </aside>
    `;
  }

  function rosterRail() {
    const currentCaptain = Hexcore2.selectors.currentCaptain();
    const teamCount = Hexcore2.selectors.teamCount();
    return `
      <footer class="roster-rail">
        <div class="rail-header">
          <h2>队伍阵容概览（${teamCount} 队）</h2>
          <div><span class="filled-dot"></span>已选 <span class="empty-dot"></span>空位</div>
        </div>
        <div class="roster-list" style="grid-template-columns: repeat(${teamCount}, minmax(120px, 1fr));">
          ${Hexcore2.state.captains.map((captain, index) => `
            <div class="team-mini ${currentCaptain && captain.id === currentCaptain.id ? 'active' : ''}">
              <div><span>${index + 1}</span><strong>${escapeHtml(captain.name)}</strong></div>
              <p>${captain.team.length}/4</p>
              <div class="slots">
                ${Array.from({ length: 4 }, (_, slot) => `<i class="${slot < captain.team.length ? 'filled' : ''}"></i>`).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      </footer>
    `;
  }

  function app() {
    return `
      ${sidebar()}
      <div class="app-main">
        ${topbar()}
        <main class="workspace">
          <div class="workspace-main">
            ${turnOrder()}
            <div class="content-grid">
              <div>
                ${playerCards()}
                ${refereeControls()}
              </div>
              <div>
                ${hexcorePanel()}
                ${rulePanel()}
              </div>
            </div>
          </div>
          ${eventLog()}
        </main>
        ${rosterRail()}
      </div>
    `;
  }

  Hexcore2.ui = {
    render() {
      document.getElementById('app').innerHTML = app();
    },
  };
})(window);
