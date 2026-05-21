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
  'src/engines/economy-engine.js',
  'src/engines/shop-engine.js',
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

function currentCaptain(H) {
  return H.selectors.currentCaptain();
}

function ensureCurrentShop(H) {
  if (!H.state.draft.currentDraw) H.actions.drawCards();
  return H.state.draft.currentDraw;
}

function skipUntilCompleted(H, maxSteps = 80) {
  let steps = 0;
  while (H.state.draft.phase !== 'completed' && steps < maxSteps) {
    H.actions.skipTurn();
    steps += 1;
  }
  assert(H.state.draft.phase === 'completed', '四轮跳过后流程应进入完成状态');
}

function testDefaultGoldSetup() {
  const { H } = createHarness();
  const captains = H.state.captains;
  const players = H.state.players;
  const captainPlayerIds = new Set(captains.map(captain => captain.playerId));
  const fiveFeePlayers = players.filter(player => player.tier === 5);

  assert(captains.length === 10, '系统默认应为10队');
  assert(players.length === 50, '默认参赛选手应为50人');
  assert(captains.every(captain => captain.playerId && captain.economy.gold === 6), '每名队长应绑定队长选手并开局6金币');
  assert(players.filter(player => player.status === 'captain').length === 10, '10名队长选手应进入队长专属池');
  assert(players.filter(player => !captainPlayerIds.has(player.id) && player.status === 'available').length === 40, '非队长40人应进入队员卡池');
  assert(fiveFeePlayers.length <= 6 && fiveFeePlayers.every(player => player.isFmvp), '5费卡应只来自参赛且非队长的历届FMVP，且最多6张');
  assert(H.state.draft.maxRounds === 4 && H.state.settings.shopSize === 5, '金币模式应固定4轮和5张商店');
  assert(H.selectors.workflowStatus().playersDraftReady, '默认示例应可直接进入队员金币抽卡阶段');
}

function testFreeShopAndRoundProbabilities() {
  const { H } = createHarness();
  const captain = currentCaptain(H);
  const shop = ensureCurrentShop(H);

  assert(shop && shop.pickMode === 'shop', '首次操作应生成金币商店');
  assert(shop.cards.length === 5, '商店应展示5张卡');
  assert(shop.cards.every(card => card.tier >= 1 && card.tier <= 3), '第一轮商店不应出现4费或5费');
  assert(captain.economy.gold === 6, '首次免费商店不应扣金币');
  assert(H.economyEngine.roundState(captain.id, 1).freeShopUsed, '首次商店生成后应记录免费次数已用');

  const round3 = H.shopEngine.probabilityForRound(3);
  const round4 = H.shopEngine.probabilityForRound(4);
  assert(round3[5] === 2, '第三轮5费概率应为2%');
  assert(round4[4] + round4[5] > round3[4] + round3[5], '第四轮4费和5费概率应达到最高');
}

function testRefreshPurchaseAndPermission() {
  const { H } = createHarness();
  const captain = currentCaptain(H);
  ensureCurrentShop(H);
  H.actions.refreshShop();

  assert(captain.economy.gold === 5, '第一次付费刷新应扣1金币');
  assert(H.economyEngine.roundState(captain.id, 1).refreshCount === 1, '刷新次数应递增');

  const slot = H.state.draft.currentDraw.cards.find(card => card.price <= captain.economy.gold);
  assert(slot, '刷新后应存在当前金币可购买的卡');
  H.state.draft.selectedSlot = H.state.draft.currentDraw.cards.indexOf(slot);
  const player = H.state.players.find(item => item.id === slot.playerId);
  H.actions.pickCard();

  assert(player.status === 'drafted' && player.teamId === captain.id, '购买成功后队员应入队');
  assert(captain.economy.gold === 5 - player.tier, '购买应按费用扣除金币');
  assert(H.economyEngine.roundState(captain.id, 1).purchaseUsed, '购买后本轮购买权限应消耗');

  H.actions.removePlayerFromTeam(captain.id, player.id);
  assert(player.status === 'drafted' && captain.team.includes(player.id), '金币模式下已购队员不能从队伍管理移回池');

  const orderBefore = H.state.draft.baseOrder.join('|');
  H.actions.moveCaptainOrder(captain.id, 'down');
  assert(H.state.draft.baseOrder.join('|') === orderBefore, '金币抽卡开始后基础顺位应固化');

  H.actions.jumpToScheduleSlot(4, captain.id);
  assert(H.state.draft.round === 1, '金币模式不能手动跳转到其他轮次');

  const goldAfterPurchase = captain.economy.gold;
  H.actions.refreshShop();
  assert(captain.economy.gold === goldAfterPurchase, '购买后不能继续刷新本轮商店');
}

function testSkipLocksRoundAndIncome() {
  const { H } = createHarness();
  const firstCaptain = currentCaptain(H);
  ensureCurrentShop(H);
  H.actions.skipTurn();

  assert(H.economyEngine.roundState(firstCaptain.id, 1).skipped, '跳过后本轮购买权限应作废');
  H.actions.jumpToScheduleSlot(1, firstCaptain.id);
  H.actions.drawCards();
  assert(!H.state.draft.currentDraw || H.state.draft.currentDraw.captainId !== firstCaptain.id, '跳过后不能通过跳转重新购买');

  H.state.draft.round = 1;
  H.turnOrderEngine.recompute();
  H.state.draft.currentIndex = H.state.draft.currentOrder.length - 1;
  H.actions.skipTurn();
  assert(H.state.draft.round === 2, '第一轮最后一位跳过后应进入第二轮');
  assert(H.state.captains.every(captain => captain.economy.gold === 9 || captain.id === firstCaptain.id && captain.economy.gold === 9), '第二轮开始每名队长应获得3金币');
}

function testFinalRandomFill() {
  const { H } = createHarness();
  skipUntilCompleted(H);

  assert(H.state.draft.finalFillCompleted, '四轮结束后应完成最终补位检查');
  assert(H.state.captains.every(captain => captain.team.length === H.state.settings.playersPerTeam), '跳过导致阵容不足时应随机补满4名队员');
  assert(H.state.players.filter(player => player.status === 'drafted').length === 40, '最终10队应共获得40名队员');
  assert(H.state.events.some(event => event.title === '最终随机补位'), '最终补位应写入日志');
}

function testGoldModeHexcoreDisable() {
  const { H, app } = createHarness();
  const captain = currentCaptain(H);
  const openFeast = H.sampleData.hexcores.find(hex => hex.id === 'open-feast');
  H.state.hexcoreAssignments[captain.id].push({ ...openFeast, status: 'available' });

  const queue = H.hexcoreEngine.executionQueue(captain.id);
  assert(queue.some(item => item.id === 'open-feast' && item.status === '金币模式禁用'), '入队型海克斯应在金币模式下禁用');
  assert(!H.hexcoreEngine.activate('open-feast').ok, '金币模式下不能执行入队型海克斯');
  H.ui.render();
  assert(app.innerHTML.includes('金币模式：入队型效果禁用'), 'UI应明确显示入队型海克斯被金币模式禁用');
}

function testGoldModeLockContractPassiveDisabled() {
  const { H } = createHarness();
  const captain = currentCaptain(H);
  const candidates = H.state.players.filter(player => player.status === 'available').slice(0, 2);
  H.state.draft.runtimeEffects.push({
    type: 'locked_pair',
    captainId: captain.id,
    playerIds: candidates.map(player => player.id),
    round: 1,
  });

  const assigned = H.assignmentEngine.purchase(captain.id, candidates[0].id, 'gold_shop_purchase');

  assert(assigned.ok, '测试前提：金币购买应成功');
  assert(captain.team.length === 1, '金币模式下锁定契约残留不应触发第二名免费入队');
  assert(candidates[1].status === 'available', '金币模式下锁定契约另一名选手应保持可选');
}

function testGoldModeManualBackfillDisabled() {
  const { H, app } = createHarness();
  const captain = currentCaptain(H);
  const player = H.state.players.find(item => item.status === 'available');

  H.actions.setActiveView('teams');
  assert(app.innerHTML.includes('金币模式已禁用手动补录'), '队伍管理页应提示金币模式禁用手动补录');
  H.actions.assignPlayerToTeam(captain.id, player.id);

  assert(captain.team.length === 0, '金币模式下手动补录不能让队员入队');
  assert(player.status === 'available', '金币模式下手动补录不能改变选手状态');
  assert(!H.assignmentEngine.assign(captain.id, player.id, 'manual_backfill'), '入队引擎应拒绝金币模式下的手动补录来源');
  assert(H.state.events.some(event => event.title === '补录队员失败'), '手动补录被拒绝应写入日志');
}

function testImportHistoryFields() {
  const { H } = createHarness();
  const csv = [
    'name,gameId,lane,score,S1,S2,S3,S4,S5,S6,FMVP',
    '测试FMVP,TEST_FMVP,中路,90,冠军,亚军,4强,1轮游,冠军,FMVP,S6',
  ].join('\n');
  const parsed = H.exportService.parsePlayerImport('history.csv', csv);
  assert(parsed.length === 1, '带历史成绩CSV应能导入');
  assert(parsed[0].isFmvp && parsed[0].fmvpSeasons.includes('S6'), '导入应识别FMVP届数');
  assert(parsed[0].seasonResults.s6 === 'FMVP', '导入应保留第6届FMVP成绩');
}

function testOfficialPlayerLimit() {
  const { H } = createHarness();
  const overflowState = H.normalizeState({
    ...H.state,
    players: [
      ...H.state.players,
      { id: 'p999', name: '溢出选手', gameId: 'OVERFLOW', lane: '中路', score: 60, status: 'available' },
    ],
  });
  assert(overflowState.players.length === 50, '状态归一化应限制参赛选手总数为50人');

  H.actions.addPlayer();
  assert(!H.state.ui.addPlayerModal, '已满50人时不能打开新增选手弹窗');

  const csv = [
    'name,gameId,lane,score',
    '第51人,PLAYER_51,中路,70',
  ].join('\n');
  const preview = H.exportService.buildPlayerImportPreview('players.csv', csv, H.state.players);
  assert(preview.accepted.length === 0 && preview.skipped[0].reason.includes('50人'), '导入预览应拒绝超过50人的选手');
}

function testUiNavigationAndRecap() {
  const { H, app } = createHarness();
  H.actions.setActiveView('draft');
  assert(app.innerHTML.includes('金币') && app.innerHTML.includes('购买此卡') && app.innerHTML.includes('刷新商店'), '实时抽选页应展示金币商店操作');
  H.actions.setActiveView('players');
  assert(app.innerHTML.includes('5费FMVP') && app.innerHTML.includes('最多6张'), '选手库应展示5费FMVP池规则');
  H.actions.setActiveView('rules');
  assert(app.innerHTML.includes('金币经济') && app.innerHTML.includes('第 4 轮') && app.innerHTML.includes('5费FMVP'), '规则页应展示金币经济和概率表');
  assert(H.exportService.exportRecapText(), '复盘导出应支持金币模式阵容');
}

function testLegacyMigration() {
  const { H } = createHarness();
  const legacy = {
    settings: { totalTeams: 10, playersPerTeam: 4, tierNames: H.state.settings.tierNames },
    captains: H.state.captains.map((captain, index) => ({
      ...captain,
      team: index === 0 ? ['p011'] : [],
      economy: undefined,
    })),
    players: H.state.players.map(player => player.id === 'p011' ? { ...player, status: 'drafted', teamId: 'c1' } : { ...player }),
    draft: { round: 3, currentDraw: { captainId: 'c1', cards: [{ playerId: 'p011' }] } },
  };
  const migrated = H.normalizeState(legacy);
  assert(migrated.legacyNoGoldBackup, '旧无金币状态应保存为历史备份');
  assert(migrated.captains.every(captain => captain.team.length === 0), '旧无金币队伍结果不应迁移为金币模式阵容');
  assert(migrated.draft.round === 1 && !migrated.draft.currentDraw, '旧无金币抽卡状态应重建为金币模式初始态');
}

function testSecurityHardening() {
  assert(staticServer.resolveRequestPath('/') === path.join(root, 'index.html'), '静态服务应正常解析首页');
  assert(staticServer.resolveRequestPath('/src/main.js') === path.join(root, 'src', 'main.js'), '静态服务应正常解析项目内资源');
  assert(staticServer.resolveRequestPath('/..%2FHEXCORE2.0_secret%2Fsecret.txt') === null, '静态服务应拒绝同名前缀兄弟目录穿越');
  assert(staticServer.resolveRequestPath('/%E0%A4%A') === null, '静态服务应拒绝非法URL编码');

  const { H, app } = createHarness();
  H.state.captains[0].id = "c1');window.__xss_fired=1;//";
  H.state.players[0].id = '<img src=x onerror=window.__xss_fired=1>';
  H.state.draft.baseOrder = ["c1');window.__xss_fired=1;//"];
  H.normalizeState(H.state);
  H.actions.setActiveView('teams');
  assert(H.state.captains.every(captain => /^[A-Za-z0-9_-]{1,48}$/.test(captain.id)), '状态恢复应规范化队长ID');
  assert(H.state.players.every(player => /^[A-Za-z0-9_-]{1,48}$/.test(player.id)), '状态恢复应规范化选手ID');
  assert(!app.innerHTML.includes('window.__xss_fired') && !app.innerHTML.includes('<img src=x'), '恶意状态ID不应进入渲染后的HTML或内联事件');

  let sizeError = '';
  H.exportService.readStateFile(
    { size: 3 * 1024 * 1024, content: '{}' },
    () => { throw new Error('超大状态备份不应被读取'); },
    error => { sizeError = error.message; },
  );
  assert(sizeError.includes('不能超过'), '超大状态备份应在读取前被拒绝');
}

async function run() {
  const tests = [
    testDefaultGoldSetup,
    testFreeShopAndRoundProbabilities,
    testRefreshPurchaseAndPermission,
    testSkipLocksRoundAndIncome,
    testFinalRandomFill,
    testGoldModeHexcoreDisable,
    testGoldModeLockContractPassiveDisabled,
    testGoldModeManualBackfillDisabled,
    testImportHistoryFields,
    testOfficialPlayerLimit,
    testUiNavigationAndRecap,
    testLegacyMigration,
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
