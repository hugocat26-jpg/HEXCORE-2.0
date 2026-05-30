(function initRefereeConsole(global) {
  const Hexcore2 = global.Hexcore2 || (global.Hexcore2 = {});
  const MULTIPLAYER_SESSION_KEY = 'hexcore2_multiplayer_session_v1';
  const MULTIPLAYER_TAB_SESSION_KEY = 'hexcore2_multiplayer_session_tab_v1';
  const SYSTEM_ADMIN_SESSION_KEY = 'hexcore2_system_admin_session_v1';
  const MANAGEMENT_ROLES = ['referee', 'tournament_admin', 'super_admin'];

  function playerById(playerId) {
    return Hexcore2.state.players.find(player => player.id === playerId);
  }

  function captainById(captainId) {
    return Hexcore2.state.captains.find(captain => captain.id === captainId);
  }

  function captainName(captainId) {
    const captain = captainById(captainId);
    return captain ? captain.name : '待定';
  }

  function versionLabel() {
    const meta = Hexcore2.meta || {};
    return `${meta.product || 'HEXCORE 2.0'} v${meta.version || '2.0'} 裁判端`;
  }

  function queryParam(name) {
    const search = global.location && typeof global.location.search === 'string' ? global.location.search : '';
    const pattern = new RegExp(`[?&]${name}=([^&]*)`);
    const match = search.match(pattern);
    return match ? decodeURIComponent(match[1].replace(/\+/g, ' ')) : '';
  }

  function clientRole() {
    const session = storedMultiplayerSession();
    const role = (queryParam('role') || queryParam('view') || queryParam('mode') || (session && session.role) || '').toLowerCase();
    return role === 'viewer' ? 'viewer' : (role === 'captain' ? 'captain' : (role === 'admin' || role === 'super_admin' || role === 'tournament_admin' ? 'admin' : 'referee'));
  }

  function hasExplicitClientRole() {
    return Boolean(queryParam('role') || queryParam('view') || queryParam('mode'));
  }

  function isAdminStandaloneRoute() {
    const pathname = String(global.location && global.location.pathname ? global.location.pathname : '/').replace(/\/+$/, '');
    return pathname === '/admin';
  }

  function readStoredJson(storage, key) {
    try {
      const raw = storage && storage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function sessionMatchesCurrentRoute(session) {
    if (!session) return false;
    const requestedRole = (queryParam('role') || queryParam('view') || queryParam('mode') || '').toLowerCase();
    if (!requestedRole) return true;
    const sessionRole = String(session.role || '').toLowerCase();
    if (requestedRole === 'viewer') return sessionRole === 'viewer';
    if (requestedRole === 'captain') {
      const requestedTeamId = queryParam('teamId') || queryParam('captainId');
      return sessionRole === 'captain' && (!requestedTeamId || String(session.teamId || '') === requestedTeamId);
    }
    if (requestedRole === 'referee') return sessionRole === 'referee';
    if (requestedRole === 'admin' || requestedRole === 'super_admin' || requestedRole === 'tournament_admin') {
      return isManagementRole(sessionRole) && sessionRole !== 'referee';
    }
    return true;
  }

  function storedMultiplayerSession() {
    const tabSession = readStoredJson(global.sessionStorage, MULTIPLAYER_TAB_SESSION_KEY);
    if (tabSession) return tabSession;
    const fallbackSession = readStoredJson(global.localStorage, MULTIPLAYER_SESSION_KEY);
    return sessionMatchesCurrentRoute(fallbackSession) ? fallbackSession : null;
  }

  function storedSystemAdminSession() {
    try {
      const raw = global.localStorage && global.localStorage.getItem(SYSTEM_ADMIN_SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function validRoleSession(session) {
    return Boolean(session && ['referee', 'tournament_admin', 'super_admin', 'captain', 'viewer'].includes(String(session.role || '').toLowerCase()));
  }

  function isManagementRole(role) {
    return MANAGEMENT_ROLES.includes(String(role || '').toLowerCase());
  }

  function isAdminClient() {
    const session = storedMultiplayerSession();
    return clientRole() === 'admin' || Boolean(session && isManagementRole(session.role) && session.role !== 'referee');
  }

  function roomCommandSubmitting(type = '') {
    const submitting = Hexcore2.state.ui && Hexcore2.state.ui.roomCommandSubmitting;
    if (!submitting || !submitting.type) return false;
    return !type || submitting.type === type;
  }

  function shortSyncTime(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return '未同步';
    return date.toLocaleTimeString('zh-CN', { hour12: false });
  }

  function sessionRemainingLabel(session) {
    const expiresAt = session && Date.parse(session.expiresAt || '');
    if (!Number.isFinite(expiresAt)) return '未知';
    const remainingSeconds = Math.ceil((expiresAt - Date.now()) / 1000);
    if (remainingSeconds <= 0) return '已过期';
    const hours = Math.floor(remainingSeconds / 3600);
    const minutes = Math.ceil((remainingSeconds % 3600) / 60);
    return hours > 0 ? `${hours}小时${minutes}分` : `${Math.max(1, minutes)}分`;
  }

  function roomSyncInfo() {
    const session = storedMultiplayerSession();
    const rawStatus = (Hexcore2.state.ui && Hexcore2.state.ui.roomSyncStatus) || (session ? 'online' : '');
    const expired = session && session.expiresAt && Date.parse(session.expiresAt) <= Date.now();
    const status = expired ? 'expired' : rawStatus;
    const labels = {
      online: '在线',
      submitting: '提交中',
      reconnecting: '重连中',
      offline: '离线',
      expired: '已过期',
    };
    return {
      session,
      status,
      label: labels[status] || '本地',
      version: session && Number.isInteger(Number(session.stateVersion)) ? Number(session.stateVersion) : 0,
      lastSynced: shortSyncTime(session && (session.syncedAt || session.savedAt)),
      remaining: sessionRemainingLabel(session),
    };
  }

  function topbarRoleItems(captain, roleStatus, syncInfo) {
    const ownCaptain = clientCaptain();
    const syncVersion = syncInfo.version ? `v${syncInfo.version}` : '未同步';
    const syncDetail = `${syncVersion} · ${syncInfo.lastSynced}`;
    const currentName = captain ? captain.name : '无';
    if (isViewerClient()) {
      return [
        { label: '身份', value: '观众端', detail: '只读进入' },
        { label: '视角', value: currentName, detail: '跟随当前回合队长' },
        { label: '权限', value: roleStatus, detail: '可看商店、海克斯和公开队伍', tone: 'readonly' },
        { label: '同步', value: syncInfo.label, detail: syncDetail, tone: syncInfo.status || 'local' },
        { label: '会话', value: syncInfo.remaining, detail: syncInfo.session ? '本机已加入' : '未加入' },
      ];
    }
    if (isCaptainClient()) {
      const isOwnTurn = captainCanOperateCurrentTurn();
      const hasHexWindow = Hexcore2.state.multiplayer && Array.isArray(Hexcore2.state.multiplayer.hexcoreActionWindows)
        && Hexcore2.state.multiplayer.hexcoreActionWindows.some(window => window && window.active !== false && window.teamId === clientTeamId());
      return [
        { label: '身份', value: '队长端', detail: ownCaptain ? ownCaptain.name : '未绑定队伍' },
        { label: '视角', value: currentName, detail: isOwnTurn ? '本人回合' : '跟随当前回合队长' },
        {
          label: '权限',
          value: roleStatus,
          detail: isOwnTurn ? '可抽选、购买和维护本队' : (hasHexWindow ? '仅限允许的海克斯操作' : '当前只能查看'),
          tone: isOwnTurn || hasHexWindow ? 'active' : 'readonly',
        },
        { label: '同步', value: syncInfo.label, detail: syncDetail, tone: syncInfo.status || 'local' },
        { label: '会话', value: syncInfo.remaining, detail: syncInfo.session ? '本机已加入' : '未加入' },
      ];
    }
    return [
      { label: '身份', value: isAdminClient() ? '管理员端' : '裁判端', detail: isAdminClient() ? '最高权限' : '主持与管理' },
      { label: '视角', value: currentName, detail: '全局裁判视角' },
      { label: '权限', value: roleStatus, detail: isAdminClient() ? '可管理房间并执行全部命令' : '可代执行、修正和管理赛事', tone: 'active' },
      { label: '同步', value: syncInfo.label, detail: syncDetail, tone: syncInfo.status || 'local' },
      { label: '会话', value: syncInfo.remaining, detail: syncInfo.session ? '本机已加入' : '未加入' },
    ];
  }

  function topbarRoleStrip(captain, roleStatus, syncInfo) {
    const items = topbarRoleItems(captain, roleStatus, syncInfo);
    return `
      <div class="role-status-strip" aria-label="当前身份、权限和同步状态">
        ${items.map(item => `
          <span class="role-status-pill ${escapeHtml(item.tone || '')}">
            <em>${escapeHtml(item.label)}</em>
            <strong class="${item.label === '同步' ? `sync-state ${escapeHtml(syncInfo.status || 'local')}` : ''}">${escapeHtml(item.value)}</strong>
            <small>${escapeHtml(item.detail)}</small>
          </span>
        `).join('')}
      </div>
    `;
  }

  function shouldShowJoinGate() {
    if (isAdminStandaloneRoute()) return false;
    const session = storedMultiplayerSession();
    if (!session) return true;
    if (hasExplicitClientRole()) return !validRoleSession(session);
    return false;
  }

  function pageTitleText() {
    if (isAdminStandaloneRoute()) return 'HEXCORE 2.0 管理员后台';
    if (shouldShowJoinGate()) return 'HEXCORE 2.0 多人登录页';
    if (isViewerClient()) return 'HEXCORE 2.0 观众端';
    if (isCaptainClient()) return 'HEXCORE 2.0 队长端';
    if (isAdminClient()) return 'HEXCORE 2.0 管理员端';
    return 'HEXCORE 2.0 裁判端';
  }

  function updateDocumentTitle() {
    if (global.document) global.document.title = pageTitleText();
  }

  function isCaptainClient() {
    return clientRole() === 'captain';
  }

  function isViewerClient() {
    return clientRole() === 'viewer';
  }

  function isReadonlyClient() {
    return isViewerClient();
  }

  function clientTeamId() {
    if (!isCaptainClient()) return '';
    const session = storedMultiplayerSession();
    const requested = queryParam('teamId') || queryParam('captainId') || (session && session.teamId);
    if (requested && Hexcore2.state.captains.some(captain => captain.id === requested)) return requested;
    const current = Hexcore2.selectors.currentCaptain && Hexcore2.selectors.currentCaptain();
    return current ? current.id : (Hexcore2.state.captains[0] ? Hexcore2.state.captains[0].id : '');
  }

  function clientCaptain() {
    const teamId = clientTeamId();
    return Hexcore2.state.captains.find(captain => captain.id === teamId) || null;
  }

  function captainCanOperateCurrentTurn() {
    if (!isCaptainClient()) return true;
    const timer = Hexcore2.state && Hexcore2.state.activeTurnTimer;
    const phase = String((timer && timer.phase) || '').trim();
    if (phase === 'hexcore_prepare' || phase === 'gold_shop_prepare') return false;
    const current = Hexcore2.selectors.currentCaptain && Hexcore2.selectors.currentCaptain();
    return Boolean(current && current.id === clientTeamId());
  }

  function captainCanUseHexcoreFor(captainId) {
    return !isCaptainClient() || captainId === clientTeamId();
  }

  function captainHexcoreActionAttr(captainId, enabledAction) {
    if (!enabledAction) return 'disabled title="当前海克斯不可发动"';
    if (captainCanUseHexcoreFor(captainId)) return '';
    return 'disabled title="队长端仅可发动自己的海克斯"';
  }

  function captainClientReadonlyNotice() {
    if (!isCaptainClient()) return '';
    const own = clientCaptain();
    const boundName = own ? own.name : '未绑定队伍';
    return `
      <section class="workflow-gate captain-readonly-notice">
        <strong>队长端</strong>
        <p>当前绑定：${escapeHtml(boundName)}。本人回合可完成海克斯选择、金币商店抽选和本队信息维护；其它队长回合仅保留只读视角。</p>
      </section>
    `;
  }

  function viewerReadonlyNotice() {
    if (!isViewerClient()) return '';
    const current = Hexcore2.selectors.currentCaptain && Hexcore2.selectors.currentCaptain();
    return `
      <section class="workflow-gate captain-readonly-notice">
        <strong>观众端只读</strong>
        <p>当前回合队长视角：${escapeHtml(current ? current.name : '暂无当前队长')}。可查看当前商店、海克斯详情和公开队伍信息，无法执行任何操作。</p>
      </section>
    `;
  }

  function roomIsArchived() {
    return Boolean(Hexcore2.state.multiplayer && Hexcore2.state.multiplayer.roomStatus === 'archived');
  }

  function roomArchivedNotice() {
    if (!roomIsArchived()) return '';
    return `
      <section class="workflow-gate archived-room-notice">
        <strong>归档房间只读</strong>
        <p>该房间已归档，服务端会拒绝新的抽卡、改名、替补、海克斯和赛程写入；当前页面仅用于查看、导出和审计。</p>
      </section>
    `;
  }

  function refereeControlsForRoom() {
    if (roomIsArchived()) return '';
    return isReadonlyClient() ? '' : refereeControls();
  }

  function roomWelcomePanel() {
    const session = storedMultiplayerSession();
    const dismissed = Boolean((session && session.welcomeDismissedAt) || (Hexcore2.state.ui && Hexcore2.state.ui.roomWelcomeDismissed));
    if (dismissed || (!session && !hasExplicitClientRole()) || (!isCaptainClient() && !isViewerClient())) return '';
    const captain = clientCaptain();
    const current = Hexcore2.selectors.currentCaptain && Hexcore2.selectors.currentCaptain();
    const items = isCaptainClient()
      ? [
        `当前身份：${captain ? captain.name : '队长端'}`,
        captainCanOperateCurrentTurn() ? '现在是你的回合，可在实时抽选页完成可用操作。' : '当前不是你的回合，你会跟随当前队长视角只读观看。',
        '队伍总览可查看全部队伍，但只有自己的队伍名称可编辑。',
        '海克斯图录只用于查看详情；赛程页只显示自己队伍相关场次。',
      ]
      : [
        `当前身份：观众端，只读查看${current ? ` ${current.name} ` : '当前回合队长'}视角。`,
        '实时抽选页会同步当前商店、海克斯详情和公开队伍信息。',
        '队伍总览与海克斯图录均为只读，不会出现写入操作。',
        '需要切换身份时，点击顶部“返回多人房间”重新加入。',
      ];
    return `
      <section class="room-welcome-panel" aria-label="加入房间后的首屏引导">
        <div>
          <strong>${isCaptainClient() ? '已进入队长端' : '已进入观众端'}</strong>
          <p>${isCaptainClient() ? '先确认顶部身份和权限，再按当前回合状态操作。' : '你正在以只读方式观看当前回合队长视角。'}</p>
        </div>
        <ul>
          ${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
        </ul>
        <button class="subtle-btn" onclick="window.hexcoreUI.dismissRoomWelcome()">知道了</button>
      </section>
    `;
  }

  function captainAllowedView(view) {
    return ['draft', 'teams', 'hexcores', 'tournament', 'rules'].includes(view);
  }

  function viewerAllowedView(view) {
    return ['draft', 'teams', 'hexcores'].includes(view);
  }

  function readonlyShopReason() {
    return isViewerClient() ? '观众端只读，无法操作' : '';
  }

  function createdRoomText(kind = 'all') {
    const created = Hexcore2.volatileCreatedRoom;
    const room = created && created.room;
    if (!room) return '';
    const captainCodes = Array.isArray(room.captainCodes) ? room.captainCodes : [];
    const apiBase = String(created.apiBase || '').trim();
    const tournamentId = created.tournamentId || room.tournamentId || '';
    const singleCaptainId = String(kind || '').startsWith('captain:') ? String(kind).slice('captain:'.length) : '';
    const singleCaptain = singleCaptainId ? captainCodes.find(item => String(item.teamId || '') === singleCaptainId) : null;
    if (singleCaptain) {
      return [
        `服务地址：${apiBase}`,
        `赛事 ID：${tournamentId}`,
        `身份：${singleCaptain.teamName || singleCaptain.teamId || '队长'}`,
        `加入码：${singleCaptain.code || ''}`,
      ].join('\n').trim();
    }
    if (kind === 'referee') {
      return [`服务地址：${apiBase}`, `赛事 ID：${tournamentId}`, '身份：裁判', `加入码：${room.refereeCode || ''}`].join('\n').trim();
    }
    if (kind === 'viewer') {
      return [`服务地址：${apiBase}`, `赛事 ID：${tournamentId}`, '身份：观众', `加入码：${room.viewerCode || ''}`].join('\n').trim();
    }
    const lines = [
      `服务地址：${apiBase}`,
      `赛事 ID：${tournamentId}`,
    ];
    if (kind === 'all' || kind === 'referee') lines.push(`裁判码：${room.refereeCode || ''}`);
    if (kind === 'all' || kind === 'viewer') lines.push(`观众码：${room.viewerCode || ''}`);
    if (kind === 'all' || kind === 'captains') {
      lines.push('', '队长码：');
      captainCodes.forEach(item => lines.push(`${item.teamName || item.teamId || '队伍'}：${item.code || ''}`));
    }
    return lines.join('\n').trim();
  }

  function createdRoomPanel() {
    const created = Hexcore2.volatileCreatedRoom;
    const room = created && created.room;
    const notice = Hexcore2.state.ui && Hexcore2.state.ui.createdRoomNotice;
    if (!room) {
      if (!notice || !notice.tournamentId) return '';
      return `
        <section class="created-room-panel created-room-panel-stale" aria-live="polite">
          <div class="created-room-head">
            <div>
              <strong>房间码明文已清空</strong>
              <span>${escapeHtml(notice.tournamentId || '')}</span>
            </div>
          </div>
          <div class="room-code-warning">为了避免旧房间码误导使用者，刷新页面后不再恢复房间码明文。请用已分发的房间码加入，或重新创建赛事并重新分发。</div>
        </section>
      `;
    }
    const captainCodes = Array.isArray(room.captainCodes) ? room.captainCodes : [];
    return `
      <section class="created-room-panel" aria-live="polite">
        <div class="created-room-head">
          <div>
            <strong>赛事已创建</strong>
            <span>${escapeHtml(created.tournamentId || room.tournamentId || '')}</span>
          </div>
          <div class="room-code-head-actions">
            <button class="subtle-btn" onclick="window.hexcoreUI.enterCreatedRefereeRoom()">用裁判码进入裁判端</button>
          </div>
        </div>
        <div class="room-code-warning">房间码明文只显示一次；刷新页面后将无法再次查看，请立即分发给对应身份。</div>
        <div class="room-code-actions">
          <button class="subtle-btn" onclick="window.hexcoreUI.copyCreatedRoomCodes('all')">复制全部</button>
          <button class="subtle-btn" onclick="window.hexcoreUI.copyCreatedRoomCodes('referee')">复制裁判码</button>
          <button class="subtle-btn" onclick="window.hexcoreUI.copyCreatedRoomCodes('captains')">复制队长码</button>
          <button class="subtle-btn" onclick="window.hexcoreUI.copyCreatedRoomCodes('viewer')">复制观众码</button>
          <button class="subtle-btn" onclick="window.hexcoreUI.downloadCreatedRoomCodes()">下载 TXT</button>
        </div>
        <textarea class="room-code-copy-source" readonly aria-label="房间码文本">${escapeHtml(createdRoomText('all'))}</textarea>
        <div class="room-code-grid">
          <div class="room-code-row">
            <div class="room-code-row-head">
              <span>裁判码</span>
              <button class="subtle-btn" onclick="window.hexcoreUI.copyCreatedRoomCodes('referee')">复制</button>
            </div>
            <code>${escapeHtml(room.refereeCode || '')}</code>
          </div>
          <div class="room-code-row">
            <div class="room-code-row-head">
              <span>观众码</span>
              <button class="subtle-btn" onclick="window.hexcoreUI.copyCreatedRoomCodes('viewer')">复制</button>
            </div>
            <code>${escapeHtml(room.viewerCode || '')}</code>
          </div>
        </div>
        <div class="captain-code-list">
          ${captainCodes.map(item => `
            <div class="room-code-row">
              <div class="room-code-row-head">
                <span>${escapeHtml(item.teamName || item.teamId || '队伍')}</span>
                <button class="subtle-btn" onclick='window.hexcoreUI.copyCreatedRoomCodes(${safeJsonString(`captain:${item.teamId || ''}`)})'>复制</button>
              </div>
              <code>${escapeHtml(item.code || '')}</code>
            </div>
          `).join('') || '<div class="empty-log">暂无队长码</div>'}
        </div>
      </section>
    `;
  }

  function joinGateMessagePanel() {
    const message = Hexcore2.state.ui && Hexcore2.state.ui.joinGateMessage;
    if (!message) return '';
    const tips = Array.isArray(message.tips) ? message.tips.map(item => String(item || '').trim()).filter(Boolean).slice(0, 4) : [];
    return `
      <div class="join-gate-message ${escapeHtml(message.level || 'warn')}">
        <strong>${escapeHtml(message.text || '')}</strong>
        ${tips.length ? `<ul>${tips.map(tip => `<li>${escapeHtml(tip)}</li>`).join('')}</ul>` : ''}
      </div>
    `;
  }

  function joinGateAccessPanel(apiBase) {
    const location = global.location || {};
    const pageUrl = String(location.href || '').replace(/[?#].*$/, '') || 'http://裁判电脑IP:4186/';
    const hostname = String(location.hostname || '').trim();
    const isLocalHost = !hostname || /^(localhost|127\.0\.0\.1)$/.test(hostname);
    const apiText = String(apiBase || '').trim() || 'http://裁判电脑IP:4196';
    const recommendedPage = isLocalHost ? 'http://裁判电脑IP:4186/' : pageUrl;
    const recommendedApi = isLocalHost ? 'http://裁判电脑IP:4196' : apiText;
    const check = Hexcore2.state.ui && Hexcore2.state.ui.joinApiCheck;
    const checkDetails = check && Array.isArray(check.details) ? check.details.filter(Boolean).slice(0, 4) : [];
    const isChecking = check && check.level === 'info' && /正在检测/.test(String(check.text || ''));
    return `
      <div class="join-access-panel" aria-label="现场访问检查">
        <div class="join-access-head">
          <div>
            <strong>现场访问检查</strong>
            <span>${isLocalHost ? '当前是本机地址，客户电脑和手机不能直接使用 127.0.0.1。' : '当前页面已使用可分发地址，请确认 API 地址同样可访问。'}</span>
          </div>
          <div class="join-access-actions">
            <button class="subtle-btn" ${isChecking ? 'disabled' : ''} onclick="window.hexcoreUI.checkJoinApiHealth()">${isChecking ? '检测中' : '检测 API'}</button>
            <button class="subtle-btn" onclick="window.hexcoreUI.copyJoinGateAccessText()">复制访问说明</button>
          </div>
        </div>
        <div class="join-access-grid">
          <div><span>当前页面</span><code>${escapeHtml(pageUrl)}</code></div>
          <div><span>当前 API</span><code>${escapeHtml(apiText)}</code></div>
          <div><span>推荐页面</span><code>${escapeHtml(recommendedPage)}</code></div>
          <div><span>推荐 API</span><code>${escapeHtml(recommendedApi)}</code></div>
        </div>
        ${check ? `
          <div class="join-api-check ${escapeHtml(check.level || 'info')}">
            <strong>${escapeHtml(check.text || '')}</strong>
            ${checkDetails.length ? `<ul>${checkDetails.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}
          </div>
        ` : ''}
        <p>局域网演示时，先在裁判电脑启动页面 4186 和 API 4196；队长或观众设备需要连接同一个 Wi-Fi，并使用裁判电脑的局域网 IP。</p>
      </div>
    `;
  }

  function roomListPanel() {
    const roomList = Hexcore2.state.ui && Hexcore2.state.ui.roomList;
    const runtime = roomList && roomList.runtime && typeof roomList.runtime === 'object' ? roomList.runtime : {};
    const rooms = roomList && Array.isArray(roomList.rooms) ? roomList.rooms : [];
    const activeCount = Number(runtime.activeRoomCount) || 0;
    const maxRooms = Number(runtime.maxRooms) || 0;
    const level = roomList && roomList.level ? roomList.level : 'info';
    const statusLabel = status => status === 'archived' ? '已归档' : '活跃';
    const modeLabel = mode => mode === 'no_camp' ? '无阵营' : '双阵营';
    const pairingLabel = mode => mode === 'random' ? '随机赛程' : (mode === 'manual' ? '手动赛程' : '阵营对抗');
    const isLoading = level === 'info' && /正在读取/.test(String(roomList && roomList.text || ''));
    return `
      <div class="join-access-panel room-list-panel" aria-label="多人房间列表">
        <div class="join-access-head">
          <div>
            <strong>多人房间列表</strong>
            <span>${maxRooms ? `当前 active 房间 ${activeCount}/${maxRooms}` : '读取服务端后显示 active 房间上限。'} ${runtime.storage ? `存储：${escapeHtml(runtime.storage)}` : ''}</span>
          </div>
          <div class="join-access-actions">
            <button class="subtle-btn" ${isLoading ? 'disabled' : ''} onclick="window.hexcoreUI.loadRoomList()">${isLoading ? '读取中' : '刷新房间列表'}</button>
          </div>
        </div>
        ${roomList ? `<div class="join-api-check ${escapeHtml(level)}"><strong>${escapeHtml(roomList.text || '')}</strong></div>` : ''}
        <div id="join-room-list" class="room-list-table">
          ${rooms.length ? rooms.map(room => `
            <button class="room-list-row" type="button" onclick='window.hexcoreUI.openRoomActionDialog(${safeJsonString(room.tournamentId)})'>
              <div>
                <strong>${escapeHtml(room.name || room.tournamentId)}</strong>
                <span>${escapeHtml(room.tournamentId)} · ${escapeHtml(modeLabel(room.campMode))} · ${escapeHtml(pairingLabel(room.pairingMode))}</span>
              </div>
              <div><span>队伍</span><strong>${escapeHtml(room.teamCount || 0)}</strong></div>
              <div><span>订阅</span><strong>${escapeHtml(room.subscriberCount || 0)}</strong></div>
              <div><span>更新</span><strong>${escapeHtml(room.updatedAt || room.createdAt || '-')}</strong></div>
              <em class="room-list-status ${escapeHtml(room.status || 'active')}">${escapeHtml(statusLabel(room.status))}</em>
            </button>
          `).join('') : `<div class="empty-log">${roomList ? '当前服务端没有可显示房间，或列表读取失败。' : '点击“刷新房间列表”查看服务端现有房间和 active 上限。'}</div>`}
        </div>
      </div>
    `;
  }

  function roomActionDialog() {
    const dialog = Hexcore2.state.ui && Hexcore2.state.ui.roomActionDialog;
    if (!dialog || !dialog.tournamentId) return '';
    const roomList = Hexcore2.state.ui && Hexcore2.state.ui.roomList;
    const rooms = roomList && Array.isArray(roomList.rooms) ? roomList.rooms : [];
    const room = rooms.find(item => item.tournamentId === dialog.tournamentId);
    if (!room) return '';
    const status = room.status === 'archived' ? '已归档' : '活跃';
    const message = dialog.message && dialog.message.text ? dialog.message : null;
    return `
      <div class="modal-backdrop room-action-backdrop" role="dialog" aria-modal="true" aria-label="房间操作">
        <section class="form-modal room-action-modal">
          <div class="modal-head">
            <div>
              <h2>${escapeHtml(room.name || room.tournamentId)}</h2>
              <p>${escapeHtml(room.tournamentId)} · ${escapeHtml(status)} · ${escapeHtml(room.teamCount || 0)} 队 · ${escapeHtml(room.storage || 'unknown')}</p>
            </div>
            <button class="icon-close" type="button" onclick="window.hexcoreUI.closeRoomActionDialog()" aria-label="关闭">×</button>
          </div>
          <div class="room-action-body">
            <label>
              <span>加入码</span>
              <input id="room-action-code" placeholder="输入裁判码或队长码；观众可留空" aria-label="房间加入码" autocomplete="off">
            </label>
            <div class="room-action-buttons">
              <button class="primary-btn" type="button" ${room.status === 'archived' ? 'disabled' : ''} onclick="window.hexcoreUI.joinSelectedRoomWithCode()">用加入码进入</button>
              <button class="subtle-btn" type="button" ${room.status === 'archived' ? 'disabled' : ''} onclick="window.hexcoreUI.joinSelectedRoomAsViewer()">免码进入观众端</button>
              <button class="subtle-btn" type="button" ${room.status === 'archived' ? 'disabled' : ''} onclick="window.hexcoreUI.archiveSelectedRoom()">归档/关闭房间</button>
              <button class="danger-btn" type="button" onclick="window.hexcoreUI.deleteSelectedRoom()">删除房间</button>
            </div>
            <div class="modal-derived-note">
              <strong>操作说明</strong>
              <span>输入裁判码进入裁判端，输入队长码进入对应队长端；不输入加入码可直接进入观众端。归档和删除需要裁判码，系统管理员请在管理员后台操作。</span>
            </div>
            ${message ? `<div class="join-api-check ${escapeHtml(message.level || 'info')}"><strong>${escapeHtml(message.text)}</strong></div>` : ''}
          </div>
        </section>
      </div>
    `;
  }

  function adminPanel(apiBase) {
    const adminStatus = Hexcore2.state.ui && Hexcore2.state.ui.adminStatus;
    const message = Hexcore2.state.ui && Hexcore2.state.ui.adminMessage;
    const session = storedSystemAdminSession();
    const setupRequired = adminStatus ? Boolean(adminStatus.setupRequired) : false;
    const environmentSecretMode = adminStatus ? Boolean(adminStatus.environmentSecretMode) : false;
    const dashboard = Hexcore2.state.ui && Hexcore2.state.ui.adminDashboard;
    const roomList = dashboard && dashboard.roomList;
    const rooms = roomList && Array.isArray(roomList.rooms) ? roomList.rooms : [];
    const load = dashboard && dashboard.load && typeof dashboard.load === 'object' ? dashboard.load : {};
    const config = dashboard && dashboard.config && typeof dashboard.config === 'object'
      ? dashboard.config
      : (adminStatus && adminStatus.config ? adminStatus.config : {});
    const events = dashboard && Array.isArray(dashboard.events) ? dashboard.events : [];
    const statusText = adminStatus
      ? (setupRequired ? '未初始化' : (environmentSecretMode ? '环境口令模式' : '已初始化'))
      : '未检测';
    const authForm = session ? '' : `
      <div class="admin-auth-grid">
        <label>
          <span>显示名称</span>
          <input id="admin-display-name" value="系统管理员" aria-label="管理员显示名称">
        </label>
        <label>
          <span>${setupRequired ? '设置密码' : '管理员密码'}</span>
          <input id="admin-password" type="password" autocomplete="current-password" aria-label="管理员密码">
        </label>
        ${setupRequired && !environmentSecretMode ? `
          <label>
            <span>确认密码</span>
            <input id="admin-password-confirm" type="password" autocomplete="new-password" aria-label="确认管理员密码">
          </label>
        ` : ''}
        <div class="admin-auth-actions">
          <button class="subtle-btn" onclick="window.hexcoreUI.loadAdminStatus()">检测管理员状态</button>
          ${setupRequired && !environmentSecretMode
            ? '<button class="primary-btn" onclick="window.hexcoreUI.setupSystemAdmin()">首次设置并登录</button>'
            : '<button class="primary-btn" onclick="window.hexcoreUI.loginSystemAdmin()">登录管理员后台</button>'}
        </div>
      </div>
    `;
    const dashboardPanel = !session ? '' : `
      <div class="admin-dashboard">
        <div class="admin-dashboard-head">
          <div>
            <strong>管理员后台</strong>
            <span>${escapeHtml(session.displayName || '系统管理员')} · ${escapeHtml(session.apiBase || apiBase || '')}</span>
          </div>
          <div class="join-access-actions">
            <button class="subtle-btn" onclick="window.hexcoreUI.loadAdminDashboard()">刷新后台</button>
            <button class="subtle-btn" onclick="window.hexcoreUI.logoutSystemAdmin()">退出管理员</button>
          </div>
        </div>
        <div class="admin-load-grid" aria-label="当前系统负荷">
          <div><span>运行时长</span><strong>${escapeHtml(load.uptimeSeconds || 0)} 秒</strong></div>
          <div><span>存储</span><strong>${escapeHtml(load.storage || 'unknown')}</strong></div>
          <div><span>房间</span><strong>${escapeHtml(load.activeRoomCount || 0)} / ${escapeHtml(load.maxRooms || 0)}</strong></div>
          <div><span>赛事</span><strong>${escapeHtml(load.tournamentCount || 0)}</strong></div>
          <div><span>赛事会话</span><strong>${escapeHtml(load.sessionCount || 0)}</strong></div>
          <div><span>管理员会话</span><strong>${escapeHtml(load.systemAdminSessionCount || 0)}</strong></div>
          <div><span>SSE 订阅</span><strong>${escapeHtml(load.subscriberCount || 0)}</strong></div>
          <div><span>内存 RSS</span><strong>${escapeHtml(load.process && load.process.rssMb || 0)} MB</strong></div>
          <div><span>堆内存</span><strong>${escapeHtml(load.process && load.process.heapUsedMb || 0)} / ${escapeHtml(load.process && load.process.heapTotalMb || 0)} MB</strong></div>
          <div><span>CPU</span><strong>${escapeHtml(load.cpu && load.cpu.count || 0)} 核</strong></div>
          <div><span>Load</span><strong>${escapeHtml(load.cpu && Array.isArray(load.cpu.loadAverage) ? load.cpu.loadAverage.join(' / ') : '-')}</strong></div>
          <div><span>PostgreSQL</span><strong>${escapeHtml(load.postgresConnected ? '已连接' : '未连接/未启用')}</strong></div>
        </div>
        <div class="admin-config-grid">
          <label><span>最大 active 房间</span><input id="admin-config-max-rooms" type="number" min="1" max="500" value="${escapeHtml(config.maxRooms || 20)}"></label>
          <label><span>会话 TTL 小时</span><input id="admin-config-session-ttl" type="number" min="1" max="168" value="${escapeHtml(config.sessionTtlHours || 24)}"></label>
          <label><span>SSE 凭据秒数</span><input id="admin-config-stream-ttl" type="number" min="30" max="3600" value="${escapeHtml(config.streamTokenTtlSeconds || 120)}"></label>
          <button class="primary-btn" onclick="window.hexcoreUI.saveAdminConfig()">保存系统配置</button>
        </div>
        <div class="admin-room-table" aria-label="管理员赛事列表">
          ${rooms.length ? rooms.map(room => `
            <article class="admin-room-card ${room.status === 'archived' ? 'archived' : 'active'}">
              <div class="admin-room-main">
                <div class="admin-room-title">
                  <span>赛事房间</span>
                  <strong>${escapeHtml(room.name || room.tournamentId)}</strong>
                  <small>${escapeHtml(room.tournamentId)} · ${escapeHtml(room.campMode === 'no_camp' ? '无阵营' : '双阵营')} · ${escapeHtml(room.pairingMode || '-')}</small>
                </div>
                <div class="admin-room-metrics" aria-label="房间运行状态">
                  <div class="admin-room-metric status">
                    <span>状态</span>
                    <strong>${escapeHtml(room.status === 'archived' ? '已归档' : '活跃')}</strong>
                  </div>
                  <div class="admin-room-metric">
                    <span>队伍</span>
                    <strong>${escapeHtml(room.teamCount || 0)}</strong>
                  </div>
                  <div class="admin-room-metric">
                    <span>订阅</span>
                    <strong>${escapeHtml(room.subscriberCount || 0)}</strong>
                  </div>
                </div>
              </div>
              <div class="admin-room-actions">
                <button class="primary-btn" ${room.status === 'archived' ? 'disabled' : ''} onclick='window.hexcoreUI.adminEnterTournament(${safeJsonString(room.tournamentId)})'>进入管理</button>
                <button class="subtle-btn" onclick='window.hexcoreUI.adminCopyRoomCodes(${safeJsonString(room.tournamentId)})'>复制房间码</button>
                <button class="subtle-btn" onclick='window.hexcoreUI.adminExportRoom(${safeJsonString(room.tournamentId)})'>导出</button>
                <button class="subtle-btn" ${room.status === 'archived' ? 'disabled' : ''} onclick='window.hexcoreUI.adminArchiveRoom(${safeJsonString(room.tournamentId)})'>归档</button>
                <button class="danger-btn" onclick='window.hexcoreUI.adminDeleteRoom(${safeJsonString(room.tournamentId)})'>删除</button>
              </div>
              ${room.codes && room.codes.available ? `
                <details class="admin-code-vault">
                  <summary>查看房间码</summary>
                  <div><span>裁判码</span><code>${escapeHtml(room.codes.refereeCode || '')}</code></div>
                  <div><span>观众码</span><code>${escapeHtml(room.codes.viewerCode || '')}</code></div>
                  ${(Array.isArray(room.codes.captainCodes) ? room.codes.captainCodes : []).map(item => `
                    <div><span>${escapeHtml(item.teamName || item.teamId || '队伍')}</span><code>${escapeHtml(item.code || '')}</code></div>
                  `).join('')}
                </details>
              ` : '<div class="admin-code-vault unavailable">该房间创建于旧版本，服务端无法恢复房间码明文。</div>'}
            </article>
          `).join('') : '<div class="empty-log">暂无赛事。可在下方创建赛事表单中创建新房间。</div>'}
        </div>
        <div class="admin-events-panel">
          <strong>最近安全事件</strong>
          ${events.length ? events.slice(0, 8).map(event => `
            <span>${escapeHtml(event.createdAt || '')} · ${escapeHtml(event.type || '')}${event.tournamentId ? ` · ${escapeHtml(event.tournamentId)}` : ''}</span>
          `).join('') : '<span>暂无安全事件。</span>'}
        </div>
      </div>
    `;
    return `
      <div class="join-access-panel admin-entry-panel" aria-label="系统管理员后台">
        <div class="join-access-head">
          <div>
            <strong>系统管理员后台</strong>
            <span>管理所有房间、赛事和运行限制；不是某个赛事里的管理员码。</span>
          </div>
          <em class="room-list-status ${session ? 'active' : 'archived'}">${escapeHtml(session ? '已登录' : statusText)}</em>
        </div>
        ${message ? `<div class="join-api-check ${escapeHtml(message.level || 'info')}"><strong>${escapeHtml(message.text || '')}</strong></div>` : ''}
        ${authForm}
        ${dashboardPanel}
      </div>
    `;
  }

  function joinGatePage() {
    const apiBase = (Hexcore2.actions && Hexcore2.actions.recentMultiplayerApiBase && Hexcore2.actions.recentMultiplayerApiBase()) || '';
    return `
      <main class="workspace join-gate-page">
        <section class="data-panel join-gate-panel">
          <div class="section-title-row">
            <h1>多人房间</h1>
            <span>裁判先创建赛事并分发房间码；队长或观众输入赛事 ID 和对应加入码进入房间。</span>
          </div>
          <div class="join-gate-grid">
            <div class="join-gate-card">
              <h2>加入已有赛事</h2>
              <div class="settings-form">
                <label>
                  <span>服务地址</span>
                  <input id="join-api-base" value="${escapeHtml(apiBase)}" aria-label="服务地址">
                </label>
                <label>
                  <span>赛事 ID</span>
                  <input id="join-tournament-id" placeholder="例如 t-api" aria-label="赛事 ID">
                </label>
                <label>
                  <span>加入码</span>
                  <input id="join-room-code" placeholder="输入裁判提供的加入码" aria-label="加入码">
                </label>
                <button class="primary-btn" onclick="window.hexcoreUI.joinRoom()">加入房间</button>
              </div>
            </div>
            <div class="join-gate-card create-room-panel">
              <h2>创建赛事</h2>
              <div class="settings-form">
                <label>
                  <span>赛事名称</span>
                  <input id="create-tournament-name" placeholder="例如 HEXCORE 内战" aria-label="赛事名称">
                </label>
                <label>
                  <span>赛事 ID</span>
                  <input id="create-tournament-id" placeholder="留空自动生成；可用字母数字 . _ : -" aria-label="创建赛事 ID">
                </label>
                <div class="create-room-options">
                  <label>
                    <span>队伍数量</span>
                    <input id="create-team-count" type="number" min="6" max="20" value="10" aria-label="队伍数量">
                  </label>
                  <label>
                    <span>规则模式</span>
                    <select id="create-camp-mode" aria-label="规则模式">
                      <option value="dual_camp">双阵营</option>
                      <option value="no_camp">无阵营</option>
                    </select>
                  </label>
                  <label>
                    <span>每队人数</span>
                    <input id="create-players-per-team" type="number" min="2" max="8" value="5" aria-label="每队人数">
                  </label>
                </div>
                <button class="primary-btn" onclick="window.hexcoreUI.createTournamentRoom()">创建赛事</button>
              </div>
            </div>
          </div>
          ${joinGateAccessPanel(apiBase)}
          ${roomListPanel()}
          ${roomActionDialog()}
          ${createdRoomPanel()}
          <div class="empty-log">已加入的会话会保存在本机；需要切换身份时可清理浏览器本地数据后重新加入。</div>
          ${joinGateMessagePanel()}
        </section>
      </main>
    `;
  }

  function adminStandalonePage() {
    const apiBase = (Hexcore2.actions && Hexcore2.actions.recentMultiplayerApiBase && Hexcore2.actions.recentMultiplayerApiBase()) || '';
    return `
      <main class="workspace join-gate-page admin-standalone-page">
        <section class="data-panel join-gate-panel">
          <div class="section-title-row">
            <h1>系统管理员后台</h1>
            <span>全局管理房间、运行限制、安全事件和系统状态。普通赛事创建与加入请返回多人房间入口。</span>
          </div>
          <div class="join-gate-card admin-route-service-card">
            <h2>服务连接</h2>
            <div class="settings-form">
              <label>
                <span>服务地址</span>
                <input id="join-api-base" value="${escapeHtml(apiBase)}" aria-label="服务地址">
              </label>
              <div class="join-access-actions admin-route-actions">
                <button class="primary-btn admin-route-action" onclick="window.hexcoreUI.loadAdminStatus()">检测管理员状态</button>
                <button class="subtle-btn admin-route-action" onclick="window.location.href='/'">返回多人房间</button>
              </div>
            </div>
          </div>
          ${adminPanel(apiBase)}
        </section>
      </main>
    `;
  }

  function captainHexcoreDraftPanel() {
    if (!isCaptainClient()) return '';
    const own = clientCaptain();
    if (!own) return '';
    const session = Hexcore2.state.hexcoreDraft || {};
    const selectedCaptainId = (Hexcore2.state.ui && Hexcore2.state.ui.hexCaptainId) || session.captainId || '';
    const activeCaptainId = selectedCaptainId || own.id;
    const activeCaptain = Hexcore2.state.captains.find(captain => captain.id === activeCaptainId) || own;
    const isOwnWindow = activeCaptain.id === own.id;
    const ownedHexcores = Hexcore2.state.hexcoreAssignments[own.id] || [];
    const activeSession = isOwnWindow && session.captainId === own.id && Array.isArray(session.slots) && session.slots.length > 0;
    const turnBlockedReason = !isOwnWindow
      ? '正在查看其它队长海克斯窗口'
      : (captainCanOperateCurrentTurn() ? '' : '未轮到本队操作');
    const canOperateDraft = isOwnWindow && !turnBlockedReason;
    const disabledActionAttr = canOperateDraft ? '' : `disabled title="${escapeHtml(turnBlockedReason)}"`;
    const canDraw = isOwnWindow && canOperateDraft && ownedHexcores.length < 1 && !activeSession;
    return `
      <section class="data-panel captain-hex-draft-panel">
        <div class="section-title-row">
          <h2>队长海克斯选择</h2>
          <span>${canOperateDraft ? '当前轮到本队选择海克斯，可抽取最多 5 个候选并刷新 1 张。' : `${escapeHtml(turnBlockedReason)}，仅可查看当前候选。`}</span>
        </div>
        <div class="hex-session-head captain-hex-session-head">
          <strong>${escapeHtml(own.name)} 已选择 ${ownedHexcores.length}/1</strong>
          ${ownedHexcores.length >= 1 ? '<span class="done">已完成海克斯选择</span>' : (canDraw ? `
            <button class="primary-btn" onclick='window.hexcoreUI.drawHexcoreForCaptain(${safeJsonString(own.id)})'>${Hexcore2.icon('hex')}抽取最多 5 个候选</button>
          ` : `<span class="pending">${escapeHtml(turnBlockedReason || '等待候选选择')}</span>`)}
        </div>
        ${activeSession ? `
          <div class="hex-draw-slots captain-hex-draw-slots">
            ${session.slots.map((hexcoreId, index) => {
              const hex = Hexcore2.sampleData.hexcores.find(item => item.id === hexcoreId);
              if (!hex) return '';
              return `
                <article class="hex-draw-card ${escapeHtml(hexcoreCategory(hex))}">
                  <div class="hex-draw-badges">
                    <span class="hex-category-pill ${escapeHtml(hexcoreCategory(hex))}">${escapeHtml(hexcoreCategoryLabel(hex))}</span>
                  </div>
                  <div class="hex-card-figure" aria-hidden="true">${hexcoreIcon(hex, 'lg')}</div>
                  <h3>${escapeHtml(hex.name)}</h3>
                  <p>${escapeHtml(hex.desc)}</p>
                  <div class="hex-execution-note">▲ ${escapeHtml(hexcoreTimingLabel(hex))}</div>
                  <div class="hex-draw-actions">
                    <button class="hex-detail-trigger" type="button" title="查看海克斯详情" aria-label="查看${escapeHtml(hex.name)}详情" onclick='window.hexcoreUI.showHexDetail(${safeJsonString(hex.id)})'>详情</button>
                    <button class="hex-refresh-btn" title="${escapeHtml(turnBlockedReason || '刷新此张候选')}" aria-label="刷新${escapeHtml(hex.name)}候选" ${session.refreshUsed ? 'disabled' : disabledActionAttr} onclick="window.hexcoreUI.refreshHexcoreSlot(${index})">刷新</button>
                    <button class="primary-btn hex-select-btn" title="${escapeHtml(turnBlockedReason || '选择此海克斯')}" aria-label="选择${escapeHtml(hex.name)}海克斯" ${disabledActionAttr} onclick='window.hexcoreUI.selectHexcoreFromDraw(${safeJsonString(own.id)}, ${safeJsonString(hex.id)})'>选择</button>
                  </div>
                </article>
              `;
            }).join('')}
          </div>
        ` : `
          <div class="hex-session-empty">
            ${ownedHexcores.length >= 1
              ? `本队已持有【${escapeHtml(ownedHexcores[0].name)}】。`
              : (isOwnWindow ? '本队当前没有进行中的海克斯候选。' : '非本队海克斯窗口，仅可查看当前进度。')}
          </div>
        `}
      </section>
    `;
  }

  function isCampVersusTournamentContext(tournament, round, match) {
    return Boolean(
      (tournament && tournament.pairingMode === 'camp_versus')
      || (round && round.pairingMode === 'camp_versus')
      || (match && match.pairingMode === 'camp_versus')
      || (round && String(round.name || '').includes('阵营对抗'))
    );
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

  function currentExplanation() {
    const captain = Hexcore2.selectors.currentCaptain();
    if (!captain) return [];
    const explanation = Hexcore2.state.draft.explanations.find(item => item.captainId === captain.id);
    return explanation ? explanation.reasons : [];
  }

  function purchaseRightBlockReason(captain, roundState, inSetup = false) {
    if (inSetup) return '';
    if (!captain) return '当前没有可操作队长';
    if (Hexcore2.state.draft.phase === 'completed') return '选人已完成';
    if (!roundState) return '等待进入操作';
    if (roundState.purchaseUsed) return '本轮购买权已使用';
    if (roundState.skipped) return '本轮已跳过';
    if (Hexcore2.selectors.teamSize(captain.id) >= Hexcore2.selectors.teamMemberCapacity(captain.id)) return '队伍已满员';
    return '';
  }

  function shopActionBlockReason(captain, roundState, inSetup = false) {
    if (inSetup) return '';
    const timerPhase = String((Hexcore2.state.activeTurnTimer && Hexcore2.state.activeTurnTimer.phase) || '').trim();
    if (timerPhase === 'gold_shop_prepare') return '准备倒计时未结束';
    if (Hexcore2.state.ui && Hexcore2.state.ui.originSageNotice) return '请先关闭神秘贤者·启元提示';
    if (Hexcore2.state.ui && Hexcore2.state.ui.chargedCannonDecision) return '请先处理轮初大炮已充能';
    if (!captain) return '当前没有可操作队长';
    if (Hexcore2.state.draft.phase === 'completed') return '选人已完成';
    if (!roundState) return '等待进入操作';
    if (Hexcore2.selectors.teamSize(captain.id) >= Hexcore2.selectors.teamMemberCapacity(captain.id)) return '队伍已满员';
    if (!roundState.freeShopUsed) return '';
    return purchaseRightBlockReason(captain, roundState, inSetup);
  }

  function currentHexcoreStatus(captain) {
    if (!captain || !Hexcore2.hexcoreEngine || !Hexcore2.hexcoreEngine.effectStatusForCaptain) return '';
    const statuses = Hexcore2.hexcoreEngine.effectStatusForCaptain(captain.id);
    if (!statuses.length) return '';
    return `
      <div class="top-hex-status" title="${escapeHtml(statuses.map(item => `${item.status}：${item.label}`).join('；'))}">
        <span>海克斯影响</span>
        ${statuses.map(item => {
          const className = [
            item.status === '已生效' ? 'applied' : 'pending',
            item.type === 'hungry_wave_watch' || item.type === 'hungry_wave_round' ? 'hungry-wave' : '',
          ].filter(Boolean).join(' ');
          return `<b class="${className}">${escapeHtml(item.status)}：${escapeHtml(item.label)}</b>`;
        }).join('')}
      </div>
    `;
  }

  function hungryWaveBanner() {
    if (Hexcore2.hexcoreEngine && Hexcore2.hexcoreEngine.activeHungryWave) {
      const wave = Hexcore2.hexcoreEngine.activeHungryWave();
      if (wave) return localHungryWaveBanner(wave);
    }
    return projectedHungryWaveBanner();
  }

  function localHungryWaveBanner(wave) {
    if (!wave) return '';
    const source = Hexcore2.state.captains.find(captain => captain.id === wave.captainId);
    const checked = new Set(wave.checkedCaptainIds || []);
    const order = Hexcore2.state.draft.currentOrder && Hexcore2.state.draft.currentOrder.length
      ? Hexcore2.state.draft.currentOrder
      : Hexcore2.state.draft.baseOrder;
    const currentIndex = Math.max(0, Number(Hexcore2.state.draft.currentIndex) || 0);
    const remaining = order.slice(currentIndex)
      .filter(captainId => captainId !== wave.captainId && !checked.has(captainId))
      .length;
    return `
      <section class="hungry-wave-alert" aria-live="polite">
        <div>
          <strong>海浪判定生效中</strong>
          <span>${escapeHtml(source ? source.name : '未知队长')} 已触发【海浪，我没吃饭】，本轮后续购买都会进入判定。</span>
        </div>
        <em>剩余待判定 ${remaining} 队</em>
      </section>
    `;
  }

  function projectedHungryWaveBanner() {
    const wave = Hexcore2.state.multiplayer && Hexcore2.state.multiplayer.lastHungryWave;
    if (!wave || !wave.type) return '';
    const source = Hexcore2.state.captains.find(captain => captain.id === wave.sourceTeamId);
    const buyer = Hexcore2.state.captains.find(captain => captain.id === wave.buyerTeamId);
    const player = Hexcore2.state.players.find(item => item.id === wave.playerId);
    const sourceName = source ? source.name : (wave.sourceTeamId || '未知队伍');
    const buyerName = buyer ? buyer.name : (wave.buyerTeamId || '');
    const playerName = player ? player.name : (wave.playerId || '');
    const probability = wave.chanceBase > 1 ? `判定 ${wave.roll + 1}/${wave.chanceBase}` : '';
    const copyByType = {
      round_start: `${sourceName} 已触发【海浪，我没吃饭】，本轮自动跳过并等待后续购买判定。`,
      same_camp_steal: `${sourceName} 命中 ${buyerName} 的购买，已带走${playerName ? `「${playerName}」` : '该选手'}。`,
      no_camp_steal: `${sourceName} 命中 ${buyerName} 的购买，已带走${playerName ? `「${playerName}」` : '该选手'}。`,
      opposite_camp_return: `${sourceName} 命中 ${buyerName} 的异阵营购买，选手已退回卡池并登记轮末补偿。`,
      round_reward: `${sourceName} 已获得海浪轮末补偿${playerName ? `「${playerName}」` : ''}。`,
      round_reward_failed: `${sourceName} 的海浪轮末补偿未能结算。`,
    };
    return `
      <section class="hungry-wave-alert" aria-live="polite">
        <div>
          <strong>海浪同步</strong>
          <span>${escapeHtml(copyByType[wave.type] || '海浪结果已由服务端同步。')}</span>
        </div>
        <em>${escapeHtml(probability || '服务端权威')}</em>
      </section>
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

  function cssAttributeValue(value) {
    return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
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

  const hexcoreCategoryMeta = {
    shop_control: { label: '商店操控', short: '商店', desc: '影响开店、刷新、商店卡展示或购买窗口。' },
    economy: { label: '金币运营', short: '金币', desc: '影响金币、返还、折扣或刷新资源。' },
    disruption: { label: '对手干扰', short: '干扰', desc: '对其他队长的商店、费用或信息造成限制。' },
    roster_replace: { label: '入队替代', short: '入队', desc: '绕过普通购买或替换队伍成员。' },
    order_response: { label: '顺位响应', short: '顺位', desc: '影响行动顺位、响应窗口或购买后判定。' },
  };

  function hexcoreCategory(hexcore) {
    return hexcore && hexcore.category && hexcoreCategoryMeta[hexcore.category] ? hexcore.category : 'shop_control';
  }

  function hexcoreCategoryLabel(hexcore) {
    return hexcoreCategoryMeta[hexcoreCategory(hexcore)].label;
  }

  function hexcoreCategoryShort(hexcore) {
    return hexcoreCategoryMeta[hexcoreCategory(hexcore)].short;
  }

  const hexcoreTagLabels = {
    shop: '商店影响',
    camp: '阵营相关',
    economy: '金币相关',
    discount: '费用优惠',
    refresh: '刷新相关',
    replace: '替换卡牌',
    target: '需要目标',
    direct_roster: '直接入队',
    gold: '金币收益',
    acquire: '获得时触发',
    refund: '返还机制',
    round_start: '轮次开始',
    steal: '夺取选手',
    team_swap: '阵容置换',
    round_income: '轮次收益',
    high_tier: '高费倾向',
    order: '顺位影响',
    random: '随机收益',
    tier4: '4费目标',
    tier5: '5费目标',
    delay: '延迟结算',
    weather: '天气迷雾',
    blind: '信息遮蔽',
    response: '响应窗口',
  };

  function hexcoreTagLabel(tag) {
    return hexcoreTagLabels[tag] || String(tag || '').replace(/_/g, ' ');
  }

  function hexcoreGlyph(hexcore) {
    const icons = {
      'camp-scout': { label: '同阵营侦察', d: ['M8 12a4 4 0 1 0 8 0a4 4 0 0 0-8 0Z', 'M15 15l4 4'] },
      'discount-coupon': { label: '购买减费', d: ['M6 8h12l-2 4 2 4H6V8Z', 'M10 12h5'] },
      'reserved-seat': { label: '保留商店卡', d: ['M7 4h10v16l-5-3-5 3V4Z', 'M10 9h4'] },
      'urgent-restock': { label: '替换同费卡', d: ['M7 8h9l-2-2', 'M17 16H8l2 2'] },
      'camp-blockade': { label: '减少目标商店', d: ['M5 5h14v14H5V5Z', 'M8 8h3v3H8V8Z', 'M15 14l-4 4'] },
      'price-interference': { label: '抬高购买价格', d: ['M12 19V5', 'M8 9l4-4 4 4', 'M7 15h10'] },
      'steady-reinforce': { label: '随机补强入队', d: ['M9 9a3 3 0 1 0 6 0a3 3 0 0 0-6 0Z', 'M5 20c1-4 13-4 14 0'] },
      donation: { label: '获得初始金币', d: ['M12 4v16', 'M8 8c0-2 8-2 8 0s-8 2-8 4'] },
      'sponsor-flow': { label: '购买后返还金币', d: ['M7 7h10v10H7V7Z', 'M17 12l3 3-3 3'] },
      'hungry-wave': { label: '购买后夺取判定', d: ['M4 15c3-4 5 4 8 0s5 4 8 0', 'M12 5v6'] },
      'last-stand': { label: '整队随机置换', d: ['M6 7h12', 'M8 5 6 7l2 2', 'M18 17H6'] },
      'open-feast': { label: '轮次经济奖励', d: ['M7 4v16', 'M10 4v16', 'M17 4c-3 4-3 8 0 10v6'] },
      'vampiric-habit': { label: '吸取其他队长金币', d: ['M12 4c4 4 5 9 0 16-5-7-4-12 0-16Z', 'M8 13h8'] },
      'giant-slayer': { label: '高费卡减费', d: ['M5 19 19 5', 'M14 5h5v5'] },
      'ballroom-queen': { label: '商店过滤高费', d: ['M5 7h14l-2 10H7L5 7Z', 'M8 7l4-3 4 3'] },
      photographer: { label: '额外免费刷新', d: ['M6 8h3l1-2h4l1 2h3v10H6V8Z', 'M9 13a3 3 0 1 0 6 0a3 3 0 0 0-6 0Z'] },
      'wise-benevolence': { label: '金币和刷新累积', d: ['M12 4v16', 'M8 8c0-2 8-2 8 0s-8 2-8 4', 'M18 7h3'] },
      'origin-sage': { label: '轮次开始提到第一', d: ['M12 20V6', 'M8 10l4-4 4 4', 'M7 16h10'] },
      'mystery-box': { label: '随机盲抽入队', d: ['M5 9h14v10H5V9Z', 'M7 9c0-4 5-4 5 0'] },
      'transmute-gold': { label: '免费获得4费', d: ['M12 4l7 8-7 8-7-8 7-8Z', 'M9 13l3 3 3-3'] },
      'transmute-prismatic': { label: '免费获得5费', d: ['M12 3l8 7-3 10H7L4 10l8-7Z', 'M9 14l3 3 3-3'] },
      'decompose-knowledge': { label: '分解资源自选', d: ['M6 6h12v5H6V6Z', 'M8 18l8-8'] },
      'stuck-together': { label: '锁定延迟入队', d: ['M7 11h10v8H7v-8Z', 'M9 11V8a3 3 0 0 1 6 0v3'] },
      'storm-fog': { label: '顺延迷雾影响', d: ['M5 10h14', 'M8 14h8', 'M6 6c3 0 3 2 6 2s3-2 6-2'] },
      'snow-cat': { label: '商店信息打乱', d: ['M5 7h14', 'M8 7l2 10h4l2-10', 'M9 14h6'] },
      'charged-cannon': { label: '调整行动顺位', d: ['M5 8h10l4 4-4 4H5', 'M15 13l4 3-4 3'] },
      'heavenly-descent': { label: '响应夺取并退款', d: ['M12 3v12', 'M8 7l4-4 4 4', 'M17 11l3 3-3 3'] },
    };
    const icon = icons[hexcore.id] || { label: '通用海克斯效果', d: ['M12 4l7 4v8l-7 4-7-4V8l7-4Z'] };
    return `
      <svg class="hex-effect-icon" viewBox="0 0 24 24" role="img" aria-label="${escapeHtml(icon.label)}">
        ${icon.d.map(path => `<path d="${path}"></path>`).join('')}
      </svg>
    `;
  }

  function hexcoreIcon(hexcore, size = 'md') {
    const safeId = escapeHtml(hexcore && hexcore.id ? hexcore.id : 'unknown');
    const safeName = escapeHtml(hexcore && hexcore.name ? hexcore.name : '海克斯');
    const safeSize = ['lg', 'md', 'sm', 'popover'].includes(size) ? size : 'md';
    return `
      <span class="hex-png-icon size-${safeSize}" data-hex-id="${safeId}" data-icon-file="${safeId}">
        <img src="assets/hex-icons/${safeId}.png" alt="${safeName}图标" loading="lazy" decoding="async" onerror="var root=this.closest&&this.closest('.hex-png-icon'); if(root) root.classList.add('is-missing'); this.removeAttribute('src');">
        <span class="hex-svg-fallback" aria-hidden="true">${hexcoreGlyph(hexcore)}</span>
      </span>
    `;
  }

  function hexcoreUseLabel(hexcore) {
    if (hexcore.id === 'origin-sage') return '轮次开始自动';
    if (hexcore.mode === 'passive') return '被动自动';
    if (hexcore.uses === 1) return '全程 1 次';
    if (hexcore.maxUsesPerRound) return `每轮 ${hexcore.maxUsesPerRound} 次`;
    return '裁判手动';
  }

  function hexcoreTimingLabel(hexcore) {
    if (!hexcore) return '裁判判定';
    if (hexcore.id === 'origin-sage') return '轮次开始自动';
    if (hexcore.mode === 'passive') return '自动触发';
    if (hexcore.needsTarget === 'captain') return '选队长';
    if (hexcore.needsTarget === 'shopCard') return '选商店卡';
    if (hexcore.needsTarget === 'player') return '选选手';
    if (hexcore.maxUsesPerRound) return '每轮一次';
    if (hexcore.uses === 1) return '一次性';
    return '裁判手动';
  }

  const purchaseConsumingHexIds = new Set([
    'steady-reinforce',
    'last-stand',
    'mystery-box',
    'transmute-gold',
    'transmute-prismatic',
    'decompose-knowledge',
  ]);

  function pendingAutoRosterEffects(captainId) {
    return (Hexcore2.state.draft.runtimeEffects || [])
      .filter(effect =>
        effect
        && effect.type === 'stuck_together'
        && effect.captainId === captainId
        && !effect.consumed
      )
      .map(effect => {
        const player = Hexcore2.state.players.find(item => item.id === effect.playerId);
        return {
          ...effect,
          playerName: player ? player.name : effect.playerId,
          playerAvailable: player ? player.status === 'available' : false,
        };
      });
  }

  function autoRosterReminder(captain, queue = []) {
    if (!captain) return '';
    const pending = pendingAutoRosterEffects(captain.id);
    if (!pending.length) return '';
    const riskyHexes = queue.filter(item =>
      item.executable
      && (
        purchaseConsumingHexIds.has(item.id)
        || (Array.isArray(item.tags) && item.tags.includes('direct_roster'))
      )
    );
    const currentDraw = Hexcore2.state.draft.currentDraw;
    const roundState = Hexcore2.economyEngine && Hexcore2.economyEngine.roundState
      ? Hexcore2.economyEngine.roundState(captain.id)
      : null;
    const canStillBuy = currentDraw
      && currentDraw.captainId === captain.id
      && roundState
      && !roundState.purchaseUsed
      && !roundState.skipped;
    const pendingText = pending.map(effect =>
      `${escapeHtml(effect.playerName || '目标选手')}（第 ${escapeHtml(effect.triggerRound || Hexcore2.state.draft.round + 1)} 轮检查）`
    ).join('、');
    const riskText = [
      canStillBuy ? '购买商店卡' : '',
      ...riskyHexes.map(item => `使用【${escapeHtml(item.name)}】`),
    ].filter(Boolean).join('、') || '使用其他直接入队海克斯';
    const unavailableText = pending.some(effect => !effect.playerAvailable)
      ? '<em>当前锁定目标已有不可用迹象，请优先确认效果状态。</em>'
      : '';
    return `
      <section class="auto-roster-reminder" aria-live="polite">
        <b>延迟自动入队提醒</b>
        <span>已锁定 ${pendingText}。在自动检查前，${riskText} 可能消耗本轮购买权或占满队伍名额，导致自动入队失效。</span>
        ${unavailableText}
      </section>
    `;
  }

  function hexcoreExecutionQueue(captainId) {
    const captain = Hexcore2.state.captains.find(item => item.id === captainId);
    const queue = Hexcore2.hexcoreEngine.executionQueue(captainId);
    const targetableIds = new Set(['reserved-seat', 'urgent-restock', 'camp-blockade', 'price-interference', 'decompose-knowledge', 'stuck-together', 'storm-fog', 'snow-cat']);
    return `
      <div class="hex-execution-queue">
        <div class="hex-queue-head">
          <strong>本轮海克斯执行队列</strong>
          <span>${queue.length ? `${queue.length} 项` : '暂无'}</span>
        </div>
        ${autoRosterReminder(captain, queue)}
        <div class="hex-queue-list">
          ${queue.map(item => `
            <article class="hex-queue-item ${escapeHtml(item.type)} ${item.executable ? 'has-action' : ''}">
              <div class="hex-queue-status">
                <b>${escapeHtml(item.status)}</b>
                <span>${escapeHtml(item.actionType)}</span>
              </div>
              <div class="hex-queue-body">
                <strong>${escapeHtml(item.name)} <em>${escapeHtml(item.actionLabel)}</em></strong>
                <div class="hex-queue-meta">
                  <span class="hex-category-chip ${escapeHtml(hexcoreCategory(item))}">${escapeHtml(hexcoreCategoryShort(item))}</span>
                  <span>${escapeHtml(item.timingLabel || hexcoreTimingLabel(item))}</span>
                </div>
                <p>${escapeHtml(item.reason)}</p>
              </div>
              ${item.executable ? `
                <button class="hex-queue-action" ${captainHexcoreActionAttr(captainId, item.executable)} onclick='${targetableIds.has(item.id) || item.needsTarget ? `window.hexcoreUI.openHexTargetPicker(${safeJsonString(item.id)})` : `window.hexcoreUI.useHexcore(${safeJsonString(item.id)})`}'>${captainCanUseHexcoreFor(captainId) ? (targetableIds.has(item.id) || item.needsTarget ? '选择目标' : '使用') : '仅可查看'}</button>
              ` : ''}
            </article>
          `).join('') || '<div class="hex-queue-empty">当前队长暂无海克斯执行项</div>'}
        </div>
      </div>
    `;
  }

  function usableHexcoreAlert() {
    const captain = Hexcore2.selectors.currentCaptain();
    if (!captain || !Hexcore2.hexcoreEngine || !Hexcore2.hexcoreEngine.executionQueue) return '';
    const usable = Hexcore2.hexcoreEngine.executionQueue(captain.id)
      .filter(item => item.executable);
    if (!usable.length) return '';
    const canOperateHexcore = captainCanUseHexcoreFor(captain.id);
    const urgent = usable.some(item => item.id === 'decompose-knowledge' || item.id === 'last-stand' || item.id === 'mystery-box' || item.id === 'transmute-gold' || item.id === 'transmute-prismatic');
    const reminder = autoRosterReminder(captain, usable);
    return `
      <section class="usable-hex-alert ${urgent ? 'urgent' : ''}">
        <div class="usable-hex-alert-main">
          <b>当前有海克斯可使用</b>
          <strong>${escapeHtml(captain.name)}：${usable.map(item => `【${escapeHtml(item.name)}】`).join('、')}</strong>
          <span>${usable.map(item => `${escapeHtml(item.name)}：${escapeHtml(item.reason)}`).join('；')}</span>
          ${reminder}
        </div>
        <div class="usable-hex-alert-actions">
          ${usable.slice(0, 3).map(item => `
            <button ${captainHexcoreActionAttr(captain.id, canOperateHexcore)} onclick='${item.needsTarget ? `window.hexcoreUI.openHexTargetPicker(${safeJsonString(item.id)})` : `window.hexcoreUI.useHexcore(${safeJsonString(item.id)})`}'>
              ${canOperateHexcore ? (item.needsTarget ? '选目标' : '使用') : '仅可查看'} ${escapeHtml(item.name)}
            </button>
          `).join('')}
          ${usable.length > 3 ? `<em>另有 ${usable.length - 3} 项</em>` : ''}
        </div>
      </section>
    `;
  }

  function hexTargetPickerPanel(captain, context) {
    const picker = Hexcore2.state.ui && Hexcore2.state.ui.hexTargetPicker;
    if (!picker || !picker.hexcoreId) return '';
    if (picker.captainId && picker.captainId !== captain.id) return '';

    const hex = (Hexcore2.state.hexcoreAssignments[captain.id] || []).find(item => item.id === picker.hexcoreId);
    if (!hex) return '';

    const selectOptions = (items, emptyLabel) => {
      if (!items.length) return `<option value="">${escapeHtml(emptyLabel)}</option>`;
      return items.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');
    };

    let body = '';
    let canSubmit = true;
    let decisionNote = '';
    const markNoTargets = (items, reason) => {
      if (items.length) return;
      canSubmit = false;
      decisionNote = reason;
    };
    if (hex.id === 'reserved-seat' || hex.id === 'urgent-restock') {
      const cards = ((Hexcore2.state.draft.currentDraw && Hexcore2.state.draft.currentDraw.captainId === captain.id)
        ? Hexcore2.state.draft.currentDraw.cards
        : []).filter(card => card && !card.purchased);
      markNoTargets(cards, '当前商店没有可处理卡牌；可能已购买、已跳过或商店未打开。');
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
      const targets = Hexcore2.hexcoreEngine.targetableCaptains
        ? Hexcore2.hexcoreEngine.targetableCaptains(captain.id)
        : [];
      const conflicts = Hexcore2.hexcoreEngine.targetConflictReasons
        ? Hexcore2.hexcoreEngine.targetConflictReasons(captain.id)
        : [];
      markNoTargets(targets, '没有满足条件的目标队长；可能已满员、被海浪免疫，或行动窗口已过。');
      body = `
        <label>
          <small>目标队长</small>
          <select id="hex-target-first">
            ${selectOptions(targets, '没有可用目标')}
          </select>
        </label>
        ${conflicts.length ? `
          <div class="hex-target-decision">
            <strong>冲突/裁决说明</strong>
            ${conflicts.slice(0, 4).map(item => `<span>${escapeHtml(item.name)}：${escapeHtml(item.reason)}</span>`).join('')}
          </div>
        ` : ''}
      `;
    } else if (hex.id === 'storm-fog') {
      const targets = Hexcore2.hexcoreEngine.weatherFogTargets ? Hexcore2.hexcoreEngine.weatherFogTargets(captain.id) : [];
      markNoTargets(targets, '当前和下一轮没有仍有购买权且未满员的非使用者队长；海浪免疫队长会被跳过。');
      body = `
        <label>
          <small>起始目标队长</small>
          <select id="hex-target-first">
            ${selectOptions(targets, '没有可用目标')}
          </select>
        </label>
        <div class="hex-target-decision">
          <strong>生效说明</strong>
          <span>从目标开始按顺位环形补足最多3名有效队长；本轮不足会顺延到下一轮；刷新不会清除血雾。</span>
        </div>
      `;
    } else if (hex.id === 'snow-cat') {
      const targets = Hexcore2.hexcoreEngine.openCaptainTargets ? Hexcore2.hexcoreEngine.openCaptainTargets(captain.id, false) : [];
      markNoTargets(targets, '当前没有未满员队长可被信息扰乱；海浪免疫或满员队伍不能作为目标。');
      body = `
        <label>
          <small>目标队长</small>
          <select id="hex-target-first">
            ${selectOptions(targets, '没有可用目标')}
          </select>
        </label>
      `;
    } else if (hex.id === 'charged-cannon') {
      const targets = Hexcore2.hexcoreEngine.cannonTargets ? Hexcore2.hexcoreEngine.cannonTargets(captain.id) : [];
      const canBoost = Hexcore2.state.draft.currentIndex > 0;
      if (!targets.length && !canBoost) {
        canSubmit = false;
        decisionNote = '当前没有可延后的未行动队长，且当前队长已经无法继续前移。';
      }
      body = `
        <label>
          <small>转换技</small>
          <select id="hex-target-first">
            <option value="delay">雷霆一击：目标顺位延后一位</option>
            <option value="boost" ${canBoost ? '' : 'disabled'}>加速之门：自己顺位前移一位</option>
          </select>
        </label>
        <label>
          <small>雷霆一击目标</small>
          <select id="hex-target-second">
            ${selectOptions(targets, '没有可后移目标')}
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
      markNoTargets(targets, '解构层数、金币或同阵营可选目标不足，当前无法执行。');
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
      const maxTier = Hexcore2.hexcoreEngine.stuckTogetherMaxTier ? Hexcore2.hexcoreEngine.stuckTogetherMaxTier() : 5;
      const targets = Hexcore2.hexcoreEngine.stuckTogetherTargets ? Hexcore2.hexcoreEngine.stuckTogetherTargets(captain.id) : [];
      markNoTargets(targets, `当前没有${maxTier}费及以下、未被选走且可锁定的本阵营选手，或已经没有后续轮次可结算。`);
      body = `
        <div class="hex-target-decision">
          <strong>费用上限</strong>
          <span>本轮从本阵营全池选择，最多锁定 ${maxTier} 费选手；目标必须未入队且不是队长。</span>
        </div>
        <label>
          <small>锁定选手（${maxTier}费及以下）</small>
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
        ${decisionNote ? `<div class="hex-target-warning">${escapeHtml(decisionNote)}</div>` : ''}
        <div class="hex-target-picker-actions">
          <button class="primary-btn" ${canSubmit ? '' : 'disabled'} onclick='window.hexcoreUI.useSelectedHexTarget(${safeJsonString(hex.id)})'>确认执行</button>
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
    const items = isViewerClient() ? [
      ['draft', 'draft', '实时抽选'],
      ['team', 'teams', '队伍总览'],
      ['hex', 'hexcores', '海克斯图录'],
    ] : (isCaptainClient() ? [
      ['draft', 'draft', '实时抽选'],
      ['team', 'teams', '队伍总览'],
      ['hex', 'hexcores', '海克斯图录'],
      ['trophy', 'tournament', '我的赛程'],
    ] : [
      ['draft', 'draft', '实时抽选'],
      ['team', 'teams', '队伍管理'],
      ['users', 'players', '选手库'],
      ['hex', 'hexcores', '海克斯库'],
      ['calendar', 'schedule', '轮次进度'],
      ['trophy', 'tournament', '赛程'],
      ['rule', 'rules', '规则设置'],
      ['log', 'logs', '日志导出'],
      ['cog', 'settings', '系统设置'],
    ]);

    return `
      <aside class="side-nav">
        <div class="brand">
          <span class="brand-mark"><img class="brand-logo" src="assets/brand/hexcore-brand.png" alt="" aria-hidden="true"></span>
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
          <p>系统名称：HEXCORE 2.0</p>
          <p>抽选规模：${teamCount} 队征召制</p>
          <p>队伍范围：${Hexcore2.state.settings.minTeams}-${Hexcore2.state.settings.maxTeams} 队</p>
          <p>版本：${escapeHtml(versionLabel())}</p>
          <p>模式：${isReadonlyClient() ? '观众端' : (isCaptainClient() ? '队长端' : '裁判代执行')}</p>
          <p>创建时间：2026-05-19 09:00</p>
          ${isViewerClient() ? `
            <p>权限：当前回合队长视角只读</p>
          ` : (isCaptainClient() ? `
            <p>绑定队伍：${escapeHtml(clientCaptain() ? clientCaptain().name : '未绑定')}</p>
            <p>权限：仅本人回合和海克斯窗口可操作</p>
          ` : `
            <p>可撤销步骤：${(Hexcore2.state.undoStack || []).length}</p>
            <button onclick="window.hexcoreUI.exportState()">导出状态备份</button>
            <button onclick="document.getElementById('state-import-input').click()">导入状态备份</button>
            <button class="danger-mini" onclick="window.hexcoreUI.resetLocalState()">重置本地状态</button>
            <input id="state-import-input" type="file" accept=".json,application/json" hidden onchange="window.hexcoreUI.importState(this.files[0]); this.value = ''">
          `)}
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
              <span>有历史成绩时按官方成绩排序分档；无历史成绩时 score=几就进入几费池。</span>
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
    const tab = Hexcore2.state.ui.playerImportTab === 'skipped' ? 'skipped' : 'accepted';
    const pageSize = 20;
    const selectedIndexes = new Set(Array.isArray(Hexcore2.state.ui.playerImportSelected)
      ? Hexcore2.state.ui.playerImportSelected.map(index => Number(index)).filter(index => Number.isInteger(index) && index >= 0 && index < accepted.length)
      : accepted.map((_, index) => index));
    const selectedCount = selectedIndexes.size;
    const activeList = tab === 'skipped' ? skipped : accepted;
    const totalPages = Math.max(1, Math.ceil(activeList.length / pageSize));
    const currentPage = Math.max(1, Math.min(totalPages, Math.round(Number(Hexcore2.state.ui.playerImportPage) || 1)));
    const pageStart = (currentPage - 1) * pageSize;
    const pageItems = activeList.slice(pageStart, currentPage * pageSize);
    const renderAccepted = (player, index) => `
      <label class="import-preview-row accepted ${selectedIndexes.has(index) ? 'selected' : ''}">
        <input type="checkbox" ${selectedIndexes.has(index) ? 'checked' : ''} onchange="window.hexcoreUI.togglePlayerImportSelection(${index})">
        <span class="import-preview-row-text">
          <strong>${escapeHtml(player.name)}</strong>
          <em>${escapeHtml(player.gameId)} · ${escapeHtml(Hexcore2.selectors.campLabel(player.camp))} · ${escapeHtml(player.lane)} · 评分 ${escapeHtml(player.score)}</em>
          ${Array.isArray(player.profileMatches) && player.profileMatches.length ? `<small>疑似档案：${player.profileMatches.map(match => `${escapeHtml(match.commonName)}（${escapeHtml(match.reason)}）`).join('、')}；确认导入不会自动合并</small>` : '<small>暂无疑似历史档案，导入后可在选手库手动创建或关联</small>'}
        </span>
      </label>
    `;
    const renderSkipped = item => `
      <article class="import-preview-row skipped">
        <strong>第 ${Number(item.row) || 0} 行</strong>
        <span>${escapeHtml(item.reason || '数据无效')}${item.gameId ? ` · ${escapeHtml(item.gameId)}` : ''}</span>
      </article>
    `;
    return `
      <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="player-import-preview-title">
        <section class="form-modal import-preview-modal">
          <div class="modal-head">
            <div>
              <h2 id="player-import-preview-title">导入预览</h2>
              <p>${escapeHtml(preview.fileName || '未命名文件')}，确认后才会写入选手库；超过组队需求的选手会保持空闲。</p>
            </div>
            <button class="icon-close" aria-label="关闭导入预览" onclick="window.hexcoreUI.cancelPlayerImport()">×</button>
          </div>
          <div class="import-preview-stats">
            <div><span>总行数</span><strong>${Number(preview.totalRows) || 0}</strong></div>
            <div class="ok"><span>已选择</span><strong>${selectedCount}</strong></div>
            <div><span>可导入</span><strong>${accepted.length}</strong></div>
            <div class="${skipped.length ? 'warn' : 'ok'}"><span>跳过总数</span><strong>${skipped.length}</strong></div>
            <div class="warn"><span>重复ID</span><strong>${Number(stats.duplicateGameId) || 0}</strong></div>
            <div class="warn"><span>缺字段</span><strong>${Number(stats.missingField) || 0}</strong></div>
            <div class="warn"><span>阵营缺失</span><strong>${Number(stats.missingCamp) || 0}</strong></div>
            <div class="warn"><span>非法评分</span><strong>${Number(stats.invalidScore) || 0}</strong></div>
          </div>
          <div class="import-preview-workbench">
            <div class="import-preview-tabs" role="tablist" aria-label="导入预览类型">
              <button class="${tab === 'accepted' ? 'active' : ''}" onclick="window.hexcoreUI.setPlayerImportTab('accepted')">
                <strong>将导入</strong><span>${selectedCount}/${accepted.length} 名</span>
              </button>
              <button class="${tab === 'skipped' ? 'active' : ''}" onclick="window.hexcoreUI.setPlayerImportTab('skipped')">
                <strong>跳过项</strong><span>${skipped.length} 条</span>
              </button>
            </div>
            <div class="import-preview-list-head">
              <div>
                <h3>${tab === 'accepted' ? '可导入选手' : '跳过明细'}</h3>
                <span>第 ${currentPage}/${totalPages} 页，每页 ${pageSize} 条</span>
              </div>
              ${tab === 'accepted' ? `
                <div class="import-select-actions">
                  <button class="subtle-btn" onclick="window.hexcoreUI.setPlayerImportSelection('all')">全选</button>
                  <button class="subtle-btn" onclick="window.hexcoreUI.setPlayerImportSelection('none')">清空</button>
                  <button class="subtle-btn" onclick="window.hexcoreUI.setPlayerImportSelection('page')">本页全选</button>
                  <button class="subtle-btn" onclick="window.hexcoreUI.setPlayerImportSelection('page-none')">本页清空</button>
                </div>
              ` : ''}
            </div>
            <div class="import-preview-list">
              ${pageItems.map((item, index) => tab === 'accepted' ? renderAccepted(item, pageStart + index) : renderSkipped(item)).join('') || `<div class="empty-log">${tab === 'accepted' ? '没有可导入选手' : '没有跳过项'}</div>`}
            </div>
            <div class="import-preview-pager">
              <button class="subtle-btn" ${currentPage <= 1 ? 'disabled' : ''} onclick="window.hexcoreUI.setPlayerImportPage(${currentPage - 1})">上一页</button>
              <span>${(currentPage - 1) * pageSize + (pageItems.length ? 1 : 0)}-${Math.min(currentPage * pageSize, activeList.length)} / ${activeList.length}</span>
              <button class="subtle-btn" ${currentPage >= totalPages ? 'disabled' : ''} onclick="window.hexcoreUI.setPlayerImportPage(${currentPage + 1})">下一页</button>
            </div>
          </div>
          <div class="modal-actions">
            <button class="subtle-btn" onclick="window.hexcoreUI.cancelPlayerImport()">取消</button>
            <button class="primary-btn" ${selectedCount ? '' : 'disabled'} onclick="window.hexcoreUI.confirmPlayerImport()">确认导入 ${selectedCount} 名</button>
          </div>
        </section>
      </div>
    `;
  }

  function originSageNoticeModal() {
    const notice = Hexcore2.state.ui && Hexcore2.state.ui.originSageNotice;
    if (!notice || (notice.expiresAt && Date.now() > Number(notice.expiresAt))) return '';
    const names = Array.isArray(notice.captainNames) && notice.captainNames.length
      ? notice.captainNames
      : (Array.isArray(notice.captainIds)
        ? notice.captainIds.map(captainId => {
          const captain = Hexcore2.state.captains.find(item => item.id === captainId);
          return captain ? captain.name : captainId;
        })
        : []);
    if (!names.length) return '';
    const remainingSeconds = notice.expiresAt
      ? Math.max(0, Math.ceil((Number(notice.expiresAt) - Date.now()) / 1000))
      : 5;
    return `
      <div class="origin-sage-backdrop" role="dialog" aria-modal="true" aria-labelledby="origin-sage-title" onclick="window.hexcoreUI.closeOriginSageNotice()">
        <section class="origin-sage-modal" onclick="event.stopPropagation()">
          <span>轮次开始自动生效</span>
          <h2 id="origin-sage-title">神秘贤者·启元</h2>
          <p>【${escapeHtml(names.join('、'))}】队长发动了神秘贤者·启元，TA 的顺位来到了第一名。</p>
          <small><b data-countdown="origin-sage">${remainingSeconds}</b> 秒后自动关闭，点击弹窗外可提前关闭。</small>
        </section>
      </div>
    `;
  }

  function chargedCannonDecisionModal() {
    const decision = Hexcore2.state.ui && Hexcore2.state.ui.chargedCannonDecision;
    if (!decision) return '';
    const captain = Hexcore2.state.captains.find(item => item.id === decision.captainId);
    if (!captain || !Hexcore2.hexcoreEngine) return '';
    const order = Hexcore2.hexcoreEngine.chargedCannonOrder
      ? Hexcore2.hexcoreEngine.chargedCannonOrder()
      : (Hexcore2.state.draft.currentOrder || []);
    const boostPreview = Hexcore2.hexcoreEngine.chargedCannonBoostPreview
      ? Hexcore2.hexcoreEngine.chargedCannonBoostPreview(captain.id)
      : { canBoost: false, beforeOrder: order, afterOrder: order, reason: '无法预览' };
    const delayTargets = Hexcore2.hexcoreEngine.chargedCannonDelayTargets
      ? Hexcore2.hexcoreEngine.chargedCannonDelayTargets(captain.id)
      : [];
    const orderList = (ids, highlightId = '') => `
      <div class="cannon-order-preview">
        ${ids.map((captainId, index) => {
          const item = Hexcore2.state.captains.find(team => team.id === captainId);
          return `<span class="${captainId === highlightId ? 'highlight' : ''}">${index + 1}. ${escapeHtml(item ? item.name : captainId)}</span>`;
        }).join('')}
      </div>
    `;
    const step = decision.step || 'choose';
    const targetOptions = delayTargets.map(target => `<option value="${escapeHtml(target.id)}">${escapeHtml(target.name)}</option>`).join('');
    const decisionError = decision.error ? `<div class="cannon-warning">${escapeHtml(decision.error)}</div>` : '';
    const body = step === 'boost'
      ? `
        <p>加速之门只能对自己使用。确认后 ${escapeHtml(captain.name)} 本轮顺位前移 1 位，但不能超过神秘贤者·启元占据的第 1 顺位。</p>
        <div class="cannon-preview-grid">
          <section><strong>当前顺位</strong>${orderList(boostPreview.beforeOrder || order, captain.id)}</section>
          <section><strong>使用后顺位</strong>${orderList(boostPreview.afterOrder || order, captain.id)}</section>
        </div>
        ${boostPreview.canBoost ? '' : `<div class="cannon-warning">${escapeHtml(boostPreview.reason || '当前无法使用加速之门')}</div>`}
        <div class="cannon-modal-actions">
          <button type="button" class="subtle-btn" onclick="window.hexcoreUI.backChargedCannonDecision()">上一步</button>
          <button type="button" class="primary-btn" ${boostPreview.canBoost ? '' : 'disabled'} onclick="window.hexcoreUI.confirmChargedCannonBoost()">确定使用加速之门</button>
        </div>
      `
      : (step === 'delay'
        ? `
          <p>雷霆一击只能在轮初指定其它队长，使目标本轮顺位后移 1 位。不能指定自己、最后顺位队长、持有海浪，我没吃饭的队长，或本轮受神秘贤者·启元保护的队长。</p>
          <label class="cannon-target-field">
            <small>雷霆一击目标</small>
            <select id="charged-cannon-delay-target">
              ${targetOptions || '<option value="">没有可用目标</option>'}
            </select>
          </label>
          ${delayTargets.length ? '' : '<div class="cannon-warning">当前没有可使用雷霆一击的目标。</div>'}
          <div class="cannon-modal-actions">
            <button type="button" class="subtle-btn" onclick="window.hexcoreUI.backChargedCannonDecision()">上一步</button>
            <button type="button" class="primary-btn" ${delayTargets.length ? '' : 'disabled'} onclick="window.hexcoreUI.confirmChargedCannonDelay(document.getElementById('charged-cannon-delay-target').value)">确定使用雷霆一击</button>
          </div>
        `
        : `
          <p>本轮开始前，${escapeHtml(captain.name)} 可在两个转换技中选择 1 个；也可以本轮不使用。确认或跳过后，本轮不再询问。</p>
          ${orderList(order, captain.id)}
          <div class="cannon-choice-grid">
            <button type="button" onclick="window.hexcoreUI.chooseChargedCannonMode('boost')" ${boostPreview.canBoost ? '' : 'disabled'}>
              <strong>加速之门</strong>
              <span>${boostPreview.canBoost ? '自己前移 1 位' : escapeHtml(boostPreview.reason || '当前无法前移')}</span>
            </button>
            <button type="button" onclick="window.hexcoreUI.chooseChargedCannonMode('delay')" ${delayTargets.length ? '' : 'disabled'}>
              <strong>雷霆一击</strong>
              <span>${delayTargets.length ? `可指定 ${delayTargets.length} 名队长后移 1 位` : '没有可后移目标'}</span>
            </button>
          </div>
          <div class="cannon-modal-actions">
            <button type="button" class="subtle-btn" onclick="window.hexcoreUI.skipChargedCannonDecision()">本轮不使用</button>
          </div>
        `);
    return `
      <div class="charged-cannon-backdrop" role="dialog" aria-modal="true" aria-labelledby="charged-cannon-title">
        <section class="charged-cannon-modal">
          <div class="charged-cannon-head">
            <span>${hexcoreIcon({ id: 'charged-cannon', name: '大炮已充能', category: 'order_response' }, 'popover')}</span>
            <div>
              <h2 id="charged-cannon-title">大炮已充能</h2>
              <p>第 ${Number(decision.round) || Hexcore2.state.draft.round} 轮轮初转换技：${escapeHtml(captain.name)}</p>
            </div>
          </div>
          ${decisionError}
          ${body}
        </section>
      </div>
    `;
  }

  function lastStandConfirmModal() {
    const confirmState = Hexcore2.state.ui && Hexcore2.state.ui.lastStandConfirm;
    if (!confirmState || !Hexcore2.hexcoreEngine || !Hexcore2.hexcoreEngine.lastStandCandidates) return '';
    const captain = Hexcore2.state.captains.find(item => item.id === confirmState.captainId);
    if (!captain) return '';
    const oldPlayers = (captain.team || []).map(playerId => playerById(playerId)).filter(Boolean);
    const candidates = Hexcore2.hexcoreEngine.lastStandCandidates(captain.id);
    const ownedCandidates = candidates.filter(player => player.teamId && player.teamId !== captain.id);
    const availableCandidates = candidates.filter(player => !player.teamId);
    const campLabel = Hexcore2.selectors.campLabel(Hexcore2.selectors.captainCamp(captain.id));
    const canConfirm = oldPlayers.length >= 4 && candidates.length >= 4;
    const autoOneChance = Boolean(confirmState.autoOneChance);
    const tierName = player => Hexcore2.state.settings.tierNames[player.tier] || `${player.tier || '?'}费`;
    const candidateRows = candidates.map(player => {
      const owner = player.teamId ? Hexcore2.state.captains.find(item => item.id === player.teamId) : null;
      return `
        <span>
          <strong>${escapeHtml(player.name)}</strong>
          <em>${escapeHtml(tierName(player))} · ${owner ? `来自 ${escapeHtml(owner.name)}` : '可选池'}</em>
        </span>
      `;
    }).join('');
    return `
      <div class="recruit-reveal-backdrop" role="dialog" aria-modal="true" aria-labelledby="last-stand-title">
        <section class="recruit-reveal-modal last-stand-modal">
          <div class="recruit-reveal-head">
            <span>${autoOneChance ? '满员强提示 · 唯一一次机会' : '整队置换确认'}</span>
            <h2 id="last-stand-title">背水一战可发动</h2>
            <p>${escapeHtml(captain.name)} 已拥有 ${oldPlayers.length}/4 名队员，将从${escapeHtml(campLabel)}本阵营候选中随机换入 4 人。${autoOneChance ? '这是满员后的唯一一次询问窗口，关闭或取消视为放弃本轮机会。' : ''}</p>
          </div>
          <div class="last-stand-summary">
            <article>
              <strong>${oldPlayers.length}</strong>
              <span>当前队员</span>
            </article>
            <article>
              <strong>${candidates.length}</strong>
              <span>本阵营候选</span>
            </article>
            <article>
              <strong>${ownedCandidates.length}</strong>
              <span>可能触发置换</span>
            </article>
            <article>
              <strong>${availableCandidates.length}</strong>
              <span>可选池候选</span>
            </article>
          </div>
          <div class="last-stand-body">
            <section>
              <h3>当前四名队员</h3>
              <div class="last-stand-chip-list">
                ${oldPlayers.map(player => `<span><strong>${escapeHtml(player.name)}</strong><em>${escapeHtml(tierName(player))}</em></span>`).join('') || '<span><strong>无</strong><em>队伍未满</em></span>'}
              </div>
            </section>
            <section class="last-stand-candidate-panel">
              <h3>候选池预览</h3>
              <div class="last-stand-chip-list candidates">
                ${candidateRows || '<span><strong>候选不足</strong><em>无法发动</em></span>'}
              </div>
            </section>
          </div>
          <div class="last-stand-warning">
            <strong>执行规则</strong>
            <span>只从本阵营候选中抽取，不可跨阵营置换。抽中别队本阵营队员时，该队从当前四名队员中随机获得 1 人补偿；抽中可选池选手时不补偿，未补偿的原队员回到可选池。本海克斯不消耗购买权；队伍满 4 人时购买权自然失效。</span>
          </div>
          <div class="recruit-reveal-foot">
            <span>${canConfirm ? (autoOneChance ? '唯一一次机会：确认即发动；取消将放弃本轮背水一战窗口。' : '确认后立即随机结算，结算结果会在入队揭示弹窗中展示。') : '当前条件不足，不能确认发动。'}</span>
            <div class="last-stand-actions">
              <button onclick="window.hexcoreUI.cancelLastStand()">取消</button>
              <button class="primary-btn" ${canConfirm ? '' : 'disabled'} onclick="window.hexcoreUI.confirmLastStand()">确认发动</button>
            </div>
          </div>
        </section>
      </div>
    `;
  }

  function dissolveTeamsConfirmModal() {
    const confirmState = Hexcore2.state.ui && Hexcore2.state.ui.dissolveTeamsConfirm;
    if (!confirmState) return '';
    const captainCount = Hexcore2.state.captains.length;
    const captainPlayers = Hexcore2.state.captains.filter(captain => Hexcore2.selectors.captainPlayer(captain.id)).length;
    const memberCount = Hexcore2.state.captains.reduce((sum, captain) => sum + (captain.team || []).length, 0);
    const hexcoreCount = Object.values(Hexcore2.state.hexcoreAssignments || {})
      .reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
    return `
      <div class="recruit-reveal-backdrop" role="dialog" aria-modal="true" aria-labelledby="dissolve-teams-title">
        <section class="recruit-reveal-modal dissolve-teams-modal">
          <div class="recruit-reveal-head">
            <span>队伍批量解散</span>
            <h2 id="dissolve-teams-title">确认一键解散队伍</h2>
            <p>当前 ${captainCount} 支队伍、${captainPlayers} 名队长、${memberCount} 名队员、${hexcoreCount} 个海克斯。请选择本次解散方式。</p>
          </div>
          <div class="last-stand-body">
            <section>
              <h3>保留队长</h3>
              <p>保留每队队长身份和已持有海克斯，只将普通队员全部移回可选池。</p>
            </section>
            <section>
              <h3>不保留队长</h3>
              <p>队长和普通队员全部回到可选池，所有队伍海克斯清空，队伍变为空壳等待重新设置。</p>
            </section>
          </div>
          <div class="modal-derived-note">
            <strong>注意</strong>
            <span>该操作会清空当前商店结果、轮内临时效果和正在显示的结算弹窗；执行前会写入撤销快照。</span>
          </div>
          <div class="modal-actions">
            <button type="button" onclick="window.hexcoreUI.closeDissolveTeamsDialog()">取消</button>
            <button type="button" class="primary-btn" onclick="window.hexcoreUI.dissolveAllTeams(true)">保留队长并解散</button>
            <button type="button" class="danger-btn" onclick="window.hexcoreUI.dissolveAllTeams(false)">全部成员回池</button>
          </div>
        </section>
      </div>
    `;
  }

  function recruitRevealModal() {
    const reveal = Hexcore2.state.ui && Hexcore2.state.ui.recruitReveal;
    if (!reveal) return '';
    const captain = Hexcore2.state.captains.find(item => item.id === reveal.captainId);
    const players = (Array.isArray(reveal.playerIds) ? reveal.playerIds : [])
      .map(playerId => playerById(playerId))
      .filter(Boolean);
    if (!players.length) return '';
    const tierName = player => Hexcore2.state.settings.tierNames[player.tier] || `${player.tier || '?'}费`;
    return `
      <div class="recruit-reveal-backdrop" role="dialog" aria-modal="true" aria-labelledby="recruit-reveal-title">
        <section class="recruit-reveal-modal">
          <div class="recruit-reveal-head">
            <span>${escapeHtml(reveal.source || '海克斯效果')}</span>
            <h2 id="recruit-reveal-title">${escapeHtml(reveal.title || '入队揭示')}</h2>
            <p>${escapeHtml(reveal.summary || '海克斯获得选手')}${captain ? `：${escapeHtml(captain.name)}` : ''}</p>
          </div>
          <div class="recruit-reveal-grid ${players.length > 1 ? 'multi' : ''}">
            ${players.map(player => `
              <article class="recruit-reveal-card tier-${Number(player.tier) || 1}">
                <b>${escapeHtml(tierName(player))}</b>
                <strong>${escapeHtml(player.name)}</strong>
                <small>ID: ${escapeHtml(player.gameId || '无游戏ID')}</small>
                <div class="recruit-reveal-meta">
                  <span>${escapeHtml(Hexcore2.selectors.campLabel(player.camp))}</span>
                  <span>${escapeHtml(player.lane || '未知位置')}</span>
                  <span>评分 ${escapeHtml(player.score || 0)}</span>
                </div>
                <div class="recruit-reveal-heroes">
                  ${(player.heroes && player.heroes.length ? player.heroes : ['暂无', '暂无', '暂无'])
                    .slice(0, 3)
                    .map(hero => `<i>${escapeHtml(hero)}</i>`)
                    .join('')}
                </div>
              </article>
            `).join('')}
          </div>
          <div class="recruit-reveal-foot">
            <span>${escapeHtml(reveal.detail || '确认后继续流程。')}</span>
            <button class="primary-btn" onclick="window.hexcoreUI.confirmRecruitReveal()">确认并继续</button>
          </div>
        </section>
      </div>
    `;
  }

  function economyRevealModal() {
    const reveal = Hexcore2.state.ui && Hexcore2.state.ui.economyReveal;
    if (!reveal) return '';
    const captain = Hexcore2.state.captains.find(item => item.id === reveal.captainId);
    const rows = Array.isArray(reveal.rows) ? reveal.rows : [];
    if (!rows.length) return '';
    return `
      <div class="recruit-reveal-backdrop" role="dialog" aria-modal="true" aria-labelledby="economy-reveal-title">
        <section class="recruit-reveal-modal economy-reveal-modal">
          <div class="recruit-reveal-head">
            <span>${escapeHtml(reveal.source || '海克斯效果')}</span>
            <h2 id="economy-reveal-title">${escapeHtml(reveal.title || '经济结算')}</h2>
            <p>${escapeHtml(reveal.summary || '经济效果已结算')}${captain ? `：${escapeHtml(captain.name)}` : ''}</p>
          </div>
          <div class="economy-reveal-total">
            <strong>+${escapeHtml(reveal.total || 0)}</strong>
            <span>当前队长获得金币</span>
          </div>
          <div class="economy-reveal-list">
            ${rows.map(row => `
              <article class="economy-reveal-row">
                <div>
                  <strong>${escapeHtml(row.name || '未知队长')}</strong>
                  <span>${escapeHtml(row.beforeGold)} → ${escapeHtml(row.afterGold)} 金币</span>
                </div>
                <b>-${escapeHtml(row.amount || 0)}</b>
              </article>
            `).join('')}
          </div>
          <div class="recruit-reveal-foot">
            <span>${escapeHtml(reveal.detail || '确认后继续流程。')}</span>
            <button class="primary-btn" onclick="window.hexcoreUI.confirmEconomyReveal()">确认</button>
          </div>
        </section>
      </div>
    `;
  }

  function hexDetailLines(value, fallback) {
    if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean);
    const text = String(value || fallback || '').trim();
    return text ? [text] : [];
  }

  function hexTargetDescription(hex) {
    if (!hex.needsTarget) return hex.mode === 'passive' ? '无需裁判选择目标，满足条件时自动生效。' : '无需额外目标，由当前队长或当前商店状态决定。';
    if (hex.needsTarget === 'captain') return '需要选择目标队长；目标必须满足行动窗口、购买权、容量和免疫限制。';
    if (hex.needsTarget === 'shopCard') return '需要选择当前商店中的一张卡；目标卡必须仍在商店且未被购买。';
    if (hex.needsTarget === 'player') return '需要选择可用选手；目标必须符合阵营、费用、队长保护和容量限制。';
    return '需要选择合法目标；无合法目标时不可执行。';
  }

  function hexDetailTips(hex) {
    const tipsById = {
      'snow-cat': ['用于打乱目标商店信息，适合干扰正在找关键卡的队长。', '费用不参与打乱，对方购买后才揭示真实选手。'],
      'heavenly-descent': ['适合反制对手刚买到的高费关键卡。', '发动者最好预留队伍空位，否则只能让该选手回到卡池。'],
      'hungry-wave': ['这是高风险延迟收益，触发者会失去金币并跳过本轮。', '命中同阵营购买时收益最高，异阵营时更偏向干扰和轮末补偿。'],
      'origin-sage': ['适合想抢轮初优先权的队伍，轮次开始自动生效。', '若已经处于第一顺位或已经打开商店，不会重复改变顺位。'],
      'decompose-knowledge': ['满 3 层后再选择高价值目标，收益更稳定。', '金币不足时可以分解 2/3 费队员抵扣，使用前应确认队伍结构。'],
      'stuck-together': ['适合提前锁定同阵营关键选手，选择列表会标注费用。', '目标受本轮费用上限限制，被其他规则拿走时会失效。'],
      'charged-cannon': ['雷霆一击用于延后对手，加速之门用于抢在关键队长前行动。', '每轮最多一次，使用前确认当前顺位。'],
    };
    if (tipsById[hex.id]) return tipsById[hex.id];
    if (hex.category === 'shop_control') return ['用于提高商店质量或控制刷新节奏，建议在开店前或刷新前确认当前金币压力。'];
    if (hex.category === 'economy') return ['用于缓解金币压力，适合配合高费卡购买或关键轮次冲刺。'];
    if (hex.category === 'disruption') return ['用于干扰其他队长节奏，使用前确认目标仍有购买权且未满员。'];
    if (hex.category === 'roster_replace') return ['用于绕过普通商店获得队员，使用前确认队伍容量和购买权消耗。'];
    if (hex.category === 'order_response') return ['用于改变行动节奏或响应关键购买，使用前确认顺位窗口。'];
    return ['按当前局势选择使用时机，优先确认目标是否合法。'];
  }

  function hexDetailNotes(hex) {
    const notes = [];
    if (hex.mode === 'passive') notes.push('被动海克斯由系统按规则自动判定，不需要裁判手动点击执行。');
    if (hex.uses === 1) notes.push('该海克斯每局通常只能成功使用 1 次，使用后会标记为已使用。');
    if (hex.maxUsesPerRound) notes.push('该海克斯按轮限制使用次数，同一轮重复触发会被拒绝。');
    if (hex.tags && hex.tags.includes('direct_roster')) notes.push('直接入队仍受阵营、队长保护、容量和重复归属校验约束。');
    if (hex.tags && hex.tags.includes('refund')) notes.push('涉及返还金币或购买权时，刷新次数是否返还以具体规则为准。');
    if (hex.needsTarget) notes.push('无合法目标时按钮应禁用或执行失败，并在日志中记录原因。');
    if (!notes.length) notes.push('执行前确认当前轮次、当前队长、金币和购买权状态，失败不应污染状态。');
    return notes;
  }

  function hexDetailModal() {
    const modal = Hexcore2.state.ui && Hexcore2.state.ui.hexDetailModal;
    if (!modal) return '';
    const hex = Hexcore2.sampleData.hexcores.find(item => item.id === modal.hexcoreId);
    if (!hex) return '';
    const detail = hexDetailLines(hex.detail, hex.desc);
    const tips = hexDetailLines(hex.tips, '').concat(hexDetailTips(hex));
    const notes = hexDetailLines(hex.notes, '').concat(hexDetailNotes(hex));
    const section = (title, lines, kind = '') => `
      <section class="hex-detail-section ${kind}">
        <h3>${escapeHtml(title)}</h3>
        ${lines.length > 1
          ? `<ul>${lines.map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`
          : `<p>${escapeHtml(lines[0] || '暂无补充说明。')}</p>`}
      </section>
    `;
    return `
      <div class="hex-detail-backdrop" role="dialog" aria-modal="true" aria-labelledby="hex-detail-title" onclick="window.hexcoreUI.closeHexDetail()">
        <section class="hex-detail-modal ${escapeHtml(hexcoreCategory(hex))}" onclick="event.stopPropagation()">
          <button type="button" class="hex-detail-close" aria-label="关闭海克斯详情" onclick="window.hexcoreUI.closeHexDetail()">×</button>
          <div class="hex-detail-head">
            <div class="hex-detail-icon" aria-hidden="true">${hexcoreIcon(hex, 'popover')}</div>
            <div>
              <strong id="hex-detail-title">${escapeHtml(hex.name)}</strong>
              <span>${escapeHtml(hexcoreUseLabel(hex))}</span>
            </div>
          </div>
          <div class="hex-detail-meta">
            <span>${escapeHtml(hexcoreCategoryLabel(hex))}</span>
            <span>${escapeHtml(hexcoreTimingLabel(hex))}</span>
            <span>${escapeHtml(hex.mode === 'passive' ? '被动自动' : '裁判手动')}</span>
            ${hex.needsTarget ? `<span>${escapeHtml(hex.needsTarget === 'captain' ? '目标：队长' : (hex.needsTarget === 'shopCard' ? '目标：商店卡' : '目标：选手'))}</span>` : ''}
          </div>
          <div class="hex-detail-body">
            ${section('规则介绍', detail, 'intro')}
            ${section('生效时机', [hexcoreTimingLabel(hex)])}
            ${section('执行目标', [hexTargetDescription(hex)])}
            ${section('使用技巧', [...new Set(tips)])}
            ${section('注意事项', [...new Set(notes)], 'notes')}
            ${Array.isArray(hex.tags) && hex.tags.length ? `
              <section class="hex-detail-section">
                <h3>规则特性</h3>
                <div class="hex-detail-tags">${hex.tags.map(tag => `<i>${escapeHtml(hexcoreTagLabel(tag))}</i>`).join('')}</div>
              </section>
            ` : ''}
          </div>
        </section>
      </div>
    `;
  }

  function tournamentSlotPickerModal() {
    const picker = Hexcore2.state.ui && Hexcore2.state.ui.tournamentSlotPicker;
    if (!picker) return '';
    const tournament = Hexcore2.state.tournament || {};
    const rounds = Array.isArray(tournament.rounds) ? tournament.rounds : [];
    const roundIndex = rounds.findIndex(round => round.id === picker.roundId);
    const round = roundIndex >= 0 ? rounds[roundIndex] : null;
    const match = round && Array.isArray(round.matches)
      ? round.matches.find(item => item.id === picker.matchId)
      : null;
    const side = picker.side === 'B' ? 'B' : 'A';
    if (!round || !match || roundIndex !== 0 || match.status === 'bye') return '';

    const isCampVersus = isCampVersusTournamentContext(tournament, round, match);
    const expectedCamp = isCampVersus ? (side === 'A' ? 'local' : 'outsider') : '';
    const currentTeamId = side === 'A' ? match.teamAId : match.teamBId;
    const assignedCaptainIds = new Set(
      (rounds[0] && Array.isArray(rounds[0].matches) ? rounds[0].matches : [])
        .flatMap(item => [item.teamAId, item.teamBId])
        .filter(Boolean)
        .filter(captainId => captainId !== currentTeamId)
    );
    const candidates = Hexcore2.state.captains
      .filter(captain => {
        if (expectedCamp && Hexcore2.selectors.captainCamp(captain.id) !== expectedCamp) return false;
        return !assignedCaptainIds.has(captain.id) || captain.id === currentTeamId;
      })
      .sort((left, right) => {
        if (left.id === currentTeamId) return -1;
        if (right.id === currentTeamId) return 1;
        return left.name.localeCompare(right.name, 'zh-CN');
      });
    const sideLabel = isCampVersus
      ? (side === 'A' ? '左侧本地队伍' : '右侧外地队伍')
      : (side === 'A' ? '左侧队伍' : '右侧队伍');
    const campLabel = expectedCamp ? Hexcore2.selectors.campLabel(expectedCamp) : '任意阵营';

    return `
      <div class="modal-backdrop tournament-slot-picker-backdrop" role="dialog" aria-modal="true" aria-labelledby="tournament-slot-picker-title" onclick="window.hexcoreUI.closeTournamentSlotPicker()">
        <section class="form-modal tournament-slot-picker-modal" onclick="event.stopPropagation()">
          <div class="modal-head">
            <div>
              <h2 id="tournament-slot-picker-title">选择赛程队伍</h2>
              <p>为 ${escapeHtml(match.id.toUpperCase())} 的 ${escapeHtml(sideLabel)} 选择队伍。只显示${escapeHtml(campLabel)}且未在其它场次中的队伍。</p>
            </div>
            <button type="button" class="icon-close" onclick="window.hexcoreUI.closeTournamentSlotPicker()" aria-label="关闭">×</button>
          </div>
          <div class="tournament-picker-context">
            <strong>${escapeHtml(match.id.toUpperCase())}</strong>
            <span>${escapeHtml(sideLabel)} · ${currentTeamId ? `当前：${captainName(currentTeamId)}` : '当前为空'}</span>
          </div>
          <div class="tournament-picker-list">
            ${candidates.length ? candidates.map(captain => {
              const isCurrent = captain.id === currentTeamId;
              const camp = Hexcore2.selectors.captainCamp(captain.id);
              const gold = captain.economy && Number.isFinite(Number(captain.economy.gold))
                ? Math.max(0, Math.round(Number(captain.economy.gold)))
                : 0;
              return `
                <button type="button" class="tournament-picker-option ${isCurrent ? 'current' : ''}" data-picker-captain-id="${escapeHtml(captain.id)}" ${isCurrent ? 'disabled' : ''} onclick='window.hexcoreUI.selectTournamentSlotCaptain(${safeJsonString(round.id)}, ${safeJsonString(match.id)}, ${safeJsonString(side)}, ${safeJsonString(captain.id)})'>
                  <strong>${escapeHtml(captain.name)}</strong>
                  <span>${escapeHtml(Hexcore2.selectors.campLabel(camp))} · 金币 ${gold}</span>
                  <em>${isCurrent ? '当前槽位' : '选入此槽'}</em>
                </button>
              `;
            }).join('') : `
              <div class="tournament-picker-empty">
                <strong>暂无可选队伍</strong>
                <span>${escapeHtml(campLabel)}队伍已经全部入场，先移出其它槽位再来安排。</span>
              </div>
            `}
          </div>
          <div class="modal-actions">
            <button type="button" onclick="window.hexcoreUI.closeTournamentSlotPicker()">取消</button>
          </div>
        </section>
      </div>
    `;
  }

  function refreshCreditCount(captain, reason, roundState) {
    if (!captain) return 0;
    const hexcoreEconomy = captain.hexcoreEconomy || {};
    if (reason === 'wise_benevolence') {
      return Math.max(0, Math.round(Number(hexcoreEconomy.wiseBenevolenceRefreshCredits) || 0));
    }
    if (reason === 'hungry_wave_refund') {
      return Math.max(0, Math.round(Number(hexcoreEconomy.hungryWaveRefreshCredits) || 0));
    }
    if (reason === 'photographer') {
      return roundState && !roundState.photographerRefreshUsed ? 1 : 0;
    }
    if (reason === 'round_one_tier_one') {
      return 1;
    }
    return 0;
  }

  function refreshReasonName(reason) {
    if (reason === 'round_one_tier_one') return '第一轮补1费';
    if (reason === 'wise_benevolence') return '贤者的博爱';
    if (reason === 'hungry_wave_refund') return '海浪补偿';
    if (reason === 'photographer') return '摄影艺术家';
    return '免费刷新';
  }

  function freeRefreshText(captain, reason, roundState, compact = false) {
    const count = refreshCreditCount(captain, reason, roundState);
    const name = refreshReasonName(reason);
    if (!count) return compact ? name : `免费（${name}）`;
    return compact ? `${name} ${count}次` : `免费（${name}，剩余 ${count} 次）`;
  }

  function shopActionText(captain, roundState, nextRefreshCost, nextRefreshReason, inSetup = false) {
    if (inSetup) return { title: '开始抽卡', hint: '触发轮初海克斯' };
    if (Hexcore2.state.ui && (Hexcore2.state.ui.originSageNotice || Hexcore2.state.ui.chargedCannonDecision)) {
      return { title: '处理轮初海克斯', hint: '处理完成后才能开店' };
    }
    if (!roundState || !roundState.freeShopUsed) return { title: '免费开店', hint: '本轮首次免费5张' };
    if (nextRefreshCost === 0) {
      return {
        title: `免费刷新（${Math.max(1, refreshCreditCount(captain, nextRefreshReason, roundState))}）`,
        hint: refreshReasonName(nextRefreshReason),
      };
    }
    return {
      title: `刷新（${nextRefreshCost}金币）`,
      hint: '费用 1/2/3/4 封顶',
    };
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
        ? freeRefreshText(captain, nextRefreshReason, roundState, true)
        : `${nextRefreshCost}金币`);
    const refreshDisabledReason = readonlyShopReason() || (isCaptainClient() && !captainCanOperateCurrentTurn()
      ? '非你的回合，仅可查看'
      : shopActionBlockReason(captain, roundState, false));
    const workflow = Hexcore2.selectors.workflowStatus();
    const statusText = !workflow.playersDraftReady
      ? `前置流程未完成：${workflow.stage.label}`
      : Hexcore2.state.draft.phase === 'completed'
      ? '选人已完成'
      : '选人进行中';
    const showRoomReturn = hasExplicitClientRole() || storedMultiplayerSession();
    const syncInfo = roomSyncInfo();
    const roleStatus = isCaptainClient()
      ? (captainCanOperateCurrentTurn()
        ? '可操作'
        : (Hexcore2.state.multiplayer && Array.isArray(Hexcore2.state.multiplayer.hexcoreActionWindows)
          && Hexcore2.state.multiplayer.hexcoreActionWindows.some(window => window && window.active !== false && window.teamId === clientTeamId())
          ? '可发动海克斯'
          : '只读观看'))
      : (isViewerClient() ? '只读模式' : '最高权限');
    return `
      <header class="topbar">
        <div class="mode">${isReadonlyClient() ? '观众端' : (isCaptainClient() ? '队长端' : (isAdminClient() ? '管理员端' : '裁判代执行'))}</div>
        ${showRoomReturn ? '<button class="ghost-btn multiplayer-return-btn" onclick="window.hexcoreUI.leaveMultiplayerRoom()">返回多人房间</button>' : ''}
        ${showRoomReturn ? `
          ${topbarRoleStrip(captain, roleStatus, syncInfo)}
        ` : ''}
        <div class="phase">当前阶段：<strong>第 ${Hexcore2.state.draft.round} 轮 / 金币商店</strong></div>
        <div class="captain-title">当前队长：<strong>${captain ? escapeHtml(captain.name) : '无'}</strong></div>
        <div class="captain-title">金币：<strong>${economy ? economy.gold : 0}</strong></div>
        ${isCaptainClient() || isReadonlyClient() ? '' : `<div class="captain-title">刷新：<strong>${escapeHtml(refreshLabel)}</strong></div>`}
        ${currentHexcoreStatus(captain)}
        <div class="top-spacer"></div>
        <div class="live-status ${Hexcore2.state.draft.phase === 'completed' ? 'done' : ''}"><span></span>${statusText}</div>
        <div class="clock">${time}</div>
        ${isCaptainClient() || isReadonlyClient() ? '' : `<button class="ghost-btn ${refreshDisabledReason ? 'disabled' : ''}" ${refreshDisabledReason ? 'disabled' : ''} title="${escapeHtml(refreshDisabledReason || '刷新当前商店')}" onclick="${refreshDisabledReason ? '' : 'window.hexcoreUI.refreshShop()'}">${Hexcore2.icon('refresh')}刷新商店</button>`}
        ${topbarTurnTimerStrip()}
      </header>
    `;
  }

  function activeTurnTimerInfo() {
    const timer = Hexcore2.state.activeTurnTimer;
    if (!timer || !timer.deadlineAt || !timer.durationMs) return null;
    const phase = String(timer.phase || '').trim();
    const prepare = phase === 'hexcore_prepare' || phase === 'gold_shop_prepare';
    if (!['hexcore_prepare', 'hexcore_draw', 'gold_shop_prepare', 'gold_shop'].includes(phase)) return null;
    const teamId = String(timer.teamId || '').trim();
    if (!teamId || !Hexcore2.state.captains.some(item => item.id === teamId)) return null;
    const deadlineMs = Date.parse(timer.deadlineAt);
    const graceMs = Date.parse(timer.graceDeadlineAt || timer.deadlineAt);
    if (!deadlineMs || !graceMs) return null;
    const now = Date.now();
    const remainingMs = Math.max(0, deadlineMs - now);
    const graceRemainingMs = Math.max(0, graceMs - now);
    if (graceRemainingMs <= 0) return null;
    const workflow = Hexcore2.selectors.workflowStatus();
    if ((phase === 'gold_shop' || phase === 'gold_shop_prepare') && !workflow.playersDraftReady) return null;
    if (phase === 'hexcore_draw') {
      const draft = Hexcore2.state.hexcoreDraft || {};
      const draftTeamId = String(draft.teamId || draft.captainId || '').trim();
      const slots = Array.isArray(draft.slots) ? draft.slots.filter(Boolean) : [];
      if (draftTeamId !== teamId || !slots.length) return null;
    }
    const percent = timer.durationMs > 0 ? Math.max(0, Math.min(100, (remainingMs / timer.durationMs) * 100)) : 0;
    const captain = Hexcore2.state.captains.find(item => item.id === teamId);
    const phaseLabelMap = {
      hexcore_prepare: '海克斯准备',
      hexcore_draw: '海克斯选择',
      gold_shop_prepare: '选手卡准备',
      gold_shop: '金币商店',
    };
    return {
      timer: { ...timer, phase, teamId },
      captain,
      phaseLabel: phaseLabelMap[phase] || '回合',
      prepare,
      remainingMs,
      graceRemainingMs,
      percent,
      ended: now >= deadlineMs,
      urgent: remainingMs > 0 && remainingMs <= 10000,
    };
  }

  function formatTimerSeconds(ms) {
    const seconds = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  }

  function turnTimerPanel() {
    const info = activeTurnTimerInfo();
    if (!info) return '';
    const title = `${info.phaseLabel}倒计时`;
    const captainName = info.captain ? info.captain.name : '当前队长';
    const status = info.ended
      ? (info.prepare
        ? '准备结束，即将开放操作'
        : `回合已结束，${Math.max(0, Math.ceil(info.graceRemainingMs / 1000))} 秒后自动进入下一队长`)
      : `${formatTimerSeconds(info.remainingMs)} 后结束`;
    return `
      <section class="turn-timer-panel ${info.ended ? 'ended' : ''} ${info.urgent ? 'urgent' : ''}" aria-live="polite">
        <div class="turn-timer-main">
          <span>${escapeHtml(title)}</span>
          <strong>${escapeHtml(captainName)}</strong>
          <em>${escapeHtml(status)}</em>
        </div>
        <div class="turn-timer-track" aria-hidden="true">
          <i style="width:${info.percent.toFixed(2)}%"></i>
        </div>
      </section>
    `;
  }

  function topbarTurnTimerStrip() {
    const info = activeTurnTimerInfo();
    if (!info) return '';
    const captainName = info.captain ? info.captain.name : '当前队长';
    const phaseTextMap = {
      hexcore_prepare: '抽海克斯准备倒计时',
      hexcore_draw: '抽海克斯倒计时',
      gold_shop_prepare: '抽选手卡准备倒计时',
      gold_shop: '抽选手卡倒计时',
    };
    const phaseText = phaseTextMap[info.timer.phase] || '回合倒计时';
    const scopeText = isCaptainClient()
      ? (clientTeamId() === info.timer.teamId
        ? (info.prepare ? '准备中，等待开始' : '本人回合')
        : '跟随当前队长视角')
      : (isViewerClient() ? '观众只读实时观看' : '裁判全局监控');
    const status = info.ended
      ? (info.prepare
        ? '准备结束，即将开放操作'
        : `回合已结束，${Math.max(0, Math.ceil(info.graceRemainingMs / 1000))} 秒后自动进入下一队长`)
      : `${formatTimerSeconds(info.remainingMs)} 后结束`;
    return `
      <div class="topbar-turn-timer ${info.ended ? 'ended' : ''} ${info.urgent ? 'urgent' : ''}" aria-live="polite">
        <div class="topbar-turn-timer-main">
          <span>${escapeHtml(phaseText)}</span>
          <strong>${escapeHtml(captainName)}</strong>
          <em>${escapeHtml(scopeText)}</em>
          <b>${escapeHtml(status)}</b>
        </div>
        <div class="topbar-turn-timer-track" aria-hidden="true">
          <i style="width:${info.percent.toFixed(2)}%"></i>
        </div>
      </div>
    `;
  }

  function turnTimeoutModal() {
    const info = activeTurnTimerInfo();
    if (!info || !info.ended || info.graceRemainingMs <= 0) return '';
    if (info.prepare) return '';
    const isOwn = isCaptainClient() && clientTeamId() === info.timer.teamId;
    const title = isOwn ? '您的回合已经结束' : `${info.phaseLabel}回合已经结束`;
    return `
      <div class="turn-timeout-layer" role="alertdialog" aria-modal="true" aria-label="${escapeHtml(title)}">
        <section class="turn-timeout-modal">
          <strong>${escapeHtml(title)}</strong>
          <p>${Math.max(0, Math.ceil(info.graceRemainingMs / 1000))} 秒后进入下一队长的回合。</p>
          <div class="turn-timeout-progress"><i style="width:${Math.max(0, Math.min(100, (info.graceRemainingMs / 3000) * 100)).toFixed(2)}%"></i></div>
        </section>
      </div>
    `;
  }

  function turnOrder() {
    const state = Hexcore2.state;
    const order = state.draft.currentOrder || [];
    const inSetup = state.draft.phase === 'setup';
    const currentIndex = inSetup ? -1 : Math.max(0, Math.min(state.draft.currentIndex, Math.max(0, order.length - 1)));
    const currentId = currentIndex >= 0 ? order[currentIndex] : '';
    const previousId = currentIndex > 0 ? order[currentIndex - 1] : '';
    const captainById = id => state.captains.find(item => item.id === id) || null;
    function nextRoundFirstCaptainId() {
      if (inSetup || state.draft.phase === 'completed' || state.draft.round >= state.draft.maxRounds) return '';
      if (!Hexcore2.turnOrderEngine || !Hexcore2.turnOrderEngine.preview) return '';
      const preview = Hexcore2.turnOrderEngine.preview(state.draft.round + 1, { includeOriginSagePreview: true });
      return preview && preview.order && preview.order.length ? preview.order[0] : '';
    }
    const nextId = currentIndex < order.length - 1 ? order[currentIndex + 1] : nextRoundFirstCaptainId();
    const nextLabel = currentIndex < order.length - 1 ? '下一位' : (nextId ? '下一轮首位' : '下一位');
    const currentCaptain = captainById(currentId);
    const previousCaptain = captainById(previousId);
    const nextCaptain = captainById(nextId);
    const drawerOpen = Boolean(state.ui && state.ui.orderDrawerOpen);
    const captainPlayerLabel = captain => {
      if (!captain) return '队列起点';
      const player = Hexcore2.selectors.captainPlayer(captain.id);
      return player ? `队长 ${player.name}` : '待定';
    };
    const orderRows = order.map((captainId, index) => {
      const captain = captainById(captainId);
      const status = !inSetup && index === currentIndex ? '当前' : (!inSetup && index < currentIndex ? '已过' : '待定');
      const className = !inSetup && index === currentIndex ? 'current' : (!inSetup && index < currentIndex ? 'done' : 'pending');
      return `
        <article class="order-detail-row ${className}">
          <span>${index + 1}</span>
          <strong>${escapeHtml(captain ? captain.name : '未知队伍')}</strong>
          <em>${escapeHtml(captainPlayerLabel(captain))}</em>
          <b>${status}</b>
        </article>
      `;
    }).join('');
    const miniItem = (label, captain, className) => `
      <div class="turn-context-card ${className}">
        <span>${label}</span>
        <strong>${captain ? escapeHtml(captain.name) : '无'}</strong>
        <em>${escapeHtml(captainPlayerLabel(captain))}</em>
      </div>
    `;
    return `
      <section class="turn-panel">
        <div class="panel-title-row">
          <h2>顺位顺序 <span>第 ${state.draft.round} 轮 · ${inSetup ? 0 : (order.length ? currentIndex + 1 : 0)}/${order.length}</span></h2>
          <button class="subtle-btn order-detail-trigger" onclick="window.hexcoreUI.openOrderDrawer()">顺位详情</button>
        </div>
        <div class="turn-context">
          ${miniItem('上一位', previousCaptain, 'previous')}
          ${miniItem('当前', currentCaptain, 'current')}
          ${miniItem(nextLabel, nextCaptain, 'next')}
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
      return { captain, ownedCount, missingCount: Math.max(0, 1 - ownedCount) };
    });
    return `
      <section class="workflow-gate">
        <div>
          <strong>实时抽选尚未开始：${escapeHtml(workflow.stage.label)}</strong>
          <p>流程顺序固定为：先确定全部队长/队伍，再让每位队长完成 1/1 海克斯选择，最后进入四轮金币商店组队。</p>
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
                  <span>${ownedCount}/1</span>
                  <em>${missingCount ? '未选择' : '已完成'}</em>
                </button>
              `).join('')}
            </div>
          </div>
        ` : ''}
        <div class="workflow-actions">
          <button class="subtle-btn" onclick="window.hexcoreUI.setActiveView('teams')">检查队伍</button>
          <button class="subtle-btn" onclick="window.hexcoreUI.setActiveView('players')">检查选手</button>
          <button class="subtle-btn" onclick="window.hexcoreUI.recoverDraftState()">修正抽选异常</button>
          <button class="primary-btn" onclick="window.hexcoreUI.setActiveView('hexcores')">进入海克斯抽取</button>
        </div>
      </section>
    `;
  }

  function playerCards() {
    const cards = currentCards();
    const captain = Hexcore2.selectors.currentCaptain();
    const blinded = captain ? Hexcore2.hexcoreEngine.isBlinded(captain.id) : false;
    const draw = Hexcore2.state.draft.currentDraw;
    const weatherFog = Boolean(draw && Array.isArray(draw.appliedEffects) && draw.appliedEffects.some(effect => effect.type === 'weather_fog'));
    const snowCat = Boolean(draw && Array.isArray(draw.appliedEffects) && draw.appliedEffects.some(effect => effect.type === 'snow_cat_shuffle'));
    const economy = captain && captain.economy ? captain.economy : null;
    const roundState = captain && Hexcore2.economyEngine ? Hexcore2.economyEngine.roundState(captain.id) : null;
    const nextRefreshCost = captain && Hexcore2.economyEngine ? Hexcore2.economyEngine.nextRefreshCost(captain.id) : 0;
    const nextRefreshReason = captain && Hexcore2.economyEngine && Hexcore2.economyEngine.nextRefreshReason
      ? Hexcore2.economyEngine.nextRefreshReason(captain.id)
      : '';
    const nextRefreshLabel = roundState
      ? (roundState.freeShopUsed
        ? (nextRefreshCost === 0
          ? freeRefreshText(captain, nextRefreshReason, roundState)
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
    const isOpenPick = Boolean(draw && draw.pickMode === 'open_pick');
    const shouldAnimateShop = Boolean(draw && !isOpenPick && !draw.revealAnimationPlayed);
    const inSetup = Hexcore2.state.draft.phase === 'setup';
    const shopPanelBlockReason = readonlyShopReason() || (isCaptainClient() && !captainCanOperateCurrentTurn()
      ? '非你的回合，仅可查看'
      : shopActionBlockReason(captain, roundState, inSetup));
    const shopPanelButton = shopActionText(captain, roundState, nextRefreshCost, nextRefreshReason, inSetup);
    const shopPanelClick = shopPanelBlockReason ? '' : (inSetup ? 'window.hexcoreUI.startDraft()' : 'window.hexcoreUI.drawCards()');
    const showShopPanelButton = !isReadonlyClient() && (!isCaptainClient() || !shopPanelBlockReason);
    const shopSubmitting = roomCommandSubmitting('OpenShop') || roomCommandSubmitting('RefreshShop');
    const purchaseSubmitting = roomCommandSubmitting('PurchaseShopCard');
    if (shouldAnimateShop) draw.revealAnimationPlayed = true;
    const shopSlotCount = 6;
    const slotCount = isOpenPick ? cards.length : Math.max(shopSlotCount, cards.length);
    const shopSlots = Array.from({ length: slotCount }, (_, index) => cards[index] || null);
    function emptyShopSlot(index, purchased = false, extraClass = '') {
      const label = purchased ? '已购买' : (index >= 5 ? '备用卡位' : '待开店');
      return `
        <div class="shop-empty-slot ${purchased ? 'purchased' : 'card-back'} ${escapeHtml(extraClass)}" aria-hidden="true" style="--slot-index:${index}">
          <span></span>
          <strong>${label}</strong>
        </div>
      `;
    }
    return `
      <section class="draw-panel">
        <div class="panel-title-row">
          <h2>${escapeHtml(currentDrawLabel())} <span>${draw && draw.reason ? escapeHtml(draw.reason) : '每次展示最多 5 张，按轮次概率生成'}</span></h2>
          ${showShopPanelButton ? `<button class="subtle-btn ${shopPanelBlockReason || shopSubmitting ? 'disabled is-submitting' : ''}" ${shopPanelBlockReason || shopSubmitting ? 'disabled' : ''} title="${escapeHtml(shopSubmitting ? '正在提交到服务端' : (shopPanelBlockReason || shopPanelButton.hint))}" onclick="${shopPanelBlockReason || shopSubmitting ? '' : shopPanelClick}">${Hexcore2.icon('cube')}${escapeHtml(shopSubmitting ? '提交中...' : (shopPanelBlockReason ? '处理轮初海克斯' : shopPanelButton.title))}</button>` : ''}
        </div>
        <div class="draw-timeout-bar">
          <strong>${captain ? `${escapeHtml(captain.name)} · ${economy ? economy.gold : 0} 金币` : '无当前队长'}</strong>
          <span>${roundState ? `本轮状态：${roundState.purchaseUsed ? '已购买' : (roundState.skipped ? '已跳过' : '可购买')} · 下一次刷新 ${escapeHtml(nextRefreshLabel)}` : '等待进入操作'}</span>
        </div>
        <div class="cards-grid ${isOpenPick ? 'open-pick-grid' : 'shop-grid'} ${shouldAnimateShop ? 'shop-reveal' : 'shop-idle'}">
          ${shopSlots.map((entry, index) => {
            if (!entry) return emptyShopSlot(index);
            const { slot, player, realPlayer } = entry;
            const purchased = Boolean(slot && slot.purchased);
            const revealUntil = Number(slot && slot.revealUntil) || 0;
            const purchaseRevealReason = String(slot && slot.purchaseRevealReason || '');
            const purchasedRevealActive = Boolean(
              purchased
              && (purchaseRevealReason === 'weather_fog' || purchaseRevealReason === 'snow_cat')
              && revealUntil > Date.now()
            );
            const revealFlipUntil = Number(slot && slot.revealFlipUntil) || 0;
            const purchasedFlipActive = Boolean(
              purchased
              && (purchaseRevealReason === 'weather_fog' || purchaseRevealReason === 'snow_cat')
              && revealFlipUntil > Date.now()
            );
            const tier = Number(slot && slot.price ? slot.price : player.tier) || 1;
            if (purchased && !purchasedRevealActive) {
              if (purchasedFlipActive && global.clearTimeout && global.setTimeout) {
                global.clearTimeout(Hexcore2.weatherFogFlipTimer);
                Hexcore2.weatherFogFlipTimer = global.setTimeout(() => Hexcore2.ui.render(), Math.max(0, revealFlipUntil - Date.now()) + 80);
              }
              return emptyShopSlot(index, true, purchasedFlipActive ? 'purchased-flip-in' : '');
            }
            if (purchasedRevealActive && global.clearTimeout && global.setTimeout) {
              global.clearTimeout(Hexcore2.weatherFogRevealTimer);
              Hexcore2.weatherFogRevealTimer = global.setTimeout(() => Hexcore2.ui.render(), Math.max(0, revealUntil - Date.now()) + 80);
            }
            const teamFull = captain ? Hexcore2.selectors.teamSize(captain.id) >= Hexcore2.selectors.teamMemberCapacity(captain.id) : false;
            const canBuy = Boolean(captain && roundState && !isReadonlyClient() && !purchaseSubmitting && captainCanOperateCurrentTurn() && !Hexcore2.state.draft.pickedThisTurn && !roundState.purchaseUsed && !roundState.skipped && !teamFull);
            const snowCatRevealActive = purchasedRevealActive && purchaseRevealReason === 'snow_cat';
            const weatherFogRevealActive = purchasedRevealActive && purchaseRevealReason === 'weather_fog';
            const shouldMask = (blinded || weatherFog) && !purchasedRevealActive;
            const displayPlayer = purchasedRevealActive ? realPlayer : player;
            const revealRemaining = purchasedRevealActive ? Math.max(1, Math.ceil((revealUntil - Date.now()) / 1000)) : 0;
            const actionHint = !captain
              ? '无当前队长'
              : (readonlyShopReason()
                || (isCaptainClient() && !captainCanOperateCurrentTurn()
                ? '非你的回合，仅可查看'
                : (purchaseSubmitting
                ? '购买提交中...'
                : (purchasedRevealActive
                ? `真实信息已揭示，${revealRemaining}秒后翻为已购买`
                : (teamFull
                ? '队伍已满'
                : (roundState && roundState.skipped
                  ? '本轮权限已结束'
                  : (roundState && roundState.purchaseUsed
                    ? '本轮权限已结束'
                    : (Hexcore2.state.draft.pickedThisTurn
                        ? '已购买'
                        : ((shouldMask || snowCat) ? '点击购买后揭示' : '点击购买')))))))));
            return `
            <button class="player-card tier-${tier} ${canBuy ? 'can-buy' : 'cannot-buy'} ${purchaseSubmitting ? 'is-submitting' : ''} ${blinded && !purchasedRevealActive ? 'blind-card' : ''} ${weatherFog && !purchasedRevealActive ? 'weather-fog-card' : ''} ${purchasedRevealActive ? 'purchased-reveal-card' : ''} ${weatherFogRevealActive ? 'weather-fog-revealing' : ''} ${snowCatRevealActive ? 'snow-cat-revealing' : ''} ${snowCat && !purchasedRevealActive ? 'snow-cat-card' : ''} ${draw && draw.pickMode === 'mystery_swap' ? 'mystery-card' : ''}" style="--slot-index:${index}; --fog-reveal-ms:${purchasedRevealActive ? Math.max(120, revealUntil - Date.now()) : 5000}ms" ${canBuy ? `onclick="window.hexcoreUI.buyCard(${index})"` : 'aria-disabled="true" disabled'}>
              <b class="shop-price-badge">${escapeHtml(tier)}费${priceBonus ? `<i>+${priceBonus}</i>` : ''}</b>
              <strong>${shouldMask ? '云雾遮蔽' : escapeHtml(displayPlayer.name)}</strong>
              <small>${shouldMask ? '购买后揭示真实选手' : `ID: ${escapeHtml(displayPlayer.gameId)}${draw && draw.pickMode === 'blind_box' && realPlayer.status === 'drafted' ? ` / 已在 ${escapeHtml(teamOwnerName(realPlayer))}` : ''}`}</small>
              <span class="camp-pill">${purchasedRevealActive ? '已购买揭示' : (weatherFog ? '天气迷雾' : (snowCat ? '信息扰乱' : escapeHtml(Hexcore2.selectors.campLabel(player.camp))))}</span>
              <div class="hero-title">擅长英雄</div>
              <div class="hero-row">
                ${(shouldMask ? ['雾', '雨', '风'] : (displayPlayer.heroes && displayPlayer.heroes.length ? displayPlayer.heroes : ['暂无', '暂无', '暂无'])).map(hero => `<span>${escapeHtml(hero)}</span>`).join('')}
              </div>
              <span class="shop-card-action-hint">${escapeHtml(actionHint)}</span>
            </button>
          `;
          }).join('')}
        </div>
        <p class="hint">提示：${captain ? `本轮最多购买 1 名队员。刷新不消耗购买权，购买或跳过后本轮权限立即固化。${escapeHtml(captain.name)} 队伍人数 ${Hexcore2.selectors.teamTotalSize(captain.id)}/${Hexcore2.state.settings.playersPerTeam}（队员 ${Hexcore2.selectors.teamSize(captain.id)}/${Hexcore2.selectors.teamMemberCapacity(captain.id)}）。` : '当前没有可操作队长'}</p>
      </section>
    `;
  }

  function heavenlyDescentBanner() {
    const windowState = Hexcore2.state.draft && Hexcore2.state.draft.heavenlyWindow;
    if (!windowState || !windowState.active || windowState.resolved) return '';
    const remaining = windowState.expiresAt ? Math.max(0, Math.ceil((Number(windowState.expiresAt) - Date.now()) / 1000)) : 0;
    if (remaining <= 0) return '';
    const targetCaptain = Hexcore2.state.captains.find(captain => captain.id === windowState.captainId);
    const player = playerById(windowState.playerId);
    const isCampMode = Hexcore2.selectors.isCampMode ? Hexcore2.selectors.isCampMode() : true;
    const owners = Hexcore2.state.captains.filter(captain =>
      (Hexcore2.state.hexcoreAssignments[captain.id] || []).some(hexcore =>
        hexcore.id === 'heavenly-descent'
        && hexcore.status !== 'used'
        && Hexcore2.selectors.isHexcoreEnabled(hexcore.id)
      )
    );
    const playerCamp = player ? player.camp : '';
    const projectedOwnerIds = new Set(Array.isArray(windowState.eligibleOwnerIds)
      ? windowState.eligibleOwnerIds.map(id => String(id || '').trim()).filter(Boolean)
      : []);
    const eligibleOwners = windowState.projectedFromServer && projectedOwnerIds.size
      ? owners.filter(owner => projectedOwnerIds.has(owner.id))
      : owners.filter(owner =>
        owner.id !== windowState.captainId
        && (isCampMode ? (playerCamp && Hexcore2.selectors.captainCamp(owner.id) === playerCamp) : true)
      );
    const visibleEligibleOwners = isCaptainClient()
      ? eligibleOwners.filter(owner => owner.id === clientTeamId())
      : eligibleOwners;
    if (!visibleEligibleOwners.length) return '';
    const playerText = player ? `「${escapeHtml(player.name)}」` : '该选手';
    const ruleText = isCampMode ? `刚购买的同阵营选手${playerText}` : `刚购买的公共池选手${playerText}`;
    const refundText = Number(windowState.price) > 0
      ? `返还 ${Number(windowState.price) || 0} 金币和购买权`
      : '返还购买费用和购买权';
    return `
      <section class="heavenly-window-banner">
        <div>
          <strong>神兵天降可发动</strong>
          <span><b data-countdown="heavenly-window">${remaining}</b> 秒内可夺取 ${escapeHtml(targetCaptain ? targetCaptain.name : '目标队长')} ${ruleText}。成功后原购买队长${refundText}。</span>
        </div>
        <div class="heavenly-window-actions">
          ${visibleEligibleOwners.map(owner => `<button onclick='window.hexcoreUI.useHeavenlyDescent(${safeJsonString(owner.id)})'>${escapeHtml(owner.name)} 发动</button>`).join('')}
        </div>
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
    const inSetup = Hexcore2.state.draft.phase === 'setup';
    const shopButton = shopActionText(captain, roundState, nextRefreshCost, nextRefreshReason, inSetup);
    const shopBlockedReason = readonlyShopReason() || (isCaptainClient() && !captainCanOperateCurrentTurn()
      ? '非你的回合，仅可查看'
      : shopActionBlockReason(captain, roundState, inSetup));
    const shopSubmitting = roomCommandSubmitting('OpenShop') || roomCommandSubmitting('RefreshShop');
    const skipSubmitting = roomCommandSubmitting('SkipTurn');
    const shopDisabled = Boolean(shopBlockedReason || shopSubmitting);
    const skipEnabled = Boolean(!skipSubmitting && !isReadonlyClient() && roundState && captainCanOperateCurrentTurn() && !roundState.purchaseUsed && !roundState.skipped);
    if (isReadonlyClient() || (isCaptainClient() && shopDisabled && !skipEnabled)) return '';
    const shopTitle = shopSubmitting ? '提交中...' : (shopDisabled ? '已无购买权' : shopButton.title);
    const shopHint = shopSubmitting ? '正在提交到服务端' : (shopDisabled ? shopBlockedReason : shopButton.hint);
    const shopClick = shopDisabled ? '' : (inSetup ? 'window.hexcoreUI.startDraft()' : 'window.hexcoreUI.drawCards()');
    return `
      <section class="control-panel">
        <h2>${isReadonlyClient() ? '观众端' : (isCaptainClient() ? '队长操作' : '裁判操作')}</h2>
        <div class="control-grid">
          <div class="control-group shop-actions">
            <span class="control-group-label">商店</span>
            <button class="action-btn cyan ${shopDisabled ? 'disabled' : ''}" ${shopDisabled ? 'disabled' : ''} onclick="${shopClick}">${icon(inSetup || !(roundState && roundState.freeShopUsed) ? 'cube' : 'refresh')}<strong>${escapeHtml(shopTitle)}</strong><span>${escapeHtml(shopHint)}</span></button>
          </div>
          <div class="control-group primary-actions">
            <span class="control-group-label">流程</span>
            <button class="action-btn amber ${skipEnabled ? '' : 'disabled'} ${skipSubmitting ? 'is-submitting' : ''}" ${skipEnabled ? '' : 'disabled'} onclick="${skipEnabled ? 'window.hexcoreUI.skipTurn()' : ''}"><span class="fast-icon">»</span><strong>${skipSubmitting ? '提交中...' : '跳过本轮'}</strong><span>${skipSubmitting ? '正在提交到服务端' : (isReadonlyClient() ? '观众只读' : (captainCanOperateCurrentTurn() ? '购买权限作废' : '非你的回合'))}</span></button>
            ${isCaptainClient() || isReadonlyClient() ? '' : `<button class="action-btn blue" onclick="window.hexcoreUI.nextCaptain()">${icon('team')}<strong>下一位</strong><span>交给下一队长</span></button>`}
          </div>
          ${isCaptainClient() || isReadonlyClient() ? '' : `<div class="control-group system-actions">
            <span class="control-group-label">系统</span>
            <button class="action-btn muted ${(Hexcore2.state.undoStack || []).length === 0 ? 'disabled' : ''}" onclick="window.hexcoreUI.undo()">${icon('undo')}<strong>撤销上一步</strong><span>可撤销 ${(Hexcore2.state.undoStack || []).length} 步</span></button>
            <button class="action-btn muted" onclick="window.hexcoreUI.recoverDraftState()">${icon('refresh')}<strong>修正异常</strong><span>轮次/顺位/满员</span></button>
          </div>`}
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
    const targetContext = targetContextForCaptain(captain);
    return `
      <section class="hexcore-panel">
        <h2>${escapeHtml(captain.name)} 的海克斯</h2>
        ${hexcoreExecutionQueue(captain.id)}
        ${hexTargetPickerPanel(captain, targetContext)}
      </section>
      ${captainOwnHexcorePanel()}
    `;
  }

  function targetContextForCaptain(captain) {
    const blindTargets = Hexcore2.hexcoreEngine.blindTargetOptions(captain.id);
    const teamPlayers = captain.team
      .map(playerId => playerById(playerId))
      .filter(Boolean);
    const availablePlayers = Hexcore2.state.players
      .filter(player => player.status === 'available')
      .sort((a, b) => b.score - a.score);
    return { blindTargets, teamPlayers, availablePlayers };
  }

  function captainOwnHexcorePanel() {
    if (!isCaptainClient()) return '';
    const own = clientCaptain();
    const current = Hexcore2.selectors.currentCaptain();
    if (!own || (current && current.id === own.id)) return '';
    const queue = Hexcore2.hexcoreEngine.executionQueue(own.id);
    const picker = Hexcore2.state.ui && Hexcore2.state.ui.hexTargetPicker;
    const shouldShowPicker = Boolean(picker && picker.captainId === own.id);
    const executable = queue.filter(item => item.executable);
    if (!shouldShowPicker && !executable.length) return '';
    const targetContext = targetContextForCaptain(own);
    return `
      <section class="hexcore-panel">
        <h2>本队可发动海克斯</h2>
        <div class="empty-log">当前观看其它队长回合，仅本人海克斯允许窗口可操作。</div>
        ${hexcoreExecutionQueue(own.id)}
        ${hexTargetPickerPanel(own, targetContext)}
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
    const eventIndex = event => Hexcore2.state.events.indexOf(event);

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
            <button class="event-item ${eventLevelClass(event.level)} ${ui.highlightEventIndex === eventIndex(event) ? 'located-card' : ''}" onclick="window.hexcoreUI.locateEvent(${eventIndex(event)})" title="定位到相关对象">
              <time>${escapeHtml(event.time)}</time>
              <div class="event-dot"></div>
              <div>
                <strong>${escapeHtml(event.title)}</strong>
                <p>${escapeHtml(event.body)}</p>
              </div>
            </button>
          `).join('') || '<div class="empty-log">当前筛选下没有事件</div>'}
        </div>
          ${isReadonlyClient() ? '' : (isCaptainClient() ? '' : '<button class="export-btn" onclick="window.hexcoreUI.exportEvents()">导出日志</button>')}
      </aside>
    `;
  }

  function rosterRail() {
    const currentCaptain = Hexcore2.selectors.currentCaptain();
    const teamCount = Hexcore2.selectors.teamCount();
    const totalCapacity = Math.max(1, Number(Hexcore2.state.settings.playersPerTeam) || 5);
    const assignedCounts = new Map();
    Hexcore2.state.captains.forEach(captain => {
      if (captain.playerId) assignedCounts.set(captain.playerId, (assignedCounts.get(captain.playerId) || 0) + 1);
      (captain.team || []).forEach(playerId => {
        assignedCounts.set(playerId, (assignedCounts.get(playerId) || 0) + 1);
      });
    });
    function rosterMembers(captain) {
      return (captain.team || []).map(playerId => playerById(playerId)).filter(Boolean);
    }
    function feeDistribution(players) {
      const counts = players.reduce((result, player) => {
        const tier = Math.max(1, Math.min(5, Number(player.tier) || 1));
        result[tier] = (result[tier] || 0) + 1;
        return result;
      }, {});
      const rows = [1, 2, 3, 4, 5]
        .filter(tier => counts[tier])
        .map(tier => `${tier}费×${counts[tier]}`);
      return rows.length ? rows.join(' / ') : '暂无队员';
    }
    function rosterIssues(captain) {
      const issues = [];
      const capacity = Hexcore2.selectors.teamMemberCapacity(captain.id);
      const captainPlayer = Hexcore2.selectors.captainPlayer(captain.id);
      const captainCamp = Hexcore2.selectors.captainCamp(captain.id);
      if (!captainPlayer) issues.push('缺队长');
      if ((captain.team || []).length > capacity) issues.push(`超员 ${(captain.team || []).length - capacity} 人`);
      if (captain.playerId && !captainPlayer) issues.push('队长选手已失效');
      (captain.team || []).forEach(playerId => {
        const player = playerById(playerId);
        if (!player) {
          issues.push(`缺失选手 ${playerId}`);
          return;
        }
        if ((assignedCounts.get(playerId) || 0) > 1) issues.push(`${player.name} 重复归属`);
        if (player.teamId !== captain.id) issues.push(`${player.name} 归属不一致`);
        if (captainCamp && player.camp !== captainCamp) {
          issues.push(`${player.name} 异阵营`);
        }
      });
      return issues;
    }
    function roundStatus(captain) {
      return Hexcore2.economyEngine ? Hexcore2.economyEngine.roundState(captain.id) : null;
    }
    function rosterState(captain, issues) {
      const isCurrent = Boolean(currentCaptain && currentCaptain.id === captain.id);
      const totalSize = Hexcore2.selectors.teamTotalSize(captain.id);
      const state = roundStatus(captain);
      if (issues.length) return { label: '异常', className: 'abnormal' };
      if (isCurrent) return { label: '当前操作', className: 'current' };
      if (state && state.purchaseUsed) return { label: '已购买', className: 'purchased' };
      if (state && state.skipped) return { label: '已跳过', className: 'skipped' };
      if (totalSize >= totalCapacity) return { label: '已满员', className: 'full' };
      return { label: `待补位 ${totalCapacity - totalSize}`, className: 'pending' };
    }
    return `
      <footer class="roster-rail">
        <div class="rail-header roster-board-header">
          <h2>队伍阵容概览（${teamCount} 队）</h2>
          <div class="roster-legend">
            <span><i class="status-dot current"></i>当前</span>
            <span><i class="status-dot full"></i>满员</span>
            <span><i class="status-dot pending"></i>待补位</span>
            <span><i class="status-dot abnormal"></i>异常</span>
          </div>
        </div>
        <div class="roster-list roster-board" role="list">
          ${Hexcore2.state.captains.map((captain, index) => {
            const captainPlayer = Hexcore2.selectors.captainPlayer(captain.id);
            const members = rosterMembers(captain);
            const totalSize = Hexcore2.selectors.teamTotalSize(captain.id);
            const camp = Hexcore2.selectors.captainCamp(captain.id);
            const campText = Hexcore2.selectors.campLabel(camp);
            const economy = captain.economy || {};
            const hexcores = Hexcore2.state.hexcoreAssignments[captain.id] || [];
            const hexText = hexcores.length ? hexcores.map(item => item.name).join('、') : '无海克斯';
            const memberSummary = members.slice(0, 4).map(player => `${player.tier || '?'}费 ${player.name}`).join(' · ') || '暂无队员';
            const distribution = feeDistribution(members);
            const issues = rosterIssues(captain);
            const state = rosterState(captain, issues);
            const issueText = issues.length ? issues.join('；') : '无异常';
            const detailMembers = members.length
              ? members.map(player => `<li><span>${player.tier || '?'}费</span><strong>${escapeHtml(player.name)}</strong><em>${escapeHtml(player.lane || '未知位置')}</em></li>`).join('')
              : '<li class="empty-detail">暂无队员</li>';
            return `
            <button type="button" role="listitem" class="team-roster-card ${escapeHtml(state.className)} ${currentCaptain && captain.id === currentCaptain.id ? 'active' : ''}" onclick='window.hexcoreUI.focusTeamFromRoster(${safeJsonString(captain.id)})' aria-label="定位 ${escapeHtml(captain.name)} 队伍">
              <span class="team-roster-top">
                <span class="team-roster-title"><b>${index + 1}</b><strong>${escapeHtml(captain.name)}</strong></span>
                <em>${totalSize}/${totalCapacity}</em>
              </span>
              <span class="team-roster-meta">
                <i class="status-dot ${escapeHtml(state.className)}"></i>
                ${escapeHtml(campText)} · 金币 ${Math.max(0, Number(economy.gold) || 0)}
              </span>
              <span class="team-roster-captain">${captainPlayer ? `队长 ${escapeHtml(captainPlayer.name)}` : '缺队长'}</span>
              <span class="team-roster-members">${escapeHtml(memberSummary)}</span>
              <span class="team-roster-foot">
                <span>${escapeHtml(distribution)}</span>
                <strong>${escapeHtml(state.label)}</strong>
              </span>
              <span class="team-roster-hex" title="${escapeHtml(hexText)}">${escapeHtml(hexText)}</span>
              <span class="roster-card-popover" role="tooltip">
                <strong>${escapeHtml(captain.name)} · ${escapeHtml(campText)} · 金币 ${Math.max(0, Number(economy.gold) || 0)} · ${escapeHtml(state.label)}</strong>
                <span>队长：${captainPlayer ? `[队长锁定] ${escapeHtml(captainPlayer.name)}` : '未设置'}</span>
                <span>海克斯：${escapeHtml(hexText)}</span>
                <span>费用分布：${escapeHtml(distribution)}</span>
                <span>异常：${escapeHtml(issueText)}</span>
                <ul>${detailMembers}</ul>
              </span>
            </button>
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
    const playerOwnerCounts = Hexcore2.state.captains.reduce((counts, item) => {
      (item.team || []).forEach(playerId => {
        counts[playerId] = (counts[playerId] || 0) + 1;
      });
      return counts;
    }, {});
    function teamCapacity(captain) {
      return Hexcore2.selectors.teamMemberCapacity(captain.id);
    }
    function teamName(captainId) {
      const owner = Hexcore2.state.captains.find(item => item.id === captainId);
      return owner ? owner.name : '其他队伍';
    }
    function teamPoolLabel(player) {
      const campMode = Hexcore2.selectors.isCampMode ? Hexcore2.selectors.isCampMode() : true;
      return campMode ? Hexcore2.selectors.campLabel(player && player.camp) : '公共卡池';
    }
    function memberIssues(captain, playerId, currentSlotIds = []) {
      const issues = [];
      const player = playerById(playerId);
      const captainCamp = Hexcore2.selectors.captainCamp(captain.id);
      const campMode = Hexcore2.selectors.isCampMode ? Hexcore2.selectors.isCampMode() : true;
      if (!player) {
        issues.push({ label: `缺失选手 ${playerId}`, kind: 'danger', fixable: true });
        return issues;
      }
      if (player.status === 'disabled') issues.push({ label: '选手已禁用', kind: 'warn', fixable: true });
      if (player.attendanceStatus === 'unavailable') issues.push({ label: '选手已缺席', kind: 'danger', fixable: true });
      if (player.attendanceStatus === 'high_risk') issues.push({ label: '高风险出勤', kind: 'warn', fixable: false });
      if (playerOwnerCounts[playerId] > 1 || currentSlotIds.filter(id => id === playerId).length > 1) {
        issues.push({ label: '重复归属', kind: 'danger', fixable: true });
      }
      if (player.teamId && player.teamId !== captain.id) {
        issues.push({ label: `归属指向${teamName(player.teamId)}`, kind: 'danger', fixable: true });
      }
      if (campMode && player && captainCamp && player.camp !== captainCamp) {
        issues.push({ label: `跨阵营：${Hexcore2.selectors.campLabel(player.camp)}`, kind: 'danger', fixable: true });
      }
      return issues;
    }
    function replacementCandidates(captain) {
      const campMode = Hexcore2.selectors.isCampMode ? Hexcore2.selectors.isCampMode() : true;
      const captainCamp = Hexcore2.selectors.captainCamp(captain.id);
      return Hexcore2.state.players
        .filter(player => player.status === 'available')
        .filter(player => player.attendanceStatus === 'confirmed')
        .filter(player => !Hexcore2.selectors.isCaptainPlayer(player.id))
        .filter(player => !campMode || !captainCamp || player.camp === captainCamp)
        .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN'));
    }
    function canReplaceMember(player) {
      if (!player || isCaptainClient() || isReadonlyClient()) return false;
      return player.status === 'disabled'
        || player.status === 'unavailable'
        || player.attendanceStatus === 'unavailable'
        || player.attendanceStatus === 'high_risk';
    }
    function substituteReplaceTools(captain, player) {
      if (!canReplaceMember(player)) return '';
      const candidates = replacementCandidates(captain);
      const selectId = `team-replace-sub-${captain.id}-${player.id}`;
      return `
        <div class="substitute-replace-tools">
          <label>
            <small>替补替换</small>
            <select id="${escapeHtml(selectId)}" ${candidates.length ? '' : 'disabled'}>
              <option value="">${candidates.length ? '选择已激活替补' : '暂无可用替补'}</option>
              ${candidates.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} · ${escapeHtml(item.lane || '未知')} · ${escapeHtml(Hexcore2.state.settings.tierNames[item.tier] || '未知卡池')} · 评分 ${escapeHtml(item.score || 0)}</option>`).join('')}
            </select>
          </label>
          <button ${candidates.length ? '' : 'disabled'} onclick='window.hexcoreUI.replaceWithSubstitute(${safeJsonString(captain.id)}, ${safeJsonString(player.id)})'>替换</button>
        </div>
      `;
    }
    function teamIssues(captain) {
      const issues = [];
      const capacity = teamCapacity(captain);
      const captainPlayer = Hexcore2.selectors.captainPlayer(captain.id);
      const totalSize = Hexcore2.selectors.teamTotalSize(captain.id);
      const totalCapacity = Hexcore2.state.settings.playersPerTeam;
      if (captain.team.length > capacity) issues.push({ label: `超员 ${captain.team.length - capacity} 人`, kind: 'danger', fixable: true });
      if (!captainPlayer && captain.team.length >= capacity) issues.push({ label: '满员但未设置队长，可在队员卡片点击“设为队长”', kind: 'warn', fixable: false });
      if (totalSize < totalCapacity) issues.push({ label: `缺员 ${totalCapacity - totalSize} 人，可补录或继续购买`, kind: 'pending', fixable: false });
      if (captain.playerId && !captainPlayer) issues.push({ label: '队长选手已失效，需要重新指定队长', kind: 'danger', fixable: true });
      captain.team.forEach(playerId => {
        const player = playerById(playerId);
        memberIssues(captain, playerId, captain.team).forEach(issue => {
          issues.push({
            label: `${player ? player.name : playerId} ${issue.label}`,
            kind: issue.kind,
            fixable: issue.fixable,
          });
        });
      });
      return issues;
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
    function captainsForTeamsPage() {
      return Hexcore2.state.captains;
    }
    function teamPermissionState(captain, isOwnCaptainTeam) {
      if (isReadonlyClient()) return { label: '观众只读', detail: '可查看公开阵容，不可编辑', className: 'readonly' };
      if (isCaptainClient()) {
        return isOwnCaptainTeam
          ? { label: '本队可编辑', detail: '仅队伍名称可改，队员归属只读', className: 'own' }
          : { label: '其它队伍只读', detail: '可查看阵容，不可编辑', className: 'readonly' };
      }
      return { label: '裁判可管理', detail: '可修正队伍、顺位和成员', className: 'admin' };
    }
    const visibleCaptains = captainsForTeamsPage();
    return `
      ${pageHeader(isCaptainClient() || isReadonlyClient() ? '队伍总览' : '队伍管理', isReadonlyClient() ? '观众端可查看全部队伍公开阵容，只读不可编辑。' : (isCaptainClient() ? '队长端可查看全部队伍，只有自己的队伍名称可编辑。' : '裁判可调整队伍、切换当前队伍、重命名队伍并处理队员归属。'))}
      ${captainClientReadonlyNotice()}
      ${viewerReadonlyNotice()}
      <section class="data-panel teams-panel">
        <div class="toolbar-row team-toolbar">
          <div>
            <strong>${isCaptainClient() || isReadonlyClient() ? `当前显示全部 ${visibleCaptains.length} 支队伍` : `当前 ${Hexcore2.selectors.teamCount()} 队，允许 ${Hexcore2.state.settings.minTeams}-${Hexcore2.state.settings.maxTeams} 队`}</strong>
            <span>${isReadonlyClient() ? '全部队伍只读展示；隐藏所有裁判修正入口。' : (isCaptainClient() ? '全部队伍可查看；只有绑定队伍可改名，其它队伍和裁判修正入口均为只读。' : '队伍增删会重算基础顺位，并清空当前商店结果。')}</span>
          </div>
          ${isCaptainClient() || isReadonlyClient() ? '' : `<div class="toolbar-actions">
            <input id="teams-team-count" type="number" min="${Hexcore2.state.settings.minTeams}" max="${Hexcore2.state.settings.maxTeams}" value="${Hexcore2.selectors.teamCount()}" aria-label="队伍数量">
            <button class="subtle-btn" onclick="window.hexcoreUI.updateTeamCountFromTeams()">应用数量</button>
            <button class="primary-btn" onclick="window.hexcoreUI.addCaptain()">${Hexcore2.icon('team')}新增队伍</button>
            <button class="danger-btn" type="button" onclick="window.hexcoreUI.openDissolveTeamsDialog()">${Hexcore2.icon('users')}一键解散队伍</button>
          </div>`}
        </div>
        <div class="metrics-grid">
          <div><span>满员队伍</span><strong>${visibleCaptains.filter(captain => Hexcore2.selectors.teamTotalSize(captain.id) === Hexcore2.state.settings.playersPerTeam).length}</strong></div>
          <div><span>缺员队伍</span><strong>${visibleCaptains.filter(captain => Hexcore2.selectors.teamTotalSize(captain.id) < Hexcore2.state.settings.playersPerTeam).length}</strong></div>
          <div><span>异常队伍</span><strong>${visibleCaptains.filter(captain => captain.team.length > teamCapacity(captain) || captain.team.some(playerId => !playerById(playerId))).length}</strong></div>
          <div><span>${isCaptainClient() || isReadonlyClient() ? '队伍数量' : '可补录选手'}</span><strong>${isCaptainClient() || isReadonlyClient() ? visibleCaptains.length : availablePlayers.length}</strong></div>
        </div>
        <div class="data-grid team-grid">
          ${visibleCaptains.map((captain, index) => {
            const basePosition = Hexcore2.state.draft.baseOrder.indexOf(captain.id) + 1;
            const status = teamStatus(captain);
            const captainPlayer = Hexcore2.selectors.captainPlayer(captain.id);
            const capacity = teamCapacity(captain);
            const issues = teamIssues(captain);
            const repairableIssues = issues.filter(issue => issue.fixable);
            const isOwnCaptainTeam = isCaptainClient() && captain.id === clientTeamId();
            const permission = teamPermissionState(captain, isOwnCaptainTeam);
            const backfillPlayers = availablePlayers.filter(player =>
              !Hexcore2.selectors.isCaptainPlayer(player.id)
              && (!goldShopMode || !(Hexcore2.selectors.isCampMode && Hexcore2.selectors.isCampMode()) || player.camp === Hexcore2.selectors.captainCamp(captain.id))
            );
            const canBackfill = captain.team.length < capacity && backfillPlayers.length > 0;
            return `
            <article class="data-card ${isReadonlyClient() ? 'captain-readonly-team' : (isCaptainClient() ? (isOwnCaptainTeam ? 'captain-own-team' : 'captain-readonly-team') : '')} ${currentCaptain && currentCaptain.id === captain.id ? 'active-card' : ''} ${Hexcore2.state.ui.highlightCaptainId === captain.id ? 'located-card' : ''}" data-captain-id="${escapeHtml(captain.id)}">
              <div class="data-card-head">
                <span>${index + 1}</span>
                <label class="captain-name-field">
                  <small>队伍名称</small>
                  <input id="captain-name-${escapeHtml(captain.id)}" value="${escapeHtml(captain.name)}" aria-label="${escapeHtml(captain.name)} 队伍名称" ${isReadonlyClient() || (isCaptainClient() && !isOwnCaptainTeam) ? 'readonly' : ''}>
                </label>
                <div class="team-permission-badge ${escapeHtml(permission.className)}">
                  <strong>${escapeHtml(permission.label)}</strong>
                  <small>${escapeHtml(permission.detail)}</small>
                </div>
              </div>
              <p>状态：<em class="${status.className}">${escapeHtml(status.label)}</em></p>
              <p>顺位记录：${escapeHtml(captain.record)} / 基础顺位第 ${basePosition}</p>
              <p>队伍人数：${Hexcore2.selectors.teamTotalSize(captain.id)}/${Hexcore2.state.settings.playersPerTeam}（含队长，队员 ${captain.team.length}/${capacity}）</p>
              ${issues.length ? `
                <div class="team-issue-box">
                  ${issues.slice(0, 6).map(issue => `<span class="team-issue ${escapeHtml(issue.kind)}">${escapeHtml(issue.label)}</span>`).join('')}
                  ${issues.length > 6 ? `<span class="team-issue warn">另有 ${issues.length - 6} 项</span>` : ''}
                  ${!isReadonlyClient() && !isCaptainClient() && repairableIssues.length ? `<button class="subtle-btn" onclick='window.hexcoreUI.repairTeamIssues(${safeJsonString(captain.id)})'>修复异常</button>` : ''}
                </div>
              ` : ''}
              ${isCaptainClient() || isReadonlyClient() ? '' : `<div class="order-tools">
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
              </div>`}
              <div class="member-list">
                ${captainPlayer ? `
                  <article class="team-member captain-member">
                    <div>
                      <strong>${escapeHtml(captainPlayer.name)}</strong>
                      <span>队长 · ${escapeHtml(teamPoolLabel(captainPlayer))} · 固定第一位</span>
                      <small>ID：${escapeHtml(captainPlayer.gameId || captainPlayer.id)}</small>
                    </div>
                  </article>
                ` : ''}
                ${Array.from({ length: capacity }, (_, slotIndex) => {
                  const playerId = captain.team[slotIndex];
                  const player = playerById(playerId);
                  const slotIssues = playerId ? memberIssues(captain, playerId, captain.team) : [];
                  const hasDangerIssue = slotIssues.some(issue => issue.kind === 'danger');
                  return player ? `
                    <article class="team-member ${slotIssues.length ? 'abnormal-member' : ''} ${hasDangerIssue ? 'danger-member' : 'warn-member'}">
                      <div>
                        <div class="team-member-title">
                          <strong>${escapeHtml(player.name)}</strong>
                          ${slotIssues.length ? `<span class="abnormal-badge">${hasDangerIssue ? '异常' : '警告'}</span>` : ''}
                        </div>
                        <span>${escapeHtml(teamPoolLabel(player))} · ${escapeHtml(player.lane || '未知')} · ${escapeHtml(Hexcore2.state.settings.tierNames[player.tier] || '未知卡池')} · 评分 ${player.score}</span>
                        <small>ID：${escapeHtml(player.gameId || player.id)}</small>
                        ${slotIssues.length ? `
                          <div class="member-warning-list">
                            ${slotIssues.map(issue => `<span class="${escapeHtml(issue.kind)}">${escapeHtml(issue.label)}</span>`).join('')}
                          </div>
                        ` : ''}
                        ${substituteReplaceTools(captain, player)}
                      </div>
                      ${isCaptainClient() || isReadonlyClient() ? '' : `<div class="team-member-actions">
                        <button onclick='window.hexcoreUI.promotePlayerToCaptain(${safeJsonString(player.id)})'>设为队长</button>
                        <button onclick='window.hexcoreUI.removePlayerFromTeam(${safeJsonString(captain.id)}, ${safeJsonString(player.id)})'>移回池</button>
                      </div>`}
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
              ${isReadonlyClient() ? '' : (isCaptainClient() ? (isOwnCaptainTeam ? `
              <div class="card-actions">
                <button onclick='window.hexcoreUI.saveCaptainName(${safeJsonString(captain.id)})'>保存名称</button>
              </div>` : '') : `<div class="backfill-tools">
                ${goldShopMode ? `
                  <p class="hint">${Hexcore2.selectors.isCampMode && Hexcore2.selectors.isCampMode() ? '裁判纠错补录：仅可从同阵营可选选手中补入，不扣金币、不消耗本轮购买权。' : '裁判纠错补录：公共卡池可选选手均可补入，不扣金币、不消耗本轮购买权。'}</p>
                  <select id="team-add-player-${escapeHtml(captain.id)}" aria-label="${escapeHtml(captain.name)} 纠错补录选手" ${canBackfill ? '' : 'disabled'}>
                    <option value="">${captain.team.length >= capacity ? '队伍已满员' : (backfillPlayers.length ? (Hexcore2.selectors.isCampMode && Hexcore2.selectors.isCampMode() ? '选择同阵营可选选手' : '选择公共卡池可选选手') : (Hexcore2.selectors.isCampMode && Hexcore2.selectors.isCampMode() ? '暂无同阵营可选选手' : '暂无公共卡池可选选手'))}</option>
                    ${backfillPlayers.map(player => `<option value="${player.id}">${escapeHtml(player.name)} · ${escapeHtml(player.lane || '未知')} · ${escapeHtml(Hexcore2.state.settings.tierNames[player.tier])} · ${player.score}</option>`).join('')}
                  </select>
                  <button ${canBackfill ? '' : 'disabled'} onclick='window.hexcoreUI.assignPlayerToTeam(${safeJsonString(captain.id)})'>补录队员</button>
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
              </div>`)}
            </article>
          `;
          }).join('')}
        </div>
      </section>
    `;
  }

  function playersPage() {
    const tierNames = Hexcore2.state.settings.tierNames;
    const noCampMode = Hexcore2.selectors.isCampMode ? !Hexcore2.selectors.isCampMode() : false;
    const campFilters = (Hexcore2.state.ui && Hexcore2.state.ui.playerCampFilters) || {};
    const camps = noCampMode ? [
      { id: 'all', label: '公共选手池' },
    ] : [
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
    function attendanceOptions(player) {
      const options = [
        ['confirmed', '已确认'],
        ['pending', '待确认'],
        ['high_risk', '高风险'],
        ['substitute', '替补'],
        ['unavailable', '缺席'],
      ];
      return options.map(([value, label]) => `<option value="${value}" ${player.attendanceStatus === value ? 'selected' : ''}>${label}</option>`).join('');
    }
    function profileOptions(player) {
      const profiles = Array.isArray(Hexcore2.state.playerProfiles) ? Hexcore2.state.playerProfiles : [];
      return [
        `<option value="">未关联档案</option>`,
        ...profiles.map(profile => `<option value="${escapeHtml(profile.id)}" ${player.profileId === profile.id ? 'selected' : ''}>${escapeHtml(profile.commonName)}</option>`),
      ].join('');
    }
    function campRankedPlayers(camp) {
      return Hexcore2.state.players
        .filter(item => noCampMode || item.camp === camp)
        .filter(item => !Hexcore2.selectors.isCaptainPlayer(item.id))
        .slice()
        .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN'));
    }
    function poolExplanation(player) {
      if (noCampMode) {
        const ranked = campRankedPlayers('all');
        const rank = ranked.findIndex(item => item.id === player.id) + 1;
        const total = ranked.length;
        const tier = Math.max(1, Math.min(5, Number(player.tier) || 1));
        if (Hexcore2.selectors.isCaptainPlayer(player.id)) {
          return {
            summary: '公共卡池队长专属：不参与普通费用池重算',
            detail: '无阵营模式使用公共选手池，队长仍作为队伍绑定身份，不进入普通商店池。',
          };
        }
        return {
          summary: `公共卡池官方成绩第 ${rank || '-'}/${total}，当前 ${tier} 费`,
          detail: '无阵营模式不按本地/外地分池，未被设为队长且出勤可用的选手会进入公共候选池。',
        };
      }
      const campName = Hexcore2.selectors.campLabel(player.camp);
      if (Hexcore2.selectors.isCaptainPlayer(player.id)) {
        return {
          summary: `${campName}队长专属：不参与普通费用池重算`,
          detail: '普通池会先剔除全部队长；有历史成绩的选手按官方成绩排序分档，无历史成绩的选手按 score 直接落费。',
        };
      }
      const ranked = campRankedPlayers(player.camp);
      const rank = ranked.findIndex(item => item.id === player.id) + 1;
      const total = ranked.length;
      const tier = Math.max(1, Math.min(5, Number(player.tier) || 1));
      if (player.tierSource === 'score') {
        return {
          summary: `${campName}普通池 score 直落，当前 ${tier} 费`,
          detail: `该选手没有有效历史成绩，使用 score=${Number(player.score) || 0} 作为费用；score=5 进 5 费，score=4 进 4 费，以此类推。`,
        };
      }
      const bucketSize = Math.max(1, Math.ceil(total / 5));
      const start = Math.min(total, (5 - tier) * bucketSize + 1);
      const end = Math.min(total, (6 - tier) * bucketSize);
      return {
        summary: `${campName}普通池官方成绩第 ${rank || '-'}/${total}，当前 ${tier} 费`,
        detail: `${tier} 费边界：第 ${start || 0}-${end || 0} 名；队长已从普通池剔除后，历史成绩有效的选手按官方成绩五档重分。`,
      };
    }
    function visibleByCampFilter(player, camp) {
      if (noCampMode) return true;
      const filter = campFilters[camp] || 'all';
      if (filter === 'all') return true;
      return Number(filter) === player.tier;
    }
    function playerRow(player) {
      const owner = player.teamId ? Hexcore2.state.captains.find(captain => captain.id === player.teamId) : null;
      const isCaptain = Hexcore2.selectors.isCaptainPlayer(player.id);
      const canPromote = player.status !== 'disabled' && !isCaptain;
      const editingGameId = Hexcore2.state.ui && Hexcore2.state.ui.editingGameIdPlayerId === player.id;
      const editingName = Hexcore2.state.ui && Hexcore2.state.ui.editingNamePlayerId === player.id;
      const explanation = poolExplanation(player);
      const profile = player.profileId && Hexcore2.selectors.playerProfile ? Hexcore2.selectors.playerProfile(player.profileId) : null;
      const drawWeight = Hexcore2.selectors.effectiveDrawWeight ? Hexcore2.selectors.effectiveDrawWeight(player) : 1;
      return `
        <article class="player-row ${player.status === 'disabled' ? 'disabled-player' : ''} ${isCaptain ? 'captain-player-row' : ''} ${Hexcore2.state.ui.highlightPlayerId === player.id ? 'located-card' : ''}">
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
            <label><small>出勤状态</small><select onchange='window.hexcoreUI.setPlayerAttendance(${safeJsonString(player.id)}, this.value)'>${attendanceOptions(player)}</select></label>
            <label><small>关联档案</small><select onchange='window.hexcoreUI.linkPlayerProfile(${safeJsonString(player.id)}, this.value)'>${profileOptions(player)}</select></label>
            <div class="readonly-score"><span>评分</span><strong>${escapeHtml(player.score || 0)}</strong></div>
            <div class="readonly-score"><span>${noCampMode ? '模式' : '阵营'}</span><strong>${escapeHtml(noCampMode ? '公共卡池' : Hexcore2.selectors.campLabel(player.camp))}</strong></div>
            <div class="readonly-score"><span>抽取权重</span><strong>${escapeHtml(drawWeight)}</strong></div>
            <div class="pool-reason">
              <strong>${profile ? `档案：${escapeHtml(profile.commonName)}` : '未关联历史档案'}</strong>
              <span>${escapeHtml(profile ? `可靠性：${Hexcore2.selectors.attendanceLabel(profile.attendanceReliability)}；别名 ${profile.aliases.length} 个；历史身份 ${profile.historicalIdentities.length} 条` : '可为跨届常用名称建立档案，游戏ID只作为本届身份信息。')}</span>
            </div>
            <div class="pool-reason">
              <strong>${escapeHtml(explanation.summary)}</strong>
              <span>${escapeHtml(explanation.detail)}</span>
            </div>
          </div>
          <div class="player-actions">
            ${isCaptain
              ? `<button class="promote-inline" onclick='window.hexcoreUI.releaseCaptain(${safeJsonString(player.id)})'>解除队长</button>`
              : (canPromote ? `<button class="promote-inline" onclick='window.hexcoreUI.promotePlayerToCaptain(${safeJsonString(player.id)})'>设为队长</button>` : '<button disabled>不可设为队长</button>')}
            ${!isCaptainClient() && !isReadonlyClient() && !isCaptain && player.attendanceStatus === 'substitute' && player.status !== 'drafted'
              ? `<button class="promote-inline" onclick='window.hexcoreUI.activateSubstitute(${safeJsonString(player.id)})'>激活替补</button>`
              : ''}
            ${isCaptain ? '' : `<button class="${player.status === 'disabled' ? '' : 'danger-inline'}" onclick='window.hexcoreUI.togglePlayerDisabled(${safeJsonString(player.id)})'>${player.status === 'disabled' ? '恢复' : '禁用'}</button>`}
            ${profile ? `<button onclick='window.hexcoreUI.addPlayerAliasToProfile(${safeJsonString(player.id)})'>补充别名</button>` : `<button onclick='window.hexcoreUI.createProfileFromPlayer(${safeJsonString(player.id)})'>创建档案</button>`}
            <button class="danger-inline" onclick='window.hexcoreUI.deletePlayer(${safeJsonString(player.id)})'>删除</button>
          </div>
        </article>
      `;
    }
    return `
      ${pageHeader('选手库', noCampMode ? '无阵营模式使用公共选手池，查看选手状态、评分、位置和归属队伍。' : '按本地人和外地人双阵营卡池查看选手状态、评分、位置和归属队伍。')}
      <section class="data-panel">
        <div class="toolbar-row">
          <div>
            <strong>选手总数：${Hexcore2.state.players.length}</strong>
            <span>${noCampMode ? '无阵营模式使用公共选手池；替补、缺席和高风险选手按出勤状态控制是否进入候选池。' : '本模式默认10队，每队5人；选手可超过组队需求，未被设为队长或购买入队的选手保持空闲。每个阵营队伍数不得超过阵营人数/5。'}</span>
          </div>
          <div class="toolbar-actions">
            <button class="primary-btn" onclick="window.hexcoreUI.addPlayer()">新增选手</button>
            <button class="subtle-btn" onclick="document.getElementById('player-import-input').click()">导入 JSON/CSV</button>
            <button class="danger-btn" onclick="window.hexcoreUI.clearAllPlayers()">清空所有选手</button>
            <input id="player-import-input" type="file" accept=".json,.csv,application/json,text/csv" hidden onchange="window.hexcoreUI.importPlayers(this.files[0]); this.value = ''">
          </div>
        </div>
        <div class="camp-pool-grid ${noCampMode ? 'no-camp-pool-grid' : ''}">
          ${camps.map(camp => {
            const players = Hexcore2.state.players
              .filter(player => noCampMode || player.camp === camp.id)
              .slice()
              .sort((a, b) => b.tier - a.tier || (Number(b.resultScore) || 0) - (Number(a.resultScore) || 0) || (Number(b.score) || 0) - (Number(a.score) || 0));
            const captainCount = players.filter(player => Hexcore2.selectors.isCaptainPlayer(player.id)).length;
            const availableCount = players.filter(player => player.status === 'available' && !Hexcore2.selectors.isCaptainPlayer(player.id)).length;
            const teamLimit = Hexcore2.selectors.campTeamLimit(camp.id);
            return `
              <section class="camp-pool-panel">
                <div class="camp-pool-head">
                  <div>
                    <h2>${escapeHtml(camp.label)} ${players.length}</h2>
                    <span>${noCampMode ? `队长 ${captainCount} · 可抽队员 ${availableCount} · 超出组队需求可空闲` : `队长 ${captainCount}/${teamLimit} · 可抽队员 ${availableCount} · 超出组队需求可空闲`}</span>
                  </div>
                  ${noCampMode ? '' : `<select aria-label="${escapeHtml(camp.label)}费用筛选" onchange='window.hexcoreUI.setPlayerCampFilter(${safeJsonString(camp.id)}, this.value)'>
                    <option value="all" ${(campFilters[camp.id] || 'all') === 'all' ? 'selected' : ''}>全部</option>
                    ${[1, 2, 3, 4, 5].map(tier => `<option value="${tier}" ${String(campFilters[camp.id]) === String(tier) ? 'selected' : ''}>${tier}费</option>`).join('')}
                  </select>`}
                </div>
                <div class="pool-columns camp-tier-columns">
                  ${[5, 4, 3, 2, 1].map(tier => {
                    const tierPlayers = players.filter(player => player.tier === tier && visibleByCampFilter(player, camp.id));
                    return `
                      <div class="pool-column">
                    <h2>${escapeHtml(tierNames[tier])}池 <small>${players.filter(player => player.tier === tier).length}</small></h2>
                        ${tierPlayers.map(player => playerRow(player)).join('') || '<div class="empty-log">暂无选手</div>'}
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

  function captainHexcoreCatalogPage() {
    const allowedHexcores = Hexcore2.sampleData.hexcores.filter(hex =>
      !Hexcore2.hexcoreEngine
      || !Hexcore2.hexcoreEngine.isDisabledInGoldMode
      || !Hexcore2.hexcoreEngine.isDisabledInGoldMode(hex.id)
    );
    const hexFilter = (Hexcore2.state.ui && Hexcore2.state.ui.hexFilter) || 'all';
    const categoryEntries = Object.entries(hexcoreCategoryMeta).map(([id, meta]) => ({
      id,
      ...meta,
      count: allowedHexcores.filter(hex => hexcoreCategory(hex) === id).length,
    }));
    const visibleHexcores = allowedHexcores.filter(hex => {
      if (hexFilter === 'all') return true;
      if (hexFilter === 'manual') return hex.mode !== 'passive';
      if (hexFilter === 'passive') return hex.mode === 'passive';
      if (hexcoreCategoryMeta[hexFilter]) return hexcoreCategory(hex) === hexFilter;
      return hex.type === hexFilter;
    });
    return `
      ${pageHeader('海克斯图录', '仅查看海克斯图录和规则详情；抽取、分配、移除由裁判端或服务端流程控制。')}
      ${captainClientReadonlyNotice()}
      <section class="data-panel captain-hex-catalog">
        <div class="toolbar-row">
          <div>
            <strong>海克斯图录</strong>
            <span>队长端只读查看效果、触发时机和注意事项，不提供裁判兜底分配入口。</span>
          </div>
          <div class="toolbar-actions">
            <select aria-label="海克斯筛选" onchange="window.hexcoreUI.setHexFilter(this.value)">
              <option value="all" ${hexFilter === 'all' ? 'selected' : ''}>全部海克斯</option>
              ${categoryEntries.map(category => `<option value="${escapeHtml(category.id)}" ${hexFilter === category.id ? 'selected' : ''}>${escapeHtml(category.label)}</option>`).join('')}
              <option value="manual" ${hexFilter === 'manual' ? 'selected' : ''}>手动效果</option>
              <option value="passive" ${hexFilter === 'passive' ? 'selected' : ''}>被动效果</option>
            </select>
          </div>
        </div>
        <div class="hex-category-tabs" aria-label="海克斯业务分类">
          <button class="${hexFilter === 'all' ? 'active' : ''}" onclick="window.hexcoreUI.setHexFilter('all')">
            <strong>全部</strong><span>${allowedHexcores.length} 项</span>
          </button>
          ${categoryEntries.map(category => `
            <button class="${hexFilter === category.id ? 'active' : ''}" onclick='window.hexcoreUI.setHexFilter(${safeJsonString(category.id)})'>
              <strong>${escapeHtml(category.label)}</strong>
              <span>${category.count} 项 · ${escapeHtml(category.desc)}</span>
            </button>
          `).join('')}
        </div>
        <div class="hex-library">
          ${visibleHexcores.map(hex => `
            <article class="hex-library-card ${escapeHtml(hexcoreCategory(hex))}">
              <div class="hex-library-top">
                <div class="hex-library-icon" aria-hidden="true">${hexcoreIcon(hex, 'md')}</div>
                <div class="hex-library-title">
                  <strong>${escapeHtml(hex.name)}</strong>
                  <span>${hex.mode === 'passive' ? '被动自动' : '可在窗口中发动'}</span>
                </div>
              </div>
              <div class="hex-library-meta">
                <span class="hex-category-chip ${escapeHtml(hexcoreCategory(hex))}">${escapeHtml(hexcoreCategoryLabel(hex))}</span>
                <span>${escapeHtml(hexcoreTimingLabel(hex))}</span>
              </div>
              <p class="hex-library-desc">
                <span>${escapeHtml(hex.desc)}</span>
                <button type="button" class="hex-detail-trigger" onclick='window.hexcoreUI.showHexDetail(${safeJsonString(hex.id)})'>详情</button>
              </p>
            </article>
          `).join('')}
        </div>
      </section>
    `;
  }

  function hexcoresPage() {
    if (isCaptainClient() || isReadonlyClient()) return captainHexcoreCatalogPage();
    const captain = Hexcore2.selectors.currentCaptain();
    const selectedCaptainId = (Hexcore2.state.ui && Hexcore2.state.ui.hexCaptainId) || (captain && captain.id) || '';
    const selectedCaptain = Hexcore2.state.captains.find(item => item.id === selectedCaptainId) || captain;
    const ownedHexcores = selectedCaptain ? (Hexcore2.state.hexcoreAssignments[selectedCaptain.id] || []) : [];
    const session = Hexcore2.state.hexcoreDraft || {};
    const activeSession = selectedCaptain && session.captainId === selectedCaptain.id && session.slots && session.slots.length;
    const drawOrder = session.drawOrder || [];
    const nextCaptain = selectedCaptain
      ? Hexcore2.state.captains.find(captain => captain.id !== selectedCaptain.id && (Hexcore2.state.hexcoreAssignments[captain.id] || []).length < 1)
      : null;
    const hexcoreOwners = new Map();
    Hexcore2.state.captains.forEach(owner => {
      (Hexcore2.state.hexcoreAssignments[owner.id] || []).forEach(hex => {
        if (hex && hex.id && !hexcoreOwners.has(hex.id)) hexcoreOwners.set(hex.id, owner);
      });
    });
    const allowedHexcores = Hexcore2.sampleData.hexcores.filter(hex =>
      !Hexcore2.hexcoreEngine
      || !Hexcore2.hexcoreEngine.isDisabledInGoldMode
      || !Hexcore2.hexcoreEngine.isDisabledInGoldMode(hex.id)
    );
    const hexFilter = (Hexcore2.state.ui && Hexcore2.state.ui.hexFilter) || 'all';
    const categoryEntries = Object.entries(hexcoreCategoryMeta).map(([id, meta]) => ({
      id,
      ...meta,
      count: allowedHexcores.filter(hex => hexcoreCategory(hex) === id).length,
    }));
    const visibleHexcores = allowedHexcores.filter(hex => {
      if (hexFilter === 'all') return true;
      if (hexFilter === 'manual') return hex.mode !== 'passive';
      if (hexFilter === 'passive') return hex.mode === 'passive';
      if (hexcoreCategoryMeta[hexFilter]) return hexcoreCategory(hex) === hexFilter;
      return hex.type === hexFilter;
    });
    return `
      ${pageHeader('海克斯库', '每位队长最多抽出 5 个全局未占用海克斯候选，可刷新其中 1 张，最多选择 1 个。')}
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
              ${categoryEntries.map(category => `<option value="${escapeHtml(category.id)}" ${hexFilter === category.id ? 'selected' : ''}>${escapeHtml(category.label)}</option>`).join('')}
              <option value="manual" ${hexFilter === 'manual' ? 'selected' : ''}>手动效果</option>
              <option value="passive" ${hexFilter === 'passive' ? 'selected' : ''}>被动效果</option>
            </select>
            <button class="primary-btn" onclick='window.hexcoreUI.drawHexcoreForCaptain(${safeJsonString(selectedCaptain ? selectedCaptain.id : '')})'>${Hexcore2.icon('hex')}抽取最多 5 个候选</button>
            <button class="primary-btn" onclick="window.hexcoreUI.nextHexcoreCaptain()">下一位</button>
            <button class="primary-btn" onclick="window.hexcoreUI.randomizeHexcoreDrawOrder()">${Hexcore2.icon('refresh')}制定抽取顺序</button>
            <button class="primary-btn" onclick="window.hexcoreUI.resetAllHexcores()">${Hexcore2.icon('undo')}重置所有海克斯</button>
          </div>
        </div>
        <div class="hex-category-tabs" aria-label="海克斯业务分类">
          <button class="${hexFilter === 'all' ? 'active' : ''}" onclick="window.hexcoreUI.setHexFilter('all')">
            <strong>全部</strong><span>${allowedHexcores.length} 项</span>
          </button>
          ${categoryEntries.map(category => `
            <button class="${hexFilter === category.id ? 'active' : ''}" onclick='window.hexcoreUI.setHexFilter(${safeJsonString(category.id)})'>
              <strong>${escapeHtml(category.label)}</strong>
              <span>${category.count} 项 · ${escapeHtml(category.desc)}</span>
            </button>
          `).join('')}
        </div>
        ${drawOrder.length ? `
          <div class="hex-draw-order">
            <strong>抽取顺序</strong>
            ${drawOrder.map((captainId, index) => {
              const item = Hexcore2.state.captains.find(captain => captain.id === captainId);
              const ownedCount = item ? (Hexcore2.state.hexcoreAssignments[item.id] || []).length : 0;
              const statusLabel = item && session.captainId === item.id && session.slots && session.slots.length
                ? '抽取中'
                : (ownedCount >= 1 ? '已选 1/1' : '待选');
              return item ? `
                <span>${index + 1}. ${escapeHtml(item.name)}（${escapeHtml(statusLabel)}）</span>
                ${index < drawOrder.length - 1 ? '<i aria-hidden="true">→</i>' : ''}
              ` : '';
            }).join('')}
          </div>
        ` : ''}
        <div class="hex-draw-session">
          ${activeSession ? `
            <div class="hex-session-head">
              <strong>${escapeHtml(selectedCaptain.name)} 本次 ${session.slots.length} 个候选 · 已选择 ${ownedHexcores.length}/1 · ${session.refreshUsed ? '刷新已用' : '可刷新 1 张'}</strong>
              <button class="primary-btn" onclick="window.hexcoreUI.cancelHexcoreDraw()">${Hexcore2.icon('undo')}取消本次抽取</button>
            </div>
            <div class="hex-draw-slots">
              ${session.slots.map((hexcoreId, index) => {
                const hex = Hexcore2.sampleData.hexcores.find(item => item.id === hexcoreId);
                if (!hex) return '';
                return `
                  <article class="hex-draw-card ${escapeHtml(hexcoreCategory(hex))}">
                    <div class="hex-draw-badges">
                  <span class="hex-category-pill ${escapeHtml(hexcoreCategory(hex))}">${hexcoreCategoryLabel(hex)}</span>
                </div>
                    <div class="hex-card-figure" aria-hidden="true">${hexcoreIcon(hex, 'lg')}</div>
                    <h3>${escapeHtml(hex.name)}</h3>
                    <p>${escapeHtml(hex.desc)}</p>
                    <div class="hex-execution-note">▲ ${hex.mode === 'passive' ? '被动自动生效' : '需要裁判执行'}</div>
                    <div class="hex-draw-actions">
                      <button class="hex-detail-trigger" type="button" title="查看海克斯详情" aria-label="查看${escapeHtml(hex.name)}详情" onclick='window.hexcoreUI.showHexDetail(${safeJsonString(hex.id)})'>详情</button>
                      <button class="hex-refresh-btn" title="刷新此张候选" aria-label="刷新${escapeHtml(hex.name)}候选" ${session.refreshUsed ? 'disabled' : ''} onclick="window.hexcoreUI.refreshHexcoreSlot(${index})">刷新</button>
                      <button class="primary-btn hex-select-btn" title="选择此海克斯" aria-label="选择${escapeHtml(hex.name)}海克斯" onclick='window.hexcoreUI.selectHexcoreFromDraw(${safeJsonString(selectedCaptain.id)}, ${safeJsonString(hex.id)})'>选择</button>
                    </div>
                  </article>
                `;
              }).join('')}
            </div>
          ` : `
            <div class="hex-session-empty">
              ${selectedCaptain ? `${escapeHtml(selectedCaptain.name)} 当前没有进行中的海克斯抽取。点击“抽取最多 5 个候选”开始。` : '请选择队长'}
            </div>
          `}
        </div>
        <div class="owned-hex-panel">
          <h2>已持有海克斯</h2>
          <div class="owned-hex-list">
            ${ownedHexcores.map(hex => `
              <article class="owned-hex-card ${escapeHtml(hexcoreCategory(hex))}">
                <div class="owned-hex-main">
                  <div class="owned-hex-icon" aria-hidden="true">${hexcoreIcon(hex, 'sm')}</div>
                  <div>
                    <strong>${escapeHtml(hex.name)}</strong>
                    <p>${escapeHtml(hex.desc)}</p>
                  </div>
                </div>
                <div class="owned-hex-meta">
                  <span class="hex-category-chip ${escapeHtml(hexcoreCategory(hex))}">${hexcoreCategoryLabel(hex)}</span>
                  <span>${hexcoreTimingLabel(hex)}</span>
                  <span>${hexcoreUseLabel(hex)}</span>
                </div>
                <div class="owned-hex-actions">
                  <button type="button" onclick='window.hexcoreUI.showHexDetail(${safeJsonString(hex.id)})'>详情</button>
                  <button onclick='window.hexcoreUI.removeHexcore(${safeJsonString(selectedCaptain.id)}, ${safeJsonString(hex.id)})'>移除</button>
                </div>
              </article>
            `).join('') || '<em>暂无海克斯</em>'}
          </div>
        </div>
        <div class="hex-library">
          ${visibleHexcores.map(hex => {
            const owner = hexcoreOwners.get(hex.id);
            const occupiedByOther = owner && (!selectedCaptain || owner.id !== selectedCaptain.id);
            const occupiedBySelected = owner && selectedCaptain && owner.id === selectedCaptain.id;
            return `
              <article class="hex-library-card ${escapeHtml(hexcoreCategory(hex))} ${Hexcore2.state.ui.highlightHexcoreId === hex.id ? 'located-card' : ''}">
                <div class="hex-library-top">
                  <div class="hex-library-icon" aria-hidden="true">${hexcoreIcon(hex, 'md')}</div>
                  <div class="hex-library-title">
                    <strong>${escapeHtml(hex.name)}</strong>
                    <span>${occupiedByOther ? `已被 ${escapeHtml(owner.name)} 选择` : (occupiedBySelected ? '当前队长已持有' : (hex.mode === 'passive' ? '被动自动' : '裁判手动'))}</span>
                  </div>
                </div>
                <div class="hex-library-meta">
                  <span class="hex-category-chip ${escapeHtml(hexcoreCategory(hex))}">${escapeHtml(hexcoreCategoryLabel(hex))}</span>
                  <span>${escapeHtml(hexcoreTimingLabel(hex))}</span>
                </div>
                <p class="hex-library-desc">
                  <span>${escapeHtml(hex.desc)}</span>
                  <button type="button" class="hex-detail-trigger"
                    onclick='window.hexcoreUI.showHexDetail(${safeJsonString(hex.id)})'>详情</button>
                </p>
                <button ${owner ? 'disabled' : ''} onclick='window.hexcoreUI.assignHexcoreToCaptain(${safeJsonString(selectedCaptain ? selectedCaptain.id : '')}, ${safeJsonString(hex.id)})'>${owner ? '已占用' : '裁判兜底分配'}</button>
              </article>
            `;
          }).join('')}
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
          <div><span>流程状态</span><strong>${Hexcore2.state.draft.phase === 'completed' ? '已完成' : '进行中'}</strong></div>
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

  function captainTournamentPage() {
    const tournament = Hexcore2.state.tournament || { status: 'empty', rounds: [] };
    const own = clientCaptain();
    const matchesForClientCaptain = [];
    (tournament.rounds || []).forEach(round => {
      (round.matches || []).forEach(match => {
        if (own && (match.teamAId === own.id || match.teamBId === own.id || match.winnerId === own.id)) {
          matchesForClientCaptain.push({ round, match });
        }
      });
    });
    return `
      ${pageHeader('我的赛程', '只显示自己队伍相关场次；比分录入、排赛和清空仍由裁判端处理。')}
      ${captainClientReadonlyNotice()}
      <section class="data-panel tournament-control-panel">
        <div class="metrics-grid tournament-metrics-grid">
          <div><span>绑定队伍</span><strong>${escapeHtml(own ? own.name : '未绑定')}</strong></div>
          <div><span>相关场次</span><strong>${matchesForClientCaptain.length}</strong></div>
          <div><span>赛程状态</span><strong>${escapeHtml(tournament.status === 'completed' ? '已完成' : ((tournament.rounds || []).length ? '进行中' : '未排赛程'))}</strong></div>
          <div><span>权限</span><strong>只读</strong></div>
        </div>
      </section>
      <section class="data-panel tournament-board">
        <div class="section-title-row tournament-table-title">
          <h2>我的赛程</h2>
          <span>只显示自己队伍相关场次，隐藏全局排赛和裁判比分操作。</span>
        </div>
        <div class="tournament-match-list">
          ${matchesForClientCaptain.map(({ round, match }) => {
            const isA = own && match.teamAId === own.id;
            const opponentId = isA ? match.teamBId : match.teamAId;
            const ownScore = isA ? match.scoreA : match.scoreB;
            const opponentScore = isA ? match.scoreB : match.scoreA;
            const statusLabel = match.status === 'completed'
              ? (match.winnerId === own.id ? '已获胜' : '已结束')
              : (match.status === 'bye' ? '轮空晋级' : '待进行');
            return `
              <article class="tournament-match ${escapeHtml(match.status || 'empty')}">
                <div class="match-head">
                  <strong>${escapeHtml(round.name || '未命名轮次')} · ${escapeHtml(String(match.id || '').toUpperCase())}</strong>
                  <span>${escapeHtml(statusLabel)}</span>
                </div>
                <div class="match-score-row">
                  <div class="tournament-slot filled">
                    <span class="slot-team">${escapeHtml(own ? own.name : '本队')}</span>
                    <input type="text" readonly value="${escapeHtml(ownScore === '' ? '-' : ownScore)}">
                  </div>
                  <em>VS</em>
                  <div class="tournament-slot ${opponentId ? 'filled' : 'empty'}">
                    <span class="slot-team">${escapeHtml(opponentId ? captainName(opponentId) : '待定对手')}</span>
                    <input type="text" readonly value="${escapeHtml(opponentScore === '' ? '-' : opponentScore)}">
                  </div>
                </div>
                <div class="match-actions">
                  <span>晋级：${escapeHtml(match.winnerId ? captainName(match.winnerId) : '待定')}</span>
                </div>
              </article>
            `;
          }).join('') || '<div class="empty-tournament">当前还没有与本队相关的赛程。</div>'}
        </div>
      </section>
    `;
  }

  function tournamentPage() {
    if (isCaptainClient()) return captainTournamentPage();
    const tournament = Hexcore2.state.tournament || { status: 'empty', rounds: [], championId: '' };
    const completedMatches = tournament.rounds.reduce((sum, round) =>
      sum + round.matches.filter(match => match.status === 'completed' || match.status === 'bye').length, 0);
    const totalMatches = tournament.rounds.reduce((sum, round) => sum + round.matches.length, 0);
    const championName = tournament.championId ? captainName(tournament.championId) : '未产生';
    const championCaptain = tournament.championId
      ? Hexcore2.state.captains.find(captain => captain.id === tournament.championId)
      : null;
    const championPlayer = championCaptain && championCaptain.playerId
      ? Hexcore2.state.players.find(player => player.id === championCaptain.playerId)
      : null;
    const championMembers = championCaptain && Array.isArray(championCaptain.team)
      ? championCaptain.team
        .map(playerId => Hexcore2.state.players.find(player => player.id === playerId))
        .filter(Boolean)
      : [];
    const championHexcores = championCaptain
      ? (Hexcore2.state.hexcoreAssignments[championCaptain.id] || []).filter(Boolean)
      : [];
    const championGold = championCaptain && championCaptain.economy
      ? Math.max(0, Math.round(Number(championCaptain.economy.gold) || 0))
      : 0;
    const finalRound = tournament.rounds[tournament.rounds.length - 1];
    const finalMatch = finalRound && finalRound.matches ? finalRound.matches[0] : null;
    const runnerUpId = finalMatch && finalMatch.winnerId
      ? (finalMatch.winnerId === finalMatch.teamAId ? finalMatch.teamBId : finalMatch.teamAId)
      : '';
    const finalScore = finalMatch && finalMatch.scoreA !== '' && finalMatch.scoreB !== ''
      ? `${finalMatch.scoreA} : ${finalMatch.scoreB}`
      : '已决出胜者';
    const statusText = tournament.status === 'completed' ? '已完成' : (tournament.rounds.length ? '进行中' : '未排赛程');
    const isCampMode = Hexcore2.selectors.isCampMode ? Hexcore2.selectors.isCampMode() : true;
    const campVersusEnabled = isCampMode && !(Hexcore2.state.ui && Hexcore2.state.ui.tournamentCampVersus === false);
    const currentPairingLabel = tournament.pairingMode === 'random'
      ? '全随机对抗'
      : (tournament.pairingMode === 'camp_versus' ? '阵营对抗' : '待生成');
    const assignedCaptainIds = new Set((tournament.rounds[0] && tournament.rounds[0].matches
      ? tournament.rounds[0].matches.flatMap(match => [match.teamAId, match.teamBId])
      : []).filter(Boolean));
    const isCampVersusMatch = (round, match) => isCampVersusTournamentContext(tournament, round, match);
    const bandleMatches = tournament.type === 'bandle_defense'
      ? tournament.rounds.flatMap(round => round.matches || [])
      : [];
    const bandleCompletedMatches = bandleMatches.filter(match => match.status === 'completed').length;
    const bandlePoints = bandleMatches.reduce((sum, match) => sum + (Number(match.bandlePoints) || 0), 0);
    const invaderPoints = bandleMatches.reduce((sum, match) => sum + (Number(match.invaderPoints) || 0), 0);
    const bandleGap = Math.abs(bandlePoints - invaderPoints);
    const finalBattle = tournament.finalBattle || {};
    const finalBonus = Number(finalBattle.bonusPoints) || 10;
    const finalBandlePoints = tournament.status === 'completed'
      ? Number(tournament.finalBandlePoints || bandlePoints)
      : bandlePoints;
    const finalInvaderPoints = tournament.status === 'completed'
      ? Number(tournament.finalInvaderPoints || invaderPoints)
      : invaderPoints;
    const contribution = {};
    if (tournament.type === 'bandle_defense') {
      Hexcore2.state.captains.forEach(captain => {
        contribution[captain.id] = { wins: 0, points: 0, yordlePoints: 0 };
      });
      bandleMatches.forEach(match => {
        if (match.status !== 'completed') return;
        if (match.winnerId && contribution[match.winnerId]) contribution[match.winnerId].wins += 1;
        if (contribution[match.teamAId]) {
          contribution[match.teamAId].points += Number(match.bandlePoints) || 0;
          contribution[match.teamAId].yordlePoints += (Number(match.yordleCount) || 0) * 0.5;
        }
        if (contribution[match.teamBId]) contribution[match.teamBId].points += Number(match.invaderPoints) || 0;
      });
    }
    const topByCamp = camp => Hexcore2.state.captains
      .filter(captain => Hexcore2.selectors.captainCamp(captain.id) === camp)
      .sort((a, b) => {
        const left = contribution[a.id] || {};
        const right = contribution[b.id] || {};
        return (right.points || 0) - (left.points || 0)
          || (right.wins || 0) - (left.wins || 0)
          || Hexcore2.state.draft.baseOrder.indexOf(a.id) - Hexcore2.state.draft.baseOrder.indexOf(b.id);
      });
    const bandleDefenseMatchCard = (round, match) => {
      const scoreA = match.scoreA === '' ? '' : match.scoreA;
      const scoreB = match.scoreB === '' ? '' : match.scoreB;
      const winnerLabel = match.winnerId
        ? (match.winnerId === match.teamAId ? '班德尔胜' : '入侵者胜')
        : '待录分';
      return `
        <article class="bandle-match-card ${match.status === 'completed' ? 'completed' : ''}">
          <div class="bandle-match-head">
            <strong>${escapeHtml(match.id.toUpperCase())}</strong>
            <span>${escapeHtml(winnerLabel)}</span>
          </div>
          <div class="bandle-match-teams">
            <span class="bandle-team-name">${escapeHtml(captainName(match.teamAId))}</span>
            <em>vs</em>
            <span class="invader-team-name">${escapeHtml(captainName(match.teamBId))}</span>
          </div>
          <div class="bandle-score-editor">
            <input id="bandle-score-${escapeHtml(round.id)}-${escapeHtml(match.id)}-a" type="number" min="0" value="${escapeHtml(scoreA)}" aria-label="班德尔比分">
            <span>:</span>
            <input id="bandle-score-${escapeHtml(round.id)}-${escapeHtml(match.id)}-b" type="number" min="0" value="${escapeHtml(scoreB)}" aria-label="入侵者比分">
          </div>
          <label class="yordle-count-field">
            <span>约德尔登场</span>
            <input id="bandle-yordle-${escapeHtml(round.id)}-${escapeHtml(match.id)}" type="number" min="0" max="5" value="${escapeHtml(match.yordleCount || 0)}">
          </label>
          <div class="bandle-point-row">
            <span>班德尔 +${escapeHtml(match.bandlePoints || 0)}</span>
            <span>入侵者 +${escapeHtml(match.invaderPoints || 0)}</span>
          </div>
          <button class="subtle-btn" onclick='window.hexcoreUI.saveBandleDefenseScore(${safeJsonString(round.id)}, ${safeJsonString(match.id)})'>保存</button>
        </article>
      `;
    };
    const bandleDefensePage = () => `
      ${pageHeader('赛程', 'S7 班德尔保卫战：两天 5x5 全交叉阵营积分赛，分差不超过 5 时触发隐藏 BO5。')}
      <section class="data-panel tournament-control-panel bandle-control-panel">
        <div class="metrics-grid tournament-metrics-grid">
          <div><span>赛制</span><strong>班德尔保卫战</strong></div>
          <div><span>已完成</span><strong>${bandleCompletedMatches}/${bandleMatches.length || 50}</strong></div>
          <div><span>班德尔积分</span><strong>${escapeHtml(bandlePoints)}</strong></div>
          <div><span>入侵者积分</span><strong>${escapeHtml(invaderPoints)}</strong></div>
          <div><span>当前分差</span><strong>${escapeHtml(bandleGap)}</strong></div>
        </div>
        <div class="toolbar-row tournament-generate-row">
          <div class="bandle-rule-note">
            <strong>每日 25 场，两天共 50 场</strong>
            <span>本地队伍视为班德尔，外地队伍视为入侵者；胜场 +1，约德尔每登场 1 人班德尔 +0.5。</span>
          </div>
          <div class="tournament-generate-actions">
            <button class="primary-btn" onclick="window.hexcoreUI.generateBandleDefenseSchedule()">重新生成保卫战</button>
            <button class="danger-btn" onclick="window.hexcoreUI.resetTournamentSchedule()">清空赛程</button>
          </div>
        </div>
      </section>
      ${tournament.status === 'completed' ? `
        <section class="data-panel bandle-victory-showcase ${tournament.winnerCamp === 'bandle' ? 'bandle-win' : 'invader-win'}">
          <div class="champion-crown-mark">${tournament.winnerCamp === 'bandle' ? '守住' : '攻破'}</div>
          <div class="champion-copy">
            <span>S7 班德尔保卫战最终阵营</span>
            <h2>${tournament.winnerCamp === 'bandle' ? '班德尔守住了家园' : '入侵者攻破了防线'}</h2>
            <p>${tournament.winnerReason === 'final_battle' ? `隐藏大决战胜方 +${finalBonus}` : '两日积分直接决胜'} · 最终 ${escapeHtml(finalBandlePoints)} : ${escapeHtml(finalInvaderPoints)}</p>
          </div>
        </section>
      ` : ''}
      <section class="data-panel bandle-scoreboard">
        <div>
          <h2>阵营积分</h2>
          <div class="bandle-score-total">
            <strong>班德尔 ${escapeHtml(bandlePoints)}</strong>
            <span>vs</span>
            <strong>入侵者 ${escapeHtml(invaderPoints)}</strong>
          </div>
          <p>${bandleCompletedMatches < bandleMatches.length
            ? `还剩 ${bandleMatches.length - bandleCompletedMatches} 场，继续录分。`
            : (bandleGap > 5 ? '分差大于 5，积分高阵营直接获胜。' : '分差不超过 5，隐藏大决战已开启。')}</p>
        </div>
        <div class="bandle-contribution-grid">
          <div>
            <h3>最强约德尔人候选</h3>
            ${topByCamp('local').slice(0, 5).map(captain => `<span>${escapeHtml(captain.name)} · ${escapeHtml((contribution[captain.id] || {}).points || 0)} 分 · ${escapeHtml((contribution[captain.id] || {}).wins || 0)} 胜</span>`).join('')}
          </div>
          <div>
            <h3>最强侵略者候选</h3>
            ${topByCamp('outsider').slice(0, 5).map(captain => `<span>${escapeHtml(captain.name)} · ${escapeHtml((contribution[captain.id] || {}).points || 0)} 分 · ${escapeHtml((contribution[captain.id] || {}).wins || 0)} 胜</span>`).join('')}
          </div>
        </div>
      </section>
      <section class="bandle-days-grid">
        ${tournament.rounds.map(round => `
          <div class="data-panel bandle-day-panel">
            <div class="section-title-row">
              <h2>${escapeHtml(round.name)}</h2>
              <span>5 支班德尔队伍分别迎战 5 支入侵者队伍。</span>
            </div>
            <div class="bandle-matrix">
              ${(round.matches || []).map(match => bandleDefenseMatchCard(round, match)).join('')}
            </div>
          </div>
        `).join('')}
      </section>
      ${finalBattle.enabled ? `
        <section class="data-panel bandle-final-panel">
          <div class="section-title-row">
            <h2>隐藏大决战 BO5</h2>
            <span>${escapeHtml(captainName(finalBattle.bandleTeamId))} vs ${escapeHtml(captainName(finalBattle.invaderTeamId))}，先赢 3 局阵营 +${escapeHtml(finalBonus)}。</span>
          </div>
          <div class="bandle-final-games">
            ${(finalBattle.games || []).map((game, index) => `
              <article class="bandle-final-game ${game.status === 'completed' ? 'completed' : ''}">
                <strong>第 ${index + 1} 局</strong>
                <div class="bandle-score-editor">
                  <input id="bandle-final-${index}-a" type="number" min="0" value="${escapeHtml(game.bandleScore === '' ? '' : game.bandleScore)}">
                  <span>:</span>
                  <input id="bandle-final-${index}-b" type="number" min="0" value="${escapeHtml(game.invaderScore === '' ? '' : game.invaderScore)}">
                </div>
                <span>${game.winnerCamp ? (game.winnerCamp === 'bandle' ? '约德尔拿下' : '侵略者拿下') : '待录分'}</span>
                <button class="subtle-btn" ${finalBattle.winnerCamp ? 'disabled' : ''} onclick="window.hexcoreUI.saveBandleFinalBattleGame(${index})">保存</button>
              </article>
            `).join('')}
          </div>
        </section>
      ` : ''}
    `;
    const teamDragCard = (captain, assigned = false) => `
      <button class="tournament-team-chip ${assigned ? 'assigned' : ''}" draggable="true"
        ondragstart='event.dataTransfer.setData("text/plain", ${safeJsonString(captain.id)}); window.hexcoreUI.setTournamentDragCaptain(${safeJsonString(captain.id)})'>
        <strong>${escapeHtml(captain.name)}</strong>
        <span>${escapeHtml(isCampMode ? Hexcore2.selectors.campLabel(Hexcore2.selectors.captainCamp(captain.id)) : '公共卡池')} · ${assigned ? '已在赛程' : '待放入'}</span>
      </button>
    `;
    const tournamentSlot = (round, match, side, teamId, locked = false, scoreDisabled = false) => {
      const isCampVersus = isCampVersusMatch(round, match);
      const sideClass = side === 'A' ? 'side-a' : 'side-b';
      const campSlotLabel = side === 'A' ? '本地队伍' : '外地队伍';
      const randomSlotLabel = side === 'A' ? '左侧队伍' : '右侧队伍';
      const teamName = teamId ? captainName(teamId) : (isCampVersus ? campSlotLabel : randomSlotLabel);
      const slotLabel = teamId ? '更换' : '选择队伍';
      return `
        <div class="tournament-slot ${sideClass} ${teamId ? 'filled' : 'empty'} ${locked ? 'locked' : ''}"
          ${locked ? '' : `ondragover="event.preventDefault()" ondrop='event.preventDefault(); window.hexcoreUI.assignTournamentSlot(${safeJsonString(round.id)}, ${safeJsonString(match.id)}, ${safeJsonString(side)}, event.dataTransfer.getData("text/plain"))'`}>
          <div class="slot-team-row">
            ${locked ? `
              <span class="slot-team">${escapeHtml(teamName)}</span>
            ` : `
              <button type="button" class="slot-select-btn" ${teamId ? `draggable="true" ondragstart='event.dataTransfer.setData("text/plain", ${safeJsonString(teamId)}); window.hexcoreUI.setTournamentDragCaptain(${safeJsonString(teamId)})'` : ''} onclick='window.hexcoreUI.openTournamentSlotPicker(${safeJsonString(round.id)}, ${safeJsonString(match.id)}, ${safeJsonString(side)})'>
                <strong>${escapeHtml(teamName)}</strong>
                <small>${escapeHtml(slotLabel)}</small>
              </button>
            `}
            ${teamId && !locked ? `<button type="button" class="slot-remove-btn" onclick='event.stopPropagation(); window.hexcoreUI.removeTournamentSlot(${safeJsonString(round.id)}, ${safeJsonString(match.id)}, ${safeJsonString(side)})'>移出</button>` : ''}
          </div>
          <input id="tournament-score-${escapeHtml(round.id)}-${escapeHtml(match.id)}-${side.toLowerCase()}" type="number" min="0" value="${escapeHtml(side === 'A' ? match.scoreA : match.scoreB)}" ${scoreDisabled ? 'disabled' : ''}>
        </div>
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
      const anyBye = match.status === 'bye' && Boolean(match.winnerId);
      const teamA = anyBye ? captainName(match.winnerId) : (match.teamAId ? captainName(match.teamAId) : '待定');
      const teamB = match.teamBId ? captainName(match.teamBId) : (anyBye ? '轮空' : '待定');
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
            <em>${anyBye ? 'BYE' : (match.scoreA === '' ? '-' : escapeHtml(match.scoreA))}</em>
          </div>
          ${anyBye ? '' : `
            <div class="bracket-team ${match.winnerId && match.winnerId === match.teamBId ? 'winner' : ''}">
              <span>${escapeHtml(teamB)}</span>
              <em>${match.scoreB === '' ? '-' : escapeHtml(match.scoreB)}</em>
            </div>
          `}
          <div class="bracket-advance">晋级：${escapeHtml(winner)}</div>
        </article>
      `;
    };

    if (tournament.type === 'bandle_defense') return bandleDefensePage();

    return `
      ${pageHeader('赛程', '为金币商店组队结束后的队伍安排淘汰赛赛程，录入比分后系统自动晋级胜者。')}
      <section class="data-panel tournament-control-panel">
        <div class="metrics-grid tournament-metrics-grid">
          <div><span>参赛队伍</span><strong>${Hexcore2.selectors.teamCount()}</strong></div>
          <div><span>赛程状态</span><strong>${statusText}</strong></div>
          <div><span>已完成场次</span><strong>${completedMatches}/${totalMatches || 0}</strong></div>
          <div><span>冠军队伍</span><strong>${escapeHtml(championName)}</strong></div>
          <div><span>对抗模式</span><strong>${escapeHtml(currentPairingLabel)}</strong></div>
        </div>
        <div class="toolbar-row tournament-generate-row">
          ${isCampMode ? `<label class="tournament-mode-toggle">
            <input id="tournament-camp-versus-toggle" type="checkbox" ${campVersusEnabled ? 'checked' : ''} onchange="window.hexcoreUI.setTournamentCampVersus(this.checked)">
            <span>阵营对抗</span>
            <small>勾选左蓝本地 vs 右红外地；取消后全随机。</small>
          </label>` : `<div class="tournament-mode-toggle readonly-mode"><span>无阵营随机赛程</span><small>所有队伍进入同一个公共赛程池。</small></div>`}
          <div class="tournament-generate-actions">
            <button class="primary-btn" onclick="window.hexcoreUI.generateTournamentSchedule()">一键生成赛程</button>
            ${isCampMode ? '<button class="primary-btn" onclick="window.hexcoreUI.generateBandleDefenseSchedule()">生成班德尔保卫战</button>' : ''}
            <button class="danger-btn" onclick="window.hexcoreUI.resetTournamentSchedule()">清空赛程</button>
          </div>
        </div>
      </section>
      ${tournament.rounds.length ? `
        ${championCaptain && tournament.status === 'completed' ? `
          <section class="data-panel tournament-champion-showcase" aria-label="冠军展示">
            <div class="champion-crown-mark">冠军</div>
            <div class="champion-copy">
              <span>HEXCORE 2.0 最终胜者</span>
              <h2>${escapeHtml(championName)}</h2>
              <p>${escapeHtml(Hexcore2.selectors.campLabel(Hexcore2.selectors.captainCamp(championCaptain.id)))} · 队长 ${escapeHtml(championPlayer ? championPlayer.name : '待定')} · 决赛 ${escapeHtml(finalScore)}</p>
            </div>
            <div class="champion-stat-strip">
              <div><span>阵容人数</span><strong>${championMembers.length + 1}/5</strong></div>
              <div><span>剩余金币</span><strong>${championGold}</strong></div>
              <div><span>持有海克斯</span><strong>${championHexcores.length || 0}</strong></div>
              <div><span>亚军队伍</span><strong>${escapeHtml(runnerUpId ? captainName(runnerUpId) : '待定')}</strong></div>
            </div>
          </section>
        ` : ''}
        <section class="data-panel tournament-seed-panel">
          <div>
            <h2>排位与手动调整</h2>
            <p>${isCampMode ? '一键生成后可点击槽位更换队伍，也可以拖动队伍到首轮比赛框。左侧为蓝色，右侧为红色。' : '一键生成后可点击槽位更换队伍，也可以拖动队伍到首轮比赛框；无阵营模式不限制左右槽位。'}</p>
          </div>
          <div class="tournament-team-bank">
            ${Hexcore2.state.captains.map(captain => teamDragCard(captain, assignedCaptainIds.has(captain.id))).join('')}
          </div>
        </section>
        <section class="tournament-board ${Hexcore2.state.ui.highlightTournament ? 'located-card' : ''}">
          <div class="section-title-row tournament-table-title">
            <h2>赛程表</h2>
            <span>录入比分、保存结果，系统自动判定胜者并推进后续轮次。</span>
          </div>
          ${tournament.rounds.map((round, roundIndex) => `
            <div class="tournament-round">
              <h2>${escapeHtml(round.name)}</h2>
              <div class="tournament-match-list">
                ${round.matches.map(match => {
                  const hasTeamA = Boolean(match.teamAId);
                  const hasTeamB = Boolean(match.teamBId);
                  const hasSingleTeam = hasTeamA !== hasTeamB;
                  const hasBye = match.status === 'bye' && Boolean(match.winnerId);
                  const pendingOpponent = !hasBye && hasSingleTeam;
                  const canConfirmBye = roundIndex === 0 && pendingOpponent;
                  const isEmptyMatch = match.status === 'empty' || (!hasTeamA && !hasTeamB);
                  const winnerName = match.winnerId ? captainName(match.winnerId) : '待定';
                  const slotLocked = roundIndex !== 0 || hasBye;
                  const scoreDisabled = hasBye || !hasTeamA || !hasTeamB;
                  const statusLabel = match.status === 'bye'
                    ? '轮空晋级'
                    : (match.status === 'completed'
                      ? '已结束'
                      : (pendingOpponent ? '待补齐' : (isEmptyMatch ? '待编排' : '待录分')));
                  const campVersusMatch = isCampVersusMatch(round, match);
                  const opponentHint = hasTeamA && !hasTeamB
                    ? (campVersusMatch ? '等待阵营B队伍' : '等待右侧队伍')
                    : (!hasTeamA && hasTeamB ? (campVersusMatch ? '等待阵营A队伍' : '等待左侧队伍') : '');
                  return `
                    <article class="tournament-match ${match.status}">
                      <div class="match-head">
                        <strong>${escapeHtml(match.id.toUpperCase())}</strong>
                        <span>${escapeHtml(statusLabel)}</span>
                      </div>
                      ${hasBye ? `
                        <div class="match-bye-row">
                          <div class="tournament-bye-card">
                            <strong>${escapeHtml(captainName(match.winnerId))}</strong>
                            <span>轮空晋级</span>
                            ${roundIndex === 0 ? `<button type="button" class="slot-remove-btn" onclick='window.hexcoreUI.removeTournamentSlot(${safeJsonString(round.id)}, ${safeJsonString(match.id)}, ${safeJsonString(match.teamAId ? 'A' : 'B')})'>移出</button>` : ''}
                          </div>
                        </div>
                      ` : `
                        <div class="match-score-row">
                          ${tournamentSlot(round, match, 'A', match.teamAId, slotLocked, scoreDisabled)}
                          <em>VS</em>
                          ${tournamentSlot(round, match, 'B', match.teamBId, slotLocked, scoreDisabled)}
                        </div>
                      `}
                      <div class="match-actions">
                        <span>${pendingOpponent ? escapeHtml(opponentHint) : `晋级：${escapeHtml(winnerName)}`}</span>
                        ${canConfirmBye ? `<button class="subtle-btn" onclick='window.hexcoreUI.confirmTournamentBye(${safeJsonString(round.id)}, ${safeJsonString(match.id)})'>确认轮空</button>` : ''}
                        ${roundIndex === 0 ? `<button class="subtle-btn" ${isEmptyMatch ? 'disabled' : ''} onclick='window.hexcoreUI.clearTournamentMatch(${safeJsonString(round.id)}, ${safeJsonString(match.id)})'>清空本场</button>` : ''}
                        <button class="subtle-btn" ${scoreDisabled ? 'disabled' : ''} onclick='window.hexcoreUI.saveTournamentScore(${safeJsonString(round.id)}, ${safeJsonString(match.id)})'>保存比分</button>
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
          <p>${isCampMode ? '点击“一键生成赛程”后，系统会按上方模式自动生成首轮对阵；点击“生成班德尔保卫战”会创建两天 5x5 全交叉阵营积分赛。' : '点击“一键生成赛程”后，系统会从全部队伍中随机生成首轮对阵。'}</p>
        </section>
      `}
    `;
  }

  function probabilityRuleRows() {
    return [1, 2, 3, 4].map(round => {
      const probabilities = Hexcore2.shopEngine.probabilityForRound(round);
      return `
        <div class="rule-block">
          <strong>第 ${round} 轮</strong>
          <span>${[1, 2, 3, 4, 5].map(tier => `${escapeHtml(Hexcore2.state.settings.tierNames[tier])} ${probabilities[tier] || 0}%`).join(' / ')}</span>
        </div>
      `;
    }).join('');
  }

  function captainRulesPage() {
    const disabledHexcores = new Set(Hexcore2.state.settings.disabledHexcores || []);
    const timers = Hexcore2.state.settings.turnTimers || {};
    return `
      ${pageHeader('完整规则', '队长端只读查看完整规则，规则参数与裁判端当前配置一致。')}
      <section class="data-panel captain-rules-page">
        <div class="rules-grid">
          <div class="rule-block"><strong>队伍配置</strong><span>当前 ${Hexcore2.selectors.teamCount()} 队，每队 ${Hexcore2.state.settings.playersPerTeam} 人（含队长）。</span></div>
          <div class="rule-block"><strong>金币经济</strong><span>开局 ${Hexcore2.state.settings.initialGold} 金币，第2-4轮各 +${Hexcore2.state.settings.roundIncome} 金币，无利息。</span></div>
          <div class="rule-block"><strong>刷新费用</strong><span>每轮首次商店免费；之后刷新 1、2、3、4 金币，4金币封顶。</span></div>
          <div class="rule-block"><strong>购买规则</strong><span>每名队长每轮最多购买1名队员，队员价格等于费用。</span></div>
          <div class="rule-block"><strong>回合计时</strong><span>准备：海克斯 ${Number(timers.hexcorePrepareSeconds) || '关闭'} 秒，选手卡 ${Number(timers.shopPrepareSeconds) || '关闭'} 秒；操作：海克斯 ${Number(timers.hexcoreSeconds) || '关闭'} 秒，选手卡 ${Number(timers.shopSeconds) || '关闭'} 秒。</span></div>
          <div class="rule-block"><strong>补位规则</strong><span>四轮结束后阵容不足时，从剩余1-5费队员中随机补位，不消耗金币。</span></div>
          ${probabilityRuleRows()}
        </div>
        <div class="hex-toggle-panel">
          <h2>海克斯规则</h2>
          <div class="hex-toggle-grid">
            ${Hexcore2.sampleData.hexcores.map(hex => `
              <article class="hex-toggle-card ${disabledHexcores.has(hex.id) ? 'disabled-player' : ''}">
                <div>
                  <strong>${escapeHtml(hex.name)}</strong>
                  <span>${disabledHexcores.has(hex.id) ? '已禁用' : '启用中'} / ${hex.mode === 'passive' ? '被动' : '手动'}</span>
                </div>
                <p>${escapeHtml(hex.desc)}</p>
              </article>
            `).join('')}
          </div>
        </div>
      </section>
    `;
  }

  function rulesPage() {
    if (isCaptainClient()) return captainRulesPage();
    const disabledHexcores = new Set(Hexcore2.state.settings.disabledHexcores || []);
    const timers = Hexcore2.state.settings.turnTimers || {};
    const probabilityRows = probabilityRuleRows();
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
          <button class="primary-btn" onclick="window.hexcoreUI.updateRules()">保存规则并重算流程</button>
          <button class="subtle-btn" onclick="window.hexcoreUI.saveRuleTemplate()">保存为模板</button>
        </div>
        <div class="turn-timer-settings">
          <div>
            <h2>回合计时</h2>
            <p>0 表示关闭。准备倒计时用于裁判开始阶段后的缓冲；操作倒计时用于队长实际抽取或开店后的回合限制。</p>
          </div>
          <label>
            <span>海克斯准备秒数</span>
            <input id="rules-hexcore-prepare-timer" type="number" min="0" max="300" value="${Number(timers.hexcorePrepareSeconds) || 0}">
          </label>
          <label>
            <span>海克斯操作秒数</span>
            <input id="rules-hexcore-timer" type="number" min="0" max="3600" value="${Number(timers.hexcoreSeconds) || 0}">
          </label>
          <label>
            <span>选手卡准备秒数</span>
            <input id="rules-shop-prepare-timer" type="number" min="0" max="300" value="${Number(timers.shopPrepareSeconds) || 0}">
          </label>
          <label>
            <span>选手卡操作秒数</span>
            <input id="rules-shop-timer" type="number" min="0" max="3600" value="${Number(timers.shopSeconds) || 0}">
          </label>
          <button class="primary-btn" onclick="window.hexcoreUI.updateTurnTimers()">保存计时</button>
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
          <div class="rule-block"><strong>回合计时</strong><span>准备：海克斯 ${Number(timers.hexcorePrepareSeconds) || '关闭'} 秒，选手卡 ${Number(timers.shopPrepareSeconds) || '关闭'} 秒；操作：海克斯 ${Number(timers.hexcoreSeconds) || '关闭'} 秒，选手卡 ${Number(timers.shopSeconds) || '关闭'} 秒。</span></div>
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
          ${(Hexcore2.state.settings.ruleTemplates || []).map((template, index) => `
            <div class="template-row">
              <strong>${escapeHtml(template.name)}</strong>
              <span>${escapeHtml(template.savedAt)} / ${escapeHtml(template.teamCount)} 队 / 每队 ${escapeHtml(template.playersPerTeam)} 人（含队长） / ${escapeHtml(template.maxRounds)} 轮</span>
              <button class="subtle-btn" onclick="window.hexcoreUI.loadRuleTemplate(${index})">加载模板</button>
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

  function roomLifecyclePanel() {
    const session = storedMultiplayerSession();
    if (!session || !isManagementRole(session.role)) return '';
    const archived = roomIsArchived();
    return `
      <section class="data-panel room-lifecycle-panel">
        <div>
          <h2>房间生命周期</h2>
          <p>当前赛事：${escapeHtml(session.tournamentId || '-')}。归档用于保留审计和导出；删除会清理服务端房间、会话和事件记录。</p>
        </div>
        <div class="room-lifecycle-actions">
          <button class="subtle-btn" ${archived ? 'disabled' : ''} onclick="window.hexcoreUI.archiveCurrentRoom()">归档当前房间</button>
          <button class="danger-btn" onclick="window.hexcoreUI.deleteCurrentRoom()">删除当前房间</button>
        </div>
      </section>
    `;
  }

  function settingsPage() {
    const lastEvent = Hexcore2.state.events[0];
    const meta = Hexcore2.storageService && Hexcore2.storageService.getMeta ? Hexcore2.storageService.getMeta() : null;
    const lastSaved = meta && meta.savedAt ? new Date(meta.savedAt).toLocaleString('zh-CN', { hour12: false }) : '暂无保存记录';
    const theme = currentTheme();
    const checkResult = Hexcore2.state.ui && Hexcore2.state.ui.systemCheckResult;
    return `
      ${pageHeader('系统设置', '本地裁判端状态备份、导入和重置。部署访问请使用 npm start 或静态 HTTP 服务。')}
      <section class="data-panel system-summary">
        <div><span>当前版本</span><strong>${escapeHtml(versionLabel())}</strong></div>
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
        <button class="subtle-btn" onclick="window.hexcoreUI.repairSystemIntegrityIssues()">修复完整性异常</button>
        <button class="subtle-btn" onclick="window.hexcoreUI.restoreLatestSnapshot()">恢复最近快照</button>
        <button class="primary-btn" onclick="window.hexcoreUI.exportState()">导出状态备份</button>
        <button class="subtle-btn" onclick="document.getElementById('state-import-input').click()">导入状态备份</button>
        <button class="danger-btn" onclick="window.hexcoreUI.clearBrowserData()">清理浏览器本地数据</button>
        <button class="danger-btn" onclick="window.hexcoreUI.resetLocalState()">重置本地状态</button>
      </section>
      ${roomLifecyclePanel()}
      <section class="data-panel system-check-panel">
        <div class="toolbar-row">
          <div>
            <h2>状态完整性检查</h2>
            <span>${checkResult ? `最近检查：${escapeHtml(checkResult.checkedAt)}，${checkResult.ok ? '未发现问题' : `发现 ${Number(checkResult.totalIssues) || 0} 项问题`}` : '尚未运行检查'}</span>
          </div>
          <strong class="${checkResult && !checkResult.ok ? 'warn' : 'done'}">${checkResult ? (checkResult.ok ? '通过' : '需处理') : '待检查'}</strong>
        </div>
        <div class="system-check-list">
          ${checkResult && checkResult.issues && checkResult.issues.length ? checkResult.issues.map(issue => `
            <article class="system-check-item ${escapeHtml(issue.level || 'warn')}">
              <strong>${escapeHtml(issue.type || '问题')}</strong>
              <span>${escapeHtml(issue.message || '')}</span>
            </article>
          `).join('') : '<div class="empty-log">队伍、选手归属、顺位和卡池检查结果会显示在这里。</div>'}
        </div>
      </section>
    `;
  }

  function activePage() {
    const requestedView = (Hexcore2.state.ui && Hexcore2.state.ui.activeView) || 'draft';
    const activeView = isViewerClient() && !viewerAllowedView(requestedView)
      ? 'draft'
      : (isCaptainClient() && !captainAllowedView(requestedView) ? 'draft' : requestedView);
    const pageWorkspace = content => `<main class="workspace-main page-workspace">${roomWelcomePanel()}${roomArchivedNotice()}${content}</main>`;
    if (activeView === 'teams') return pageWorkspace(teamsPage());
    if (activeView === 'players') return pageWorkspace(playersPage());
    if (activeView === 'hexcores') return pageWorkspace(hexcoresPage());
    if (activeView === 'schedule') return pageWorkspace(schedulePage());
    if (activeView === 'tournament') return pageWorkspace(tournamentPage());
    if (activeView === 'rules') return pageWorkspace(rulesPage());
    if (activeView === 'logs') return pageWorkspace(logsPage());
    if (activeView === 'settings') return pageWorkspace(settingsPage());
    return `
      <main class="workspace">
        <div class="workspace-main">
          ${roomWelcomePanel()}
          ${roomArchivedNotice()}
          ${captainClientReadonlyNotice()}
          ${viewerReadonlyNotice()}
          ${captainHexcoreDraftPanel()}
          ${isReadonlyClient() ? '' : (isCaptainClient() ? '' : workflowGatePanel())}
          ${hungryWaveBanner()}
          ${usableHexcoreAlert()}
          ${turnOrder()}
          ${heavenlyDescentBanner()}
          <div class="content-grid">
            <div class="draft-main-column">
              ${playerCards()}
              ${refereeControlsForRoom()}
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
    if (isAdminStandaloneRoute()) return adminStandalonePage();
    if (shouldShowJoinGate()) return joinGatePage();
    return `
      ${sidebar()}
      <div class="app-main">
        ${topbar()}
        ${activePage()}
      </div>
      ${addPlayerModal()}
      ${playerImportPreviewModal()}
      ${originSageNoticeModal()}
      ${chargedCannonDecisionModal()}
      ${lastStandConfirmModal()}
      ${dissolveTeamsConfirmModal()}
      ${recruitRevealModal()}
      ${economyRevealModal()}
      ${turnTimeoutModal()}
      ${hexDetailModal()}
      ${tournamentSlotPickerModal()}
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
      const scrollCaptainIntoViewId = Hexcore2.state.ui && Hexcore2.state.ui.scrollCaptainIntoViewId;
      if (Hexcore2.state.ui) delete Hexcore2.state.ui.scrollCaptainIntoViewId;
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
      updateDocumentTitle();
      const appRoot = document.getElementById('app');
      const fullPageRoot = shouldShowJoinGate() || isAdminStandaloneRoute();
      if (appRoot && appRoot.classList) {
        appRoot.classList.toggle('join-gate-root', fullPageRoot);
        appRoot.classList.toggle('admin-gate-root', isAdminStandaloneRoute());
      }
      appRoot.innerHTML = app();
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
      const focusLocatedCaptain = () => {
        if (!scrollCaptainIntoViewId || !document.querySelector) return;
        const target = document.querySelector(`[data-captain-id="${cssAttributeValue(scrollCaptainIntoViewId)}"]`);
        if (target && typeof target.scrollIntoView === 'function') {
          target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }
      };
      restoreScroll();
      focusLocatedCaptain();
      if (global.requestAnimationFrame) {
        global.requestAnimationFrame(() => {
          restoreScroll();
          focusLocatedCaptain();
        });
      }
    },
  };
})(window);
