const fs = require('fs');
const path = require('path');
const vm = require('vm');
const staticServer = require('./serve.js');

const root = path.resolve(__dirname, '..');
const sourceFiles = [
  'src/core/sample-data.js',
  'src/services/storage-service.js',
  'src/services/history-service.js',
  'src/services/export-service.js',
  'src/core/app-state.js',
  'src/core/event-store.js',
  'src/engines/turn-order-engine.js',
  'src/engines/pool-engine.js',
  'src/engines/probability-engine.js',
  'src/engines/assignment-engine.js',
  'src/engines/hexcore-engine.js',
  'src/ui/icons.js',
  'src/ui/referee-console.js',
  'src/main.js',
];

function createHarness() {
  const app = { innerHTML: '' };
  const elements = {};
  const context = {
    console,
    Math,
    Date,
    JSON,
    setTimeout,
    clearTimeout,
    window: {},
    document: {
      getElementById(id) {
        if (id === 'app') return app;
        elements[id] = elements[id] || { click() {}, value: '', files: [] };
        return elements[id];
      },
      createElement() {
        return { click() {}, remove() {}, set href(value) {}, set download(value) {} };
      },
      body: { appendChild() {}, removeChild() {} },
    },
    Blob: function Blob(parts, options) {
      this.parts = parts;
      this.options = options;
    },
    FileReader: function FileReader() {
      this.readAsText = file => {
        this.result = file && file.content ? file.content : '';
        if (this.onload) this.onload();
      };
    },
    URL: {
      createObjectURL() { return 'blob:test'; },
      revokeObjectURL() {},
    },
    localStorage: {
      getItem() { return null; },
      setItem() {},
      removeItem() {},
    },
    location: { protocol: 'http:', reload() {} },
    confirm() { return true; },
    prompt(message, defaultValue) { return defaultValue || '测试输入'; },
  };
  context.window = context;
  vm.createContext(context);
  sourceFiles.forEach(file => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return { H: context.Hexcore2, app, elements };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function testOriginQueue() {
  const { H } = createHarness();
  const origin = H.sampleData.hexcores.find(hex => hex.id === 'origin');
  H.state.hexcoreAssignments.c6 = [{ ...origin }];
  H.state.hexcoreAssignments.c7 = [{ ...origin }];
  H.state.draft.round = 3;
  H.state.draft.baseOrder = H.state.captains.map(item => item.id);
  H.state.draft.currentOrder = [...H.state.draft.baseOrder];
  H.state.draft.currentIndex = H.state.draft.currentOrder.indexOf('c6');
  H.state.draft.runtimeEffects = [];

  assert(H.hexcoreEngine.activate('origin').ok, '第一个启元应成功');
  H.state.draft.currentIndex = H.state.draft.currentOrder.indexOf('c7');
  assert(H.hexcoreEngine.activate('origin').ok, '第二个启元应成功');
  assert(H.state.draft.currentOrder[0] === 'c6', '第一个启元使用者应固定第1顺位');
  assert(H.state.draft.currentOrder[1] === 'c7', '第二个启元使用者应固定第2顺位');
}

function testPandoraConflict() {
  const { H, app } = createHarness();
  const openFeast = H.sampleData.hexcores.find(hex => hex.id === 'open-feast');
  H.state.hexcoreAssignments.c5.push({ ...openFeast });
  H.state.draft.currentOrder = ['c5', 'c6', 'c7'];
  H.state.draft.currentIndex = 0;

  assert(H.hexcoreEngine.isDisabledByPandora('c5', 'open-feast'), '潘多拉应禁用开饭啦');
  assert(!H.hexcoreEngine.activate('open-feast').ok, '潘多拉持有者不能使用开饭啦');
  H.ui.render();
  assert(app.innerHTML.includes('潘多拉魔盒：该效果失效'), 'UI 应显示潘多拉禁用状态');
}

function testLockContract() {
  const { H } = createHarness();
  H.state.draft.round = 2;
  H.state.draft.currentOrder = ['c2', 'c3', 'c4'];
  H.state.draft.currentIndex = 0;
  H.state.draft.runtimeEffects = [];
  const captain = H.state.captains.find(item => item.id === 'c2');
  const beforeSize = captain.team.length;

  assert(H.hexcoreEngine.activate('lock-contract', { firstPlayerId: 'p201', secondPlayerId: 'p202' }).ok, '锁定契约应成功创建');
  assert(H.assignmentEngine.assign('c2', 'p201', 'test_pick'), '应能选中契约内第一名选手');
  assert(captain.team.includes('p201') && captain.team.includes('p202'), '契约另一名选手应自动入队');
  assert(captain.team.length === beforeSize + 2, '锁定契约应使队伍增加2名选手');
}

function testMysteryBoxTransfer() {
  const { H } = createHarness();
  H.state.draft.round = 1;
  H.state.draft.currentOrder = ['c7', 'c1', 'c2'];
  H.state.draft.currentIndex = 0;
  H.state.draft.runtimeEffects = [];
  const c1 = H.state.captains.find(item => item.id === 'c1');
  const c7 = H.state.captains.find(item => item.id === 'c7');

  assert(H.hexcoreEngine.activate('mystery-box').ok, '盲盒应成功触发');
  H.state.draft.currentDraw.cards = [{ slotId: 'slot_test', playerId: 'p101', visibleToReferee: true, visibleToCaptain: true }];
  H.state.draft.selectedSlot = 0;
  H.actions.pickCard();
  assert(!c1.team.includes('p101'), '盲盒转队后选手应脱离原队伍');
  assert(c7.team.includes('p101'), '盲盒转队后选手应进入当前队伍');
  assert(H.state.draft.currentOrder[H.state.draft.currentIndex + 1] === 'c1', '原队长应获得补偿回合');
}

function testHellhound() {
  const { H } = createHarness();
  H.state.draft.round = 1;
  H.state.draft.currentOrder = ['c10', 'c7', 'c8'];
  H.state.draft.currentIndex = 0;
  H.state.draft.runtimeEffects = [];
  const captain = H.state.captains.find(item => item.id === 'c10');

  assert(H.hexcoreEngine.activate('hellhound').ok, '地狱三头犬第1轮应成功触发');
  assert(H.state.draft.currentDraw.effectiveTier === 1, '第一段应进入侏儒马池');
  H.actions.timeoutRandomPick();
  assert(captain.team.length === 1, '第一段超时随机后应入队1人');
  assert(H.state.draft.currentDraw.effectiveTier === 2, '第二段应进入中等马池');
}

function testSnowCat() {
  const { H, app } = createHarness();
  H.state.draft.round = 3;
  H.state.draft.currentOrder = ['c11', 'c7', 'c8'];
  H.state.draft.currentIndex = 0;
  H.state.draft.runtimeEffects = [];

  assert(H.hexcoreEngine.activate('snow-cat').ok, '雪定饿的喵应成功触发');
  assert(H.state.draft.currentDraw.pickMode === 'mystery_swap', '应生成身份扰动抽卡');
  H.ui.render();
  assert(app.innerHTML.includes('真实身份待揭示'), 'UI 应提示真实身份待揭示');
}

function testDecomposeKnowledge() {
  const { H, app } = createHarness();
  H.state.draft.round = 2;
  H.state.draft.currentOrder = ['c1', 'c2', 'c3'];
  H.state.draft.currentIndex = 0;
  H.state.draft.runtimeEffects = [];

  assert(!H.hexcoreEngine.activate('decompose-knowledge', { targetPlayerId: 'p201' }).ok, '不能分析队伍外选手');
  assert(H.hexcoreEngine.activate('decompose-knowledge', { targetPlayerId: 'p101' }).ok, '应能分析已有队员');
  H.actions.drawCards();
  H.ui.render();
  assert(app.innerHTML.includes('战力顺位'), '抽卡 UI 应显示战力顺位');
}

function testUiNavigationAndHexButtons() {
  const { H, app, elements } = createHarness();
  H.ui.render();
  assert(app.innerHTML.includes('setActiveView'), '侧边栏应绑定视图切换动作');
  assert(!app.innerHTML.includes('useHexcore(" origin")'), '海克斯按钮不应生成被截断的 onclick 参数');
  H.actions.setActiveView('players');
  assert(app.innerHTML.includes('选手库') && app.innerHTML.includes('侏儒马池') && app.innerHTML.includes('setPlayerFilter'), '选手库页面应可筛选');
  assert(app.innerHTML.includes('导入 JSON/CSV') && app.innerHTML.includes('pool-health-grid'), '选手库应提供导入和卡池容量检测');
  const beforePlayers = H.state.players.length;
  H.actions.addPlayer();
  assert(H.state.players.length === beforePlayers + 1, '选手库应能新增选手');
  const newPlayer = H.state.players[H.state.players.length - 1];
  elements[`player-name-${newPlayer.id}`] = { value: '回归测试选手' };
  elements[`player-lane-${newPlayer.id}`] = { value: '中路' };
  elements[`player-tier-${newPlayer.id}`] = { value: '2' };
  elements[`player-score-${newPlayer.id}`] = { value: '88' };
  H.actions.savePlayer(newPlayer.id);
  assert(newPlayer.name === '回归测试选手' && newPlayer.tier === 2 && newPlayer.score === 88, '选手库应能保存选手基础信息');
  H.actions.togglePlayerDisabled(newPlayer.id);
  assert(newPlayer.status === 'disabled', '选手库应能禁用可选选手');
  H.actions.togglePlayerDisabled(newPlayer.id);
  assert(newPlayer.status === 'available', '选手库应能恢复禁用选手');
  H.actions.importPlayers({
    name: 'players.csv',
    content: 'name,lane,tier,score,gameId\nCSV选手,中路,3,91,CSV_001\n重复选手,上路,2,70,CSV_001',
  });
  assert(H.state.players.some(player => player.name === 'CSV选手' && player.tier === 3), '选手库应能导入CSV选手');
  assert(H.state.players.filter(player => player.gameId === 'CSV_001').length === 1, '选手导入应跳过重复游戏ID');
  const importedPlayer = H.state.players.find(player => player.name === 'CSV选手');
  H.actions.deletePlayer(importedPlayer.id);
  assert(!H.state.players.some(player => player.id === importedPlayer.id), '选手库应能删除选手');
  H.actions.setActiveView('hexcores');
  assert(app.innerHTML.includes('为该队长抽海克斯') && app.innerHTML.includes('removeHexcore') && app.innerHTML.includes('assignHexcoreToCaptain'), '海克斯库页面应提供裁判抽取、移除和指定分配入口');
  H.actions.setHexFilter('manual');
  assert(H.state.ui.hexFilter === 'manual', '海克斯库应能筛选手动效果');
  const c2HexBefore = H.state.hexcoreAssignments.c2.length;
  H.actions.assignHexcoreToCaptain('c2', 'origin');
  assert(H.state.hexcoreAssignments.c2.length === c2HexBefore + 1, '海克斯库应能指定分配海克斯');
  H.actions.setActiveView('teams');
  assert(app.innerHTML.includes('新增队伍') && app.innerHTML.includes('saveCaptainName'), '队伍管理页面应提供实质操作');
  H.actions.setActiveView('rules');
  assert(app.innerHTML.includes('保存规则并重算流程'), '规则设置页面应提供保存入口');
  elements['captain-name-c1'] = { value: 'C1 回归改名' };
  H.actions.saveCaptainName('c1');
  assert(H.state.captains.find(captain => captain.id === 'c1').name === 'C1 回归改名', '队伍管理应能通过输入框保存改名');

  const beforeCount = H.state.captains.length;
  elements['rules-team-count'] = { value: '13' };
  elements['rules-players-per-team'] = { value: '4' };
  elements['rules-max-rounds'] = { value: '4' };
  elements['rules-current-round'] = { value: '3' };
  elements['rules-draw-count'] = { value: '4' };
  elements['rules-auto-random-strategy'] = { value: 'top_scored' };
  elements['rules-timeout-strategy'] = { value: 'highest_score' };
  elements['rules-round-tier-1'] = { value: '1' };
  elements['rules-round-tier-2'] = { value: '2' };
  elements['rules-round-tier-3'] = { value: '4' };
  elements['rules-round-tier-4'] = { value: '3' };
  H.actions.updateRules();
  assert(H.state.captains.length === 13, '规则设置应能调整队伍数量');
  assert(H.state.draft.round === 3, '规则设置应能调整当前轮次');
  assert(H.state.settings.drawCount === 4, '规则设置应能调整基础抽卡张数');
  assert(H.selectors.roundTier(3) === 4, '规则设置应能调整每轮卡池顺序');
  assert(H.state.captains.length === beforeCount + 1, '规则设置应新增缺失队伍');
  const oldOrderIndex = H.state.draft.baseOrder.indexOf('c2');
  H.actions.moveCaptainOrder('c2', 'up');
  assert(H.state.draft.baseOrder.indexOf('c2') === oldOrderIndex - 1, '队伍管理应能上移基础顺位');
  elements['team-add-player-c7'] = { value: 'p401' };
  H.actions.assignPlayerToTeam('c7');
  assert(H.state.captains.find(captain => captain.id === 'c7').team.includes('p401'), '队伍管理应能手动补录队员');
  H.actions.toggleHexcoreEnabled('origin');
  assert(!H.selectors.isHexcoreEnabled('origin'), '规则设置应能禁用指定海克斯');
  H.actions.saveRuleTemplate();
  assert(H.state.settings.ruleTemplates.length === 1, '规则设置应能保存规则模板');
  H.actions.setActiveView('schedule');
  assert(app.innerHTML.includes('轮次进度') && app.innerHTML.includes('schedule-cell') && app.innerHTML.includes('jumpToScheduleSlot'), '轮次进度页面应提供跳转入口');
  H.actions.jumpToScheduleSlot(2, 'c2');
  assert(H.state.draft.round === 2 && H.selectors.currentCaptain().id === 'c2', '轮次跳转应切换轮次和当前队长');
  H.actions.setActiveView('logs');
  assert(app.innerHTML.includes('exportEventsJson') && app.innerHTML.includes('exportRecapText'), '日志页面应提供 JSON 和复盘文本导出');
  elements['event-search'] = { value: '海克斯' };
  H.actions.setEventSearch();
  assert(H.state.ui.eventSearch === '海克斯', '日志页面应能设置关键词搜索');
  H.actions.setEventCaptainFilter('c7');
  assert(H.state.ui.eventCaptainFilter === 'c7', '日志页面应能按队长筛选');
  assert(H.exportService.filteredEvents().every(event => `${event.title} ${event.body}`.includes('C7') || `${event.title} ${event.body}`.includes('海克斯')), '日志筛选应返回匹配事件');
  assert(H.exportService.exportEventsJson(), '日志页面应能导出 JSON');
  assert(H.exportService.exportRecapText(), '日志页面应能导出复盘文本');
  assert(app.innerHTML.includes('clearEvents'), '日志页面应提供清空入口');
  H.actions.clearEvents();
  assert(H.state.events.length === 1 && H.state.events[0].title === '日志清理', '清空日志后应保留清理反馈事件');
  H.actions.setActiveView('settings');
  assert(app.innerHTML.includes('runSystemCheck') && app.innerHTML.includes('restoreLatestSnapshot') && app.innerHTML.includes('clearBrowserData'), '系统设置应提供状态检查、快照恢复和本地清理入口');
  H.actions.runSystemCheck();
  assert(H.state.events[0].title === '系统检查通过', '系统检查应通过当前一致性数据');
}

function testFeedbackAutoDismiss() {
  const { H, app } = createHarness();
  H.eventStore.append('测试反馈', '2秒后应自动消失', 'success');
  H.ui.render();
  assert(app.innerHTML.includes('feedback-toast'), '反馈提示应立即显示');
  return new Promise(resolve => {
    setTimeout(() => {
      assert(!H.state.ui.feedback, '反馈提示应在2.2秒后清除状态');
      assert(!app.innerHTML.includes('feedback-toast'), '反馈提示应在2.2秒后从页面移除');
      resolve();
    }, 2300);
  });
}

function testSecurityHardening() {
  assert(staticServer.resolveRequestPath('/') === path.join(root, 'index.html'), '静态服务应正常解析首页');
  assert(staticServer.resolveRequestPath('/src/main.js') === path.join(root, 'src', 'main.js'), '静态服务应正常解析项目内资源');
  assert(staticServer.resolveRequestPath('/..%2FHEXCORE2.0_secret%2Fsecret.txt') === null, '静态服务应拒绝同名前缀兄弟目录穿越');
  assert(staticServer.resolveRequestPath('/%E0%A4%A') === null, '静态服务应拒绝非法URL编码');

  const { H, app } = createHarness();
  H.state.settings.ruleTemplates = [{
    name: '<b>模板</b>',
    savedAt: '2026-05-20',
    teamCount: '<img src=x onerror=window.__xss_fired=1>',
    playersPerTeam: '<svg onload=window.__xss_fired=1>',
    maxRounds: '<iframe src=javascript:alert(1)>',
    drawCount: '3',
    roundTiers: ['1', '2', '3', '4'],
    disabledHexcores: [],
  }];
  H.normalizeState(H.state);
  H.actions.setActiveView('rules');
  assert(!app.innerHTML.includes('<img src=x'), '规则模板队伍数字段不应保留HTML');
  assert(!app.innerHTML.includes('onload=window.__xss_fired'), '规则模板每队人数不应保留事件属性');
  assert(!app.innerHTML.includes('<iframe src=javascript'), '规则模板轮数字段不应保留HTML');
  assert(app.innerHTML.includes('&lt;b&gt;模板&lt;/b&gt;'), '规则模板名称应保持转义输出');
}

async function run() {
  const tests = [
    testOriginQueue,
    testPandoraConflict,
    testLockContract,
    testMysteryBoxTransfer,
    testHellhound,
    testSnowCat,
    testDecomposeKnowledge,
    testUiNavigationAndHexButtons,
    testFeedbackAutoDismiss,
    testSecurityHardening,
  ];

  for (const test of tests) {
    await test();
  }
  console.log(`regression ok: ${tests.length} tests`);
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
