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
    if (draw && draw.pickMode === 'shop') return draw.generatedBy === 'paid_refresh' ? '刷新商店' : '免费商店';
    if (draw && draw.pickMode === 'blind_box') return '盲盒抽卡';
    if (draw && draw.pickMode === 'hellhound') return '地狱三头犬连选';
    if (!draw || draw.pickMode !== 'open_pick') return '队员商店';
    return '全池列表';
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

  function currentHexcoreStatus(captain) {
    if (!captain || !Hexcore2.hexcoreEngine || !Hexcore2.hexcoreEngine.effectStatusForCaptain) return '';
    const statuses = Hexcore2.hexcoreEngine.effectStatusForCaptain(captain.id);
    if (!statuses.length) return '';
    return `
      <div class="top-hex-status" title="${escapeHtml(statuses.map(item => `${item.status}：${item.label}`).join('；'))}">
        <span>海克斯影响</span>
        ${statuses.map(item => `<b class="${item.status === '已生效' ? 'applied' : 'pending'}">${escapeHtml(item.status)}：${escapeHtml(item.label)}</b>`).join('')}
      </div>
    `;
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
      'camp-scout': '&#128269;',
      'discount-coupon': '&#127903;',
      'reserved-seat': '&#128204;',
      'urgent-restock': '&#128260;',
      'camp-blockade': '&#128737;',
      'price-interference': '&#128200;',
      'steady-reinforce': '&#9878;',
      donation: '&#127873;',
      'sponsor-flow': '&#128176;',
      'open-feast': '&#127860;',
      'vampiric-habit': '&#129656;',
      'giant-slayer': '&#128481;',
      photographer: '&#128247;',
      'wise-benevolence': '&#127775;',
    };
    return glyphs[hexcore.id] || '&#10022;';
  }

  function hexcoreUseLabel(hexcore) {
    if (hexcore.mode === 'passive') return '被动自动';
    if (hexcore.uses === 1) return '全程 1 次';
    if (hexcore.maxUsesPerRound) return `每轮 ${hexcore.maxUsesPerRound} 次`;
    return '裁判手动';
  }

  function hexcoreExecutionQueue(captainId) {
    const queue = Hexcore2.hexcoreEngine.executionQueue(captainId);
    const targetableIds = new Set(['reserved-seat', 'urgent-restock', 'camp-blockade', 'price-interference', 'decompose-knowledge', 'stuck-together']);
    return `
      <div class="hex-execution-queue">
        <div class="hex-queue-head">
          <strong>本轮海克斯执行队列</strong>
          <span>${queue.length ? `${queue.length} 项` : '暂无'}</span>
        </div>
        <div class="hex-queue-list">
          ${queue.map(item => `
            <article class="hex-queue-item ${escapeHtml(item.type)} ${item.executable ? 'has-action' : ''}">
              <div class="hex-queue-status">
                <b>${escapeHtml(item.status)}</b>
                <span>${escapeHtml(item.actionType)}</span>
              </div>
              <div class="hex-queue-body">
                <strong>${escapeHtml(item.name)} <em>${escapeHtml(item.actionLabel)}</em></strong>
                <p>${escapeHtml(item.reason)}</p>
              </div>
              ${item.executable ? `
                <button class="hex-queue-action" onclick='${targetableIds.has(item.id) || item.needsTarget ? `window.hexcoreUI.openHexTargetPicker(${safeJsonString(item.id)})` : `window.hexcoreUI.useHexcore(${safeJsonString(item.id)})`}'>${targetableIds.has(item.id) || item.needsTarget ? '选择目标' : '使用'}</button>
              ` : ''}
            </article>
          `).join('') || '<div class="hex-queue-empty">当前队长暂无海克斯执行项</div>'}
        </div>
      </div>
    `;
  }

  function hexTargetPickerPanel(captain, context) {
    const picker = Hexcore2.state.ui && Hexcore2.state.ui.hexTargetPicker;
    if (!picker || !picker.hexcoreId) return '';

    const hex = (Hexcore2.state.hexcoreAssignments[captain.id] || []).find(item => item.id === picker.hexcoreId);
    if (!hex) return '';

    const selectOptions = (items, emptyLabel) => {
      if (!items.length) return `<option value="">${escapeHtml(emptyLabel)}</option>`;
      return items.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');
    };

    let body = '';
    if (hex.id === 'reserved-seat' || hex.id === 'urgent-restock') {
      const cards = (Hexcore2.state.draft.currentDraw && Hexcore2.state.draft.currentDraw.captainId === captain.id)
        ? Hexcore2.state.draft.currentDraw.cards
        : [];
      body = `
        <label>
          <small>${hex.id === 'reserved-seat' ? '保留卡牌' : '替换卡牌'}</small>
          <select id="hex-target-first">
            ${cards.map((card, index) => {
              const player = Hexcore2.state.players.find(item => item.id === card.playerId);
              return `<option value="${index}">${index + 1}. ${escapeHtml(player ? player.name : card.playerId)}</option>`;
            }).join('') || '<option value="">当前没有商店卡</option>'}
          </select>
        </label>
      `;
    } else if (hex.id === 'camp-blockade' || hex.id === 'price-interference') {
      const order = Hexcore2.state.draft.currentOrder || [];
      const targets = Hexcore2.state.captains.filter(item =>
        item.id !== captain.id
        && Hexcore2.selectors.teamSize(item.id) < Hexcore2.selectors.teamMemberCapacity(item.id)
        && (order.indexOf(item.id) >= Hexcore2.state.draft.currentIndex || Hexcore2.state.draft.round < Hexcore2.state.draft.maxRounds)
      );
      body = `
        <label>
          <small>目标队长</small>
          <select id="hex-target-first">
            ${selectOptions(targets, '没有可用目标')}
          </select>
        </label>
      `;
    } else if (hex.id === 'blind') {
      body = `
        <label>
          <small>致盲目标队长</small>
          <select id="hex-target-first">
            ${selectOptions(context.blindTargets, '本轮没有可致盲目标')}
          </select>
        </label>
      `;
    } else if (hex.id === 'order-swap') {
      body = `
        <label>
          <small>队长 A</small>
          <select id="hex-target-first">
            ${selectOptions(Hexcore2.state.captains, '没有可交换队长')}
          </select>
        </label>
        <label>
          <small>队长 B</small>
          <select id="hex-target-second">
            ${selectOptions(Hexcore2.state.captains.slice(1), '没有可交换队长')}
          </select>
        </label>
      `;
    } else if (hex.id === 'decompose-knowledge') {
      const targets = Hexcore2.hexcoreEngine.decomposeTargets ? Hexcore2.hexcoreEngine.decomposeTargets(captain.id) : [];
      const sacrifices = Hexcore2.hexcoreEngine.decomposableTeamPlayers ? Hexcore2.hexcoreEngine.decomposableTeamPlayers(captain) : [];
      body = `
        <label>
          <small>自选目标</small>
          <select id="hex-target-first">
            ${targets.map(player => `<option value="${escapeHtml(player.id)}">${escapeHtml(player.name)} · ${player.tier}费 · 评分 ${player.score}</option>`).join('') || '<option value="">没有可自选目标</option>'}
          </select>
        </label>
        <label>
          <small>金币不足时分解抵扣</small>
          <select id="hex-target-second">
            <option value="">不分解队员</option>
            ${sacrifices.map(player => `<option value="${escapeHtml(player.id)}">${escapeHtml(player.name)} · ${player.tier}费抵 ${player.tier} 金币</option>`).join('')}
          </select>
        </label>
      `;
    } else if (hex.id === 'stuck-together') {
      const targets = Hexcore2.hexcoreEngine.stuckTogetherTargets ? Hexcore2.hexcoreEngine.stuckTogetherTargets(captain.id) : [];
      body = `
        <label>
          <small>锁定选手</small>
          <select id="hex-target-first">
            ${targets.map(player => `<option value="${escapeHtml(player.id)}">${escapeHtml(player.name)} · ${player.tier}费 · 评分 ${player.score}</option>`).join('') || '<option value="">没有可锁定目标</option>'}
          </select>
        </label>
      `;
    } else if (hex.id === 'lock-contract') {
      body = `
        <label>
          <small>绑定选手 A</small>
          <select id="hex-target-first">
            ${selectOptions(context.availablePlayers, '当前没有可绑定选手')}
          </select>
        </label>
        <label>
          <small>绑定选手 B</small>
          <select id="hex-target-second">
            ${selectOptions(context.availablePlayers.slice(1), '当前没有可绑定选手')}
          </select>
        </label>
      `;
    }

    if (!body) return '';
    return `
      <div class="hex-target-picker-panel">
        <div class="hex-target-picker-head">
          <div>
            <strong>${escapeHtml(hex.name)}</strong>
            <p>${escapeHtml(hex.desc)}</p>
          </div>
          <button class="ghost-btn" onclick="window.hexcoreUI.closeHexTargetPicker()">关闭</button>
        </div>
        <div class="hex-target-picker-options">
          ${body}
        </div>
        <div class="hex-target-picker-actions">
          <button class="primary-btn" onclick='window.hexcoreUI.useSelectedHexTarget(${safeJsonString(hex.id)})'>确认执行</button>
          <button class="ghost-btn" onclick="window.hexcoreUI.closeHexTargetPicker()">取消</button>
        </div>
      </div>
    `;
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
        <div class="nav-section">金币商店控制台</div>
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
              <span>阵营</span>
              <select id="add-player-camp">
                <option value="local">本地人</option>
                <option value="outsider">外地人</option>
              </select>
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

  function playerImportPreviewModal() {
    const preview = Hexcore2.state.ui && Hexcore2.state.ui.playerImportPreview;
    if (!preview) return '';
    const accepted = Array.isArray(preview.accepted) ? preview.accepted : [];
    const skipped = Array.isArray(preview.skipped) ? preview.skipped : [];
    const stats = preview.stats || {};
    return `
      <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="player-import-preview-title">
        <section class="form-modal import-preview-modal">
          <div class="modal-head">
            <div>
              <h2 id="player-import-preview-title">导入预览</h2>
              <p>${escapeHtml(preview.fileName || '未命名文件')}，确认后才会写入选手库。</p>
            </div>
            <button class="icon-close" aria-label="关闭导入预览" onclick="window.hexcoreUI.cancelPlayerImport()">×</button>
          </div>
          <div class="import-preview-stats">
            <div><span>总行数</span><strong>${Number(preview.totalRows) || 0}</strong></div>
            <div class="ok"><span>将导入</span><strong>${accepted.length}</strong></div>
            <div class="warn"><span>重复ID</span><strong>${Number(stats.duplicateGameId) || 0}</strong></div>
            <div class="warn"><span>缺字段</span><strong>${Number(stats.missingField) || 0}</strong></div>
            <div class="warn"><span>非法评分</span><strong>${Number(stats.invalidScore) || 0}</strong></div>
          </div>
          <div class="import-preview-columns">
            <div>
              <h3>将导入前 ${Math.min(accepted.length, 10)} 名</h3>
              ${accepted.slice(0, 10).map(player => `
                <article class="import-preview-row">
                  <strong>${escapeHtml(player.name)}</strong>
                  <span>${escapeHtml(player.gameId)} · ${escapeHtml(player.lane)} · 评分 ${escapeHtml(player.score)}</span>
                </article>
              `).join('') || '<div class="empty-log">没有可导入选手</div>'}
            </div>
            <div>
              <h3>跳过前 ${Math.min(skipped.length, 10)} 条</h3>
              ${skipped.slice(0, 10).map(item => `
                <article class="import-preview-row skipped">
                  <strong>第 ${Number(item.row) || 0} 行</strong>
                  <span>${escapeHtml(item.reason || '数据无效')}${item.gameId ? ` · ${escapeHtml(item.gameId)}` : ''}</span>
                </article>
              `).join('') || '<div class="empty-log">没有跳过项</div>'}
            </div>
          </div>
          <div class="modal-actions">
            <button class="subtle-btn" onclick="window.hexcoreUI.cancelPlayerImport()">取消</button>
            <button class="primary-btn" ${accepted.length ? '' : 'disabled'} onclick="window.hexcoreUI.confirmPlayerImport()">确认导入 ${accepted.length} 名</button>
          </div>
        </section>
      </div>
    `;
  }

  function topbar() {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const captain = Hexcore2.selectors.currentCaptain();
    const economy = captain && captain.economy ? captain.economy : null;
    const roundState = captain && Hexcore2.economyEngine ? Hexcore2.economyEngine.roundState(captain.id) : null;
    const nextRefreshCost = captain && Hexcore2.economyEngine ? Hexcore2.economyEngine.nextRefreshCost(captain.id) : 0;
    const nextRefreshReason = captain && Hexcore2.economyEngine && Hexcore2.economyEngine.nextRefreshReason
      ? Hexcore2.economyEngine.nextRefreshReason(captain.id)
      : '';
    const refreshLabel = roundState && !roundState.freeShopUsed
      ? '首次免费'
      : (nextRefreshCost === 0
        ? (nextRefreshReason === 'round_one_tier_one' ? '缺1费免费' : (nextRefreshReason === 'wise_benevolence' ? '博爱免费' : '海克斯免费'))
        : `${nextRefreshCost}金币`);
    const workflow = Hexcore2.selectors.workflowStatus();
    const statusText = !workflow.playersDraftReady
      ? `前置流程未完成：${workflow.stage.label}`
      : Hexcore2.state.draft.phase === 'completed'
      ? '选人已完成'
      : (Hexcore2.state.draft.paused ? '流程已暂停' : '选人进行中');
    return `
      <header class="topbar">
        <div class="mode">裁判代执行</div>
        <div class="phase">当前阶段：<strong>第 ${Hexcore2.state.draft.round} 轮 / 金币商店</strong></div>
        <div class="captain-title">当前队长：<strong>${captain ? escapeHtml(captain.name) : '无'}</strong></div>
        <div class="captain-title">金币：<strong>${economy ? economy.gold : 0}</strong></div>
        <div class="captain-title">刷新：<strong>${escapeHtml(refreshLabel)}</strong></div>
        ${currentHexcoreStatus(captain)}
        <div class="top-spacer"></div>
        <div class="live-status ${Hexcore2.state.draft.phase === 'completed' ? 'done' : ''}"><span></span>${statusText}</div>
        <div class="clock">${time}</div>
        <button class="ghost-btn" onclick="window.hexcoreUI.refreshShop()">${Hexcore2.icon('refresh')}刷新商店</button>
      </header>
    `;
  }

  function turnOrder() {
    const state = Hexcore2.state;
    const order = state.draft.currentOrder || [];
    const currentIndex = Math.max(0, Math.min(state.draft.currentIndex, Math.max(0, order.length - 1)));
    const currentId = order[currentIndex];
    const previousId = currentIndex > 0 ? order[currentIndex - 1] : '';
    const nextId = currentIndex < order.length - 1 ? order[currentIndex + 1] : '';
    const captainById = id => state.captains.find(item => item.id === id) || null;
    const currentCaptain = captainById(currentId);
    const previousCaptain = captainById(previousId);
    const nextCaptain = captainById(nextId);
    const drawerOpen = Boolean(state.ui && state.ui.orderDrawerOpen);
    const orderRows = order.map((captainId, index) => {
      const captain = captainById(captainId);
      const status = index === currentIndex ? '当前' : (index < currentIndex ? '已过' : '待定');
      const className = index === currentIndex ? 'current' : (index < currentIndex ? 'done' : 'pending');
      return `
        <article class="order-detail-row ${className}">
          <span>${index + 1}</span>
          <strong>${escapeHtml(captain ? captain.name : '未知队伍')}</strong>
          <em>${escapeHtml(captain ? captain.record : '待定')}</em>
          <b>${status}</b>
        </article>
      `;
    }).join('');
    const miniItem = (label, captain, className) => `
      <div class="turn-context-card ${className}">
        <span>${label}</span>
        <strong>${captain ? escapeHtml(captain.name) : '无'}</strong>
        <em>${captain ? escapeHtml(captain.record || '待定') : '队列起点'}</em>
      </div>
    `;
    return `
      <section class="turn-panel">
        <div class="panel-title-row">
          <h2>顺位顺序 <span>第 ${state.draft.round} 轮 · ${order.length ? currentIndex + 1 : 0}/${order.length}</span></h2>
          <button class="subtle-btn order-detail-trigger" onclick="window.hexcoreUI.openOrderDrawer()">顺位详情</button>
        </div>
        <div class="turn-context">
          ${miniItem('上一位', previousCaptain, 'previous')}
          ${miniItem('当前', currentCaptain, 'current')}
          ${miniItem('下一位', nextCaptain, 'next')}
        </div>
        <div class="turn-note">顺位变更说明：${escapeHtml(currentExplanation().join('；') || '按基础蛇形顺位执行')}。</div>
      </section>
      <div class="order-drawer-layer ${drawerOpen ? 'open' : ''}" aria-label="顺位详情" aria-hidden="${drawerOpen ? 'false' : 'true'}">
        <button class="order-drawer-backdrop" onclick="window.hexcoreUI.closeOrderDrawer()" aria-label="关闭顺位详情"></button>
        <aside class="order-drawer" aria-label="顺位详情">
          <div class="order-drawer-head">
            <div>
              <strong>顺位详情</strong>
              <span>第 ${state.draft.round} 轮 / 共 ${order.length} 队</span>
            </div>
            <button class="subtle-btn order-detail-trigger" onclick="window.hexcoreUI.closeOrderDrawer()">关闭</button>
          </div>
          <div class="order-detail-list">
            ${orderRows || '<div class="empty-log">暂无顺位</div>'}
          </div>
        </aside>
      </div>
    `;
  }

  function workflowGatePanel() {
    const workflow = Hexcore2.selectors.workflowStatus();
    if (workflow.playersDraftReady) return '';
    const checklist = workflow.checklist.items;
    const missingCaptains = workflow.missingHexcoreCaptains
      .map(id => Hexcore2.state.captains.find(captain => captain.id === id))
      .filter(Boolean);
    const missingHexcoreRows = missingCaptains.map(captain => {
      const ownedCount = (Hexcore2.state.hexcoreAssignments[captain.id] || []).length;
      return { captain, ownedCount, missingCount: Math.max(0, 3 - ownedCount) };
    });
    return `
      <section class="workflow-gate">
        <div>
          <strong>实时抽选尚未开始：${escapeHtml(workflow.stage.label)}</strong>
          <p>流程顺序固定为：先确定全部队长/队伍，再让所有队长抽满 3 个海克斯，最后进入四轮金币商店组队。</p>
        </div>
        <div class="workflow-steps">
          <span class="${workflow.stage.order > 1 ? 'done' : 'pending'}">1 数据准备</span>
          <span class="${workflow.stage.order > 2 ? 'done' : 'pending'}">2 队长确认</span>
          <span class="${workflow.stage.order > 3 ? 'done' : 'pending'}">3 队长抽海克斯</span>
          <span class="pending">4 队员抽选</span>
        </div>
        <div class="workflow-checklist">
          ${checklist.map(item => `
            <button class="workflow-check ${escapeHtml(item.status)}" onclick='window.hexcoreUI.setActiveView(${safeJsonString(item.view)})'>
              <strong>${escapeHtml(item.label)}</strong>
              <span>${item.status === 'pass' ? '通过' : (item.status === 'warn' ? '需关注' : '待处理')}</span>
              <em>${escapeHtml(item.detail)}</em>
            </button>
          `).join('')}
        </div>
        ${missingHexcoreRows.length ? `
          <div class="workflow-missing-board">
            <div class="workflow-board-head">
              <strong>待处理海克斯</strong>
              <span>${missingHexcoreRows.length} 队未完成</span>
            </div>
            <div class="workflow-missing-list">
              ${missingHexcoreRows.map(({ captain, ownedCount, missingCount }) => `
                <button onclick='window.hexcoreUI.openHexcoreForCaptain(${safeJsonString(captain.id)})'>
                  <strong>${escapeHtml(captain.name)}</strong>
                  <span>${ownedCount}/3</span>
                  <em>还差 ${missingCount} 个</em>
                </button>
              `).join('')}
            </div>
          </div>
        ` : ''}
        <div class="workflow-actions">
          <button class="subtle-btn" onclick="window.hexcoreUI.setActiveView('teams')">检查队伍</button>
          <button class="subtle-btn" onclick="window.hexcoreUI.setActiveView('players')">检查选手</button>
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
    const draw = Hexcore2.state.draft.currentDraw;
    const economy = captain && captain.economy ? captain.economy : null;
    const roundState = captain && Hexcore2.economyEngine ? Hexcore2.economyEngine.roundState(captain.id) : null;
    const nextRefreshCost = captain && Hexcore2.economyEngine ? Hexcore2.economyEngine.nextRefreshCost(captain.id) : 0;
    const nextRefreshReason = captain && Hexcore2.economyEngine && Hexcore2.economyEngine.nextRefreshReason
      ? Hexcore2.economyEngine.nextRefreshReason(captain.id)
      : '';
    const nextRefreshLabel = roundState
      ? (roundState.freeShopUsed
        ? (nextRefreshCost === 0
          ? (nextRefreshReason === 'round_one_tier_one' ? '免费（第一轮补1费）' : (nextRefreshReason === 'wise_benevolence' ? '免费（贤者的博爱）' : '免费'))
          : `${nextRefreshCost} 金币`)
        : '免费')
      : '等待进入操作';
    function teamOwnerName(player) {
      if (!player || !player.teamId) return '';
      const owner = Hexcore2.state.captains.find(item => item.id === player.teamId);
      return owner ? owner.name : '';
    }
    function priceInterferenceBonus(captainId) {
      return Hexcore2.state.draft.runtimeEffects.some(effect =>
        effect.type === 'price_interference'
        && effect.captainId === captainId
        && !effect.consumed
      ) ? 1 : 0;
    }
    const priceBonus = captain ? priceInterferenceBonus(captain.id) : 0;
    return `
      <section class="draw-panel">
        <div class="panel-title-row">
          <h2>${escapeHtml(currentDrawLabel())} <span>${draw && draw.reason ? escapeHtml(draw.reason) : '每次展示最多 5 张，按轮次概率生成'}</span></h2>
          <button class="subtle-btn" onclick="window.hexcoreUI.drawCards()">${Hexcore2.icon('cube')}${roundState && roundState.freeShopUsed ? '刷新商店' : '免费开店'}</button>
        </div>
        <div class="draw-timeout-bar">
          <strong>${captain ? `${escapeHtml(captain.name)} · ${economy ? economy.gold : 0} 金币` : '无当前队长'}</strong>
          <span>${roundState ? `本轮状态：${roundState.purchaseUsed ? '已购买' : (roundState.skipped ? '已跳过' : '可购买')} · 下一次刷新 ${escapeHtml(nextRefreshLabel)}` : '等待进入操作'}</span>
        </div>
        <div class="cards-grid ${draw && draw.pickMode === 'open_pick' ? 'open-pick-grid' : ''}">
          ${cards.map(({ slot, player, realPlayer }, index) => {
            const purchased = Boolean(slot && slot.purchased);
            const tier = Number(slot && slot.price ? slot.price : player.tier) || 1;
            if (purchased) {
              return '<div class="shop-empty-slot" aria-hidden="true"></div>';
            }
            return `
            <button class="player-card tier-${tier} ${index === selected ? 'selected' : ''} ${blinded ? 'blind-card' : ''} ${draw && draw.pickMode === 'mystery_swap' ? 'mystery-card' : ''}" onclick="window.hexcoreUI.selectCard(${index})">
              <b class="shop-price-badge">${escapeHtml(tier)}费${priceBonus ? `<i>+${priceBonus}</i>` : ''}</b>
              <strong>${blinded ? '身份隐藏' : escapeHtml(player.name)}</strong>
              <small>${blinded ? '选中后揭示' : `ID: ${escapeHtml(player.gameId)}${draw && draw.pickMode === 'blind_box' && realPlayer.status === 'drafted' ? ` / 已在 ${escapeHtml(teamOwnerName(realPlayer))}` : ''}`}</small>
              <span class="camp-pill">${escapeHtml(Hexcore2.selectors.campLabel(player.camp))}</span>
              <div class="hero-title">擅长英雄</div>
              <div class="hero-row">
                ${(blinded ? ['?', '?', '?'] : (player.heroes && player.heroes.length ? player.heroes : ['暂无', '暂无', '暂无'])).map(hero => `<span>${escapeHtml(hero)}</span>`).join('')}
              </div>
            </button>
          `;
          }).join('')}
        </div>
        <p class="hint">提示：${captain ? `本轮最多购买 1 名队员。刷新不消耗购买权，购买或跳过后本轮权限立即固化。${escapeHtml(captain.name)} 队伍人数 ${Hexcore2.selectors.teamTotalSize(captain.id)}/${Hexcore2.state.settings.playersPerTeam}（队员 ${Hexcore2.selectors.teamSize(captain.id)}/${Hexcore2.selectors.teamMemberCapacity(captain.id)}）。` : '当前没有可操作队长'}</p>
      </section>
    `;
  }

  function refereeControls() {
    const icon = Hexcore2.icon;
    const draw = Hexcore2.state.draft.currentDraw;
    const captain = Hexcore2.selectors.currentCaptain();
    const roundState = captain && Hexcore2.economyEngine ? Hexcore2.economyEngine.roundState(captain.id) : null;
    const nextRefreshCost = captain && Hexcore2.economyEngine ? Hexcore2.economyEngine.nextRefreshCost(captain.id) : 0;
    const nextRefreshReason = captain && Hexcore2.economyEngine && Hexcore2.economyEngine.nextRefreshReason
      ? Hexcore2.economyEngine.nextRefreshReason(captain.id)
      : '';
    const refreshButtonText = roundState && roundState.freeShopUsed && nextRefreshCost === 0
      ? (nextRefreshReason === 'round_one_tier_one' ? '免费补1费' : (nextRefreshReason === 'wise_benevolence' ? '博爱刷新' : '免费刷新'))
      : '付费刷新';
    const refreshButtonHint = roundState && roundState.freeShopUsed && nextRefreshCost === 0
      ? (nextRefreshReason === 'round_one_tier_one' ? '第一轮未见1费卡' : (nextRefreshReason === 'wise_benevolence' ? '消耗累计刷新次数' : '海克斯免费'))
      : '费用 1/2/3/4 封顶';
    const canPurchase = Boolean(draw && draw.cards && draw.cards.length && !Hexcore2.state.draft.pickedThisTurn && roundState && !roundState.purchaseUsed && !roundState.skipped);
    return `
      <section class="control-panel">
        <h2>裁判操作</h2>
        <div class="control-grid">
          <div class="control-group shop-actions">
            <span class="control-group-label">商店</span>
            <button class="action-btn cyan" onclick="window.hexcoreUI.drawCards()">${icon('cube')}<strong>${roundState && roundState.freeShopUsed ? '刷新商店' : '免费开店'}</strong><span>${roundState && roundState.freeShopUsed ? '按刷新费用扣金币' : '本轮首次免费5张'}</span></button>
            <button class="action-btn cyan" onclick="window.hexcoreUI.refreshShop()">${icon('refresh')}<strong>${escapeHtml(refreshButtonText)}</strong><span>${escapeHtml(refreshButtonHint)}</span></button>
          </div>
          <div class="control-group primary-actions">
            <span class="control-group-label">流程</span>
            <button class="action-btn green ${canPurchase ? '' : 'disabled'}" onclick="window.hexcoreUI.pickCard()">${icon('pick')}<strong>${roundState && roundState.purchaseUsed ? '已购买' : '购买此卡'}</strong><span>扣金币并入队</span></button>
            <button class="action-btn amber ${roundState && !roundState.purchaseUsed && !roundState.skipped ? '' : 'disabled'}" onclick="window.hexcoreUI.skipTurn()"><span class="fast-icon">»</span><strong>跳过本轮</strong><span>购买权限作废</span></button>
            <button class="action-btn blue" onclick="window.hexcoreUI.nextCaptain()">${icon('team')}<strong>下一位</strong><span>交给下一队长</span></button>
          </div>
          <div class="control-group system-actions">
            <span class="control-group-label">系统</span>
            <button class="action-btn muted" onclick="window.hexcoreUI.pause()">${icon('pause')}<strong>${Hexcore2.state.draft.paused ? '继续' : '暂停'}</strong><span>${Hexcore2.state.draft.paused ? '继续选人流程' : '暂停选人流程'}</span></button>
            <button class="action-btn muted ${(Hexcore2.state.undoStack || []).length === 0 ? 'disabled' : ''}" onclick="window.hexcoreUI.undo()">${icon('undo')}<strong>撤销上一步</strong><span>可撤销 ${(Hexcore2.state.undoStack || []).length} 步</span></button>
          </div>
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
    const blindTargets = Hexcore2.hexcoreEngine.blindTargetOptions(captain.id);
    const teamPlayers = captain.team
      .map(playerId => playerById(playerId))
      .filter(Boolean);
    const availablePlayers = Hexcore2.state.players
      .filter(player => player.status === 'available')
      .sort((a, b) => b.score - a.score);
    const targetContext = { blindTargets, teamPlayers, availablePlayers };
    return `
      <section class="hexcore-panel">
        <h2>${escapeHtml(captain.name)} 的海克斯</h2>
        ${hexcoreExecutionQueue(captain.id)}
        ${hexTargetPickerPanel(captain, targetContext)}
      </section>
    `;
  }

  function rulePanel() {
    const captain = Hexcore2.selectors.currentCaptain();
    const reasons = currentExplanation();
    const probabilities = Hexcore2.shopEngine ? Hexcore2.shopEngine.probabilityForRound(Hexcore2.state.draft.round) : {};
    const probabilityLine = [1, 2, 3, 4, 5]
      .map(tier => `${Hexcore2.state.settings.tierNames[tier]} ${probabilities[tier] || 0}%`)
      .join(' / ');
    const lines = [
      { label: '金币规则', body: '开局6金币，第2-4轮各+3，无利息；本轮首次商店免费，之后刷新1/2/3/4封顶。' },
      { label: '本轮概率', body: probabilityLine },
      ...(reasons.length ? reasons : ['基础顺位：按当前轮次蛇形顺位执行']).map(reason => ({ label: '顺位原因', body: reason })),
    ];
    return `
      <section class="rule-panel">
        <div class="rule-summary-head">
          <h2>规则摘要</h2>
          <button class="subtle-btn" onclick="window.hexcoreUI.setActiveView('rules')">完整规则</button>
        </div>
        <div class="rule-summary-grid">
          ${lines.slice(0, 3).map((line, index) => `
            <div class="rule-line ${index % 2 ? 'cyan' : 'amber'}"><strong>${escapeHtml(line.label)}</strong><span>${escapeHtml(line.body)}</span></div>
          `).join('')}
        </div>
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
            <option value="draw" ${filter === 'draw' ? 'selected' : ''}>商店</option>
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
          ${Hexcore2.state.captains.map((captain, index) => {
            const capacity = Hexcore2.selectors.teamMemberCapacity(captain.id);
            return `
            <div class="team-mini ${currentCaptain && captain.id === currentCaptain.id ? 'active' : ''}">
              <div><span>${index + 1}</span><strong>${escapeHtml(captain.name)}</strong></div>
              <p>${Hexcore2.selectors.teamTotalSize(captain.id)}/${Hexcore2.state.settings.playersPerTeam}</p>
              <div class="slots">
                ${Array.from({ length: capacity }, (_, slot) => `<i class="${slot < captain.team.length ? 'filled' : ''}"></i>`).join('')}
              </div>
            </div>
          `;
          }).join('')}
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
    const goldShopMode = Hexcore2.state.settings.economyMode === 'gold_shop';
    function teamCapacity(captain) {
      return Hexcore2.selectors.teamMemberCapacity(captain.id);
    }
    function teamStatus(captain) {
      const capacity = teamCapacity(captain);
      const hasCaptain = Boolean(Hexcore2.selectors.captainPlayer(captain.id));
      const totalSize = Hexcore2.selectors.teamTotalSize(captain.id);
      const totalCapacity = Hexcore2.state.settings.playersPerTeam;
      if (captain.team.length > capacity) return { label: '异常：超员', className: 'warn' };
      const missingPlayers = captain.team.filter(playerId => !playerById(playerId));
      if (missingPlayers.length) return { label: '异常：缺失选手', className: 'warn' };
      if (!hasCaptain && captain.team.length === capacity) return { label: '满员-未设置队长', className: 'warn' };
      if (totalSize === totalCapacity) return { label: '满员', className: 'done' };
      return { label: `缺员 ${totalCapacity - totalSize}`, className: 'pending' };
    }
    return `
      ${pageHeader('队伍管理', '裁判可调整队伍、切换当前队伍、重命名队伍并处理队员归属。')}
      <section class="data-panel teams-panel">
        <div class="toolbar-row team-toolbar">
          <div>
            <strong>当前 ${Hexcore2.selectors.teamCount()} 队，允许 ${Hexcore2.state.settings.minTeams}-${Hexcore2.state.settings.maxTeams} 队</strong>
            <span>队伍增删会重算基础顺位，并清空当前商店结果。</span>
          </div>
          <div class="toolbar-actions">
            <input id="teams-team-count" type="number" min="${Hexcore2.state.settings.minTeams}" max="${Hexcore2.state.settings.maxTeams}" value="${Hexcore2.selectors.teamCount()}" aria-label="队伍数量">
            <button class="subtle-btn" onclick="window.hexcoreUI.updateTeamCountFromTeams()">应用数量</button>
            <button class="primary-btn" onclick="window.hexcoreUI.addCaptain()">${Hexcore2.icon('team')}新增队伍</button>
          </div>
        </div>
        <div class="metrics-grid">
          <div><span>满员队伍</span><strong>${Hexcore2.state.captains.filter(captain => Hexcore2.selectors.teamTotalSize(captain.id) === Hexcore2.state.settings.playersPerTeam).length}</strong></div>
          <div><span>缺员队伍</span><strong>${Hexcore2.state.captains.filter(captain => Hexcore2.selectors.teamTotalSize(captain.id) < Hexcore2.state.settings.playersPerTeam).length}</strong></div>
          <div><span>异常队伍</span><strong>${Hexcore2.state.captains.filter(captain => captain.team.length > teamCapacity(captain) || captain.team.some(playerId => !playerById(playerId))).length}</strong></div>
          <div><span>可补录选手</span><strong>${availablePlayers.length}</strong></div>
        </div>
        <div class="data-grid team-grid">
          ${Hexcore2.state.captains.map((captain, index) => {
            const basePosition = Hexcore2.state.draft.baseOrder.indexOf(captain.id) + 1;
            const status = teamStatus(captain);
            const captainPlayer = Hexcore2.selectors.captainPlayer(captain.id);
            const capacity = teamCapacity(captain);
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
              <p>队伍人数：${Hexcore2.selectors.teamTotalSize(captain.id)}/${Hexcore2.state.settings.playersPerTeam}（含队长，队员 ${captain.team.length}/${capacity}）</p>
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
                ${captainPlayer ? `
                  <article class="team-member captain-member">
                    <div>
                      <strong>${escapeHtml(captainPlayer.name)}</strong>
                      <span>队长 · ${escapeHtml(Hexcore2.selectors.campLabel(captainPlayer.camp))} · 固定第一位</span>
                      <small>ID：${escapeHtml(captainPlayer.gameId || captainPlayer.id)}</small>
                    </div>
                  </article>
                ` : ''}
                ${Array.from({ length: capacity }, (_, slotIndex) => {
                  const playerId = captain.team[slotIndex];
                  const player = playerById(playerId);
                  return player ? `
                    <article class="team-member">
                      <div>
                        <strong>${escapeHtml(player.name)}</strong>
                        <span>${escapeHtml(Hexcore2.selectors.campLabel(player.camp))} · ${escapeHtml(player.lane || '未知')} · ${escapeHtml(Hexcore2.state.settings.tierNames[player.tier] || '未知卡池')} · 评分 ${player.score}</span>
                        <small>ID：${escapeHtml(player.gameId || player.id)}</small>
                      </div>
                      <div class="team-member-actions">
                        <button onclick='window.hexcoreUI.promotePlayerToCaptain(${safeJsonString(player.id)})'>设为队长</button>
                        <button onclick='window.hexcoreUI.removePlayerFromTeam(${safeJsonString(captain.id)}, ${safeJsonString(player.id)})'>移回池</button>
                      </div>
                    </article>
                  ` : `
                    <article class="team-member empty-member">
                      <div>
                        <strong>空位 ${slotIndex + 1}</strong>
                        <span>${goldShopMode ? '等待商店购买或终局随机补位' : '等待购买或补录队员'}</span>
                        <small>当前未满员</small>
                      </div>
                    </article>
                  `;
                }).join('')}
              </div>
              <div class="backfill-tools">
                ${goldShopMode ? `
                  <p class="hint">金币模式已禁用手动补录，队员来源限定为商店购买和四轮结束后的随机补位。</p>
                ` : `
                  <select id="team-add-player-${escapeHtml(captain.id)}" aria-label="${escapeHtml(captain.name)} 补录选手">
                    <option value="">选择可补录选手</option>
                    ${availablePlayers.map(player => `<option value="${player.id}">${escapeHtml(player.name)} · ${escapeHtml(player.lane || '未知')} · ${escapeHtml(Hexcore2.state.settings.tierNames[player.tier])} · ${player.score}</option>`).join('')}
                  </select>
                  <button onclick='window.hexcoreUI.assignPlayerToTeam(${safeJsonString(captain.id)})'>补录队员</button>
                `}
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
    const campFilters = (Hexcore2.state.ui && Hexcore2.state.ui.playerCampFilters) || {};
    const camps = [
      { id: 'local', label: '本地人卡池' },
      { id: 'outsider', label: '外地人卡池' },
    ];
    function statusLabel(player, owner) {
      if (Hexcore2.selectors.isCaptainPlayer(player.id)) return '队长锁定';
      if (player.status === 'available') return '可选';
      if (player.status === 'disabled') return '已禁用';
      return `已入队${owner ? `：${owner.name}` : ''}`;
    }
    function statusClass(player) {
      if (Hexcore2.selectors.isCaptainPlayer(player.id)) return 'captain';
      return player.status === 'available' ? 'available' : (player.status === 'disabled' ? 'disabled' : 'drafted');
    }
    function poolReason(player, rank, total) {
      return `${Hexcore2.selectors.campLabel(player.camp)}独立评分第 ${rank}/${total}，显示在 ${player.tier} 费池`;
    }
    function visibleByCampFilter(player, camp) {
      const filter = campFilters[camp] || 'all';
      if (filter === 'all') return true;
      return Number(filter) === player.tier;
    }
    function playerRow(player, rank, total) {
      const owner = player.teamId ? Hexcore2.state.captains.find(captain => captain.id === player.teamId) : null;
      const isCaptain = Hexcore2.selectors.isCaptainPlayer(player.id);
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
                ` : `<strong>${escapeHtml(player.name)}</strong>`}
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
            <em class="${statusClass(player)}">${escapeHtml(statusLabel(player, owner))}</em>
          </div>
          <div class="player-edit-grid">
            <label><small>偏好位置</small><input id="player-lane-${escapeHtml(player.id)}" value="${escapeHtml(player.lane || '未知')}" onblur='window.hexcoreUI.autoSavePlayerIfChanged(${safeJsonString(player.id)})' onkeydown='if(event.key==="Enter") window.hexcoreUI.savePlayer(${safeJsonString(player.id)})'></label>
            <label><small>绝活英雄</small><input id="player-heroes-${escapeHtml(player.id)}" value="${escapeHtml((player.heroes || []).join('、'))}" placeholder="用顿号分隔" onblur='window.hexcoreUI.autoSavePlayerIfChanged(${safeJsonString(player.id)})' onkeydown='if(event.key==="Enter") window.hexcoreUI.savePlayer(${safeJsonString(player.id)})'></label>
            <label class="manifesto-field"><small>参赛宣言</small><textarea id="player-manifesto-${escapeHtml(player.id)}" rows="2" placeholder="填写这名选手的参赛宣言" onblur='window.hexcoreUI.autoSavePlayerIfChanged(${safeJsonString(player.id)})'>${escapeHtml(player.manifesto || '')}</textarea></label>
            <div class="readonly-score"><span>评分</span><strong>${escapeHtml(player.score || 0)}</strong></div>
            <div class="readonly-score"><span>阵营</span><strong>${escapeHtml(Hexcore2.selectors.campLabel(player.camp))}</strong></div>
            <div class="pool-reason"><span>${escapeHtml(poolReason(player, rank, total))}</span></div>
          </div>
          <div class="player-actions">
            ${isCaptain
              ? `<button class="promote-inline" onclick='window.hexcoreUI.releaseCaptain(${safeJsonString(player.id)})'>解除队长</button>`
              : (canPromote ? `<button class="promote-inline" onclick='window.hexcoreUI.promotePlayerToCaptain(${safeJsonString(player.id)})'>设为队长</button>` : '<button disabled>不可设为队长</button>')}
            ${isCaptain ? '' : `<button class="${player.status === 'disabled' ? '' : 'danger-inline'}" onclick='window.hexcoreUI.togglePlayerDisabled(${safeJsonString(player.id)})'>${player.status === 'disabled' ? '恢复' : '禁用'}</button>`}
            <button class="danger-inline" onclick='window.hexcoreUI.deletePlayer(${safeJsonString(player.id)})'>删除</button>
          </div>
        </article>
      `;
    }
    return `
      ${pageHeader('选手库', '按本地人和外地人双阵营卡池查看选手状态、评分、位置和归属队伍。')}
      <section class="data-panel">
        <div class="toolbar-row">
          <div>
            <strong>选手总数：${Hexcore2.state.players.length}/50</strong>
            <span>本模式固定本地人25人、外地人25人；每个阵营队伍数不得超过阵营人数/5，队长保留在对应费用池并标记队长锁定。</span>
          </div>
          <div class="toolbar-actions">
            <button class="primary-btn" ${Hexcore2.state.players.length >= 50 ? 'disabled' : ''} onclick="window.hexcoreUI.addPlayer()">新增选手</button>
            <button class="subtle-btn" ${Hexcore2.state.players.length >= 50 ? 'disabled' : ''} onclick="document.getElementById('player-import-input').click()">导入 JSON/CSV</button>
            <button class="danger-inline" onclick="window.hexcoreUI.clearAllPlayers()">清空所有选手</button>
            <input id="player-import-input" type="file" accept=".json,.csv,application/json,text/csv" hidden onchange="window.hexcoreUI.importPlayers(this.files[0]); this.value = ''">
          </div>
        </div>
        <div class="camp-pool-grid">
          ${camps.map(camp => {
            const players = Hexcore2.state.players
              .filter(player => player.camp === camp.id)
              .slice()
              .sort((a, b) => b.tier - a.tier || (Number(b.resultScore) || 0) - (Number(a.resultScore) || 0) || (Number(b.score) || 0) - (Number(a.score) || 0));
            const captainCount = players.filter(player => Hexcore2.selectors.isCaptainPlayer(player.id)).length;
            const availableCount = players.filter(player => player.status === 'available' && !Hexcore2.selectors.isCaptainPlayer(player.id)).length;
            const teamLimit = Hexcore2.selectors.campTeamLimit(camp.id);
            return `
              <section class="camp-pool-panel">
                <div class="camp-pool-head">
                  <div>
                    <h2>${escapeHtml(camp.label)} ${players.length}/25</h2>
                    <span>队长 ${captainCount}/${teamLimit} · 可抽队员 ${availableCount}/20</span>
                  </div>
                  <select aria-label="${escapeHtml(camp.label)}费用筛选" onchange='window.hexcoreUI.setPlayerCampFilter(${safeJsonString(camp.id)}, this.value)'>
                    <option value="all" ${(campFilters[camp.id] || 'all') === 'all' ? 'selected' : ''}>全部</option>
                    ${[1, 2, 3, 4, 5].map(tier => `<option value="${tier}" ${String(campFilters[camp.id]) === String(tier) ? 'selected' : ''}>${tier}费</option>`).join('')}
                  </select>
                </div>
                <div class="pool-columns camp-tier-columns">
                  ${[5, 4, 3, 2, 1].map(tier => {
                    const tierPlayers = players.filter(player => player.tier === tier && visibleByCampFilter(player, camp.id));
                    return `
                      <div class="pool-column">
                        <h2>${escapeHtml(tierNames[tier])}池 <small>${players.filter(player => player.tier === tier).length}/5</small></h2>
                        ${tierPlayers.map(player => playerRow(player, players.findIndex(item => item.id === player.id) + 1, players.length)).join('') || '<div class="empty-log">暂无选手</div>'}
                      </div>
                    `;
                  }).join('')}
                </div>
              </section>
            `;
          }).join('')}
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
            <button class="primary-btn" onclick="window.hexcoreUI.nextHexcoreCaptain()">下一位</button>
            <button class="primary-btn" onclick="window.hexcoreUI.randomizeHexcoreDrawOrder()">${Hexcore2.icon('refresh')}制定抽取顺序</button>
            <button class="primary-btn" onclick="window.hexcoreUI.resetAllHexcores()">${Hexcore2.icon('undo')}重置所有海克斯</button>
          </div>
        </div>
        ${drawOrder.length ? `
          <div class="hex-draw-order">
            <strong>抽取顺序</strong>
            ${drawOrder.map((captainId, index) => {
              const item = Hexcore2.state.captains.find(captain => captain.id === captainId);
              return item ? `
                <span>${index + 1}. ${escapeHtml(item.name)}</span>
                ${index < drawOrder.length - 1 ? '<i aria-hidden="true">→</i>' : ''}
              ` : '';
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
              <article class="owned-hex-card ${escapeHtml(hex.type)}">
                <div class="owned-hex-main">
                  <div class="owned-hex-icon" aria-hidden="true">${hexcoreGlyph(hex)}</div>
                  <div>
                    <strong>${escapeHtml(hex.name)}</strong>
                    <p>${escapeHtml(hex.desc)}</p>
                  </div>
                </div>
                <div class="owned-hex-meta">
                  <span>${hexcoreTierLabel(hex)}</span>
                  <span>${hexcoreKindLabel(hex)}</span>
                  <span>${hexcoreUseLabel(hex)}</span>
                </div>
                <button onclick='window.hexcoreUI.removeHexcore(${safeJsonString(selectedCaptain.id)}, ${safeJsonString(hex.id)})'>移除</button>
              </article>
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
      if (captain.team.length >= Hexcore2.selectors.teamMemberCapacity(captain.id)) return { label: '满员', className: 'done' };
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
    const assignedCaptainIds = new Set((tournament.rounds[0] && tournament.rounds[0].matches
      ? tournament.rounds[0].matches.flatMap(match => [match.teamAId, match.teamBId])
      : []).filter(Boolean));
    const teamDragCard = (captain, assigned = false) => `
      <button class="tournament-team-chip ${assigned ? 'assigned' : ''}" draggable="true"
        ondragstart='event.dataTransfer.setData("text/plain", ${safeJsonString(captain.id)}); window.hexcoreUI.setTournamentDragCaptain(${safeJsonString(captain.id)})'>
        <strong>${escapeHtml(captain.name)}</strong>
        <span>${assigned ? '已在赛程' : '待放入'}</span>
      </button>
    `;
    const tournamentSlot = (round, match, side, teamId, disabled = false) => {
      const teamName = teamId ? captainName(teamId) : '拖入队伍';
      return `
        <label class="tournament-slot ${teamId ? 'filled' : 'empty'} ${disabled ? 'locked' : ''}"
          ${disabled ? '' : `ondragover="event.preventDefault()" ondrop='event.preventDefault(); window.hexcoreUI.assignTournamentSlot(${safeJsonString(round.id)}, ${safeJsonString(match.id)}, ${safeJsonString(side)}, event.dataTransfer.getData("text/plain"))'`}>
          <span class="slot-team" ${teamId && !disabled ? `draggable="true" ondragstart='event.dataTransfer.setData("text/plain", ${safeJsonString(teamId)}); window.hexcoreUI.setTournamentDragCaptain(${safeJsonString(teamId)})'` : ''}>${escapeHtml(teamName)}</span>
          <input id="tournament-score-${escapeHtml(round.id)}-${escapeHtml(match.id)}-${side.toLowerCase()}" type="number" min="0" value="${escapeHtml(side === 'A' ? match.scoreA : match.scoreB)}" ${disabled ? 'disabled' : ''}>
        </label>
      `;
    };
    const sourceLabel = (roundIndex, matchIndex, side) => {
      if (roundIndex === 0) return '';
      const prevIndex = matchIndex * 2 + (side === 'A' ? 0 : 1);
      const prevRound = tournament.rounds[roundIndex - 1];
      const source = prevRound && prevRound.matches[prevIndex];
      return source ? `${source.id.toUpperCase()}胜者` : '轮空晋级';
    };
    const bracketCard = (round, match, roundIndex, matchIndex) => {
      const teamA = match.teamAId ? captainName(match.teamAId) : '待定';
      const hasBye = Boolean(match.teamAId && !match.teamBId && match.status === 'bye');
      const teamB = match.teamBId ? captainName(match.teamBId) : (hasBye ? '轮空' : '待定');
      const winner = match.winnerId ? captainName(match.winnerId) : '待产生';
      const linked = Boolean(roundIndex > 0 || (roundIndex < tournament.rounds.length - 1 && match.winnerId));
      return `
        <article class="bracket-match ${match.status} ${linked ? 'linked' : ''} ${match.winnerId ? 'advanced' : ''}">
          <div class="bracket-match-head">
            <strong>${escapeHtml(match.id.toUpperCase())}</strong>
            <span>${match.status === 'completed' ? '已结束' : (match.status === 'bye' ? '轮空' : '待赛')}</span>
          </div>
          ${roundIndex > 0 ? `<div class="bracket-source">${escapeHtml(sourceLabel(roundIndex, matchIndex, 'A'))}${match.teamBId ? ` / ${escapeHtml(sourceLabel(roundIndex, matchIndex, 'B'))}` : ''}</div>` : ''}
          <div class="bracket-team ${match.winnerId && match.winnerId === match.teamAId ? 'winner' : ''}">
            <span>${escapeHtml(teamA)}</span>
            <em>${hasBye ? 'BYE' : (match.scoreA === '' ? '-' : escapeHtml(match.scoreA))}</em>
          </div>
          <div class="bracket-team ${hasBye ? 'bye-slot' : ''} ${match.winnerId && match.winnerId === match.teamBId ? 'winner' : ''}">
            <span>${escapeHtml(teamB)}</span>
            <em>${match.scoreB === '' ? '-' : escapeHtml(match.scoreB)}</em>
          </div>
          <div class="bracket-advance">晋级：${escapeHtml(winner)}</div>
        </article>
      `;
    };

    return `
      ${pageHeader('赛程', '为金币商店组队结束后的队伍安排淘汰赛赛程，录入比分后系统自动晋级胜者。')}
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
        <section class="data-panel tournament-seed-panel">
          <div>
            <h2>拖拽排位</h2>
            <p>拖动队伍到首轮比赛框的 A/B 槽位。调整后会清空比分并重算后续晋级。</p>
          </div>
          <div class="tournament-team-bank">
            ${Hexcore2.state.captains.map(captain => teamDragCard(captain, assignedCaptainIds.has(captain.id))).join('')}
          </div>
        </section>
        <section class="tournament-board">
          <div class="section-title-row tournament-table-title">
            <h2>赛程表</h2>
            <span>录入比分、保存结果，系统自动判定胜者并推进后续轮次。</span>
          </div>
          ${tournament.rounds.map((round, roundIndex) => `
            <div class="tournament-round">
              <h2>${escapeHtml(round.name)}</h2>
              <div class="tournament-match-list">
                ${round.matches.map(match => {
                  const hasBye = Boolean(match.teamAId && !match.teamBId);
                  const winnerName = match.winnerId ? captainName(match.winnerId) : '待定';
                  const locked = roundIndex !== 0 || hasBye;
                  return `
                    <article class="tournament-match ${match.status}">
                      <div class="match-head">
                        <strong>${escapeHtml(match.id.toUpperCase())}</strong>
                        <span>${match.status === 'bye' ? '轮空晋级' : (match.status === 'completed' ? '已结束' : '待录分')}</span>
                      </div>
                      <div class="match-score-row">
                        ${tournamentSlot(round, match, 'A', match.teamAId, locked)}
                        <em>VS</em>
                        ${tournamentSlot(round, match, 'B', match.teamBId, locked)}
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
        <section class="data-panel tournament-chart-panel">
          <div class="section-title-row">
            <h2>赛程图</h2>
            <span>横向查看每轮晋级路径，比分保存后自动生成下一轮。</span>
          </div>
          <div class="tournament-bracket" style="grid-template-columns: repeat(${tournament.rounds.length}, minmax(260px, 1fr));">
            ${tournament.rounds.map((round, roundIndex) => `
              <div class="bracket-round">
                <h3>${escapeHtml(round.name)}</h3>
                <div class="bracket-match-stack">
                  ${round.matches.map((match, matchIndex) => bracketCard(round, match, roundIndex, matchIndex)).join('')}
                </div>
              </div>
            `).join('')}
          </div>
        </section>
      ` : `
        <section class="data-panel empty-tournament">
          <h2>暂无赛程</h2>
          <p>点击“生成淘汰赛赛程”后，系统会按当前基础顺位为所有队伍自动配对。金币商店组队流程不会被赛程页面修改。</p>
        </section>
      `}
    `;
  }

  function rulesPage() {
    const disabledHexcores = new Set(Hexcore2.state.settings.disabledHexcores || []);
    const probabilityRows = [1, 2, 3, 4].map(round => {
      const probabilities = Hexcore2.shopEngine.probabilityForRound(round);
      return `
        <div class="rule-block">
          <strong>第 ${round} 轮</strong>
          <span>${[1, 2, 3, 4, 5].map(tier => `${escapeHtml(Hexcore2.state.settings.tierNames[tier])} ${probabilities[tier] || 0}%`).join(' / ')}</span>
        </div>
      `;
    }).join('');
    const tierNameFields = [0, 1, 2, 3, 4, 5].map(tier => `
      <label>
        <span>${tier === 0 ? '队长卡池名称' : `${tier}费卡池名称`}</span>
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
            <span>每队人数（含队长）</span>
            <input id="rules-players-per-team" type="number" min="2" max="8" value="${Hexcore2.state.settings.playersPerTeam}">
          </label>
          <label>
            <span>最大轮数（官方固定）</span>
            <input id="rules-max-rounds" type="number" min="4" max="4" value="4" readonly>
          </label>
          <label>
            <span>当前轮次</span>
            <input id="rules-current-round" type="number" min="1" max="${Hexcore2.state.draft.maxRounds}" value="${Hexcore2.state.draft.round}">
          </label>
          <label>
            <span>商店张数（官方固定）</span>
            <input id="rules-draw-count" type="number" min="5" max="5" value="5" readonly>
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
        <div class="rules-grid">
          <div class="rule-block"><strong>金币经济</strong><span>开局 ${Hexcore2.state.settings.initialGold} 金币，第2-4轮各 +${Hexcore2.state.settings.roundIncome} 金币，无利息。</span></div>
          <div class="rule-block"><strong>刷新费用</strong><span>每轮首次商店免费；之后刷新 1、2、3、4 金币，4金币封顶。</span></div>
          <div class="rule-block"><strong>购买规则</strong><span>每名队长每轮最多购买1名队员，队员价格等于费用。</span></div>
          <div class="rule-block"><strong>补位规则</strong><span>四轮结束后阵容不足时，从剩余1-5费队员中随机补位，不消耗金币。</span></div>
          ${probabilityRows}
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
              <span>${escapeHtml(template.savedAt)} / ${escapeHtml(template.teamCount)} 队 / 每队 ${escapeHtml(template.playersPerTeam)} 人（含队长） / ${escapeHtml(template.maxRounds)} 轮</span>
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
            <div class="draft-main-column">
              ${playerCards()}
              ${refereeControls()}
              ${rosterRail()}
            </div>
            <div class="draft-side-column">
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
      ${playerImportPreviewModal()}
      <div id="toast-root" aria-live="polite"></div>
    `;
  }

  Hexcore2.ui = {
    renderFeedback() {
      const root = document.getElementById('toast-root');
      if (root) root.innerHTML = feedbackToast();
    },

    render() {
      const shouldResetScroll = Boolean(Hexcore2.state.ui && Hexcore2.state.ui.resetScrollOnRender);
      if (Hexcore2.state.ui) delete Hexcore2.state.ui.resetScrollOnRender;
      const scrollTarget = document.scrollingElement || document.documentElement;
      const scrollLeft = shouldResetScroll ? 0 : (scrollTarget ? scrollTarget.scrollLeft : 0);
      const scrollTop = shouldResetScroll ? 0 : (scrollTarget ? scrollTarget.scrollTop : 0);
      const scrollSelectors = ['.app-main', '.workspace-main', '.page-workspace', '.event-rail'];
      const elementScrolls = document.querySelector ? scrollSelectors.map(selector => {
        const element = document.querySelector(selector);
        return {
          selector,
          left: shouldResetScroll ? 0 : (element ? element.scrollLeft : 0),
          top: shouldResetScroll ? 0 : (element ? element.scrollTop : 0),
        };
      }) : [];
      applyTheme();
      document.getElementById('app').innerHTML = app();
      this.renderFeedback();
      const restoreScroll = () => {
        if (scrollTarget) {
          scrollTarget.scrollLeft = scrollLeft;
          scrollTarget.scrollTop = scrollTop;
        }
        if (document.querySelector) {
          elementScrolls.forEach(item => {
            const element = document.querySelector(item.selector);
            if (!element) return;
            element.scrollLeft = item.left;
            element.scrollTop = item.top;
          });
        }
      };
      restoreScroll();
      if (global.requestAnimationFrame) global.requestAnimationFrame(restoreScroll);
    },
  };
})(window);
