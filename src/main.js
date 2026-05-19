const captains = [
  { id: 'c1', name: 'C1 夜阑', record: '1-1', filled: 2 },
  { id: 'c2', name: 'C2 星海', record: '1-2', filled: 1 },
  { id: 'c3', name: 'C3 烬灭', record: '2-2', filled: 3 },
  { id: 'c4', name: 'C4 龙牙', record: '2-11', filled: 2 },
  { id: 'c5', name: 'C5 无痕', record: '2-3', filled: 1 },
  { id: 'c6', name: 'C6 孤城', record: '2-10', filled: 2 },
  { id: 'c7', name: 'C7 神秘贤者', record: '当前', filled: 0 },
  { id: 'c8', name: 'C8 凌云', record: '待定', filled: 0 },
  { id: 'c9', name: 'C9 破晓', record: '待定', filled: 0 },
  { id: 'c10', name: 'C10 幻影', record: '待定', filled: 0 },
  { id: 'c11', name: 'C11 锋芒', record: '待定', filled: 0 },
  { id: 'c12', name: 'C12 逐风', record: '待定', filled: 0 },
];

const cards = [
  {
    lane: '上路',
    name: '青山隐',
    gameId: 'QS_Yin',
    score: 78,
    kda: '2.6',
    damage: '12.4K',
    winRate: '40%',
    heroes: ['影', '猎', '炮'],
  },
  {
    lane: '打野',
    name: '林深见鹿',
    gameId: 'LS_Deer',
    score: 85,
    kda: '4.1',
    damage: '15.8K',
    winRate: '60%',
    heroes: ['霜', '刃', '巫'],
  },
  {
    lane: '中路',
    name: '云外之人',
    gameId: 'YW_ZhiRen',
    score: 72,
    kda: '2.3',
    damage: '10.7K',
    winRate: '40%',
    heroes: ['夜', '术', '金'],
  },
];

const hexcores = [
  {
    id: 'origin',
    name: '启元',
    type: 'cyan',
    desc: '跳过当前队伍的抽卡阶段，立刻获得下一位顺位。',
    state: '使用',
  },
  {
    id: 'blind',
    name: '致盲吹箭',
    type: 'amber',
    desc: '使下一位队长本轮抽卡致盲一轮，选中后揭示。',
    state: '使用',
  },
  {
    id: 'double',
    name: '双发快射',
    type: 'violet',
    desc: '本轮抽卡数量 +1，但不能使用其他海克斯。',
    state: '已使用',
  },
];

const events = [
  ['14:31:52', '海克斯询问', 'C7 神秘贤者 询问可用海克斯', 'info'],
  ['14:31:48', '抽卡完成', 'C7 神秘贤者 抽取 3 张选手卡', 'draw'],
  ['14:31:20', '顺位变更', 'C3 烬灭 使用【启元】，顺延至第 2 位', 'warn'],
  ['14:30:55', '选手入队', 'C6 孤城 选择了选手「夜雨声烦」加入队伍（2/4）', 'success'],
  ['14:30:33', '海克斯询问', 'C6 孤城 询问可用海克斯', 'info'],
  ['14:30:29', '抽卡完成', 'C6 孤城 抽取 2 张选手卡', 'draw'],
  ['14:29:58', '选手入队', 'C5 无痕 选择了选手「风缝蝶吹」加入队伍（1/4）', 'success'],
  ['14:29:41', '海克斯询问', 'C5 无痕 询问可用海克斯', 'info'],
];

const state = {
  selectedCard: 1,
  activeCaptainIndex: 6,
  events: [...events],
  picked: false,
};

function icon(name) {
  const icons = {
    draft: '<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    team: '<path d="M16 21v-2a4 4 0 0 0-8 0v2"/><circle cx="12" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M2 21v-2a4 4 0 0 1 3-3.87"/>',
    users: '<circle cx="9" cy="7" r="4"/><path d="M17 11a4 4 0 1 0 0-8"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/>',
    hex: '<path d="M12 2 21 7v10l-9 5-9-5V7z"/><path d="M12 22V12M3 7l9 5 9-5"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    rule: '<path d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    log: '<path d="M4 4h16v16H4z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.12 2.12-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1 1.55V20h-3v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06-2.12-2.12.06-.06A1.7 1.7 0 0 0 5 15a1.7 1.7 0 0 0-1.55-1H3v-3h.45A1.7 1.7 0 0 0 5 10a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.12-2.12.06.06A1.7 1.7 0 0 0 8.66 6.34 1.7 1.7 0 0 0 9.66 4.8V4h3v.8a1.7 1.7 0 0 0 1 1.54 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.12 2.12-.06.06A1.7 1.7 0 0 0 19 10a1.7 1.7 0 0 0 1.55 1H21v3h-.45A1.7 1.7 0 0 0 19.4 15z"/>',
    cube: '<path d="M21 16V8l-9-5-9 5v8l9 5z"/><path d="M3.3 7.7 12 13l8.7-5.3M12 22V13"/>',
    pick: '<path d="m9 12 2 2 4-5"/><circle cx="12" cy="12" r="10"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-2"/>',
    refresh: '<path d="M21 12a9 9 0 0 1-15.5 6.2"/><path d="M3 12A9 9 0 0 1 18.5 5.8"/><path d="M18 2v4h-4M6 22v-4h4"/>',
  };

  return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.cube}</svg>`;
}

function addEvent(title, body, type = 'info') {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  state.events.unshift([time, title, body, type]);
  state.events = state.events.slice(0, 10);
}

function selectCard(index) {
  state.selectedCard = index;
  state.picked = false;
  render();
}

function drawCards() {
  state.picked = false;
  state.selectedCard = Math.floor(Math.random() * cards.length);
  addEvent('抽卡完成', `${captains[state.activeCaptainIndex].name} 抽取 3 张选手卡`, 'draw');
  render();
}

function pickCard() {
  const captain = captains[state.activeCaptainIndex];
  const card = cards[state.selectedCard];
  if (!state.picked && captain.filled < 4) {
    captain.filled += 1;
  }
  state.picked = true;
  addEvent('选手入队', `${captain.name} 选择了选手「${card.name}」加入队伍（${captain.filled}/4）`, 'success');
  render();
}

function nextCaptain() {
  state.activeCaptainIndex = (state.activeCaptainIndex + 1) % captains.length;
  state.selectedCard = 1;
  state.picked = false;
  addEvent('裁判操作', `进入 ${captains[state.activeCaptainIndex].name} 的选人环节`, 'info');
  render();
}

function useHexcore(index) {
  if (hexcores[index].state === '已使用') return;
  hexcores[index].state = '已使用';
  addEvent('海克斯激活', `${captains[state.activeCaptainIndex].name} 使用【${hexcores[index].name}】`, index === 1 ? 'warn' : 'info');
  render();
}

function sidebar() {
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
        <p>创建者：裁判组</p>
        <p>创建时间：2026-05-19 09:00</p>
      </div>
    </aside>
  `;
}

function topbar() {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  return `
    <header class="topbar">
      <div class="mode">裁判代执行</div>
      <div class="phase">当前阶段：<strong>第 2 轮 / 中等马池</strong></div>
      <div class="captain-title">当前队长：<strong>${captains[state.activeCaptainIndex].name}</strong></div>
      <div class="top-spacer"></div>
      <div class="live-status"><span></span>比赛进行中</div>
      <div class="clock">${time}</div>
      <button class="ghost-btn" onclick="window.hexcoreUI.drawCards()">${icon('refresh')}刷新</button>
    </header>
  `;
}

function turnOrder() {
  return `
    <section class="turn-panel">
      <div class="panel-title-row">
        <h2>顺位顺序 <span>当前第 2 轮</span></h2>
        <button class="subtle-btn">顺位详情</button>
      </div>
      <div class="turn-strip">
        ${captains.map((captain, index) => `
          <div class="turn-card ${index === state.activeCaptainIndex ? 'current' : ''} ${index < state.activeCaptainIndex ? 'done' : ''}">
            <strong>${captain.name}</strong>
            <span>${captain.record}</span>
          </div>
        `).join('')}
      </div>
      <div class="turn-note">顺位变更说明：第 1 轮 C3 使用【启元】优先，顺延至第 2 位；恶魔契约影响已计入。</div>
    </section>
  `;
}

function playerCards() {
  return `
    <section class="draw-panel">
      <div class="panel-title-row">
        <h2>本轮抽卡 <span>中等马池</span></h2>
        <button class="subtle-btn" onclick="window.hexcoreUI.drawCards()">${icon('refresh')}刷新池子</button>
      </div>
      <div class="cards-grid">
        ${cards.map((card, index) => `
          <button class="player-card ${index === state.selectedCard ? 'selected' : ''}" onclick="window.hexcoreUI.selectCard(${index})">
            <span class="card-index">${index + 1}</span>
            <span class="lane">${card.lane}</span>
            <span class="check">${index === state.selectedCard ? '✓' : ''}</span>
            <strong>${card.name}</strong>
            <small>ID: ${card.gameId}</small>
            <div class="score-row">评分 <b>${card.score}</b></div>
            <div class="history-title">历史表现（近5场）</div>
            <div class="stat-grid">
              <span>KDA<b>${card.kda}</b></span>
              <span>场均伤害<b>${card.damage}</b></span>
              <span>胜率<b>${card.winRate}</b></span>
            </div>
            <div class="hero-title">擅长英雄</div>
            <div class="hero-row">
              ${card.heroes.map(hero => `<span>${hero}</span>`).join('')}
            </div>
          </button>
        `).join('')}
      </div>
      <p class="hint">提示：请选择一名选手加入 ${captains[state.activeCaptainIndex].name} 的队伍（${captains[state.activeCaptainIndex].filled}/4）</p>
    </section>
  `;
}

function refereeControls() {
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
  return `
    <section class="hexcore-panel">
      <h2>${captains[state.activeCaptainIndex].name} 的海克斯</h2>
      <div class="hex-list">
        ${hexcores.map((hex, index) => `
          <div class="hex-row ${hex.type}">
            <div class="hex-symbol">${icon('hex')}</div>
            <div>
              <strong>${hex.name}</strong>
              <p>${hex.desc}</p>
              <span>可用次数：${hex.state === '已使用' ? 0 : 1}</span>
            </div>
            <button class="${hex.state === '已使用' ? 'used' : ''}" onclick="window.hexcoreUI.useHexcore(${index})">${hex.state}</button>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

function rulePanel() {
  return `
    <section class="rule-panel">
      <h2>规则说明</h2>
      <div class="rule-line amber"><strong>顺位原因：基础顺位</strong><span>未触发任何影响顺位的效果时，按基础顺序进行。</span></div>
      <div class="rule-line cyan"><strong>顺位原因：启元优先</strong><span>当队长使用【启元】后，立刻获得下一位顺位。</span></div>
      <div class="rule-line amber"><strong>顺位原因：恶魔契约影响</strong><span>若触发【恶魔契约】，顺位按规则调整，可能后移或交换。</span></div>
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
        ${state.events.map(([time, title, body, type]) => `
          <div class="event-item ${type}">
            <time>${time}</time>
            <div class="event-dot"></div>
            <div>
              <strong>${title}</strong>
              <p>${body}</p>
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
        ${captains.map((captain, index) => `
          <div class="team-mini ${index === state.activeCaptainIndex ? 'active' : ''}">
            <div><span>${index + 1}</span><strong>${captain.name}</strong></div>
            <p>${captain.filled}/4</p>
            <div class="slots">
              ${Array.from({ length: 4 }, (_, slot) => `<i class="${slot < captain.filled ? 'filled' : ''}"></i>`).join('')}
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

function render() {
  document.getElementById('app').innerHTML = app();
}

window.hexcoreUI = {
  selectCard,
  drawCards,
  pickCard,
  nextCaptain,
  useHexcore,
  skipTurn() {
    addEvent('裁判操作', `${captains[state.activeCaptainIndex].name} 跳过本轮选人`, 'warn');
    nextCaptain();
  },
  pause() {
    addEvent('裁判操作', '裁判暂停了选秀流程', 'warn');
    render();
  },
  undo() {
    addEvent('裁判操作', '撤销上一步操作，等待裁判确认', 'warn');
    render();
  },
};

render();
