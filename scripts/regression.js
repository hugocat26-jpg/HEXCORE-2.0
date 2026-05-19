const fs = require('fs');
const path = require('path');
const vm = require('vm');

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
        return { click() {}, set href(value) {}, set download(value) {} };
      },
      body: { appendChild() {}, removeChild() {} },
    },
    Blob: function Blob(parts, options) {
      this.parts = parts;
      this.options = options;
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
  H.actions.setActiveView('hexcores');
  assert(app.innerHTML.includes('为该队长抽海克斯') && app.innerHTML.includes('removeHexcore'), '海克斯库页面应提供裁判抽取和移除入口');
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
  elements['rules-current-round'] = { value: '3' };
  H.actions.updateRules();
  assert(H.state.captains.length === 13, '规则设置应能调整队伍数量');
  assert(H.state.draft.round === 3, '规则设置应能调整当前轮次');
  assert(H.state.captains.length === beforeCount + 1, '规则设置应新增缺失队伍');
  H.actions.setActiveView('schedule');
  assert(app.innerHTML.includes('schedule-cell') && app.innerHTML.includes('jumpToScheduleSlot'), '赛程页面应提供跳转入口');
  H.actions.jumpToScheduleSlot(2, 'c2');
  assert(H.state.draft.round === 2 && H.selectors.currentCaptain().id === 'c2', '赛程跳转应切换轮次和当前队长');
  H.actions.setActiveView('logs');
  assert(app.innerHTML.includes('clearEvents'), '日志页面应提供清空入口');
  H.actions.clearEvents();
  assert(H.state.events.length === 1 && H.state.events[0].title === '日志清理', '清空日志后应保留清理反馈事件');
  H.actions.setActiveView('settings');
  assert(app.innerHTML.includes('runSystemCheck'), '系统设置应提供状态检查入口');
  H.actions.runSystemCheck();
  assert(H.state.events[0].title === '系统检查通过', '系统检查应通过当前一致性数据');
}

function run() {
  const tests = [
    testOriginQueue,
    testPandoraConflict,
    testLockContract,
    testMysteryBoxTransfer,
    testHellhound,
    testSnowCat,
    testDecomposeKnowledge,
    testUiNavigationAndHexButtons,
  ];

  tests.forEach(test => test());
  console.log(`regression ok: ${tests.length} tests`);
}

run();
