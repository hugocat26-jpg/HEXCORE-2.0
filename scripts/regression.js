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
  const toastRoot = { innerHTML: '' };
  const elements = {};
  const scrollingElement = { scrollTop: 0, scrollLeft: 0, dataset: {} };
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
        if (id === 'toast-root') return toastRoot;
        elements[id] = elements[id] || { click() {}, value: '', files: [] };
        return elements[id];
      },
      querySelector() {
        return null;
      },
      createElement() {
        return { click() {}, remove() {}, set href(value) {}, set download(value) {} };
      },
      scrollingElement,
      documentElement: scrollingElement,
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
  return { H: context.Hexcore2, app, toastRoot, elements, document: context.document };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function markCaptainsReady(H) {
  H.state.captains.forEach((captain, index) => {
    if (captain.playerId) return;
    const playerId = `ready-captain-${captain.id}`;
    captain.playerId = playerId;
    H.state.players.push({
      id: playerId,
      name: `${captain.name} 队长`,
      lane: '队长',
      gameId: `READY_${index + 1}`,
      score: 100 + index,
      tier: 0,
      status: 'available',
    });
  });
  H.normalizeState(H.state);
}

function markWorkflowReady(H) {
  markCaptainsReady(H);
  const openSlots = H.state.captains.reduce((sum, captain) => (
    sum + Math.max(0, H.selectors.teamMemberCapacity(captain.id) - captain.team.length)
  ), 0);
  const availableCount = H.state.players.filter(player => player.status === 'available' && player.tier >= 1 && player.tier <= 4).length;
  for (let index = availableCount; index < openSlots; index += 1) {
    H.state.players.push({
      id: `ready-player-${index + 1}`,
      name: `就绪测试选手${index + 1}`,
      lane: '补位',
      gameId: `READY_PLAYER_${index + 1}`,
      score: 50 + (index % 50),
      tier: (index % 4) + 1,
      status: 'available',
    });
  }
  H.normalizeState(H.state);
  const filler = H.sampleData.hexcores.slice(0, 3).map(hex => ({ ...hex }));
  H.state.captains.forEach(captain => {
    const current = H.state.hexcoreAssignments[captain.id] || [];
    const owned = new Set(current.map(hex => hex.id));
    filler.forEach(hex => {
      if (current.length < 3 && !owned.has(hex.id)) current.push({ ...hex });
    });
    H.state.hexcoreAssignments[captain.id] = current;
    if (current.length < 3) {
      H.sampleData.hexcores.forEach(hex => {
        if (current.length < 3 && !owned.has(hex.id)) current.push({ ...hex });
      });
    }
  });
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

function testHexcoreExecutionQueue() {
  const { H, app } = createHarness();
  const blind = H.sampleData.hexcores.find(hex => hex.id === 'blind');
  const giantSlayer = H.sampleData.hexcores.find(hex => hex.id === 'giant-slayer');
  const openFeast = H.sampleData.hexcores.find(hex => hex.id === 'open-feast');
  H.state.hexcoreAssignments.c2 = [
    { ...blind, status: 'available' },
    { ...giantSlayer, status: 'passive' },
    { ...openFeast, status: 'available' },
  ];
  H.state.draft.round = 1;
  H.state.draft.currentOrder = ['c2', 'c3', 'c4'];
  H.state.draft.currentIndex = 0;
  H.state.draft.runtimeEffects = [];

  const queue = H.hexcoreEngine.executionQueue('c2');
  assert(queue.length === 3, '海克斯执行队列应覆盖当前队长全部已持有海克斯');
  assert(queue.some(item => item.id === 'blind' && item.status === '需选择目标' && item.needsTarget && item.actionType === '抽卡修饰'), '致盲吹箭应提示需要选择目标并归类为抽卡修饰');
  assert(queue.some(item => item.id === 'giant-slayer' && item.status === '被动生效' && item.actionType === '抽卡修饰'), '被动海克斯应在队列中标记为自动生效并归类为抽卡修饰');
  assert(queue.some(item => item.id === 'open-feast' && item.status === '可执行' && item.actionType === '生成抽卡'), '开饭啦应在队列中标记为生成抽卡');

  H.state.settings.disabledHexcores = ['open-feast'];
  const disabledQueue = H.hexcoreEngine.executionQueue('c2');
  assert(disabledQueue.some(item => item.id === 'open-feast' && item.status === '已禁用'), '规则禁用海克斯应在队列中标记为已禁用');

  H.state.settings.disabledHexcores = [];
  H.state.hexcoreAssignments.c2.push({ ...H.sampleData.hexcores.find(hex => hex.id === 'pandora-box'), status: 'passive' });
  const pandoraQueue = H.hexcoreEngine.executionQueue('c2');
  assert(pandoraQueue.some(item => item.id === 'open-feast' && item.status === '潘多拉失效'), '潘多拉禁用的海克斯应在队列中标记失效');

  H.ui.render();
  assert(app.innerHTML.includes('本轮海克斯执行队列') && app.innerHTML.includes('需选择目标') && app.innerHTML.includes('被动生效'), '实时抽选应展示本轮海克斯执行队列');

  H.state.hexcoreAssignments.c2 = [
    { ...H.sampleData.hexcores.find(hex => hex.id === 'snow-cat'), status: 'available' },
    { ...H.sampleData.hexcores.find(hex => hex.id === 'lock-contract'), status: 'available' },
    { ...H.sampleData.hexcores.find(hex => hex.id === 'double-shot'), status: 'available' },
  ];
  H.state.draft.currentDraw = { captainId: 'c2', cards: [{ playerId: 'p201' }] };
  H.state.draft.pickedThisTurn = false;
  const pendingDrawQueue = H.hexcoreEngine.executionQueue('c2');
  assert(pendingDrawQueue.every(item => item.status === '先完成抽卡'), '当前队长有未完成抽卡时，手动海克斯应先提示处理抽卡');

  H.state.draft.currentDraw = null;
  H.state.draft.pickedThisTurn = true;
  const currentTier = H.poolEngine.effectiveTier('c2');
  H.state.players.forEach(player => {
    if (player.status === 'available') player.status = 'drafted';
  });
  H.state.players.push({ id: 'queue-only-one', name: '队列单人', lane: '补位', gameId: 'QUEUE_ONE', score: 50, tier: currentTier, status: 'available' });
  H.state.captains.find(captain => captain.id === 'c2').team = ['slot-a', 'slot-b', 'slot-c', 'slot-d'];
  const insufficientQueue = H.hexcoreEngine.executionQueue('c2');
  assert(insufficientQueue.some(item => item.id === 'snow-cat' && item.status === '选手不足'), '雪定饿的喵应检查当前池至少2名可选选手');
  assert(insufficientQueue.some(item => item.id === 'lock-contract' && item.status === '选手不足'), '锁定契约应检查全局至少2名可选选手');
  assert(insufficientQueue.some(item => item.id === 'double-shot' && item.status === '队伍空间不足'), '双发快射应检查队伍至少有2个空位');
}

function testWorkflowGateMissingHexcoreBoard() {
  const { H, app } = createHarness();
  markCaptainsReady(H);
  H.state.hexcoreAssignments.c2 = H.sampleData.hexcores.slice(0, 1).map(hex => ({ ...hex }));
  H.state.hexcoreAssignments.c3 = H.sampleData.hexcores.slice(0, 3).map(hex => ({ ...hex }));
  H.state.ui.activeView = 'draft';
  H.ui.render();

  assert(app.innerHTML.includes('实时抽选尚未开始') && app.innerHTML.includes('流程检查') || app.innerHTML.includes('队长抽海克斯'), '实时抽选未开始时应显示流程阶段提示');
  assert(app.innerHTML.includes('待处理海克斯') && app.innerHTML.includes('还差 2 个') && app.innerHTML.includes('openHexcoreForCaptain'), '实时抽选未开始时应显示未抽满海克斯队伍清单和直达入口');
  H.actions.openHexcoreForCaptain('c2');
  assert(H.state.ui.activeView === 'hexcores' && H.state.ui.hexCaptainId === 'c2', '点击待处理海克斯队伍应进入海克斯库并定位到该队长');
  assert(app.innerHTML.includes('操作队长：C2'), '直达海克斯库后应显示目标队长');
}

function testWorkflowStageChecklist() {
  const { H, app } = createHarness();
  H.state.ui.activeView = 'draft';
  H.ui.render();
  let workflow = H.selectors.workflowStatus();
  assert(workflow.stage.id === 'captain-confirm' && workflow.checklist.blockingItems.some(item => item.id === 'captain-player'), '未指定队长选手时应处于队长确认阶段');
  assert(app.innerHTML.includes('队长确认') && app.innerHTML.includes('队长确认') && app.innerHTML.includes('待处理'), '前置面板应显示队长确认检查项');

  markWorkflowReady(H);
  H.ui.render();
  workflow = H.selectors.workflowStatus();
  assert(workflow.playersDraftReady && workflow.stage.id === 'player-draft', '队长和海克斯均完成后应进入队员抽选阶段');
  assert(!app.innerHTML.includes('实时抽选尚未开始'), '前置流程完成后不应再显示阻塞面板');
}

function testHexTargetPicker() {
  const { H, app, elements } = createHarness();
  const targetHexes = ['blind', 'order-swap', 'decompose-knowledge', 'lock-contract']
    .map(id => ({ ...H.sampleData.hexcores.find(hex => hex.id === id), status: 'available' }));
  H.state.hexcoreAssignments.c2 = targetHexes;
  H.state.draft.currentOrder = ['c2', 'c3', 'c4'];
  H.state.draft.currentIndex = 0;
  H.state.draft.runtimeEffects = [];
  H.state.ui.activeView = 'draft';
  H.ui.render();

  assert(app.innerHTML.includes('openHexTargetPicker') && app.innerHTML.includes('选择目标'), '目标型海克斯应显示统一目标选择入口');
  assert(!app.innerHTML.includes('pair-grid') && !app.innerHTML.includes('↔'), '目标型海克斯不应直接渲染大量两两组合按钮');

  H.actions.openHexTargetPicker('lock-contract');
  assert(H.state.ui.hexTargetPicker.hexcoreId === 'lock-contract', '打开目标选择面板应记录当前海克斯');
  assert(app.innerHTML.includes('hex-target-picker-panel') && app.innerHTML.includes('绑定选手 A') && app.innerHTML.includes('绑定选手 B'), '锁定契约应通过统一面板选择两名选手');
  const pair = H.state.players.filter(player => player.status === 'available').slice(0, 2);
  elements['hex-target-first'] = { value: pair[0].id };
  elements['hex-target-second'] = { value: pair[0].id };
  H.actions.useSelectedHexTarget('lock-contract');
  assert(H.state.ui.hexTargetPicker.hexcoreId === 'lock-contract' && H.state.events[0].title === '海克斯执行失败', '选择相同目标时应保留面板并提示失败');
  elements['hex-target-first'] = { value: pair[0].id };
  elements['hex-target-second'] = { value: pair[1].id };
  H.actions.useSelectedHexTarget('lock-contract');
  assert(!H.state.ui.hexTargetPicker && H.hexcoreEngine.lockContractPairs().length === 1, '确认有效目标后应执行海克斯并关闭目标面板');

  H.actions.openHexTargetPicker('blind');
  assert(app.innerHTML.includes('致盲目标队长'), '致盲吹箭应通过统一面板选择目标队长');
  elements['hex-target-first'] = { value: 'c3' };
  H.actions.useSelectedHexTarget('blind');
  assert(!H.state.ui.hexTargetPicker && H.hexcoreEngine.isBlinded('c3'), '致盲吹箭确认目标后应写入本轮致盲效果');
}

function testLockContract() {
  const { H } = createHarness();
  H.state.draft.round = 2;
  H.state.draft.currentOrder = ['c2', 'c3', 'c4'];
  H.state.draft.currentIndex = 0;
  H.state.draft.runtimeEffects = [];
  const captain = H.state.captains.find(item => item.id === 'c2');
  const beforeSize = captain.team.length;
  const pair = H.state.players.filter(player => player.status === 'available').slice(0, 2);

  assert(pair.length === 2, '锁定契约测试需要两名可选选手');
  assert(H.hexcoreEngine.activate('lock-contract', { firstPlayerId: pair[0].id, secondPlayerId: pair[1].id }).ok, '锁定契约应成功创建');
  assert(H.assignmentEngine.assign('c2', pair[0].id, 'test_pick'), '应能选中契约内第一名选手');
  assert(captain.team.includes(pair[0].id) && captain.team.includes(pair[1].id), '契约另一名选手应自动入队');
  assert(captain.team.length === beforeSize + 2, '锁定契约应使队伍增加2名选手');
}

function testMysteryBoxTransfer() {
  const { H } = createHarness();
  markWorkflowReady(H);
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
  markWorkflowReady(H);
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
  H.state.players.push(
    { id: 'snow-test-a', name: '雪猫高分', lane: '中路', gameId: 'SNOW_A', score: 119, tier: 3, status: 'available' },
    { id: 'snow-test-b', name: '雪猫低分', lane: '辅助', gameId: 'SNOW_B', score: 118, tier: 3, status: 'available' }
  );
  H.normalizeState(H.state);

  assert(H.hexcoreEngine.activate('snow-cat').ok, '雪定饿的喵应成功触发');
  assert(H.state.draft.currentDraw.pickMode === 'mystery_swap', '应生成身份扰动抽卡');
  H.ui.render();
  assert(app.innerHTML.includes('真实身份待揭示'), 'UI 应提示真实身份待揭示');
}

function testDecomposeKnowledge() {
  const { H, app } = createHarness();
  markWorkflowReady(H);
  H.state.draft.round = 2;
  H.state.draft.currentOrder = ['c1', 'c2', 'c3'];
  H.state.draft.currentIndex = 0;
  H.state.draft.runtimeEffects = [];

  assert(!H.hexcoreEngine.activate('decompose-knowledge', { targetPlayerId: 'p201' }).ok, '不能分析队伍外选手');
  assert(H.hexcoreEngine.activate('decompose-knowledge', { targetPlayerId: 'p101' }).ok, '应能分析已有队员');
  H.actions.drawCards();
  H.ui.render();
  assert(app.innerHTML.includes('战力顺位'), '抽卡 UI 应显示战力顺位');
  assert(app.innerHTML.includes('倒计时') && app.innerHTML.includes('从当前卡组随机'), '抽卡后 UI 应显示超时倒计时和当前卡组随机提示');
  const timeoutBeforePause = H.state.draft.currentDraw.timeoutEndsAt;
  H.actions.pause();
  assert(H.state.draft.paused && !H.state.draft.currentDraw.timeoutEndsAt && H.state.draft.currentDraw.timeoutPausedRemainingMs > 0, '暂停后应冻结超时倒计时');
  H.ui.render();
  assert(app.innerHTML.includes('已暂停') && app.innerHTML.includes('恢复后倒计时继续'), '暂停后 UI 应提示倒计时已冻结');
  assert(app.innerHTML.includes('<strong>继续</strong>') && app.innerHTML.includes('继续选人流程'), '暂停后按钮应切换为继续');
  H.actions.pause();
  assert(!H.state.draft.paused && H.state.draft.currentDraw.timeoutEndsAt && H.state.draft.currentDraw.timeoutEndsAt !== timeoutBeforePause, '恢复后应按剩余时间继续倒计时');
  H.ui.render();
  assert(app.innerHTML.includes('<strong>暂停</strong>') && app.innerHTML.includes('暂停选人流程'), '继续后按钮应切回暂停');
  const drawnPlayerIds = H.state.draft.currentDraw.cards.map(card => card.playerId);
  H.actions.timeoutRandomPick(true);
  const pickedFromDraw = H.state.captains.find(captain => captain.id === 'c1').team.some(playerId => drawnPlayerIds.includes(playerId));
  assert(pickedFromDraw, '普通超时随机应只从当前抽到的候选卡中选择');
}

function testUiNavigationAndHexButtons() {
  const { H, app, elements } = createHarness();
  H.ui.render();
  assert(app.innerHTML.includes('setActiveView'), '侧边栏应绑定视图切换动作');
  assert(!app.innerHTML.includes('useHexcore(" origin")'), '海克斯按钮不应生成被截断的 onclick 参数');
  H.actions.setActiveView('players');
  assert(app.innerHTML.includes('选手库') && app.innerHTML.includes('侏儒马池') && app.innerHTML.includes('setPlayerFilter'), '选手库页面应可筛选');
  assert(app.innerHTML.includes('导入 JSON/CSV') && app.innerHTML.includes('清空所有选手') && app.innerHTML.includes('pool-health-grid'), '选手库应提供导入、清空和卡池容量检测');
  assert(app.innerHTML.includes('队长专属池') && app.innerHTML.includes('卡池等级不可手动设置') && !app.innerHTML.includes('player-tier-'), '选手库应说明系统分池且不允许手动设置卡池');
  assert(app.innerHTML.includes('参赛宣言') && app.innerHTML.includes('player-manifesto-') && app.innerHTML.includes('player-lane-') && app.innerHTML.includes('player-heroes-') && app.innerHTML.includes('autoSavePlayerIfChanged') && app.innerHTML.includes('偏好位置') && app.innerHTML.includes('绝活英雄') && app.innerHTML.includes('readonly-score') && !app.innerHTML.includes('id="player-name-') && !app.innerHTML.includes('player-score-'), '选手卡片应按名字、ID、偏好位置、绝活英雄、参赛宣言、评分展示并支持失焦自动保存');
  assert(!app.innerHTML.includes('>保存</button>'), '选手卡片不应再显示手动保存按钮');
  H.state.captains[0].playerId = 'captain-test-player';
  H.state.players.push({ id: 'captain-test-player', name: '队长测试选手', lane: '中路', gameId: 'CAPTAIN_TEST', score: 120, tier: 4, status: 'available' });
  H.normalizeState(H.state);
  assert(H.state.players.find(player => player.id === 'captain-test-player').tier === 0, '被选为队长的选手应进入队长专属卡池');
  assert(H.state.players.filter(player => player.id !== 'captain-test-player').every(player => player.tier >= 1 && player.tier <= 4), '非队长选手应被系统分配到四个普通卡池');
  H.ui.render();
  assert(app.innerHTML.includes('解除队长') && app.innerHTML.includes('releaseCaptain') && !app.innerHTML.includes('队长锁定'), '队长专属卡片应提供解除队长入口，不应显示队长锁定');
  H.actions.releaseCaptain('captain-test-player');
  const releasedCaptainPlayer = H.state.players.find(player => player.id === 'captain-test-player');
  assert(!H.state.captains[0].playerId && releasedCaptainPlayer.status === 'available' && releasedCaptainPlayer.tier >= 1, '解除队长后队伍应变为待指定队长，选手回到普通卡池');
  const teamCountBeforePromote = H.state.captains.length;
  const emptyCaptainBeforePromote = H.state.captains.find(captain => !captain.playerId);
  const freePromotePlayer = H.state.players.find(player => player.status === 'available' && player.id !== 'captain-test-player');
  assert(app.innerHTML.includes('设为队长') && app.innerHTML.includes('player-card-head'), '选手库每名非队长选手应有独立卡片和设为队长入口');
  H.state.ui.playerFilter = 'available';
  H.actions.promotePlayerToCaptain(freePromotePlayer.id);
  assert(H.state.captains.length === teamCountBeforePromote, '存在空队伍时自由选手设为队长应填入该队伍而不是新建队伍');
  assert(emptyCaptainBeforePromote.playerId === freePromotePlayer.id, '自由选手应被指定为空队伍的队长');
  assert(H.state.players.find(player => player.id === freePromotePlayer.id).tier === 0, '自由选手设为队长后应进入队长专属池');
  assert(H.state.ui.playerFilter === 'available', '选手设为队长后应保留原选手库筛选条件');
  emptyCaptainBeforePromote.playerGameId = 'STALE_CAPTAIN_GAME_ID';
  H.normalizeState(H.state);
  delete emptyCaptainBeforePromote.playerId;
  H.normalizeState(H.state);
  assert(!emptyCaptainBeforePromote.playerGameId && H.selectors.teamMemberCapacity(emptyCaptainBeforePromote.id) === H.state.settings.playersPerTeam + 1, '无真实队长时应清理残留游戏ID并按无队长容量计算');
  const draftedPromotePlayer = H.state.players.find(player => player.status === 'drafted' && player.teamId);
  const ownerBeforePromote = H.state.captains.find(captain => captain.id === draftedPromotePlayer.teamId);
  H.state.players.push({ id: 'old-captain-player', name: '旧队长测试', lane: '辅助', gameId: 'OLD_CAPTAIN', score: 76, tier: 3, status: 'available' });
  ownerBeforePromote.playerId = 'old-captain-player';
  H.normalizeState(H.state);
  H.actions.promotePlayerToCaptain(draftedPromotePlayer.id);
  assert(ownerBeforePromote.playerId === draftedPromotePlayer.id && !ownerBeforePromote.team.includes(draftedPromotePlayer.id), '已入队队员晋升队长时应替换所在队伍队长且不占队员名额');
  assert(ownerBeforePromote.team.includes('old-captain-player') && H.state.players.find(player => player.id === 'old-captain-player').status === 'drafted', '原队长应自动降为当前队伍队员');
  const beforePlayers = H.state.players.length;
  H.actions.addPlayer();
  assert(H.state.players.length === beforePlayers, '点击新增选手不应直接写入选手库');
  assert(app.innerHTML.includes('add-player-name') && app.innerHTML.includes('confirmAddPlayer'), '新增选手应打开信息填写弹窗');
  elements['add-player-name'] = { value: '回归测试选手' };
  elements['add-player-lane'] = { value: '中路' };
  elements['add-player-score'] = { value: '88' };
  elements['add-player-game-id'] = { value: 'REG_NEW_001' };
  H.actions.confirmAddPlayer();
  assert(H.state.players.length === beforePlayers + 1, '选手库应能新增选手');
  const newPlayer = H.state.players[H.state.players.length - 1];
  assert(newPlayer.name === '回归测试选手' && newPlayer.tier >= 1 && newPlayer.tier <= 4 && newPlayer.score === 88, '选手库应能保存选手基础信息并由系统安排卡池');
  elements[`player-lane-${newPlayer.id}`] = { value: '辅助' };
  elements[`player-heroes-${newPlayer.id}`] = { value: '洛、锤石、牛头' };
  elements[`player-manifesto-${newPlayer.id}`] = { value: '稳定开团，拒绝白给' };
  H.actions.savePlayer(newPlayer.id);
  assert(newPlayer.lane === '辅助' && newPlayer.heroes.includes('锤石') && newPlayer.manifesto === '稳定开团，拒绝白给' && newPlayer.score === 88, '选手库应能保存偏好位置、绝活英雄、参赛宣言且不修改评分');
  const eventCountBeforeNoopAutosave = H.state.events.length;
  H.actions.autoSavePlayerIfChanged(newPlayer.id);
  assert(H.state.events.length === eventCountBeforeNoopAutosave, '参赛宣言未改动时失焦不应重复写入日志');
  elements[`player-manifesto-${newPlayer.id}`] = { value: '点击别处自动保存' };
  H.actions.autoSavePlayerIfChanged(newPlayer.id);
  assert(newPlayer.manifesto === '点击别处自动保存' && H.state.events.length === eventCountBeforeNoopAutosave + 1, '参赛宣言改动后失焦应自动保存');
  const eventCountBeforeLaneAutosave = H.state.events.length;
  elements[`player-lane-${newPlayer.id}`] = { value: '中路' };
  H.actions.autoSavePlayerIfChanged(newPlayer.id);
  assert(newPlayer.lane === '中路' && H.state.events.length === eventCountBeforeLaneAutosave + 1, '偏好位置改动后失焦应自动保存');
  const eventCountBeforeHeroesAutosave = H.state.events.length;
  elements[`player-heroes-${newPlayer.id}`] = { value: '沙皇、发条、岩雀' };
  H.actions.autoSavePlayerIfChanged(newPlayer.id);
  assert(newPlayer.heroes.includes('沙皇') && newPlayer.heroes.includes('岩雀') && H.state.events.length === eventCountBeforeHeroesAutosave + 1, '绝活英雄改动后失焦应自动保存');
  H.state.ui.playerFilter = 'all';
  H.ui.render();
  assert(app.innerHTML.includes('系统分池：评分第') && app.innerHTML.includes('评分 ') && app.innerHTML.includes('pool-reason'), '选手库应显示卡池评分区间和每名选手的系统分池原因');
  H.actions.editPlayerName(newPlayer.id);
  assert(H.state.ui.editingNamePlayerId === newPlayer.id && app.innerHTML.includes('player-display-name-'), '点击选手名称编辑按钮应进入内联编辑态');
  elements[`player-display-name-${newPlayer.id}`] = { value: '回归改名选手', focus() {}, select() {} };
  H.actions.savePlayerName(newPlayer.id);
  assert(newPlayer.name === '回归改名选手' && !H.state.ui.editingNamePlayerId, '回车保存选手名称应更新选手并退出编辑态');
  H.actions.editPlayerGameId(newPlayer.id);
  assert(H.state.ui.editingGameIdPlayerId === newPlayer.id && app.innerHTML.includes('player-game-id-'), '点击游戏ID编辑按钮应进入内联编辑态');
  elements[`player-game-id-${newPlayer.id}`] = { value: 'REG_NEW_RENAMED', focus() {}, select() {} };
  H.actions.savePlayerGameId(newPlayer.id);
  assert(newPlayer.gameId === 'REG_NEW_RENAMED' && !H.state.ui.editingGameIdPlayerId, '回车保存游戏ID应更新选手并退出编辑态');
  H.actions.togglePlayerDisabled(newPlayer.id);
  assert(newPlayer.status === 'disabled', '选手库应能禁用可选选手');
  H.actions.togglePlayerDisabled(newPlayer.id);
  assert(newPlayer.status === 'available', '选手库应能恢复禁用选手');
  H.actions.importPlayers({
    name: 'players.csv',
    content: 'name,lane,tier,score,gameId\nCSV选手,中路,3,91,CSV_001\n重复选手,上路,2,70,CSV_001\n无名选手,,2,70,CSV_BAD_LANE\n非法评分,上路,2,abc,CSV_BAD_SCORE',
  });
  assert(H.state.ui.playerImportPreview && app.innerHTML.includes('导入预览'), '选手导入应先显示预览弹窗，不应立即写入选手库');
  assert(H.state.ui.playerImportPreview.accepted.length === 1, '导入预览应只接受有效且不重复的选手');
  assert(H.state.ui.playerImportPreview.stats.duplicateGameId === 1 && H.state.ui.playerImportPreview.stats.missingField === 1 && H.state.ui.playerImportPreview.stats.invalidScore === 1, '导入预览应统计重复ID、缺字段和非法评分');
  assert(!H.state.players.some(player => player.name === 'CSV选手'), '确认前不应写入导入选手');
  H.actions.confirmPlayerImport();
  assert(H.state.players.some(player => player.name === 'CSV选手' && player.tier >= 1 && player.tier <= 4), '选手库应能导入CSV选手并由系统安排卡池');
  assert(H.state.players.filter(player => player.gameId === 'CSV_001').length === 1, '选手导入应跳过重复游戏ID');
  assert(!H.state.ui.playerImportPreview, '确认导入后应关闭导入预览');
  const importedPlayer = H.state.players.find(player => player.name === 'CSV选手');
  H.actions.deletePlayer(importedPlayer.id);
  assert(!H.state.players.some(player => player.id === importedPlayer.id), '选手库应能删除选手');
  H.actions.setActiveView('hexcores');
  assert(app.innerHTML.includes('抽取 3 个候选') && app.innerHTML.includes('下一位') && app.innerHTML.includes('nextHexcoreCaptain') && app.innerHTML.includes('重置所有海克斯') && app.innerHTML.includes('resetAllHexcores') && app.innerHTML.includes('removeHexcore') && app.innerHTML.includes('assignHexcoreToCaptain'), '海克斯库页面应提供三选一抽取、手动下一位、移除、重置和兜底分配入口');
  H.actions.setHexFilter('manual');
  assert(H.state.ui.hexFilter === 'manual', '海克斯库应能筛选手动效果');
  H.actions.setHexCaptain('c2');
  const c2SessionBefore = H.state.hexcoreAssignments.c2.length;
  H.actions.drawHexcoreForCaptain('c2');
  assert(H.state.hexcoreDraft.captainId === 'c2' && H.state.hexcoreDraft.slots.length === 3, '海克斯抽取应生成3个候选');
  const firstSlot = H.state.hexcoreDraft.slots[0];
  H.actions.refreshHexcoreSlot(0);
  assert(H.state.hexcoreDraft.refreshUsed && H.state.hexcoreDraft.slots[0] !== firstSlot, '海克斯三选一应允许刷新1张候选');
  const chosenSlot = H.state.hexcoreDraft.slots[0];
  H.actions.selectHexcoreFromDraw('c2', chosenSlot);
  assert(H.state.hexcoreAssignments.c2.length === c2SessionBefore + 1, '海克斯三选一选择后应写入队长持有列表');
  assert(!H.state.hexcoreDraft.captainId, '选满3个海克斯后应结束当前会话');
  assert(H.state.ui.hexCaptainId === 'c2', '选满3个海克斯后应停留在当前队长，等待裁判手动切换');
  H.actions.nextHexcoreCaptain();
  assert(H.state.ui.hexCaptainId !== 'c2', '点击下一位后才应切换到下一名未满3个海克斯的队长');
  H.actions.removeHexcore('c2', chosenSlot);
  const c2HexBefore = H.state.hexcoreAssignments.c2.length;
  H.actions.assignHexcoreToCaptain('c2', 'origin');
  assert(H.state.hexcoreAssignments.c2.length === c2HexBefore + 1, '海克斯库应能指定分配海克斯');
  H.actions.setActiveView('hexcores');
  assert(app.innerHTML.includes('owned-hex-card') && app.innerHTML.includes('owned-hex-meta'), '已持有海克斯应显示详细卡片信息');
  H.actions.randomizeHexcoreDrawOrder();
  assert(H.state.hexcoreDraft.drawOrder.length === H.state.captains.length, '海克斯库应能随机制定抽取顺序');
  H.state.draft.runtimeEffects = [{ type: 'blind', sourceCaptainId: 'c2' }];
  H.actions.resetAllHexcores();
  assert(H.state.captains.every(captain => Array.isArray(H.state.hexcoreAssignments[captain.id]) && H.state.hexcoreAssignments[captain.id].length === 0), '重置所有海克斯应清空每个队长持有列表');
  assert(!H.state.hexcoreDraft.captainId && H.state.hexcoreDraft.slots.length === 0 && H.state.hexcoreDraft.drawOrder.length === 0, '重置所有海克斯应清空当前抽取会话和抽取顺序');
  assert(H.state.draft.runtimeEffects.length === 0, '重置所有海克斯应清空运行中的海克斯效果');
  H.actions.setActiveView('teams');
  assert(app.innerHTML.includes('新增队伍') && app.innerHTML.includes('saveCaptainName') && !app.innerHTML.includes('待指定队长'), '队伍管理页面应提供实质操作，且无队长队伍不显示占位队长栏');
  H.actions.setActiveView('rules');
  assert(app.innerHTML.includes('保存规则并重算流程'), '规则设置页面应提供保存入口');
  assert(app.innerHTML.includes('卡池名称') && app.innerHTML.includes('rules-tier-name-4'), '规则设置页面应支持自定义卡池名称');
  assert(!app.innerHTML.includes('旧购买逻辑') && !app.innerHTML.includes('资源购买卡牌'), '规则设置不应显示旧购买逻辑说明');
  elements['captain-name-c1'] = { value: 'C1 回归改名' };
  H.actions.saveCaptainName('c1');
  assert(H.state.captains.find(captain => captain.id === 'c1').name === 'C1 回归改名', '队伍管理应能通过输入框保存改名');

  const beforeCount = H.state.captains.length;
  const targetTeamCount = Math.min(H.state.settings.maxTeams, beforeCount + 1);
  elements['rules-team-count'] = { value: String(targetTeamCount) };
  elements['rules-players-per-team'] = { value: '4' };
  elements['rules-max-rounds'] = { value: '4' };
  elements['rules-current-round'] = { value: '3' };
  elements['rules-draw-count'] = { value: '4' };
  elements['rules-auto-random-strategy'] = { value: 'top_scored' };
  elements['rules-timeout-strategy'] = { value: 'highest_score' };
  elements['rules-tier-name-0'] = { value: '队长' };
  elements['rules-tier-name-1'] = { value: '幼马' };
  elements['rules-tier-name-2'] = { value: '战马' };
  elements['rules-tier-name-3'] = { value: '烈马' };
  elements['rules-tier-name-4'] = { value: '神兽' };
  elements['rules-round-tier-1'] = { value: '1' };
  elements['rules-round-tier-2'] = { value: '2' };
  elements['rules-round-tier-3'] = { value: '4' };
  elements['rules-round-tier-4'] = { value: '3' };
  H.actions.updateRules();
  assert(H.state.captains.length === targetTeamCount, '规则设置应能调整队伍数量');
  assert(H.state.draft.round === 3, '规则设置应能调整当前轮次');
  assert(H.state.settings.drawCount === 4, '规则设置应能调整基础抽卡张数');
  assert(H.selectors.roundTier(3) === 4, '规则设置应能调整每轮卡池顺序');
  assert(H.state.settings.tierNames[4] === '神兽', '规则设置应能保存自定义卡池名称');
  H.actions.setActiveView('players');
  assert(app.innerHTML.includes('神兽池'), '自定义卡池名称保存后应同步到选手库分池标题');
  assert(H.state.captains.length === targetTeamCount, '规则设置应新增缺失队伍');
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
  H.actions.setActiveView('tournament');
  assert(app.innerHTML.includes('赛程') && app.innerHTML.includes('generateTournamentSchedule'), '赛程页面应提供生成入口');
  H.actions.generateTournamentSchedule();
  assert(H.state.tournament.rounds.length >= 1 && H.state.tournament.rounds[0].matches.length >= 1, '赛程页面应能生成首轮对阵');
  H.actions.setActiveView('tournament');
  assert(app.innerHTML.includes('tournament-team-bank') && app.innerHTML.includes('tournament-slot') && app.innerHTML.includes('draggable="true"'), '赛程页面应支持拖动队伍到首轮框内');
  assert(app.innerHTML.includes('赛程图') && app.innerHTML.includes('tournament-bracket') && app.innerHTML.includes('bracket-match'), '赛程页面应显示赛程图');
  assert(app.innerHTML.includes('赛程表') && app.innerHTML.includes('tournament-board') && app.innerHTML.includes('tournament-match-list'), '赛程页面应显示赛程表');
  assert(app.innerHTML.indexOf('赛程表') < app.innerHTML.indexOf('赛程图'), '赛程表应显示在赛程图之前');
  const dragCaptainId = H.state.captains[2].id;
  const dragTargetMatch = H.state.tournament.rounds[0].matches[0];
  H.actions.assignTournamentSlot('r1', dragTargetMatch.id, 'A', dragCaptainId);
  assert(dragTargetMatch.teamAId === dragCaptainId, '拖拽落位应把队伍写入目标槽位');
  assert(H.state.tournament.rounds[0].matches.filter(match => match.teamAId === dragCaptainId || match.teamBId === dragCaptainId).length === 1, '拖拽落位应从原槽位移除同一队伍');
  H.actions.generateTournamentSchedule();
  const firstMatch = H.state.tournament.rounds[0].matches.find(match => match.teamAId && match.teamBId);
  elements[`tournament-score-r1-${firstMatch.id}-a`] = { value: '2' };
  elements[`tournament-score-r1-${firstMatch.id}-b`] = { value: '0' };
  H.actions.saveTournamentScore('r1', firstMatch.id);
  assert(firstMatch.winnerId === firstMatch.teamAId && firstMatch.status === 'completed', '录入比分后应自动判定晋级队伍');
  H.state.tournament.rounds[0].matches.forEach(match => {
    if (match.status === 'pending') {
      elements[`tournament-score-r1-${match.id}-a`] = { value: '1' };
      elements[`tournament-score-r1-${match.id}-b`] = { value: '0' };
      H.actions.saveTournamentScore('r1', match.id);
    }
  });
  assert(H.state.tournament.rounds.length >= 2, '首轮全部结束后应自动生成下一轮');
  H.actions.resetTournamentSchedule();
  assert(H.state.tournament.status === 'empty' && H.state.tournament.rounds.length === 0, '赛程页面应能清空赛程');
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

function testTeamCapacityAndMemberPromotion() {
  const { H, app } = createHarness();
  const captain = H.state.captains[0];
  const originalCaptainPlayer = H.state.players.find(player => player.id === captain.playerId);
  if (originalCaptainPlayer) originalCaptainPlayer.status = 'available';
  delete captain.playerId;
  delete captain.playerGameId;
  captain.team = [];

  const testPlayers = Array.from({ length: 6 }, (_, index) => ({
    id: `team-capacity-${index + 1}`,
    name: `容量测试${index + 1}`,
    lane: '补位',
    gameId: `TEAM_CAP_${index + 1}`,
    score: 70 + index,
    tier: 2,
    status: 'available',
  }));
  H.state.players.push(...testPlayers);
  H.normalizeState(H.state);

  assert(H.selectors.teamMemberCapacity(captain.id) === H.state.settings.playersPerTeam + 1, '无队长队伍应允许补录5名临时队员');
  testPlayers.slice(0, 5).forEach(player => H.actions.assignPlayerToTeam(captain.id, player.id));
  assert(captain.team.length === 5, '无队长队伍应能补录5名队员');
  H.actions.assignPlayerToTeam(captain.id, testPlayers[5].id);
  assert(captain.team.length === 5 && H.state.players.find(player => player.id === testPlayers[5].id).status === 'available', '无队长队伍超过5人时应拒绝继续补录');

  H.actions.setActiveView('teams');
  assert(app.innerHTML.includes('队伍人数：5/5') && app.innerHTML.includes('team-member-actions') && app.innerHTML.includes('设为队长'), '队伍管理应显示无队长5人容量，并在队员卡片提供设为队长入口');
  const c1CardStart = app.innerHTML.indexOf('id="captain-name-c1"');
  const c2CardStart = app.innerHTML.indexOf('id="captain-name-c2"');
  const c1CardHtml = app.innerHTML.slice(c1CardStart, c2CardStart);
  assert(c1CardHtml.includes('满员-未设置队长') && !c1CardHtml.includes('待指定队长') && !c1CardHtml.includes('队伍编号：c1'), '无队长满员队伍应只在状态显示未设置队长，不应额外占用队长栏');
  const c2CardEnd = app.innerHTML.indexOf('id="captain-name-c3"');
  const c2CardHtml = app.innerHTML.slice(c2CardStart, c2CardEnd);
  assert(!c2CardHtml.includes('待指定队长') && !c2CardHtml.includes('队伍编号：c2'), '无队长缺员队伍也不应显示待指定队长占位栏');

  const firstPromotedId = captain.team[0];
  H.actions.promotePlayerToCaptain(firstPromotedId);
  assert(captain.playerId === firstPromotedId, '无队长队伍可将队员提升为队长');
  assert(!captain.team.includes(firstPromotedId) && captain.team.length === 4 && H.selectors.teamMemberCapacity(captain.id) === H.state.settings.playersPerTeam, '队员提升为队长后应退出队员位，有队长队伍容量回到4人');

  const previousCaptainId = captain.playerId;
  const replacementId = captain.team[0];
  H.actions.promotePlayerToCaptain(replacementId);
  const previousCaptain = H.state.players.find(player => player.id === previousCaptainId);
  assert(captain.playerId === replacementId, '已有队长时可将队员提升为新队长');
  assert(!captain.team.includes(replacementId), '新队长不应继续占用队员位');
  assert(captain.team.includes(previousCaptainId) && previousCaptain.status === 'drafted' && previousCaptain.teamId === captain.id, '原队长应自动降为当前队伍队员');
}

function testFeedbackAutoDismiss() {
  const { H, app, toastRoot, document } = createHarness();
  document.scrollingElement.scrollTop = 480;
  H.ui.render();
  const appBeforeToast = app.innerHTML;
  H.eventStore.append('测试反馈', '2秒后应自动消失', 'success');
  assert(toastRoot.innerHTML.includes('feedback-toast'), '反馈提示应立即显示在独立通知根节点');
  assert(app.innerHTML === appBeforeToast, '反馈提示弹出不应重绘主应用容器');
  assert(document.scrollingElement.scrollTop === 480, '反馈提示弹出时不应改变页面滚动位置');
  return new Promise(resolve => {
    setTimeout(() => {
      assert(!H.state.ui.feedback, '反馈提示应在2.2秒后清除状态');
      assert(!toastRoot.innerHTML.includes('feedback-toast'), '反馈提示应在2.2秒后从独立通知根节点移除');
      assert(app.innerHTML === appBeforeToast, '反馈提示消失不应重绘主应用容器');
      assert(document.scrollingElement.scrollTop === 480, '反馈提示消失时不应改变页面滚动位置');
      resolve();
    }, 2300);
  });
}

function testClearAllPlayers() {
  const { H, app } = createHarness();
  H.actions.setActiveView('players');
  assert(app.innerHTML.includes('清空所有选手'), '选手库应显示清空所有选手入口');
  H.actions.generateTournamentSchedule();
  H.actions.clearAllPlayers();
  assert(H.state.players.length === 0, '清空所有选手后选手库应为空');
  assert(H.state.captains.every(captain => captain.team.length === 0 && !captain.playerId && !captain.playerGameId), '清空所有选手后所有队伍应为空且无队长绑定');
  assert(H.state.draft.round === 1 && H.state.draft.currentIndex === 0 && !H.state.draft.currentDraw, '清空所有选手后流程应回到第1轮初始态');
  assert(H.state.captains.every(captain => (H.state.hexcoreAssignments[captain.id] || []).length === 0), '清空所有选手后所有海克斯分配应清空');
  assert(H.state.tournament.status === 'empty' && H.state.tournament.rounds.length === 0, '清空所有选手后赛程应清空');
  H.actions.importPlayers({
    name: 'hexcore2_players_50.csv',
    content: fs.readFileSync(path.join(root, 'test-data', 'hexcore2_players_50.csv'), 'utf8'),
  });
  assert(H.state.ui.playerImportPreview && H.state.ui.playerImportPreview.accepted.length === 50, '导入50人测试表格应先生成50人预览');
  H.actions.confirmPlayerImport();
  assert(H.state.players.length === 50 && H.state.players.some(player => player.gameId === 'DY_Raven_T48'), '清空后应能导入50人测试表格');
}

function testRandomizeHexcoreDrawOrderResetsAndSelectsFirst() {
  const { H, app } = createHarness();
  H.state.ui.hexCaptainId = 'c8';
  H.state.hexcoreDraft = {
    captainId: 'c8',
    slots: ['origin', 'blind', 'steady'],
    chosen: ['origin'],
    seenIds: ['origin', 'blind', 'steady'],
    refreshUsed: true,
    drawOrder: [],
  };
  H.state.draft.runtimeEffects = [{ type: 'test_effect' }];

  H.actions.randomizeHexcoreDrawOrder();

  const order = H.state.hexcoreDraft.drawOrder;
  assert(order.length === H.state.captains.length, '制定抽取顺序后应包含全部队长');
  assert(new Set(order).size === H.state.captains.length, '制定抽取顺序后队长不应重复');
  assert(H.state.ui.hexCaptainId === order[0], '制定抽取顺序后应切换到第一顺位队长');
  assert(H.state.captains.every(captain => (H.state.hexcoreAssignments[captain.id] || []).length === 0), '制定抽取顺序后应清空所有队长海克斯');
  assert(!H.state.hexcoreDraft.captainId && H.state.hexcoreDraft.slots.length === 0 && !H.state.hexcoreDraft.refreshUsed, '制定抽取顺序后应清空当前抽取会话');
  assert(H.state.draft.runtimeEffects.length === 0, '制定抽取顺序后应清空海克斯运行时效果');
  H.actions.setActiveView('hexcores');
  assert(app.innerHTML.includes('aria-hidden="true">→</i>'), '抽取顺序队伍之间应显示箭头');
  assert(app.innerHTML.includes(`操作队长：${H.state.captains.find(captain => captain.id === order[0]).name}`), '海克斯库应显示第一顺位队长为当前操作队长');
}

function testSecurityHardening() {
  assert(staticServer.resolveRequestPath('/') === path.join(root, 'index.html'), '静态服务应正常解析首页');
  assert(staticServer.resolveRequestPath('/src/main.js') === path.join(root, 'src', 'main.js'), '静态服务应正常解析项目内资源');
  assert(staticServer.resolveRequestPath('/..%2FHEXCORE2.0_secret%2Fsecret.txt') === null, '静态服务应拒绝同名前缀兄弟目录穿越');
  assert(staticServer.resolveRequestPath('/%E0%A4%A') === null, '静态服务应拒绝非法URL编码');

  const { H, app } = createHarness();
  H.state.captains[0].id = "c1');window.__xss_fired=1;//";
  H.state.captains[0].team = ["p101');window.__xss_fired=1;//"];
  H.state.players[0].id = "p201');window.__xss_fired=1;//";
  H.state.players[1].id = '<img src=x onerror=window.__xss_fired=1>';
  H.state.draft.baseOrder = ["c1');window.__xss_fired=1;//"];
  H.normalizeState(H.state);
  H.actions.setActiveView('teams');
  assert(H.state.captains.every(captain => /^[A-Za-z0-9_-]{1,48}$/.test(captain.id)), '状态恢复应规范化队长ID');
  assert(H.state.players.every(player => /^[A-Za-z0-9_-]{1,48}$/.test(player.id)), '状态恢复应规范化选手ID');
  assert(!app.innerHTML.includes('window.__xss_fired') && !app.innerHTML.includes('<img src=x'), '恶意状态ID不应进入渲染后的HTML或内联事件');

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

  const currentDrawHarness = createHarness();
  const H2 = currentDrawHarness.H;
  const app2 = currentDrawHarness.app;
  [1, 2, 3, 4].forEach(tier => {
    H2.state.settings.tierNames[tier] = '<b>马池</b>';
  });
  H2.state.draft.currentOrder = ['c1'];
  H2.state.draft.currentIndex = 0;
  H2.state.draft.currentDraw = {
    id: 'malicious-draw',
    captainId: 'c1',
    round: 1,
    tier: 1,
    effectiveTier: 1,
    pickMode: 'hellhound',
    timeLimitSeconds: '<img src=x onerror=window.__xss_fired=1>',
    cards: [{ playerId: 'p201', displayPlayerId: 'p201' }],
  };
  H2.normalizeState(H2.state);
  H2.actions.setActiveView('draft');
  assert(H2.state.draft.currentDraw.timeLimitSeconds === H2.state.settings.pickTimeoutSeconds, '导入状态中的限时字段应被规范为数字');
  assert(!app2.innerHTML.includes('<img src=x') && !app2.innerHTML.includes('window.__xss_fired'), '导入抽卡状态不应把限时HTML渲染出来');
  assert(app2.innerHTML.includes('&lt;b&gt;马池&lt;/b&gt;'), '自定义卡池名称在顶部状态栏应转义输出');

  let sizeError = '';
  H2.exportService.readStateFile(
    { size: 3 * 1024 * 1024, content: '{}' },
    () => { throw new Error('超大状态备份不应被读取'); },
    error => { sizeError = error.message; },
  );
  assert(sizeError.includes('不能超过'), '超大状态备份应在读取前被拒绝');
}

async function run() {
  const tests = [
    testOriginQueue,
    testPandoraConflict,
    testHexcoreExecutionQueue,
    testWorkflowGateMissingHexcoreBoard,
    testWorkflowStageChecklist,
    testHexTargetPicker,
    testLockContract,
    testMysteryBoxTransfer,
    testHellhound,
    testSnowCat,
    testDecomposeKnowledge,
    testUiNavigationAndHexButtons,
    testTeamCapacityAndMemberPromotion,
    testFeedbackAutoDismiss,
    testClearAllPlayers,
    testRandomizeHexcoreDrawOrderResetsAndSelectsFirst,
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
