(function initRefereeConsole(global) {
  const Hexcore2 = global.Hexcore2 || (global.Hexcore2 = {});

  function playerById(playerId) {
    return Hexcore2.state.players.find(player => player.id === playerId);
  }

  function currentCards() {
    const draw = Hexcore2.state.draft.currentDraw;
    if (!draw) return [];
    return draw.cards.map(card => playerById(card.playerId)).filter(Boolean);
  }

  function currentExplanation() {
    const captain = Hexcore2.selectors.currentCaptain();
    if (!captain) return [];
    const explanation = Hexcore2.state.draft.explanations.find(item => item.captainId === captain.id);
    return explanation ? explanation.reasons : [];
  }

  function sidebar() {
    const icon = Hexcore2.icon;
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
          <p>赛制：12 队征召制</p>
          <p>版本：2.0 裁判端</p>
          <p>模式：裁判代执行</p>
          <p>创建时间：2026-05-19 09:00</p>
        </div>
      </aside>
    `;
  }

  function topbar() {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const captain = Hexcore2.selectors.currentCaptain();
    const tier = Hexcore2.poolEngine.effectiveTier(captain.id);
    const tierName = Hexcore2.state.settings.tierNames[tier];
    return `
      <header class="topbar">
        <div class="mode">裁判代执行</div>
        <div class="phase">当前阶段：<strong>第 ${Hexcore2.state.draft.round} 轮 / ${tierName}池</strong></div>
        <div class="captain-title">当前队长：<strong>${captain.name}</strong></div>
        <div class="top-spacer"></div>
        <div class="live-status"><span></span>${Hexcore2.state.draft.paused ? '流程已暂停' : '比赛进行中'}</div>
        <div class="clock">${time}</div>
        <button class="ghost-btn" onclick="window.hexcoreUI.drawCards()">${Hexcore2.icon('refresh')}刷新</button>
      </header>
    `;
  }

  function turnOrder() {
    const state = Hexcore2.state;
    return `
      <section class="turn-panel">
        <div class="panel-title-row">
          <h2>顺位顺序 <span>当前第 ${state.draft.round} 轮</span></h2>
          <button class="subtle-btn">顺位详情</button>
        </div>
        <div class="turn-strip">
          ${state.draft.currentOrder.map((captainId, index) => {
            const captain = state.captains.find(item => item.id === captainId);
            return `
              <div class="turn-card ${index === state.draft.currentIndex ? 'current' : ''} ${index < state.draft.currentIndex ? 'done' : ''}">
                <strong>${captain.name}</strong>
                <span>${captain.record}</span>
              </div>
            `;
          }).join('')}
        </div>
        <div class="turn-note">顺位变更说明：${currentExplanation().join('；') || '按基础蛇形顺位执行'}。</div>
      </section>
    `;
  }

  function playerCards() {
    const cards = currentCards();
    const captain = Hexcore2.selectors.currentCaptain();
    const selected = Hexcore2.state.draft.selectedSlot;
    const blinded = Hexcore2.hexcoreEngine.isBlinded(captain.id);
    return `
      <section class="draw-panel">
        <div class="panel-title-row">
          <h2>本轮抽卡 <span>${Hexcore2.state.settings.tierNames[Hexcore2.poolEngine.effectiveTier(captain.id)]}池</span></h2>
          <button class="subtle-btn" onclick="window.hexcoreUI.drawCards()">${Hexcore2.icon('refresh')}刷新池子</button>
        </div>
        <div class="cards-grid">
          ${cards.map((card, index) => `
            <button class="player-card ${index === selected ? 'selected' : ''} ${blinded ? 'blind-card' : ''}" onclick="window.hexcoreUI.selectCard(${index})">
              <span class="card-index">${index + 1}</span>
              <span class="lane">${blinded ? '致盲' : card.lane}</span>
              <span class="check">${index === selected ? '✓' : ''}</span>
              <strong>${blinded ? '身份隐藏' : card.name}</strong>
              <small>${blinded ? '选中后揭示' : `ID: ${card.gameId}`}</small>
              <div class="score-row">评分 <b>${blinded ? '??' : card.score}</b></div>
              <div class="history-title">历史表现（近5场）</div>
              <div class="stat-grid">
                <span>KDA<b>${blinded ? '?' : card.kda}</b></span>
                <span>场均伤害<b>${blinded ? '?' : card.damage}</b></span>
                <span>胜率<b>${blinded ? '?' : card.winRate}</b></span>
              </div>
              <div class="hero-title">擅长英雄</div>
              <div class="hero-row">
                ${(blinded ? ['?', '?', '?'] : card.heroes).map(hero => `<span>${hero}</span>`).join('')}
              </div>
            </button>
          `).join('')}
        </div>
        <p class="hint">提示：请选择一名选手加入 ${captain.name} 的队伍（${Hexcore2.selectors.teamSize(captain.id)}/4）</p>
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
          <button class="action-btn green" onclick="window.hexcoreUI.pickCard()">${icon('pick')}<strong>选择此卡</strong><span>将选手加入队伍</span></button>
          <button class="action-btn amber" onclick="window.hexcoreUI.skipTurn()"><span class="fast-icon">»</span><strong>跳过本轮</strong><span>不选择，跳过此轮</span></button>
          <button class="action-btn blue" onclick="window.hexcoreUI.nextCaptain()">${icon('team')}<strong>下一位</strong><span>交给下一队长</span></button>
          <button class="action-btn muted" onclick="window.hexcoreUI.pause()">${icon('pause')}<strong>暂停</strong><span>暂停选秀流程</span></button>
          <button class="action-btn muted" onclick="window.hexcoreUI.undo()">${icon('undo')}<strong>撤销上一步</strong><span>撤销上一次操作</span></button>
        </div>
      </section>
    `;
  }

  function hexcorePanel() {
    const captain = Hexcore2.selectors.currentCaptain();
    const hexcores = Hexcore2.selectors.currentHexcores();
    return `
      <section class="hexcore-panel">
        <h2>${captain.name} 的海克斯</h2>
        <div class="hex-list">
          ${hexcores.map(hex => `
            <div class="hex-row ${hex.type}">
              <div class="hex-symbol">${Hexcore2.icon('hex')}</div>
              <div>
                <strong>${hex.name}</strong>
                <p>${hex.desc}</p>
                <span>可用次数：${hex.status === 'used' ? 0 : hex.uses}</span>
              </div>
              <button class="${hex.status === 'used' ? 'used' : ''}" onclick="window.hexcoreUI.useHexcore('${hex.id}')">${hex.status === 'used' ? '已使用' : '使用'}</button>
            </div>
          `).join('')}
        </div>
      </section>
    `;
  }

  function rulePanel() {
    const reasons = currentExplanation();
    return `
      <section class="rule-panel">
        <h2>规则说明</h2>
        ${(reasons.length ? reasons : ['基础顺位：按当前轮次蛇形顺位执行']).map((reason, index) => `
          <div class="rule-line ${index % 2 ? 'cyan' : 'amber'}"><strong>顺位原因</strong><span>${reason}</span></div>
        `).join('')}
        <button class="subtle-btn full">查看完整规则</button>
      </section>
    `;
  }

  function eventLog() {
    return `
      <aside class="event-rail">
        <div class="panel-title-row">
          <h2>事件日志</h2>
          <select aria-label="事件筛选">
            <option>全部事件</option>
            <option>海克斯</option>
            <option>选手入队</option>
          </select>
        </div>
        <div class="event-list">
          ${Hexcore2.state.events.map(event => `
            <div class="event-item ${event.level}">
              <time>${event.time}</time>
              <div class="event-dot"></div>
              <div>
                <strong>${event.title}</strong>
                <p>${event.body}</p>
              </div>
            </div>
          `).join('')}
        </div>
        <button class="export-btn">导出日志</button>
      </aside>
    `;
  }

  function rosterRail() {
    return `
      <footer class="roster-rail">
        <div class="rail-header">
          <h2>队伍阵容概览（12 队）</h2>
          <div><span class="filled-dot"></span>已选 <span class="empty-dot"></span>空位</div>
        </div>
        <div class="roster-list">
          ${Hexcore2.state.captains.map((captain, index) => `
            <div class="team-mini ${captain.id === Hexcore2.selectors.currentCaptain().id ? 'active' : ''}">
              <div><span>${index + 1}</span><strong>${captain.name}</strong></div>
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
