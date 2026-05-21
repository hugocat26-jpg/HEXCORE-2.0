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
    if (draw && draw.pickMode === 'blind_box') return '盲盒抽卡';
    if (draw && draw.pickMode === 'hellhound') return '地狱三头犬连选';
    if (!draw || draw.pickMode !== 'open_pick') return '本轮抽卡';
    return '全池自选';
  }

  function drawTimeoutRemaining() {
    const draw = Hexcore2.state.draft.currentDraw;
    if (!draw || Hexcore2.state.draft.pickedThisTurn) return null;
    if (Hexcore2.state.draft.paused && draw.timeoutPausedRemainingMs !== undefined) {
      return Math.max(0, Math.ceil(Number(draw.timeoutPausedRemainingMs) / 1000));
    }
    if (!draw.timeoutEndsAt) return null;
    return Math.max(0, Math.ceil((draw.timeoutEndsAt - Date.now()) / 1000));
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

  function currentTheme() {
    const theme = Hexcore2.state.ui && Hexcore2.state.ui.theme;
    return ['default', 'neon', 'apple'].includes(theme) ? theme : 'default';
  }

  function applyTheme() {
    if (!document || !document.documentElement) return;
    document.documentElement.dataset.theme = currentTheme();
  }

  function hexcoreKindLabel(hexcore) {
    if (hexcore.mode === 'passive') return '策略';
    return '特殊';
  }

  function hexcoreTierLabel(hexcore) {
    const labels = { cyan: '白银', amber: '黄金', violet: '棱彩' };
    return labels[hexcore.type] || '海克斯';
  }

  function hexcoreGlyph(hexcore) {
    const glyphs = {
      'transmute-bronze': '&#10024;',
      'transmute-auric': '&#10024;',
      'transmute-prismatic': '&#10024;',
      origin: '&#128160;',
      'mystery-box': '&#127873;',
      blind: '&#127919;',
      'double-shot': '&#9889;',
      'last-stand': '&#128737;&#65039;',
      'lock-contract': '&#128279;',
      hellhound: '&#128293;',
      'elite-choice': '&#11088;',
      'giant-slayer': '&#128481;&#65039;',
      'ballroom-queen': '&#128081;',
      'demon-contract': '&#128220;',
      'decompose-knowledge': '&#128269;',
      'pandora-box': '&#127873;',
      'snow-cat': '&#10052;&#65039;',
      steady: '&#9878;&#65039;',
      'open-feast': '&#127860;',
      photographer: '&#128247;',
      'order-swap': '&#8644;',
    };
    return glyphs[hexcore.id] || '&#10022;';
  }

  function sidebar() {
    const icon = Hexcore2.icon;
    const teamCount = Hexcore2.selectors.teamCount();
    const playerCount = Hexcore2.state.players.length;
    const roundProgressLabel = Hexcore2.state.draft.phase === 'completed'
      ? '完成'
      : `${Hexcore2.state.draft.round}/${Hexcore2.state.draft.maxRounds}`;
    const tournamentLabel = Hexcore2.state.tournament.status === 'completed'
      ? '完成'
      : (Hexcore2.state.tournament.rounds.length ? `${Hexcore2.state.tournament.rounds.length}轮` : '未排');
    const activeView = (Hexcore2.state.ui && Hexcore2.state.ui.activeView) || 'draft';
    const items = [
      ['draft', 'draft', '实时抽选'],
      ['team', 'teams', '队伍管理'],
      ['users', 'players', '选手库'],
      ['hex', 'hexcores', '海克斯库'],
      ['calendar', 'schedule', '轮次进度'],
      ['trophy', 'tournament', '赛程'],
      ['rule', 'rules', '规则设置'],
      ['log', 'logs', '日志导出'],
      ['cog', 'settings', '系统设置'],
    ];

    return `
      <aside class="side-nav">
        <div class="brand">
          <span class="brand-mark">${icon('cube')}</span>
          <span>HEXCORE 2.0</span>
        </div>
        <div class="nav-section">选人抽卡控制台</div>
        <nav class="nav-list">
          ${items.map(([iconName, view, label]) => `
            <button class="nav-item ${activeView === view ? 'active' : ''}" onclick="window.hexcoreUI.setActiveView('${view}')">
              ${icon(iconName)}
              <span>${label}</span>
              ${view === 'teams' ? `<b class="nav-count">${teamCount} 队</b>` : ''}
              ${view === 'players' ? `<b class="nav-count">${playerCount} 人</b>` : ''}
              ${view === 'schedule' ? `<b class="nav-count">${roundProgressLabel}</b>` : ''}
              ${view === 'tournament' ? `<b class="nav-count">${tournamentLabel}</b>` : ''}
            </button>
          `).join('')}
        </nav>
        <div class="event-info">
          <div>流程信息</div>
          <p>项目名称：HEXCORE 2.0</p>
          <p>抽选规模：${teamCount} 队征召制</p>
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

  function feedbackToast() {
    const feedback = Hexcore2.state.ui && Hexcore2.state.ui.feedback;
    if (!feedback) return '';
    const createdAt = Number(feedback.createdAt || 0);
    const age = createdAt ? Date.now() - createdAt : 0;
    if (age >= 2200) return '';
    const fading = age >= 2000 ? 'fading' : '';
    return `
      <div class="feedback-toast ${eventLevelClass(feedback.level)} ${fading}">
        <strong>${escapeHtml(feedback.title)}</strong>
        <span>${escapeHtml(feedback.body)}</span>
      </div>
    `;
  }

  function addPlayerModal() {
    const ui = Hexcore2.state.ui || {};
    if (!ui.addPlayerModal) return '';
    return `
      <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="add-player-title">
        <section class="form-modal">
          <div class="modal-head">
            <div>
              <h2 id="add-player-title">新增选手</h2>
              <p>填写选手基础信息后再加入选手库。</p>
            </div>
            <button class="icon-close" aria-label="关闭新增选手弹窗" onclick="window.hexcoreUI.cancelAddPlayer()">×</button>
          </div>
          <div class="modal-form-grid">
            <label>
              <span>选手名称</span>
              <input id="add-player-name" placeholder="请输入选手名称">
            </label>
            <label>
              <span>位置</span>
              <input id="add-player-lane" placeholder="上路 / 打野 / 中路 / 下路 / 辅助">
            </label>
            <label>
              <span>评分</span>
              <input id="add-player-score" type="number" min="0" max="120" value="60">
            </label>
            <div class="modal-derived-note">
              <strong>卡池由系统安排</strong>
              <span>保存后系统会按所有非队长选手评分四等分，自动分配到四个卡池。</span>
            </div>
            <label class="modal-wide">
              <span>游戏ID</span>
              <input id="add-player-game-id" placeholder="可选，不填则系统自动生成">
            </label>
          </div>
          <div class="modal-actions">
            <button class="subtle-btn" onclick="window.hexcoreUI.cancelAddPlayer()">取消</button>
            <button class="primary-btn" onclick="window.hexcoreUI.confirmAddPlayer()">确认新增</button>
          </div>
        </section>
      </div>
    `;
  }

  function topbar() {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const captain = Hexcore2.selectors.currentCaptain();
    const tier = captain ? Hexcore2.poolEngine.effectiveTier(captain.id) : Hexcore2.selectors.roundTier(Hexcore2.state.draft.round);
    const tierName = Hexcore2.state.settings.tierNames[tier];
    const workflow = Hexcore2.selectors.workflowStatus();
    const statusText = !workflow.playersDraftReady
      ? '前置流程未完成'
      : Hexcore2.state.draft.phase === 'completed'
      ? '选人已完成'
      : (Hexcore2.state.draft.paused ? '流程已暂停' : '选人进行中');
    return `
      <header class="topbar">
        <div class="mode">裁判代执行</div>
        <div class="phase">当前阶段：<strong>第 ${Hexcore2.state.draft.round} 轮 / ${escapeHtml(tierName)}池</strong></div>
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

  function workflowGatePanel() {
    const workflow = Hexcore2.selectors.workflowStatus();
    if (workflow.playersDraftReady) return '';
    const missingCaptains = workflow.missingHexcoreCaptains
      .map(id => Hexcore2.state.captains.find(captain => captain.id === id))
      .filter(Boolean);
    return `
      <section class="workflow-gate">
        <div>
          <strong>实时抽选尚未开始</strong>
          <p>流程顺序固定为：先确定全部队长/队伍，再让所有队长抽满 3 个海克斯，最后进入队员抽卡选人。</p>
        </div>
        <div class="workflow-steps">
          <span class="${workflow.captainReady ? 'done' : 'pending'}">1 队长/队伍配置${workflow.captainReady ? '已完成' : '待完成'}</span>
          <span class="${workflow.hexcoreReady ? 'done' : 'pending'}">2 全部队长海克斯${workflow.hexcoreReady ? '已完成' : `待完成 ${missingCaptains.length} 队`}</span>
          <span class="pending">3 实时抽选队员</span>
        </div>
        ${missingCaptains.length ? `<p class="workflow-missing">未抽满海克斯：${missingCaptains.slice(0, 8).map(captain => escapeHtml(captain.name)).join('、')}${missingCaptains.length > 8 ? ' 等' : ''}</p>` : ''}
        <div class="workflow-actions">
          <button class="subtle-btn" onclick="window.hexcoreUI.setActiveView('teams')">检查队伍</button>
          <button class="primary-btn" onclick="window.hexcoreUI.setActiveView('hexcores')">进入海克斯抽取</button>
        </div>
      </section>
    `;
  }

  function playerCards() {
    const cards = currentCards();
    const captain = Hexcore2.selectors.currentCaptain();
    const selected = Hexcore2.state.draft.selectedSlot;
    const blinded = captain ? Hexcore2.hexcoreEngine.isBlinded(captain.id) : false;
    const infoBoost = captain ? Hexcore2.hexcoreEngine.infoBoostFor(captain.id) : null;
    const tier = captain ? Hexcore2.poolEngine.effectiveTier(captain.id) : Hexcore2.selectors.roundTier(Hexcore2.state.draft.round);
    const draw = Hexcore2.state.draft.currentDraw;
    const timeoutRemaining = drawTimeoutRemaining();
    function teamOwnerName(player) {
      if (!player || !player.teamId) return '';
      const owner = Hexcore2.state.captains.find(item => item.id === player.teamId);
      return owner ? owner.name : '';
    }
    return `
      <section class="draw-panel">
        <div class="panel-title-row">
          <h2>${escapeHtml(currentDrawLabel())} <span>${escapeHtml(Hexcore2.state.settings.tierNames[tier])}池${draw && draw.reason ? ` / ${escapeHtml(draw.reason)}` : ''}</span></h2>
          <button class="subtle-btn" onclick="window.hexcoreUI.drawCards()">${Hexcore2.icon('refresh')}刷新池子</button>
        </div>
        ${timeoutRemaining !== null ? `<div class="draw-timeout-bar ${Hexcore2.state.draft.paused ? 'paused' : ''}"><strong>${Hexcore2.state.draft.paused ? '已暂停' : '倒计时'} ${timeoutRemaining}s</strong><span>${Hexcore2.state.draft.paused ? '恢复后倒计时继续' : `结束未选择时，将从当前 ${cards.length} 张候选卡中随机入队`}</span></div>` : ''}
        <div class="cards-grid ${draw && draw.pickMode === 'open_pick' ? 'open-pick-grid' : ''}">
          ${cards.map(({ slot, player, realPlayer }, index) => `
            <button class="player-card ${index === selected ? 'selected' : ''} ${blinded ? 'blind-card' : ''} ${draw && draw.pickMode === 'mystery_swap' ? 'mystery-card' : ''}" onclick="window.hexcoreUI.selectCard(${index})">
              <span class="card-index">${index + 1}</span>
              <span class="lane">${blinded ? '致盲' : escapeHtml(player.lane)}</span>
              <span class="check">${index === selected ? '✓' : ''}</span>
              <strong>${blinded ? '身份隐藏' : escapeHtml(player.name)}</strong>
              <small>${blinded ? '选中后揭示' : `ID: ${escapeHtml(player.gameId)}${draw && draw.pickMode === 'mystery_swap' ? ' / 真实身份待揭示' : ''}${draw && draw.pickMode === 'blind_box' && realPlayer.status === 'drafted' ? ` / 已在 ${escapeHtml(teamOwnerName(realPlayer))}` : ''}`}</small>
              <div class="score-row">评分 <b>${blinded ? '??' : player.score}</b></div>
              ${infoBoost && !blinded ? `<div class="power-rank">战力顺位 <b>#${Hexcore2.hexcoreEngine.powerRank(realPlayer.id)}</b></div>` : ''}
              <div class="history-title">历史表现（近5场）</div>
              <div class="stat-grid">
                <span>KDA<b>${blinded ? '?' : escapeHtml(player.kda)}</b></span>
                <span>场均伤害<b>${blinded ? '?' : escapeHtml(player.damage)}</b></span>
                <span>胜率<b>${blinded ? '?' : escapeHtml(player.winRate)}</b></span>
              </div>
              <div class="hero-title">擅长英雄</div>
              <div class="hero-row">
                ${(blinded ? ['?', '?', '?'] : (player.heroes && player.heroes.length ? player.heroes : ['暂无', '暂无', '暂无'])).map(hero => `<span>${escapeHtml(hero)}</span>`).join('')}
              </div>
              ${draw && draw.pickMode === 'mystery_swap' && slot.displayPlayerId !== slot.playerId ? `<em>选择后揭示：真实选中并非当前展示身份</em>` : ''}
              ${draw && draw.pickMode === 'blind_box' && realPlayer.status === 'drafted' ? '<em>盲盒命中已选选手：选择后转队并补偿原队长</em>' : ''}
            </button>
          `).join('')}
        </div>
        <p class="hint">提示：${captain ? `${draw && draw.pickMode === 'open_pick' ? '开饭啦已展开当前池全部可选选手，' : ''}${draw && draw.pickMode === 'hellhound' ? `本段限时 ${escapeHtml(draw.timeLimitSeconds)} 秒，超时可随机分配，` : ''}请选择一名选手加入 ${escapeHtml(captain.name)} 的队伍（${Hexcore2.selectors.teamSize(captain.id)}/${Hexcore2.state.settings.playersPerTeam}）` : '当前没有可操作队长'}</p>
      </section>
    `;
  }

  function refereeControls() {
    const icon = Hexcore2.icon;
    const draw = Hexcore2.state.draft.currentDraw;
    const timeoutRemaining = drawTimeoutRemaining();
    const canTimeoutPick = Boolean(draw && draw.cards && draw.cards.length && !Hexcore2.state.draft.pickedThisTurn);
    return `
      <section class="control-panel">
        <h2>裁判操作</h2>
        <div class="control-grid">
          <button class="action-btn cyan" onclick="window.hexcoreUI.drawCards()">${icon('cube')}<strong>抽卡</strong><span>抽取本轮选手</span></button>
          <button class="action-btn green ${Hexcore2.state.draft.pickedThisTurn ? 'disabled' : ''}" onclick="window.hexcoreUI.pickCard()">${icon('pick')}<strong>${Hexcore2.state.draft.pickedThisTurn ? '已选择' : '选择此卡'}</strong><span>将选手加入队伍</span></button>
          <button class="action-btn amber ${canTimeoutPick ? '' : 'disabled'}" onclick="window.hexcoreUI.timeoutRandomPick()"><span class="fast-icon">⏱</span><strong>超时随机${timeoutRemaining !== null ? ` ${timeoutRemaining}s` : ''}</strong><span>从当前卡组随机</span></button>
          <button class="action-btn amber" onclick="window.hexcoreUI.skipTurn()"><span class="fast-icon">»</span><strong>跳过本轮</strong><span>不选择，跳过此轮</span></button>
          <button class="action-btn blue" onclick="window.hexcoreUI.nextCaptain()">${icon('team')}<strong>下一位</strong><span>交给下一队长</span></button>
          <button class="action-btn muted" onclick="window.hexcoreUI.pause()">${icon('pause')}<strong>${Hexcore2.state.draft.paused ? '继续' : '暂停'}</strong><span>${Hexcore2.state.draft.paused ? '继续选人流程' : '暂停选人流程'}</span></button>
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
    const teamPlayers = captain.team
      .map(playerId => playerById(playerId))
      .filter(Boolean);
    const availablePlayers = Hexcore2.state.players
      .filter(player => player.status === 'available')
      .sort((a, b) => b.score - a.score);
    const lockPairs = [];
    availablePlayers.forEach((first, firstIndex) => {
      availablePlayers.slice(firstIndex + 1).forEach(second => {
        lockPairs.push([first, second]);
      });
    });
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
            const globallyDisabled = !Hexcore2.selectors.isHexcoreEnabled(hex.id);
            const blindUsed = hex.id === 'blind' && Hexcore2.hexcoreEngine.blindUsedBy(captain.id);
            const snowUsed = hex.id === 'snow-cat' && Hexcore2.hexcoreEngine.snowCatUsedBy(captain.id);
            const pandoraDisabled = Hexcore2.hexcoreEngine.isDisabledByPandora(captain.id, hex.id);
            const isUsed = globallyDisabled || hex.mode === 'passive' || (hex.status === 'used' && hex.id !== 'blind' && hex.id !== 'snow-cat') || blindUsed || snowUsed || pandoraDisabled;
            return `
              <div class="hex-row ${hex.type} ${hex.id === 'blind' || hex.id === 'order-swap' || hex.id === 'decompose-knowledge' || hex.id === 'lock-contract' ? 'targetable' : ''}">
                <div class="hex-symbol">${Hexcore2.icon('hex')}</div>
                <div>
                  <strong>${escapeHtml(hex.name)}</strong>
                  <p>${escapeHtml(hex.desc)}</p>
                  <span>${globallyDisabled ? '规则设置：已禁用' : (pandoraDisabled ? '潘多拉魔盒：该效果失效' : (hex.mode === 'passive' ? '被动规则：自动生效' : (hex.id === 'blind' ? (blindUsed ? '本轮已使用' : '本轮可指定目标') : (hex.id === 'snow-cat' ? (snowUsed ? '本轮已使用' : '本轮可用') : `可用次数：${hex.status === 'used' ? 0 : hex.uses}`))))}</span>
                  ${hex.id === 'blind' && !blindUsed && !globallyDisabled ? `
                    <div class="target-grid">
                      ${blindTargets.map(target => `
                        <button onclick='window.hexcoreUI.useHexcore(${safeJsonString(hex.id)}, ${safeJsonString(target.id)})'>${escapeHtml(target.name)}</button>
                      `).join('') || '<span>本轮没有可致盲目标</span>'}
                    </div>
                  ` : ''}
                  ${hex.id === 'order-swap' && hex.status !== 'used' && !globallyDisabled ? `
                    <div class="target-grid pair-grid">
                      ${swapPairs.map(([first, second]) => `
                        <button onclick='window.hexcoreUI.useHexcore(${safeJsonString(hex.id)}, ${safeJsonString(first.id)}, ${safeJsonString(second.id)})'>${escapeHtml(first.name)} ↔ ${escapeHtml(second.name)}</button>
                      `).join('')}
                    </div>
                  ` : ''}
                  ${hex.id === 'decompose-knowledge' && hex.status !== 'used' && !globallyDisabled ? `
                    <div class="target-grid">
                      ${teamPlayers.map(player => `
                        <button onclick='window.hexcoreUI.useHexcore(${safeJsonString(hex.id)}, ${safeJsonString(player.id)})'>${escapeHtml(player.name)}</button>
                      `).join('') || '<span>至少拥有1名选手后可用</span>'}
                    </div>
                  ` : ''}
                  ${hex.id === 'lock-contract' && hex.status !== 'used' && !globallyDisabled ? `
                    <div class="target-grid pair-grid">
                      ${lockPairs.map(([first, second]) => `
                        <button onclick='window.hexcoreUI.useHexcore(${safeJsonString(hex.id)}, ${safeJsonString(first.id)}, ${safeJsonString(second.id)})'>${escapeHtml(first.name)} ↔ ${escapeHtml(second.name)}</button>
                      `).join('') || '<span>当前没有足够可绑定选手</span>'}
                    </div>
                  ` : ''}
                </div>
                <button class="${isUsed ? 'used' : ''}" ${globallyDisabled || hex.mode === 'passive' || blindUsed || snowUsed || pandoraDisabled || hex.id === 'blind' || hex.id === 'order-swap' || hex.id === 'decompose-knowledge' || hex.id === 'lock-contract' ? 'disabled' : ''} onclick='window.hexcoreUI.useHexcore(${safeJsonString(hex.id)})'>${globallyDisabled ? '已禁用' : (hex.mode === 'passive' ? '被动' : (isUsed ? (pandoraDisabled ? '失效' : '已使用') : (hex.id === 'blind' || hex.id === 'order-swap' || hex.id === 'decompose-knowledge' || hex.id === 'lock-contract' ? '选下方' : '使用')))}</button>
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
    const ui = Hexcore2.state.ui || {};
    const filter = ui.eventFilter || 'all';
    const captainFilter = ui.eventCaptainFilter || 'all';
    const eventSearch = ui.eventSearch || '';
    const filteredEvents = Hexcore2.exportService.filteredEvents();

    return `
      <aside class="event-rail">
        <div class="panel-title-row">
          <h2>事件日志</h2>
          <select aria-label="事件筛选" onchange="window.hexcoreUI.setEventFilter(this.value)">
            <option value="all" ${filter === 'all' ? 'selected' : ''}>全部事件</option>
            <option value="hexcore" ${filter === 'hexcore' ? 'selected' : ''}>海克斯</option>
            <option value="team" ${filter === 'team' ? 'selected' : ''}>选手入队</option>
            <option value="draw" ${filter === 'draw' ? 'selected' : ''}>抽卡</option>
            <option value="warning" ${filter === 'warning' ? 'selected' : ''}>警告</option>
          </select>
        </div>
        <div class="event-filter-grid">
          <select aria-label="队长筛选" onchange="window.hexcoreUI.setEventCaptainFilter(this.value)">
            <option value="all" ${captainFilter === 'all' ? 'selected' : ''}>全部队长</option>
            ${Hexcore2.state.captains.map(captain => `<option value="${captain.id}" ${captainFilter === captain.id ? 'selected' : ''}>${escapeHtml(captain.name)}</option>`).join('')}
          </select>
          <label>
            <input id="event-search" value="${escapeHtml(eventSearch)}" placeholder="搜索事件关键词" onkeydown="if(event.key === 'Enter') window.hexcoreUI.setEventSearch()">
            <button onclick="window.hexcoreUI.setEventSearch()">搜索</button>
          </label>
        </div>
        <p class="event-count">当前筛选 ${filteredEvents.length}/${Hexcore2.state.events.length} 条</p>
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
        <div class="roster-list">
          ${Hexcore2.state.captains.map((captain, index) => `
            <div class="team-mini ${currentCaptain && captain.id === currentCaptain.id ? 'active' : ''}">
              <div><span>${index + 1}</span><strong>${escapeHtml(captain.name)}</strong></div>
              <p>${captain.team.length}/${Hexcore2.state.settings.playersPerTeam}</p>
              <div class="slots">
                ${Array.from({ length: Hexcore2.state.settings.playersPerTeam }, (_, slot) => `<i class="${slot < captain.team.length ? 'filled' : ''}"></i>`).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      </footer>
    `;
  }

  function pageHeader(title, subtitle) {
    return `
      <section class="page-header">
        <div>
          <h1>${escapeHtml(title)}</h1>
          <p>${escapeHtml(subtitle)}</p>
        </div>
        <button class="subtle-btn" onclick="window.hexcoreUI.setActiveView('draft')">${Hexcore2.icon('draft')}返回实时抽选</button>
      </section>
    `;
  }

  function teamsPage() {
    const currentCaptain = Hexcore2.selectors.currentCaptain();
    const availablePlayers = Hexcore2.state.players
      .filter(player => player.status === 'available')
      .sort((a, b) => b.score - a.score);
    function teamStatus(captain) {
      if (captain.team.length > Hexcore2.state.settings.playersPerTeam) return { label: '异常：超员', className: 'warn' };
      const missingPlayers = captain.team.filter(playerId => !playerById(playerId));
      if (missingPlayers.length) return { label: '异常：缺失选手', className: 'warn' };
      if (captain.team.length === Hexcore2.state.settings.playersPerTeam) return { label: '满员', className: 'done' };
      return { label: `缺员 ${Hexcore2.state.settings.playersPerTeam - captain.team.length}`, className: 'pending' };
    }
    return `
      ${pageHeader('队伍管理', '裁判可调整队伍、切换当前队伍、重命名队伍并处理队员归属。')}
      <section class="data-panel teams-panel">
        <div class="toolbar-row team-toolbar">
          <div>
            <strong>当前 ${Hexcore2.selectors.teamCount()} 队，允许 ${Hexcore2.state.settings.minTeams}-${Hexcore2.state.settings.maxTeams} 队</strong>
            <span>队伍增删会重算基础顺位，并清空当前抽卡结果。</span>
          </div>
          <div class="toolbar-actions">
            <input id="teams-team-count" type="number" min="${Hexcore2.state.settings.minTeams}" max="${Hexcore2.state.settings.maxTeams}" value="${Hexcore2.selectors.teamCount()}" aria-label="队伍数量">
            <button class="subtle-btn" onclick="window.hexcoreUI.updateTeamCountFromTeams()">应用数量</button>
            <button class="primary-btn" onclick="window.hexcoreUI.addCaptain()">${Hexcore2.icon('team')}新增队伍</button>
          </div>
        </div>
        <div class="metrics-grid">
          <div><span>满员队伍</span><strong>${Hexcore2.state.captains.filter(captain => captain.team.length === Hexcore2.state.settings.playersPerTeam).length}</strong></div>
          <div><span>缺员队伍</span><strong>${Hexcore2.state.captains.filter(captain => captain.team.length < Hexcore2.state.settings.playersPerTeam).length}</strong></div>
          <div><span>异常队伍</span><strong>${Hexcore2.state.captains.filter(captain => captain.team.length > Hexcore2.state.settings.playersPerTeam || captain.team.some(playerId => !playerById(playerId))).length}</strong></div>
          <div><span>可补录选手</span><strong>${availablePlayers.length}</strong></div>
        </div>
        <div class="data-grid team-grid">
          ${Hexcore2.state.captains.map((captain, index) => {
            const basePosition = Hexcore2.state.draft.baseOrder.indexOf(captain.id) + 1;
            const status = teamStatus(captain);
            const captainPlayer = playerById(captain.playerId);
            return `
            <article class="data-card ${currentCaptain && currentCaptain.id === captain.id ? 'active-card' : ''}">
              <div class="data-card-head">
                <span>${index + 1}</span>
                <label class="captain-name-field">
                  <small>队伍名称</small>
                  <input id="captain-name-${escapeHtml(captain.id)}" value="${escapeHtml(captain.name)}" aria-label="${escapeHtml(captain.name)} 队伍名称">
                </label>
              </div>
              <p>状态：<em class="${status.className}">${escapeHtml(status.label)}</em></p>
              <p>顺位记录：${escapeHtml(captain.record)} / 基础顺位第 ${basePosition}</p>
              <p>队伍人数：${captain.team.length}/${Hexcore2.state.settings.playersPerTeam}</p>
              <div class="order-tools">
                <div class="order-tools-head">
                  <span>基础顺位</span>
                  <strong>第 ${basePosition} 位</strong>
                </div>
                <div class="order-button-row">
                  <button class="subtle-btn icon-order-btn" title="顺位上移" onclick='window.hexcoreUI.moveCaptainOrder(${safeJsonString(captain.id)}, "up")'>${Hexcore2.icon('arrowUp')}</button>
                  <button class="subtle-btn icon-order-btn" title="顺位下移" onclick='window.hexcoreUI.moveCaptainOrder(${safeJsonString(captain.id)}, "down")'>${Hexcore2.icon('arrowDown')}</button>
                  <label class="order-position-field">
                    <small>设为</small>
                    <input id="captain-order-${escapeHtml(captain.id)}" type="number" min="1" max="${Hexcore2.state.captains.length}" value="${basePosition}">
                  </label>
                  <button class="subtle-btn order-apply-btn" onclick='window.hexcoreUI.setCaptainOrderPosition(${safeJsonString(captain.id)})'>应用</button>
                </div>
              </div>
              <div class="member-list">
                <article class="team-member captain-member ${captainPlayer ? '' : 'empty-captain-member'}">
                  <div>
                    <strong>${captainPlayer ? escapeHtml(captainPlayer.name) : '待指定队长'}</strong>
                    <span>${captainPlayer ? '队长 · 固定第一位' : '尚未指定队长'}</span>
                    <small>${captainPlayer ? `ID：${escapeHtml(captainPlayer.gameId || captainPlayer.id)}` : `队伍编号：${escapeHtml(captain.id)}`}</small>
                  </div>
                </article>
                ${Array.from({ length: Hexcore2.state.settings.playersPerTeam }, (_, slotIndex) => {
                  const playerId = captain.team[slotIndex];
                  const player = playerById(playerId);
                  return player ? `
                    <article class="team-member">
                      <div>
                        <strong>${escapeHtml(player.name)}</strong>
                        <span>${escapeHtml(player.lane || '未知')} · ${escapeHtml(Hexcore2.state.settings.tierNames[player.tier] || '未知卡池')} · 评分 ${player.score}</span>
                        <small>ID：${escapeHtml(player.gameId || player.id)}</small>
                      </div>
                      <button onclick='window.hexcoreUI.removePlayerFromTeam(${safeJsonString(captain.id)}, ${safeJsonString(player.id)})'>移回池</button>
                    </article>
                  ` : `
                    <article class="team-member empty-member">
                      <div>
                        <strong>空位 ${slotIndex + 1}</strong>
                        <span>等待抽卡或补录队员</span>
                        <small>当前未满员</small>
                      </div>
                    </article>
                  `;
                }).join('')}
              </div>
              <div class="backfill-tools">
                <select id="team-add-player-${escapeHtml(captain.id)}" aria-label="${escapeHtml(captain.name)} 补录选手">
                  <option value="">选择可补录选手</option>
                  ${availablePlayers.map(player => `<option value="${player.id}">${escapeHtml(player.name)} · ${escapeHtml(player.lane || '未知')} · ${escapeHtml(Hexcore2.state.settings.tierNames[player.tier])} · ${player.score}</option>`).join('')}
                </select>
                <button onclick='window.hexcoreUI.assignPlayerToTeam(${safeJsonString(captain.id)})'>补录队员</button>
              </div>
              <div class="card-actions">
                <button onclick='window.hexcoreUI.setCurrentCaptain(${safeJsonString(captain.id)})'>设为当前</button>
                <button onclick='window.hexcoreUI.saveCaptainName(${safeJsonString(captain.id)})'>保存名称</button>
                <button class="danger-inline" onclick='window.hexcoreUI.removeCaptain(${safeJsonString(captain.id)})'>删除</button>
              </div>
            </article>
          `;
          }).join('')}
        </div>
      </section>
    `;
  }

  function playersPage() {
    const tierNames = Hexcore2.state.settings.tierNames;
    const filter = (Hexcore2.state.ui && Hexcore2.state.ui.playerFilter) || 'all';
    const requiredByTier = [1, 2, 3, 4].reduce((result, tier) => {
      const rounds = Hexcore2.state.settings.roundTiers.filter(item => Number(item) === tier).length;
      result[tier] = rounds * Hexcore2.selectors.teamCount();
      return result;
    }, {});
    const captainPoolCount = Hexcore2.state.players.filter(player => player.tier === 0).length;
    const poolStats = [1, 2, 3, 4].map(tier => {
      const players = Hexcore2.state.players.filter(player => player.tier === tier);
      const enabled = players.filter(player => player.status !== 'disabled').length;
      const available = players.filter(player => player.status === 'available').length;
      const required = requiredByTier[tier] || 0;
      return { tier, enabled, available, required, ok: enabled >= required };
    });
    function visiblePlayer(player) {
      if (filter === 'all') return true;
      if (filter === 'available') return player.status === 'available';
      if (filter === 'drafted') return player.status === 'drafted';
      if (filter === 'disabled') return player.status === 'disabled';
      return Number(filter) === player.tier;
    }
    return `
      ${pageHeader('选手库', '按卡池查看选手状态、评分、位置和归属队伍。')}
      <section class="data-panel">
        <div class="toolbar-row">
          <div>
            <strong>选手总数：${Hexcore2.state.players.length}</strong>
            <span>可选 ${Hexcore2.state.players.filter(player => player.status === 'available').length} 人，已入队 ${Hexcore2.state.players.filter(player => player.status === 'drafted').length} 人。卡池由系统按评分四等分自动安排。</span>
          </div>
          <div class="toolbar-actions">
            <select aria-label="选手筛选" onchange="window.hexcoreUI.setPlayerFilter(this.value)">
              <option value="all" ${filter === 'all' ? 'selected' : ''}>全部选手</option>
              <option value="available" ${filter === 'available' ? 'selected' : ''}>仅可选</option>
              <option value="drafted" ${filter === 'drafted' ? 'selected' : ''}>仅已入队</option>
              <option value="disabled" ${filter === 'disabled' ? 'selected' : ''}>仅禁用</option>
              <option value="0" ${filter === '0' ? 'selected' : ''}>队长专属池</option>
              <option value="1" ${filter === '1' ? 'selected' : ''}>侏儒马池</option>
              <option value="2" ${filter === '2' ? 'selected' : ''}>中等马池</option>
              <option value="3" ${filter === '3' ? 'selected' : ''}>上等马池</option>
              <option value="4" ${filter === '4' ? 'selected' : ''}>猛犸池</option>
            </select>
            <button class="primary-btn" onclick="window.hexcoreUI.addPlayer()">新增选手</button>
            <button class="subtle-btn" onclick="document.getElementById('player-import-input').click()">导入 JSON/CSV</button>
            <button class="danger-inline" onclick="window.hexcoreUI.clearAllPlayers()">清空所有选手</button>
            <input id="player-import-input" type="file" accept=".json,.csv,application/json,text/csv" hidden onchange="window.hexcoreUI.importPlayers(this.files[0]); this.value = ''">
          </div>
        </div>
        <div class="pool-health-grid">
          <div class="captain-pool-stat">
            <span>${escapeHtml(tierNames[0])}</span>
            <strong>${captainPoolCount}</strong>
            <small>队长自动移出普通卡池</small>
          </div>
          ${poolStats.map(stat => `
            <div class="${stat.ok ? 'ok' : 'warn'}">
              <span>${escapeHtml(tierNames[stat.tier])}</span>
              <strong>${stat.enabled}/${stat.required}</strong>
              <small>可选 ${stat.available} · ${stat.ok ? '数量足够' : '数量不足'}</small>
            </div>
          `).join('')}
        </div>
        <p class="system-pool-note">卡池等级不可手动设置。系统会先把队长选手移入队长专属卡池，再按剩余选手评分从高到低四等分：猛犸、上等马、中等马、侏儒马。</p>
        <div class="pool-columns">
          ${[0, 1, 2, 3, 4].map(tier => `
            <div class="pool-column">
              <h2>${escapeHtml(tierNames[tier])}池</h2>
              ${Hexcore2.state.players.filter(player => player.tier === tier && visiblePlayer(player)).map(player => {
                const owner = player.teamId ? Hexcore2.state.captains.find(captain => captain.id === player.teamId) : null;
                const isCaptain = player.status === 'captain';
                const canPromote = player.status !== 'disabled' && !isCaptain;
                const editingGameId = Hexcore2.state.ui && Hexcore2.state.ui.editingGameIdPlayerId === player.id;
                const editingName = Hexcore2.state.ui && Hexcore2.state.ui.editingNamePlayerId === player.id;
                return `
                  <article class="player-row ${player.status === 'disabled' ? 'disabled-player' : ''} ${isCaptain ? 'captain-player-row' : ''}">
                    <div class="player-card-head">
                      <div>
                        <span class="player-name-line">
                          ${editingName ? `
                            <input class="player-name-editor" id="player-display-name-${escapeHtml(player.id)}" value="${escapeHtml(player.name || '')}" onblur='window.hexcoreUI.savePlayerName(${safeJsonString(player.id)})' onkeydown='if(event.key==="Enter") window.hexcoreUI.savePlayerName(${safeJsonString(player.id)}); if(event.key==="Escape") window.hexcoreUI.cancelPlayerNameEdit()'>
                          ` : `
                            <strong>${escapeHtml(player.name)}</strong>
                          `}
                          ${editingName ? '' : `<button class="inline-edit-btn name-edit-btn" title="编辑选手名称" onclick='window.hexcoreUI.editPlayerName(${safeJsonString(player.id)})'>${Hexcore2.icon('edit')}</button>`}
                        </span>
                        ${editingGameId ? `
                          <input class="game-id-editor" id="player-game-id-${escapeHtml(player.id)}" value="${escapeHtml(player.gameId || '')}" onblur='window.hexcoreUI.savePlayerGameId(${safeJsonString(player.id)})' onkeydown='if(event.key==="Enter") window.hexcoreUI.savePlayerGameId(${safeJsonString(player.id)}); if(event.key==="Escape") window.hexcoreUI.cancelPlayerGameIdEdit()'>
                        ` : `
                          <span class="game-id-line">
                            <span class="game-id-display">${escapeHtml(player.gameId || '无游戏ID')}</span>
                            <button class="inline-edit-btn game-id-edit-btn" title="编辑游戏ID" onclick='window.hexcoreUI.editPlayerGameId(${safeJsonString(player.id)})'>${Hexcore2.icon('edit')}</button>
                          </span>
                        `}
                      </div>
                      <em class="${isCaptain ? 'captain' : (player.status === 'available' ? 'available' : (player.status === 'disabled' ? 'disabled' : 'drafted'))}">${isCaptain ? '队长专属' : (player.status === 'available' ? '可选' : (player.status === 'disabled' ? '已禁用' : `已入队${owner ? `：${escapeHtml(owner.name)}` : ''}`))}</em>
                    </div>
                    <div class="player-edit-grid">
                      <label><small>偏好位置</small><input id="player-lane-${escapeHtml(player.id)}" value="${escapeHtml(player.lane || '未知')}" onblur='window.hexcoreUI.autoSavePlayerIfChanged(${safeJsonString(player.id)})' onkeydown='if(event.key==="Enter") window.hexcoreUI.savePlayer(${safeJsonString(player.id)})'></label>
                      <label><small>绝活英雄</small><input id="player-heroes-${escapeHtml(player.id)}" value="${escapeHtml((player.heroes || []).join('、'))}" placeholder="用顿号分隔" onblur='window.hexcoreUI.autoSavePlayerIfChanged(${safeJsonString(player.id)})' onkeydown='if(event.key==="Enter") window.hexcoreUI.savePlayer(${safeJsonString(player.id)})'></label>
                      <label class="manifesto-field"><small>参赛宣言</small><textarea id="player-manifesto-${escapeHtml(player.id)}" rows="2" placeholder="填写这名选手的参赛宣言" onblur='window.hexcoreUI.autoSavePlayerIfChanged(${safeJsonString(player.id)})'>${escapeHtml(player.manifesto || '')}</textarea></label>
                      <div class="readonly-score"><span>评分</span><strong>${escapeHtml(player.score || 0)}</strong></div>
                    </div>
                    <div class="player-actions">
                      ${canPromote ? `<button class="promote-inline" onclick='window.hexcoreUI.promotePlayerToCaptain(${safeJsonString(player.id)})'>设为队长</button>` : '<button disabled>队长锁定</button>'}
                      ${isCaptain ? '' : `<button class="${player.status === 'disabled' ? '' : 'danger-inline'}" onclick='window.hexcoreUI.togglePlayerDisabled(${safeJsonString(player.id)})'>${player.status === 'disabled' ? '恢复' : '禁用'}</button>`}
                      <button class="danger-inline" onclick='window.hexcoreUI.deletePlayer(${safeJsonString(player.id)})'>删除</button>
                    </div>
                  </article>
                `;
              }).join('') || '<div class="empty-log">暂无选手</div>'}
            </div>
          `).join('')}
        </div>
      </section>
    `;
  }

  function hexcoresPage() {
    const captain = Hexcore2.selectors.currentCaptain();
    const selectedCaptainId = (Hexcore2.state.ui && Hexcore2.state.ui.hexCaptainId) || (captain && captain.id) || '';
    const selectedCaptain = Hexcore2.state.captains.find(item => item.id === selectedCaptainId) || captain;
    const ownedHexcores = selectedCaptain ? (Hexcore2.state.hexcoreAssignments[selectedCaptain.id] || []) : [];
    const session = Hexcore2.state.hexcoreDraft || {};
    const activeSession = selectedCaptain && session.captainId === selectedCaptain.id && session.slots && session.slots.length;
    const drawOrder = session.drawOrder || [];
    const nextCaptain = selectedCaptain
      ? Hexcore2.state.captains.find(captain => captain.id !== selectedCaptain.id && (Hexcore2.state.hexcoreAssignments[captain.id] || []).length < 3)
      : null;
    const hexFilter = (Hexcore2.state.ui && Hexcore2.state.ui.hexFilter) || 'all';
    const visibleHexcores = Hexcore2.sampleData.hexcores.filter(hex => {
      if (hexFilter === 'all') return true;
      if (hexFilter === 'manual') return hex.mode !== 'passive';
      if (hexFilter === 'passive') return hex.mode === 'passive';
      return hex.type === hexFilter;
    });
    return `
      ${pageHeader('海克斯库', '流程与旧项目一致：每次为队长随机生成 3 个海克斯选项，队长三选一，选满 3 个为止。')}
      <section class="data-panel">
        <div class="toolbar-row">
          <div>
            <strong>操作队长：${selectedCaptain ? escapeHtml(selectedCaptain.name) : '无'}</strong>
            <span>当前阶段由裁判代执行抽取，队长口头选择后裁判点击确认。</span>
          </div>
          <div class="toolbar-actions">
            <select aria-label="选择海克斯队长" onchange="window.hexcoreUI.setHexCaptain(this.value)">
              ${Hexcore2.state.captains.map(item => `<option value="${item.id}" ${selectedCaptain && selectedCaptain.id === item.id ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}
            </select>
            <select aria-label="海克斯筛选" onchange="window.hexcoreUI.setHexFilter(this.value)">
              <option value="all" ${hexFilter === 'all' ? 'selected' : ''}>全部海克斯</option>
              <option value="manual" ${hexFilter === 'manual' ? 'selected' : ''}>手动效果</option>
              <option value="passive" ${hexFilter === 'passive' ? 'selected' : ''}>被动效果</option>
              <option value="cyan" ${hexFilter === 'cyan' ? 'selected' : ''}>青铜/功能</option>
              <option value="amber" ${hexFilter === 'amber' ? 'selected' : ''}>黄金/干扰</option>
              <option value="violet" ${hexFilter === 'violet' ? 'selected' : ''}>棱彩/强力</option>
            </select>
            <button class="primary-btn" onclick='window.hexcoreUI.drawHexcoreForCaptain(${safeJsonString(selectedCaptain ? selectedCaptain.id : '')})'>${Hexcore2.icon('hex')}抽取 3 个候选</button>
            <button class="primary-btn" onclick="window.hexcoreUI.randomizeHexcoreDrawOrder()">${Hexcore2.icon('refresh')}制定抽取顺序</button>
            <button class="primary-btn" onclick="window.hexcoreUI.resetAllHexcores()">${Hexcore2.icon('undo')}重置所有海克斯</button>
          </div>
        </div>
        ${drawOrder.length ? `
          <div class="hex-draw-order">
            <strong>抽取顺序</strong>
            ${drawOrder.map((captainId, index) => {
              const item = Hexcore2.state.captains.find(captain => captain.id === captainId);
              return item ? `<span>${index + 1}. ${escapeHtml(item.name)}</span>` : '';
            }).join('')}
          </div>
        ` : ''}
        <div class="hex-draw-session">
          ${activeSession ? `
            <div class="hex-session-head">
              <strong>${escapeHtml(selectedCaptain.name)} 已拥有 ${ownedHexcores.length}/3，还需选 ${Math.max(0, 3 - ownedHexcores.length)} 个</strong>
              <button class="primary-btn" onclick="window.hexcoreUI.cancelHexcoreDraw()">${Hexcore2.icon('undo')}取消本次抽取</button>
            </div>
            <div class="hex-draw-slots">
              ${session.slots.map((hexcoreId, index) => {
                const hex = Hexcore2.sampleData.hexcores.find(item => item.id === hexcoreId);
                if (!hex) return '';
                return `
                  <article class="hex-draw-card ${escapeHtml(hex.type)}">
                    <div class="hex-draw-badges">
                      <span class="hex-kind-badge">${hexcoreKindLabel(hex)}</span>
                      <span class="hex-tier-pill">${hexcoreTierLabel(hex)}</span>
                    </div>
                    <div class="hex-card-figure" aria-hidden="true">${hexcoreGlyph(hex)}</div>
                    <h3>${escapeHtml(hex.name)}</h3>
                    <p>${escapeHtml(hex.desc)}</p>
                    <div class="hex-execution-note">▲ ${hex.mode === 'passive' ? '被动自动生效' : '需要裁判执行'}</div>
                    <div class="hex-draw-actions">
                      <button class="hex-refresh-btn" ${session.refreshUsed ? 'disabled' : ''} onclick="window.hexcoreUI.refreshHexcoreSlot(${index})">换一张</button>
                      <button class="primary-btn hex-select-btn" onclick='window.hexcoreUI.selectHexcoreFromDraw(${safeJsonString(selectedCaptain.id)}, ${safeJsonString(hex.id)})'>选择此海克斯</button>
                    </div>
                  </article>
                `;
              }).join('')}
            </div>
          ` : `
            <div class="hex-session-empty">
              ${selectedCaptain ? `${escapeHtml(selectedCaptain.name)} 当前没有进行中的三选一。点击“抽取 3 个候选”开始。` : '请选择队长'}
            </div>
          `}
        </div>
        <div class="owned-hex-panel">
          <h2>已持有海克斯</h2>
          <div class="owned-hex-list">
            ${ownedHexcores.map(hex => `
              <span>${escapeHtml(hex.name)} <button onclick='window.hexcoreUI.removeHexcore(${safeJsonString(selectedCaptain.id)}, ${safeJsonString(hex.id)})'>移除</button></span>
            `).join('') || '<em>暂无海克斯</em>'}
          </div>
        </div>
        <div class="hex-library">
          ${visibleHexcores.map(hex => `
            <article class="hex-library-card ${escapeHtml(hex.type)}">
              <div>
                <strong>${escapeHtml(hex.name)}</strong>
                <span>${hex.mode === 'passive' ? '被动自动' : '裁判手动'}</span>
              </div>
              <p>${escapeHtml(hex.desc)}</p>
              <button onclick='window.hexcoreUI.assignHexcoreToCaptain(${safeJsonString(selectedCaptain ? selectedCaptain.id : '')}, ${safeJsonString(hex.id)})'>裁判兜底分配</button>
            </article>
          `).join('')}
        </div>
      </section>
    `;
  }

  function schedulePage() {
    function roundStatus(captain, round) {
      if (captain.team.length >= round) return { label: '已完成', className: 'done' };
      if (Hexcore2.state.draft.round === round && Hexcore2.selectors.currentCaptain() && Hexcore2.selectors.currentCaptain().id === captain.id) {
        return { label: '当前', className: 'current' };
      }
      if (captain.team.length >= Hexcore2.state.settings.playersPerTeam) return { label: '满员', className: 'done' };
      return { label: '待处理', className: 'pending' };
    }

    return `
      ${pageHeader('轮次进度', '查看当前抽选轮次、顺位和选人完成度，并支持裁判跳转到指定队长。')}
      <section class="data-panel">
        <div class="metrics-grid">
          <div><span>当前轮次</span><strong>${Hexcore2.state.draft.round}/${Hexcore2.state.draft.maxRounds}</strong></div>
          <div><span>有效队伍</span><strong>${Hexcore2.selectors.teamCount()}</strong></div>
          <div><span>已入队选手</span><strong>${Hexcore2.state.players.filter(player => player.status === 'drafted').length}</strong></div>
          <div><span>流程状态</span><strong>${Hexcore2.state.draft.paused ? '已暂停' : '进行中'}</strong></div>
        </div>
        ${turnOrder()}
        <div class="schedule-matrix">
          <div class="schedule-row schedule-head" style="grid-template-columns: minmax(160px, 1.2fr) repeat(${Hexcore2.state.draft.maxRounds}, minmax(120px, 1fr));">
            <strong>队长</strong>
            ${Array.from({ length: Hexcore2.state.draft.maxRounds }, (_, index) => `<strong>第 ${index + 1} 轮</strong>`).join('')}
          </div>
          ${Hexcore2.state.captains.map(captain => `
            <div class="schedule-row" style="grid-template-columns: minmax(160px, 1.2fr) repeat(${Hexcore2.state.draft.maxRounds}, minmax(120px, 1fr));">
              <strong>${escapeHtml(captain.name)}</strong>
              ${Array.from({ length: Hexcore2.state.draft.maxRounds }, (_, index) => {
                const round = index + 1;
                const status = roundStatus(captain, round);
                return `
                  <button class="schedule-cell ${status.className}" onclick='window.hexcoreUI.jumpToScheduleSlot(${round}, ${safeJsonString(captain.id)})'>
                    <span>${status.label}</span>
                    <small>跳转</small>
                  </button>
                `;
              }).join('')}
            </div>
          `).join('')}
        </div>
      </section>
    `;
  }

  function tournamentPage() {
    const tournament = Hexcore2.state.tournament || { status: 'empty', rounds: [], championId: '' };
    const captainName = captainId => {
      const captain = Hexcore2.state.captains.find(item => item.id === captainId);
      return captain ? captain.name : '待定';
    };
    const completedMatches = tournament.rounds.reduce((sum, round) =>
      sum + round.matches.filter(match => match.status === 'completed' || match.status === 'bye').length, 0);
    const totalMatches = tournament.rounds.reduce((sum, round) => sum + round.matches.length, 0);
    const championName = tournament.championId ? captainName(tournament.championId) : '未产生';
    const statusText = tournament.status === 'completed' ? '已完成' : (tournament.rounds.length ? '进行中' : '未排赛程');

    return `
      ${pageHeader('赛程', '为抽卡选人结束后的队伍安排淘汰赛赛程，录入比分后系统自动晋级胜者。')}
      <section class="data-panel">
        <div class="metrics-grid">
          <div><span>参赛队伍</span><strong>${Hexcore2.selectors.teamCount()}</strong></div>
          <div><span>赛程状态</span><strong>${statusText}</strong></div>
          <div><span>已完成场次</span><strong>${completedMatches}/${totalMatches || 0}</strong></div>
          <div><span>冠军队伍</span><strong>${escapeHtml(championName)}</strong></div>
        </div>
        <div class="toolbar-row">
          <button class="primary-btn" onclick="window.hexcoreUI.generateTournamentSchedule()">生成淘汰赛赛程</button>
          <button class="danger-btn" onclick="window.hexcoreUI.resetTournamentSchedule()">清空赛程</button>
        </div>
      </section>
      ${tournament.rounds.length ? `
        <section class="tournament-board">
          ${tournament.rounds.map((round, roundIndex) => `
            <div class="tournament-round">
              <h2>${escapeHtml(round.name)}</h2>
              <div class="tournament-match-list">
                ${round.matches.map(match => {
                  const hasBye = Boolean(match.teamAId && !match.teamBId);
                  const winnerName = match.winnerId ? captainName(match.winnerId) : '待定';
                  return `
                    <article class="tournament-match ${match.status}">
                      <div class="match-head">
                        <strong>${escapeHtml(match.id.toUpperCase())}</strong>
                        <span>${match.status === 'bye' ? '轮空晋级' : (match.status === 'completed' ? '已结束' : '待录分')}</span>
                      </div>
                      <div class="match-score-row">
                        <label>
                          <span>${escapeHtml(captainName(match.teamAId))}</span>
                          <input id="tournament-score-${escapeHtml(round.id)}-${escapeHtml(match.id)}-a" type="number" min="0" value="${escapeHtml(match.scoreA)}" ${hasBye ? 'disabled' : ''}>
                        </label>
                        <em>VS</em>
                        <label>
                          <span>${escapeHtml(match.teamBId ? captainName(match.teamBId) : '轮空')}</span>
                          <input id="tournament-score-${escapeHtml(round.id)}-${escapeHtml(match.id)}-b" type="number" min="0" value="${escapeHtml(match.scoreB)}" ${hasBye ? 'disabled' : ''}>
                        </label>
                      </div>
                      <div class="match-actions">
                        <span>晋级：${escapeHtml(winnerName)}</span>
                        <button class="subtle-btn" ${hasBye ? 'disabled' : ''} onclick='window.hexcoreUI.saveTournamentScore(${safeJsonString(round.id)}, ${safeJsonString(match.id)})'>保存比分</button>
                      </div>
                    </article>
                  `;
                }).join('')}
              </div>
            </div>
          `).join('')}
        </section>
      ` : `
        <section class="data-panel empty-tournament">
          <h2>暂无赛程</h2>
          <p>点击“生成淘汰赛赛程”后，系统会按当前基础顺位为所有队伍自动配对。选人抽卡流程不会被赛程页面修改。</p>
        </section>
      `}
    `;
  }

  function rulesPage() {
    const tierOptions = [1, 2, 3, 4].map(tier => `<option value="${tier}">${escapeHtml(Hexcore2.state.settings.tierNames[tier])}</option>`).join('');
    const disabledHexcores = new Set(Hexcore2.state.settings.disabledHexcores || []);
    const tierNameFields = [0, 1, 2, 3, 4].map(tier => `
      <label>
        <span>${tier === 0 ? '队长卡池名称' : `第 ${tier} 档卡池名称`}</span>
        <input id="rules-tier-name-${tier}" maxlength="12" value="${escapeHtml(Hexcore2.state.settings.tierNames[tier])}">
      </label>
    `).join('');
    return `
      ${pageHeader('规则设置', '当前版本固定为裁判代执行，保留多人登录鉴权与队长自抽扩展口。')}
      <section class="data-panel">
        <div class="settings-form">
          <label>
            <span>队伍数量（${Hexcore2.state.settings.minTeams}-${Hexcore2.state.settings.maxTeams}）</span>
            <input id="rules-team-count" type="number" min="${Hexcore2.state.settings.minTeams}" max="${Hexcore2.state.settings.maxTeams}" value="${Hexcore2.selectors.teamCount()}">
          </label>
          <label>
            <span>每队人数</span>
            <input id="rules-players-per-team" type="number" min="1" max="8" value="${Hexcore2.state.settings.playersPerTeam}">
          </label>
          <label>
            <span>最大轮数</span>
            <input id="rules-max-rounds" type="number" min="1" max="8" value="${Hexcore2.state.draft.maxRounds}">
          </label>
          <label>
            <span>当前轮次</span>
            <input id="rules-current-round" type="number" min="1" max="${Hexcore2.state.draft.maxRounds}" value="${Hexcore2.state.draft.round}">
          </label>
          <label>
            <span>基础抽卡张数</span>
            <input id="rules-draw-count" type="number" min="1" max="8" value="${Hexcore2.state.settings.drawCount}">
          </label>
          <label>
            <span>自动随机策略</span>
            <select id="rules-auto-random-strategy">
              <option value="balanced" ${Hexcore2.state.settings.autoRandomStrategy === 'balanced' ? 'selected' : ''}>均衡随机</option>
              <option value="top_scored" ${Hexcore2.state.settings.autoRandomStrategy === 'top_scored' ? 'selected' : ''}>优先高分</option>
              <option value="low_scored" ${Hexcore2.state.settings.autoRandomStrategy === 'low_scored' ? 'selected' : ''}>优先低分</option>
            </select>
          </label>
          <label>
            <span>超时策略</span>
            <select id="rules-timeout-strategy">
              <option value="random_available" ${Hexcore2.state.settings.timeoutStrategy === 'random_available' ? 'selected' : ''}>随机可选</option>
              <option value="highest_score" ${Hexcore2.state.settings.timeoutStrategy === 'highest_score' ? 'selected' : ''}>最高评分</option>
              <option value="lowest_score" ${Hexcore2.state.settings.timeoutStrategy === 'lowest_score' ? 'selected' : ''}>最低评分</option>
            </select>
          </label>
          <button class="primary-btn" onclick="window.hexcoreUI.updateRules()">保存规则并重算流程</button>
          <button class="subtle-btn" onclick="window.hexcoreUI.saveRuleTemplate()">保存为模板</button>
        </div>
        <div class="tier-name-editor">
          <h2>卡池名称</h2>
          <div class="tier-name-grid">
            ${tierNameFields}
          </div>
        </div>
        <div class="round-tier-editor">
          <h2>每轮卡池顺序</h2>
          <div class="round-tier-grid">
            ${Array.from({ length: Hexcore2.state.draft.maxRounds }, (_, index) => {
              const round = index + 1;
              const tier = Hexcore2.selectors.roundTier(round);
              return `
                <label>
                  <span>第 ${round} 轮</span>
                  <select id="rules-round-tier-${round}">
                    ${tierOptions.replace(`value="${tier}"`, `value="${tier}" selected`)}
                  </select>
                </label>
              `;
            }).join('')}
          </div>
        </div>
        <div class="rules-grid">
          <div class="rule-block"><strong>队伍数量</strong><span>${Hexcore2.state.settings.minTeams}-${Hexcore2.state.settings.maxTeams} 队，当前 ${Hexcore2.selectors.teamCount()} 队。</span></div>
          <div class="rule-block"><strong>队伍容量</strong><span>每队 ${Hexcore2.state.settings.playersPerTeam} 名选手。</span></div>
          <div class="rule-block"><strong>基础抽卡</strong><span>每次基础抽 ${Hexcore2.state.settings.drawCount} 张，海克斯可继续叠加。</span></div>
          <div class="rule-block"><strong>执行模式</strong><span>当前由裁判代抽、代选、代用海克斯。</span></div>
        </div>
        <div class="hex-toggle-panel">
          <h2>海克斯启用控制</h2>
          <div class="hex-toggle-grid">
            ${Hexcore2.sampleData.hexcores.map(hex => `
              <article class="hex-toggle-card ${disabledHexcores.has(hex.id) ? 'disabled-player' : ''}">
                <div>
                  <strong>${escapeHtml(hex.name)}</strong>
                  <span>${disabledHexcores.has(hex.id) ? '已禁用' : '启用中'} / ${hex.mode === 'passive' ? '被动' : '手动'}</span>
                </div>
                <p>${escapeHtml(hex.desc)}</p>
                <button class="${disabledHexcores.has(hex.id) ? '' : 'danger-inline'}" onclick="window.hexcoreUI.toggleHexcoreEnabled('${hex.id}')">${disabledHexcores.has(hex.id) ? '启用' : '禁用'}</button>
              </article>
            `).join('')}
          </div>
        </div>
        <div class="rule-template-panel">
          <h2>已保存模板</h2>
          ${(Hexcore2.state.settings.ruleTemplates || []).map(template => `
            <div class="template-row">
              <strong>${escapeHtml(template.name)}</strong>
              <span>${escapeHtml(template.savedAt)} / ${escapeHtml(template.teamCount)} 队 / 每队 ${escapeHtml(template.playersPerTeam)} 人 / ${escapeHtml(template.maxRounds)} 轮</span>
            </div>
          `).join('') || '<div class="empty-log">暂无模板</div>'}
        </div>
      </section>
    `;
  }

  function logsPage() {
    return `
      ${pageHeader('日志导出', '筛选、查看并导出裁判操作和海克斯自动执行记录。')}
      <section class="data-panel log-tools">
        <button class="primary-btn" onclick="window.hexcoreUI.exportEvents()">导出 TXT</button>
        <button class="primary-btn" onclick="window.hexcoreUI.exportEventsJson()">导出 JSON</button>
        <button class="subtle-btn" onclick="window.hexcoreUI.exportRecapText()">导出复盘文本</button>
        <button class="danger-btn" onclick="window.hexcoreUI.clearEvents()">清空日志</button>
      </section>
      <div class="log-workspace">
        ${eventLog()}
      </div>
    `;
  }

  function settingsPage() {
    const lastEvent = Hexcore2.state.events[0];
    const meta = Hexcore2.storageService && Hexcore2.storageService.getMeta ? Hexcore2.storageService.getMeta() : null;
    const lastSaved = meta && meta.savedAt ? new Date(meta.savedAt).toLocaleString('zh-CN', { hour12: false }) : '暂无保存记录';
    const theme = currentTheme();
    return `
      ${pageHeader('系统设置', '本地裁判端状态备份、导入和重置。部署访问请使用 npm start 或静态 HTTP 服务。')}
      <section class="data-panel system-summary">
        <div><span>当前版本</span><strong>HEXCORE 2.0 裁判端</strong></div>
        <div><span>事件数量</span><strong>${Hexcore2.state.events.length}</strong></div>
        <div><span>撤销快照</span><strong>${(Hexcore2.state.undoStack || []).length}</strong></div>
        <div><span>最近事件</span><strong>${lastEvent ? escapeHtml(lastEvent.title) : '暂无'}</strong></div>
        <div><span>最后保存</span><strong>${escapeHtml(lastSaved)}</strong></div>
      </section>
      <section class="data-panel theme-settings">
        <div>
          <h2>界面主题</h2>
          <p>只切换颜色、阴影和卡片质感，保持当前页面布局不变。</p>
        </div>
        <div class="theme-choice-grid" role="radiogroup" aria-label="界面主题">
          <button class="theme-choice default ${theme === 'default' ? 'active' : ''}" aria-pressed="${theme === 'default'}" onclick="window.hexcoreUI.setTheme('default')">
            <span></span>
            <strong>默认</strong>
            <em>当前控制台风格</em>
          </button>
          <button class="theme-choice neon ${theme === 'neon' ? 'active' : ''}" aria-pressed="${theme === 'neon'}" onclick="window.hexcoreUI.setTheme('neon')">
            <span></span>
            <strong>霓虹游戏风</strong>
            <em>深蓝紫电竞质感</em>
          </button>
          <button class="theme-choice apple ${theme === 'apple' ? 'active' : ''}" aria-pressed="${theme === 'apple'}" onclick="window.hexcoreUI.setTheme('apple')">
            <span></span>
            <strong>Apple 浅色</strong>
            <em>清爽磨砂质感</em>
          </button>
        </div>
      </section>
      <section class="data-panel settings-actions">
        <button class="primary-btn" onclick="window.hexcoreUI.runSystemCheck()">运行状态检查</button>
        <button class="subtle-btn" onclick="window.hexcoreUI.restoreLatestSnapshot()">恢复最近快照</button>
        <button class="primary-btn" onclick="window.hexcoreUI.exportState()">导出状态备份</button>
        <button class="subtle-btn" onclick="document.getElementById('state-import-input').click()">导入状态备份</button>
        <button class="danger-btn" onclick="window.hexcoreUI.clearBrowserData()">清理浏览器本地数据</button>
        <button class="danger-btn" onclick="window.hexcoreUI.resetLocalState()">重置本地状态</button>
      </section>
    `;
  }

  function activePage() {
    const activeView = (Hexcore2.state.ui && Hexcore2.state.ui.activeView) || 'draft';
    if (activeView === 'teams') return `<main class="workspace-main page-workspace">${teamsPage()}</main>`;
    if (activeView === 'players') return `<main class="workspace-main page-workspace">${playersPage()}</main>`;
    if (activeView === 'hexcores') return `<main class="workspace-main page-workspace">${hexcoresPage()}</main>`;
    if (activeView === 'schedule') return `<main class="workspace-main page-workspace">${schedulePage()}</main>`;
    if (activeView === 'tournament') return `<main class="workspace-main page-workspace">${tournamentPage()}</main>`;
    if (activeView === 'rules') return `<main class="workspace-main page-workspace">${rulesPage()}</main>`;
    if (activeView === 'logs') return `<main class="workspace-main page-workspace">${logsPage()}</main>`;
    if (activeView === 'settings') return `<main class="workspace-main page-workspace">${settingsPage()}</main>`;
    return `
      <main class="workspace">
        <div class="workspace-main">
          ${workflowGatePanel()}
          ${turnOrder()}
          <div class="content-grid">
            <div>
              ${playerCards()}
              ${refereeControls()}
              ${rosterRail()}
            </div>
            <div>
              ${hexcorePanel()}
              ${rulePanel()}
            </div>
          </div>
        </div>
        ${eventLog()}
      </main>
    `;
  }

  function app() {
    return `
      ${sidebar()}
      <div class="app-main">
        ${topbar()}
        ${activePage()}
      </div>
      ${addPlayerModal()}
      ${feedbackToast()}
    `;
  }

  Hexcore2.ui = {
    render() {
      applyTheme();
      document.getElementById('app').innerHTML = app();
    },
  };
})(window);
