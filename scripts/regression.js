const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const staticServer = require('./serve.js');
const { analyzeTaskDoc, runTaskLoop } = require('./task-loop-runner.js');

const root = path.resolve(__dirname, '..');
const sourceFiles = [
  'src/core/sample-data.js',
  'src/services/storage-service.js',
  'src/services/history-service.js',
  'src/services/export-service.js',
  'src/services/integrity-service.js',
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
  const appMain = { scrollTop: 0, scrollLeft: 0 };
  const workspaceMain = { scrollTop: 0, scrollLeft: 0 };
  const eventRail = { scrollTop: 0, scrollLeft: 0 };
  const app = {};
  let appHtml = '';
  Object.defineProperty(app, 'innerHTML', {
    get() {
      return appHtml;
    },
    set(value) {
      appHtml = value;
      appMain.scrollTop = 0;
      workspaceMain.scrollTop = 0;
      eventRail.scrollTop = 0;
    },
  });
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
      querySelector(selector) {
        if (selector === '.app-main') return appMain;
        if (selector === '.workspace-main' || selector === '.page-workspace') return workspaceMain;
        if (selector === '.event-rail') return eventRail;
        return null;
      },
      createElement() { return { click() {}, remove() {}, set href(value) {}, set download(value) {} }; },
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
  return { H: context.Hexcore2, app, elements, workspaceMain };
}

function testSeasonResults(score, index) {
  const labels = score >= 92
    ? ['冠军', '亚军', '4强', '冠军', 'FMVP', '冠军']
    : score >= 82
      ? ['4强', '亚军', '1轮游', '4强', '亚军', '4强']
      : score >= 70
        ? ['1轮游', '4强', '未参赛', '4强', '1轮游', '亚军']
        : ['未参赛', '1轮游', '未参赛', '1轮游', '未参赛', '4强'];
  return labels.reduce((result, value, offset) => {
    result[`s${offset + 1}`] = labels[(offset + index) % labels.length];
    return result;
  }, {});
}

function installReadyTestData(H) {
  const lanes = ['上路', '打野', '中路', '下路', '辅助'];
  const buildPlayers = (camp, prefix, startIndex) => Array.from({ length: 25 }, (_, index) => {
    const number = startIndex + index;
    const score = 100 - index;
    const fmvp = index < 2 ? [`S${index + 1}`] : [];
    return {
      id: `p${String(number).padStart(3, '0')}`,
      name: `${camp === 'local' ? '本地测试' : '外地测试'}${index + 1}`,
      camp,
      lane: lanes[index % lanes.length],
      gameId: `${prefix}_${String(index + 1).padStart(2, '0')}`,
      score,
      tier: 1,
      kda: '2.0',
      damage: '10K',
      winRate: '50%',
      heroes: ['奥恩', '蔚', '发条'],
      manifesto: '回归测试选手',
      status: 'available',
      seasonResults: testSeasonResults(score, index),
      fmvpSeasons: fmvp,
      isFmvp: Boolean(fmvp.length),
    };
  });
  const players = [
    ...buildPlayers('local', 'LOCAL_TEST', 1),
    ...buildPlayers('outsider', 'OUT_TEST', 26),
  ];
  const captainPlayerIds = ['p001', 'p002', 'p003', 'p004', 'p005', 'p026', 'p027', 'p028', 'p029', 'p030'];
  const captains = captainPlayerIds.map((playerId, index) => {
    const player = players.find(item => item.id === playerId);
    return {
      id: `c${index + 1}`,
      name: `C${index + 1} ${player.name}`,
      record: player.camp === 'local' ? '本地队长' : '外地队长',
      team: [],
      playerId: player.id,
      playerGameId: player.gameId,
    };
  });
  const take = (...ids) => ids
    .map(id => H.sampleData.hexcores.find(hexcore => hexcore.id === id))
    .filter(Boolean)
    .map(hexcore => ({ ...hexcore, status: hexcore.mode === 'passive' ? 'passive' : 'available' }));

  H.state.players = players;
  H.state.captains = captains;
  H.state.hexcoreAssignments = {
    c1: take('camp-scout'),
    c2: take('donation'),
    c3: take('open-feast'),
    c4: take('photographer'),
    c5: take('giant-slayer'),
    c6: take('wise-benevolence'),
    c7: take('vampiric-habit'),
    c8: take('steady-reinforce'),
    c9: take('sponsor-flow'),
    c10: take('price-interference'),
  };
  H.state.draft = {
    ...H.state.draft,
    phase: 'captain_action',
    round: 1,
    maxRounds: 4,
    baseOrder: captains.map(captain => captain.id),
    currentOrder: captains.map(captain => captain.id),
    currentIndex: 0,
    selectedSlot: 0,
    currentDraw: null,
    runtimeEffects: [],
    explanations: [],
    pickedThisTurn: false,
    paused: false,
    finalFillCompleted: false,
  };
  H.state.tournament = { status: 'empty', championId: '', rounds: [] };
  H.state.undoStack = [];
  H.normalizeState(H.state);
  H.economyEngine.ensureAll();
  H.turnOrderEngine.recompute();
  H.ui.render();
}

function createReadyHarness() {
  const harness = createHarness();
  installReadyTestData(harness.H);
  harness.H.actions.drawCards();
  return harness;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function withMutedConsole(fn) {
  const originalLog = console.log;
  const originalError = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

function testArgsMap(args) {
  return new Map(args.map(arg => {
    const [key, ...rest] = arg.replace(/^--/, '').split('=');
    return [key, rest.join('=') || 'true'];
  }));
}

function currentCaptain(H) {
  return H.selectors.currentCaptain();
}

function playerById(H, playerId) {
  return H.state.players.find(player => player.id === playerId);
}

function assignedHexcore(hexcore) {
  return { ...hexcore, status: hexcore.mode === 'passive' ? 'passive' : 'available' };
}

function setOnlyHexcore(H, captainId, hexcoreId) {
  H.state.hexcoreAssignments[captainId] = [assignedHexcore(H.sampleData.hexcores.find(hexcore => hexcore.id === hexcoreId))];
}

function releaseHexcoreEverywhere(H, hexcoreId) {
  Object.keys(H.state.hexcoreAssignments || {}).forEach(captainId => {
    H.state.hexcoreAssignments[captainId] = (H.state.hexcoreAssignments[captainId] || [])
      .filter(hex => hex.id !== hexcoreId);
  });
}

function drawForCaptain(H, captainId) {
  H.state.draft.currentOrder = H.state.captains.map(captain => captain.id);
  H.state.draft.currentIndex = H.state.draft.currentOrder.indexOf(captainId);
  H.state.draft.currentDraw = null;
  H.economyEngine.roundState(captainId).freeShopUsed = false;
  H.actions.drawCards();
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

function runGoldDraftToCompletion(H, maxSteps = 240) {
  let steps = 0;
  while (H.state.draft.phase !== 'completed' && steps < maxSteps) {
    const captain = currentCaptain(H);
    assert(captain, '金币流程应始终有当前队长');
    captain.economy = captain.economy || {};
    captain.economy.gold = Math.max(Number(captain.economy.gold) || 0, 50);
    if (!H.state.draft.currentDraw || H.state.draft.currentDraw.captainId !== captain.id) {
      H.actions.drawCards();
    }
    const draw = H.state.draft.currentDraw;
    if (draw && draw.captainId === captain.id && !H.state.draft.pickedThisTurn) {
      const slotIndex = draw.cards.findIndex(card => card && !card.purchased);
      if (slotIndex >= 0) {
        H.state.draft.selectedSlot = slotIndex;
        H.actions.pickCard();
      } else {
        H.actions.skipTurn();
      }
    }
    if (H.state.draft.phase !== 'completed' && (H.state.draft.pickedThisTurn || (H.economyEngine.roundState(captain.id).skipped))) {
      H.actions.nextCaptain();
    }
    steps += 1;
  }
  assert(H.state.draft.phase === 'completed', '四轮金币商店应能在守护步数内完成');
}

function testDefaultEmptySetup() {
  const { H } = createHarness();

  assert(H.state.players.length === 0, '默认状态不应预置参赛选手');
  assert(H.state.captains.length === 10, '默认状态应保留10个空队伍槽位');
  assert(
    H.state.captains.every((captain, index) =>
      captain.name === `海斗${index + 1}队` && !captain.playerId && captain.team.length === 0
    ),
    '默认队伍应使用海斗x队命名且不预置队长选手或队员'
  );
  assert(Object.values(H.state.hexcoreAssignments).every(list => Array.isArray(list) && list.length === 0), '默认状态不应预置已分配海克斯');
  assert(!H.selectors.workflowStatus().playersDraftReady, '默认空状态不应直接进入队员抽选');
}

function testResetLocalStateRendersEmptySetup() {
  const { H, app } = createReadyHarness();

  H.actions.resetLocalState();

  assert(H.state.players.length === 0, '重置本地状态后应清空参赛选手');
  assert(H.state.captains.every((captain, index) => captain.name === `海斗${index + 1}队` && !captain.playerId), '重置后应恢复海斗x队空队伍');
  assert(!H.state.draft.currentDraw, '重置后不应保留旧商店');
  assert(!H.selectors.workflowStatus().playersDraftReady, '重置后应回到数据准备阶段');
  assert(app.innerHTML.includes('app-main') && app.innerHTML.includes('实时抽选尚未开始'), '重置后页面应立即重新渲染流程门禁，而不是依赖刷新加载');

  installReadyTestData(H);
  H.actions.clearBrowserData();
  assert(H.state.players.length === 0, '清理浏览器本地数据后应立即恢复默认空状态');
  assert(H.state.ui.feedback && H.state.ui.feedback.body.includes('页面已恢复默认空状态'), '清理浏览器本地数据后应给出可重新初始化提示');
}

function testCampLockedSetup() {
  const { H } = createReadyHarness();
  const localPlayers = H.state.players.filter(player => player.camp === 'local');
  const outsiderPlayers = H.state.players.filter(player => player.camp === 'outsider');
  const localCaptains = H.state.captains.filter(captain => H.selectors.captainCamp(captain.id) === 'local');
  const outsiderCaptains = H.state.captains.filter(captain => H.selectors.captainCamp(captain.id) === 'outsider');

  assert(H.state.players.length === 50, '默认参赛选手应固定为50人');
  assert(localPlayers.length === 25 && outsiderPlayers.length === 25, '本地人和外地人应各25人');
  assert(H.state.captains.length === 10, '队伍应固定10队');
  assert(localCaptains.length === 5 && outsiderCaptains.length === 5, '本地队长和外地队长应各5人');
  assert(H.selectors.campTeamLimit('local') === 5 && H.selectors.campTeamLimit('outsider') === 5, '阵营队伍上限应等于阵营人数除以5');
  assert(H.state.settings.playersPerTeam === 5 && H.state.draft.maxRounds === 4, '每队含队长5人且固定4轮');
  assert(H.state.captains.every(captain => H.selectors.teamMemberCapacity(captain.id) === 4), '每队应有4个队员名额');
  assert(H.selectors.workflowStatus().playersDraftReady, '完整测试数据应可进入金币商店队员抽选');

  const tierCaptainHarness = createHarness();
  installReadyTestData(tierCaptainHarness.H);
  const tierCaptainIds = ['p001', 'p006', 'p011', 'p016', 'p021'];
  tierCaptainHarness.H.state.captains.slice(0, 5).forEach((captain, index) => {
    captain.playerId = tierCaptainIds[index];
    const player = tierCaptainHarness.H.state.players.find(item => item.id === captain.playerId);
    captain.playerGameId = player ? player.gameId : '';
  });
  tierCaptainHarness.H.normalizeState(tierCaptainHarness.H.state);
  [1, 2, 3, 4, 5].forEach(tier => {
    const count = tierCaptainHarness.H.state.players.filter(player => player.camp === 'local' && Number(player.tier) === tier).length;
    assert(count === 5, `队长来自不同费用池时，本地${tier}费池仍应显示5/5，当前 ${count}/5`);
  });
}

function testCampTeamLimitGuard() {
  const { H } = createReadyHarness();
  const outsiderCaptain = H.state.captains.find(captain => H.selectors.captainCamp(captain.id) === 'outsider');
  const outsiderCaptainPlayer = H.selectors.captainPlayer(outsiderCaptain.id);
  const localCandidate = H.state.players.find(player =>
    player.camp === 'local'
    && player.status === 'available'
    && !H.selectors.isCaptainPlayer(player.id)
  );

  outsiderCaptain.playerId = '';
  outsiderCaptain.playerGameId = '';
  outsiderCaptainPlayer.status = 'available';
  delete outsiderCaptainPlayer.role;
  delete outsiderCaptainPlayer.isCaptain;
  assert(H.selectors.campCaptainCount('outsider') === 4, '解除外地队长后外地队伍数应减少');
  H.actions.promotePlayerToCaptain(localCandidate.id);
  assert(H.selectors.campCaptainCount('local') === 5, '本地队伍达到上限后不能继续新增本地队长');
  assert(!H.selectors.isCaptainPlayer(localCandidate.id), '超过阵营人数/5时，候选人不能被设为队长');

  outsiderCaptain.playerId = localCandidate.id;
  localCandidate.status = 'captain';
  assert(H.selectors.workflowChecklist().blockingItems.some(item => item.id === 'camp-count'), '异常状态下流程门禁应拦截阵营队伍超额');
}

function testCampLockedShop() {
  const { H } = createReadyHarness();
  const localShop = drawForCaptain(H, 'c1');
  assert(localShop.cards.length === 5, '本地队长商店应生成5张卡');
  assert(localShop.cards.every(card => playerById(H, card.playerId).camp === 'local'), '本地队长商店不能出现外地人');
  assert(new Set(localShop.cards.map(card => card.playerId)).size === localShop.cards.length, '商店内不应重复展示同一选手');

  const outsiderShop = drawForCaptain(H, 'c6');
  assert(outsiderShop.cards.length === 5, '外地队长商店应生成5张卡');
  assert(outsiderShop.cards.every(card => playerById(H, card.playerId).camp === 'outsider'), '外地队长商店不能出现本地人');

  H.state.players
    .filter(player => player.camp === 'local' && player.tier === 1 && player.status === 'available')
    .forEach(player => { player.status = 'disabled'; });
  const weighted = H.shopEngine.generate('c1', { round: 3 });
  assert(weighted.cards.every(card => card.tier !== 1), '空费用时应移除无可抽费用并用其他费用等比放大');
}

function testAssignmentHardGuards() {
  const { H } = createReadyHarness();
  const localCaptain = H.state.captains.find(captain => H.selectors.captainCamp(captain.id) === 'local');
  const outsiderPlayer = H.state.players.find(player => player.camp === 'outsider' && player.status === 'available');
  const captainPlayer = H.selectors.captainPlayer(localCaptain.id);

  assert(!H.assignmentEngine.assign(localCaptain.id, outsiderPlayer.id, 'gold_shop_purchase'), '入队层应拒绝异阵营选手');
  assert(!H.assignmentEngine.purchase(localCaptain.id, outsiderPlayer.id, 'gold_shop_purchase').ok, '购买异阵营选手应被拒绝');
  assert(!H.assignmentEngine.purchase(localCaptain.id, captainPlayer.id, 'gold_shop_purchase').ok, '队长锁定选手不可被购买');
}

function testCampChecklistAllowsDraftedPlayers() {
  const { H } = createReadyHarness();
  const localCaptain = H.state.captains.find(captain => H.selectors.captainCamp(captain.id) === 'local');
  const localPlayer = H.state.players.find(player =>
    player.camp === 'local'
    && player.status === 'available'
    && !H.selectors.isCaptainPlayer(player.id)
  );

  assert(H.assignmentEngine.purchase(localCaptain.id, localPlayer.id, 'gold_shop_purchase').ok, '测试前提：本地队长应能购买本地队员');
  const campItem = H.selectors.workflowChecklist().items.find(item => item.id === 'camp-count');

  assert(campItem && campItem.status === 'pass', '已入队队员不应导致阵营人数门禁失败');
}

function testPurchasedShopCardIsMarked() {
  const { H, app } = createReadyHarness();
  H.actions.drawCards();
  const selectedSlot = H.state.draft.currentDraw.cards[0];
  const expectedTierClass = `tier-${selectedSlot.price || selectedSlot.tier}`;
  assert(app.innerHTML.includes(expectedTierClass), '商店卡片应按费用渲染费用边框类');
  H.state.draft.selectedSlot = 0;

  H.actions.pickCard();

  assert(H.state.draft.currentDraw.cards[0].purchased, '购买成功后当前商店卡应标记为已购买');
  assert(app.innerHTML.includes('shop-empty-slot'), '购买成功后商店原位置应显示为空槽');
  assert(!app.innerHTML.includes('purchased-card'), '购买成功后不应继续显示已购买卡片');
}

function testUndoRestoresShopPermissions() {
  const { H } = createReadyHarness();
  const captain = currentCaptain(H);
  assert(H.state.draft.currentDraw && H.state.draft.currentDraw.captainId === captain.id, '测试前提：默认应已为当前队长打开免费商店');
  if (H.state.draft.currentDraw.cards && H.state.draft.currentDraw.cards[0]) {
    H.state.draft.currentDraw.cards[0].tier = 1;
    H.state.draft.currentDraw.cards[0].price = 1;
  }
  const goldAfterFreeShop = captain.economy.gold;
  const refreshCountAfterFreeShop = H.economyEngine.roundState(captain.id).refreshCount;
  const refreshCost = H.economyEngine.nextRefreshCost(captain.id);
  assert(refreshCost > 0, '测试前提：本用例应覆盖付费刷新而不是第一轮补1费免费刷新');

  H.actions.refreshShop();
  assert(captain.economy.gold === goldAfterFreeShop - refreshCost, '测试前提：付费刷新应扣除当前刷新费用');
  assert(H.economyEngine.roundState(captain.id).refreshCount === refreshCountAfterFreeShop + 1, '测试前提：付费刷新次数应增加');

  H.actions.undo();
  const restoredRefreshCaptain = H.state.captains.find(item => item.id === captain.id);
  const restoredRefreshState = H.economyEngine.roundState(captain.id);
  assert(restoredRefreshCaptain.economy.gold === goldAfterFreeShop, '撤销付费刷新后应返还金币');
  assert(restoredRefreshState.freeShopUsed && restoredRefreshState.refreshCount === refreshCountAfterFreeShop, '撤销付费刷新后应返还刷新权限计数');
  assert(!restoredRefreshState.purchaseUsed && !restoredRefreshState.skipped, '撤销付费刷新后购买权限不应作废');

  H.actions.skipTurn();
  H.actions.undo();
  const restoredSkipState = H.economyEngine.roundState(captain.id);
  assert(currentCaptain(H).id === captain.id, '撤销跳过后应回到原队长');
  assert(restoredSkipState.freeShopUsed && !restoredSkipState.purchaseUsed && !restoredSkipState.skipped, '撤销跳过后应返还当前轮购买和刷新权限');
  assert(H.state.draft.currentDraw && H.state.draft.currentDraw.captainId === captain.id, '撤销跳过后应恢复原商店');
}

function testFinalFillSameCamp() {
  const { H } = createReadyHarness();
  skipUntilCompleted(H);
  H.state.captains.forEach(captain => {
    const camp = H.selectors.captainCamp(captain.id);
    assert(captain.team.length === 4, `${captain.name} 应补满4名队员`);
    assert(captain.team.every(playerId => playerById(H, playerId).camp === camp), `${captain.name} 最终补位不能跨阵营`);
  });
}

function testPlayersUiAndImport() {
  const { H, app } = createReadyHarness();
  H.actions.setActiveView('players');
  assert(app.innerHTML.includes('本地人卡池 25/25'), '选手库应展示本地人卡池');
  assert(app.innerHTML.includes('外地人卡池 25/25'), '选手库应展示外地人卡池');
  assert(app.innerHTML.includes('队长锁定'), '队长应在费用池中显示队长锁定标记');
  assert(app.innerHTML.includes('费边界'), '选手卡应展示费用池边界解释');
  assert(app.innerHTML.includes('队长已从普通池剔除后按剩余人数五档重分'), '选手卡应说明队长剔除后重新分池');

  const csv = [
    'name,gameId,lane,camp,score,S1,S2,S3,S4,S5,S6',
    '测试本地,TEST_LOCAL,中路,本地人,88,冠军,亚军,4强,1轮游,冠军,4强',
  ].join('\n');
  const parsed = H.exportService.parsePlayerImport('players.csv', csv);
  assert(parsed[0].camp === 'local', '导入应识别本地人阵营');

  let error = '';
  try {
    H.exportService.parsePlayerImport('players.csv', 'name,gameId,lane,score\n缺阵营,NO_CAMP,中路,70');
  } catch (caught) {
    error = caught.message;
  }
  assert(error.includes('阵营'), '缺少阵营字段时应导入失败');

  H.state.players = H.state.players.slice(0, 10);
  const initialPlayerCount = H.state.players.length;
  const previewCsv = [
    'name,gameId,lane,camp,score',
    '预览本地,PREVIEW_LOCAL,上路,本地人,76',
    '缺阵营,NO_CAMP,中路,,70',
    '坏评分,BAD_SCORE,打野,外地人,999',
    '重复选手,PREVIEW_LOCAL,辅助,本地人,66',
  ].join('\n');
  const preview = H.exportService.buildPlayerImportPreview('preview.csv', previewCsv, H.state.players);
  assert(preview.totalRows === 4, '导入预览应统计总行数');
  assert(preview.accepted.length === 1, '导入预览应只接收有效且未重复的选手');
  assert(preview.skipped.length === 3, '导入预览应统计跳过总数');
  assert(preview.stats.missingCamp === 1, '导入预览应单独统计阵营缺失');
  assert(preview.stats.invalidScore === 1, '导入预览应单独统计非法评分');
  assert(preview.stats.duplicateGameId === 1, '导入预览应单独统计重复 ID');

  H.state.captains.forEach(captain => {
    captain.team = [];
    captain.economy = captain.economy || {};
    captain.economy.roundState = {};
  });
  H.state.draft.currentDraw = null;
  H.state.draft.pickedThisTurn = null;
  H.state.draft.phase = 'setup';
  H.state.draft.round = 1;
  H.actions.importPlayers({ name: 'preview.csv', content: previewCsv });
  assert(H.state.players.length === initialPlayerCount, '导入预览确认前不应写入状态');
  assert(H.state.ui.playerImportPreview.accepted.length === 1, '导入动作应先生成预览');
  H.actions.confirmPlayerImport();
  assert(H.state.players.length === initialPlayerCount + 1, '确认导入后才写入有效选手');
}

function testFullTenTeamGoldShopFlow() {
  const { H } = createHarness();
  H.actions.resetLocalState();
  const rows = ['name,gameId,lane,camp,score,S1,S2,S3,S4,S5,S6'];
  for (let index = 1; index <= 25; index += 1) {
    rows.push(`本地流程${index},LOCAL_FLOW_${index},全能,本地人,${100 - index},冠军,亚军,4强,1轮游,冠军,4强`);
  }
  for (let index = 1; index <= 25; index += 1) {
    rows.push(`外地流程${index},OUT_FLOW_${index},全能,外地人,${100 - index},冠军,亚军,4强,1轮游,冠军,4强`);
  }
  H.actions.importPlayers({ name: 'full-flow.csv', content: rows.join('\n') });
  assert(H.state.ui.playerImportPreview.accepted.length === 50, '完整流程导入预览应接收50名选手');
  H.actions.confirmPlayerImport();
  assert(H.state.players.length === 50, '完整流程确认导入后应写入50名选手');

  const localCaptains = H.state.players.filter(player => player.camp === 'local').slice(0, 5);
  const outsiderCaptains = H.state.players.filter(player => player.camp === 'outsider').slice(0, 5);
  [...localCaptains, ...outsiderCaptains].forEach(player => H.actions.promotePlayerToCaptain(player.id));
  assert(H.state.captains.filter(captain => captain.playerId).length === 10, '完整流程应配置10名队长');
  assert(H.selectors.workflowStatus().captainReady, '完整流程队长配置应通过门禁');

  const flowHexcores = [
    'camp-scout',
    'discount-coupon',
    'reserved-seat',
    'urgent-restock',
    'steady-reinforce',
    'donation',
    'sponsor-flow',
    'open-feast',
    'vampiric-habit',
    'giant-slayer',
  ];
  H.state.captains.forEach((captain, index) => {
    H.state.hexcoreAssignments[captain.id] = [assignedHexcore(H.sampleData.hexcores.find(hex => hex.id === flowHexcores[index]))];
  });
  assert(H.selectors.workflowStatus().playersDraftReady, '完整流程应允许进入金币商店四轮选人');

  H.state.draft = {
    ...H.state.draft,
    phase: 'captain_action',
    round: 1,
    maxRounds: 4,
    baseOrder: H.state.captains.map(captain => captain.id),
    currentOrder: H.state.captains.map(captain => captain.id),
    currentIndex: 0,
    currentDraw: null,
    pickedThisTurn: false,
    selectedSlot: 0,
    runtimeEffects: [],
  };
  H.economyEngine.ensureAll();
  runGoldDraftToCompletion(H);
  H.state.captains.forEach(captain => {
    assert(captain.team.length === 4, `${captain.name} 四轮后应拥有4名队员`);
    const camp = H.selectors.captainCamp(captain.id);
    assert(captain.team.every(playerId => playerById(H, playerId).camp === camp), `${captain.name} 不应抽到跨阵营队员`);
  });

  H.actions.generateTournamentSchedule();
  assert(H.state.tournament.rounds.length >= 1, '完整流程完成后应能生成淘汰赛赛程');
}

function testRenderKeepsPageScroll() {
  const { H, workspaceMain } = createReadyHarness();
  H.actions.setActiveView('players');
  workspaceMain.scrollTop = 620;
  const localCandidate = H.state.players.find(player =>
    player.camp === 'local'
    && player.status === 'available'
    && !H.selectors.isCaptainPlayer(player.id)
  );

  H.actions.promotePlayerToCaptain(localCandidate.id);

  assert(workspaceMain.scrollTop === 620, '点击设为队长后选手库滚动位置应保持不变');
}

function testTeamIssueDetectionAndRepair() {
  const { H, app } = createReadyHarness();
  const captain = H.state.captains[0];
  const candidates = H.state.players.filter(player => !H.selectors.isCaptainPlayer(player.id));
  const keeper = candidates[0];
  const disabled = candidates[1];
  keeper.status = 'picked';
  keeper.teamId = captain.id;
  disabled.status = 'disabled';
  disabled.teamId = captain.id;
  captain.team = [keeper.id, keeper.id, 'missing-player-id', disabled.id];
  H.state.draft.currentDraw = null;
  H.state.draft.pickedThisTurn = false;
  H.state.draft.phase = 'setup';
  H.state.draft.round = 1;

  H.actions.setActiveView('teams');
  assert(app.innerHTML.includes('重复归属'), '队伍异常识别应显示重复归属');
  assert(app.innerHTML.includes('缺失选手'), '队伍异常识别应显示缺失选手');
  assert(app.innerHTML.includes('已禁用'), '队伍异常识别应显示失效选手');
  assert(app.innerHTML.includes('修复异常'), '存在可修复异常时应显示修复入口');

  H.actions.repairTeamIssues(captain.id);
  assert(captain.team.length === 1 && captain.team[0] === keeper.id, `修复异常应清理重复、缺失和禁用成员，当前：${captain.team.join(',')}`);
  assert(disabled.status === 'disabled', '修复异常不应把禁用选手恢复为可选');
  assert(keeper.teamId === captain.id && keeper.status === 'drafted', '修复异常应保留有效成员归属');
}

function testGoldModeAllowsManualMoveBackToPool() {
  const { H } = createReadyHarness();
  const captain = H.state.captains[0];
  const player = H.state.players.find(item =>
    item.camp === H.selectors.captainCamp(captain.id)
    && !H.selectors.isCaptainPlayer(item.id)
    && item.status === 'available'
  );
  player.status = 'drafted';
  player.teamId = captain.id;
  captain.team = [player.id];
  H.state.draft.round = 4;
  H.state.draft.phase = 'captain_action';

  H.actions.removePlayerFromTeam(captain.id, player.id);

  assert(!captain.team.includes(player.id), '金币模式下移回池应从队伍移除该队员');
  assert(player.status === 'available' && !player.teamId, '金币模式下移回池应恢复选手可选状态');
  assert(H.state.events[0] && H.state.events[0].title === '队伍纠错', '金币模式下移回池应写入队伍纠错日志');

  H.actions.assignPlayerToTeam(captain.id, player.id);
  assert(captain.team.includes(player.id), '金币模式下纠错补录应允许同阵营可选选手回到队伍');
  assert(player.status === 'drafted' && player.teamId === captain.id, '金币模式下纠错补录应同步选手归属');
  assert(H.state.events[0] && H.state.events[0].title === '队伍纠错', '金币模式下纠错补录应写入队伍纠错日志');
}

function testSystemIntegrityCheck() {
  const { H, app } = createReadyHarness();
  const captain = H.state.captains[0];
  const otherCampPlayer = H.state.players.find(player =>
    player.camp !== H.selectors.captainCamp(captain.id)
    && !H.selectors.isCaptainPlayer(player.id)
  );
  otherCampPlayer.status = 'drafted';
  otherCampPlayer.teamId = captain.id;
  captain.team = [otherCampPlayer.id, otherCampPlayer.id];
  H.state.draft.baseOrder.push(captain.id);

  H.actions.setActiveView('settings');
  H.actions.runSystemCheck();

  assert(H.state.ui.systemCheckResult && !H.state.ui.systemCheckResult.ok, '状态检查应保存可视化结果');
  assert(H.state.ui.systemCheckResult.issues.some(issue => issue.type === '重复归属'), '状态检查应识别重复归属');
  assert(H.state.ui.systemCheckResult.issues.some(issue => issue.type === '跨阵营'), '状态检查应识别跨阵营');
  assert(H.state.ui.systemCheckResult.issues.some(issue => issue.type === '顺位异常'), '状态检查应识别顺位异常');
  assert(app.innerHTML.includes('状态完整性检查'), '系统设置页应显示完整性检查面板');
  assert(app.innerHTML.includes('需处理'), '系统设置页应显示检查状态');
  assert(app.innerHTML.includes('修复完整性异常'), '系统设置页应提供完整性异常修复入口');

  H.actions.repairSystemIntegrityIssues();
  assert(!captain.team.includes(otherCampPlayer.id), '完整性修复应移出非法跨阵营队员');
  assert(otherCampPlayer.status === 'available' && !otherCampPlayer.teamId, '完整性修复应把非法队员退回可选池');
  assert(H.state.ui.systemCheckResult.issues.every(issue => issue.type !== '跨阵营'), '完整性修复后不应继续报告已修复的跨阵营异常');
}

function testSystemIntegrityCheckMatchesCurrentRules() {
  const { H } = createReadyHarness();
  H.actions.setActiveView('settings');
  H.actions.runSystemCheck();
  assert(H.state.ui.systemCheckResult && H.state.ui.systemCheckResult.ok, '干净状态下完整性检查不应误报卡池异常');

  const captain = H.state.captains[0];
  const otherCampPlayer = H.state.players.find(player =>
    player.camp !== H.selectors.captainCamp(captain.id)
    && !H.selectors.isCaptainPlayer(player.id)
    && player.status === 'available'
  );
  otherCampPlayer.status = 'drafted';
  otherCampPlayer.teamId = captain.id;
  otherCampPlayer.teamBypassReason = 'stuck_together';
  captain.team = [otherCampPlayer.id];

  H.actions.runSystemCheck();
  assert(
    !H.state.ui.systemCheckResult.issues.some(issue => issue.type === '跨阵营'),
    '和我困在一起记录的合法跨阵营入队不应被完整性检查误报'
  );
}

function testNavigationResetsPageScroll() {
  const { H, workspaceMain } = createReadyHarness();
  H.actions.setActiveView('players');
  workspaceMain.scrollTop = 680;

  H.actions.setActiveView('draft');

  assert(H.state.ui.activeView === 'draft', '应能切回实时抽选页');
  assert(workspaceMain.scrollTop === 0, '从选手库切回实时抽选页时应回到页面顶部');
}

function testNewHexcores() {
  const { H } = createReadyHarness();
  const captain = currentCaptain(H);
  H.state.draft.currentDraw = null;
  H.economyEngine.roundState(captain.id).freeShopUsed = false;

  assert(H.hexcoreEngine.activate('camp-scout').ok, '阵营侦察应可在开店前使用');
  H.actions.drawCards();
  assert(H.state.draft.currentDraw.cards.length >= 5, '阵营侦察应保留商店生成能力');

  const failScout = createReadyHarness().H;
  failScout.actions.drawCards();
  assert(!failScout.hexcoreEngine.activate('camp-scout').ok, '阵营侦察在商店打开后应失败');

  const discount = createReadyHarness().H;
  discount.state.draft.currentIndex = 4;
  const discountCaptain = currentCaptain(discount);
  setOnlyHexcore(discount, discountCaptain.id, 'discount-coupon');
  discount.actions.drawCards();
  const beforeGold = discountCaptain.economy.gold;
  assert(discount.hexcoreEngine.activate('discount-coupon').ok, '压价券应可在购买前使用');
  discount.state.draft.selectedSlot = 0;
  const discountPlayer = playerById(discount, discount.state.draft.currentDraw.cards[0].playerId);
  discount.actions.pickCard();
  assert(discountCaptain.economy.gold === beforeGold - Math.max(1, discountPlayer.tier - 1), '压价券应降低本次购买费用');

  const reserve = createReadyHarness().H;
  reserve.state.draft.currentIndex = 1;
  setOnlyHexcore(reserve, currentCaptain(reserve).id, 'reserved-seat');
  reserve.actions.drawCards();
  const reservedPlayerId = reserve.state.draft.currentDraw.cards[0].playerId;
  assert(reserve.hexcoreEngine.activate('reserved-seat', { shopCardIndex: 0 }).ok, '保留席位应能保留当前商店卡');
  reserve.actions.refreshShop();
  assert(reserve.state.draft.currentDraw.cards.some(card => card.playerId === reservedPlayerId), '刷新后应保留指定卡');

  const restock = createReadyHarness().H;
  restock.state.draft.currentIndex = 2;
  setOnlyHexcore(restock, currentCaptain(restock).id, 'urgent-restock');
  restock.actions.drawCards();
  let restockShown = new Set(restock.state.draft.currentDraw.cards.map(card => card.playerId));
  let restockIndex = restock.state.draft.currentDraw.cards.findIndex(card => {
    const player = playerById(restock, card.playerId);
    return player && restock.selectors.availableCampPlayers(currentCaptain(restock).id, restockShown)
      .some(candidate => candidate.tier === player.tier);
  });
  if (restockIndex < 0) {
    const firstCard = restock.state.draft.currentDraw.cards[0];
    const firstPlayer = playerById(restock, firstCard.playerId);
    const fallback = restock.selectors.availableCampPlayers(currentCaptain(restock).id, restockShown)[0];
    if (firstPlayer && fallback) fallback.tier = firstPlayer.tier;
    restockShown = new Set(restock.state.draft.currentDraw.cards.map(card => card.playerId));
    restockIndex = 0;
  }
  assert(restockIndex >= 0, '测试前提：当前商店应存在可加急调货的卡槽');
  const oldPlayerId = restock.state.draft.currentDraw.cards[restockIndex].playerId;
  assert(restock.hexcoreEngine.activate('urgent-restock', { shopCardIndex: restockIndex }).ok, '加急调货应能替换同阵营同费用卡');
  assert(restock.state.draft.currentDraw.cards[restockIndex].playerId !== oldPlayerId, '加急调货后目标卡应变化');

  const blockade = createReadyHarness().H;
  blockade.state.draft.currentIndex = 2;
  blockade.state.draft.currentDraw = null;
  setOnlyHexcore(blockade, currentCaptain(blockade).id, 'camp-blockade');
  assert(blockade.hexcoreEngine.activate('camp-blockade', { targetCaptainId: 'c6' }).ok, '阵营封锁应能选择任意阵营队长');
  blockade.state.draft.currentIndex = 3;
  blockade.actions.drawCards();
  blockade.state.draft.currentIndex = 5;
  blockade.state.draft.currentDraw = null;
  blockade.economyEngine.roundState('c6').freeShopUsed = false;
  blockade.actions.drawCards();
  assert(blockade.state.draft.currentDraw.cards.length === 4, '阵营封锁生效后目标队长商店应少展示1张卡');
  const delayedBlockade = createReadyHarness().H;
  delayedBlockade.state.draft.currentIndex = 2;
  delayedBlockade.state.draft.currentDraw = null;
  setOnlyHexcore(delayedBlockade, currentCaptain(delayedBlockade).id, 'camp-blockade');
  assert(delayedBlockade.hexcoreEngine.activate('camp-blockade', { targetCaptainId: 'c1' }).ok, '阵营封锁可对本轮已行动队长使用并延迟到下轮生效');

  const { H: price, app: priceApp } = createReadyHarness();
  price.state.draft.currentIndex = 3;
  price.state.draft.currentDraw = null;
  setOnlyHexcore(price, currentCaptain(price).id, 'price-interference');
  assert(price.hexcoreEngine.activate('price-interference', { targetCaptainId: 'c6' }).ok, '抬价干扰应能选择任意阵营队长');
  assert(price.hexcoreEngine.effectStatusForCaptain('c6').some(effect => effect.label.includes('购买费用 +1')), '抬价干扰应在目标队长状态中显示待生效');
  price.state.draft.currentIndex = 5;
  price.actions.drawCards();
  assert(priceApp.innerHTML.includes('+1') && priceApp.innerHTML.includes('shop-price-badge'), '抬价干扰目标商店卡应显示醒目的+1费用标记');
  const priceCaptain = currentCaptain(price);
  const priceBeforeGold = priceCaptain.economy.gold;
  const pricePlayer = playerById(price, price.state.draft.currentDraw.cards[0].playerId);
  price.state.draft.selectedSlot = 0;
  price.actions.pickCard();
  assert(priceCaptain.economy.gold === priceBeforeGold - pricePlayer.tier - 1, '抬价干扰生效后购买费用应实际增加1金币');
  assert(price.state.draft.currentDraw.purchaseEffects.some(effect => effect.type === 'price_interference'), '购买后应记录已生效的抬价干扰');

  const sponsor = createReadyHarness().H;
  const sponsorCaptain = currentCaptain(sponsor);
  setOnlyHexcore(sponsor, sponsorCaptain.id, 'sponsor-flow');
  const sponsorPlayer = sponsor.state.players.find(player => player.camp === 'local' && player.tier >= 3 && player.status === 'available');
  sponsorCaptain.economy.gold = 10;
  const sponsorBeforeGold = sponsorCaptain.economy.gold;
  sponsor.assignmentEngine.purchase(sponsorCaptain.id, sponsorPlayer.id, 'gold_shop_purchase');
  assert(sponsorCaptain.sponsorFlowUsed === 1 && sponsorCaptain.economy.gold === sponsorBeforeGold - sponsorPlayer.tier + 1, '赞助回流应在购买3费及以上选手后返还1金币');

  const giant = createReadyHarness().H;
  const giantCaptain = giant.state.captains.find(captain => (giant.state.hexcoreAssignments[captain.id] || []).some(hex => hex.id === 'giant-slayer'));
  const giantPlayer = giant.state.players.find(player => player.camp === giant.selectors.captainCamp(giantCaptain.id) && player.tier === 4 && player.status === 'available');
  giantCaptain.economy.gold = 10;
  const giantBeforeGold = giantCaptain.economy.gold;
  giant.assignmentEngine.purchase(giantCaptain.id, giantPlayer.id, 'gold_shop_purchase');
  assert(giantCaptain.giantSlayerDiscountUsed[4] && giantCaptain.economy.gold === giantBeforeGold - 3, '巨人杀手首次购买4费卡应优惠1金币');

  const donation = createReadyHarness().H;
  const donationCaptain = currentCaptain(donation);
  const donationBeforeGold = donationCaptain.economy.gold;
  releaseHexcoreEverywhere(donation, 'donation');
  donation.state.hexcoreAssignments[donationCaptain.id] = [];
  donationCaptain.hexcoreEconomy = { ...(donationCaptain.hexcoreEconomy || {}), donationApplied: false };
  donation.actions.assignHexcoreToCaptain(donationCaptain.id, 'donation');
  assert(donationCaptain.economy.gold === donationBeforeGold + 2, '捐赠被分配后应立刻增加2金币');

  const feast = createReadyHarness().H;
  const feastCaptain = feast.state.captains.find(captain => (feast.state.hexcoreAssignments[captain.id] || []).some(hex => hex.id === 'open-feast'));
  feast.state.draft.round = 3;
  const feastBeforeGold = feastCaptain.economy.gold;
  feast.economyEngine.applyRoundIncome(3);
  assert(feastCaptain.economy.gold === feastBeforeGold + feast.state.settings.roundIncome + 3, '开饭啦应在第3轮额外获得3金币');

  const photo = createReadyHarness().H;
  const photoCaptain = photo.state.captains.find(captain => (photo.state.hexcoreAssignments[captain.id] || []).some(hex => hex.id === 'photographer'));
  drawForCaptain(photo, photoCaptain.id);
  const photoBeforeGold = photoCaptain.economy.gold;
  photo.actions.refreshShop();
  assert(photoCaptain.economy.gold === photoBeforeGold && photo.economyEngine.roundState(photoCaptain.id).photographerRefreshUsed, '摄影艺术家每轮第一次刷新应免费且不累计到额外金币消耗');

  const ballroom = createReadyHarness().H;
  const ballroomCaptain = currentCaptain(ballroom);
  ballroom.state.hexcoreAssignments[ballroomCaptain.id] = [
    { ...ballroom.sampleData.hexcores.find(hex => hex.id === 'ballroom-queen'), status: 'passive' },
  ];
  ballroom.state.draft.currentDraw = ballroom.shopEngine.generate(ballroomCaptain.id, { generatedBy: 'test' });
  assert(ballroom.state.draft.currentDraw.cards.length > 0, '舞会女王应正常生成商店');
  assert(ballroom.state.draft.currentDraw.cards.every(card => card.tier >= 3 && card.tier <= 5), '舞会女王高费充足时商店不应展示1/2费卡');
  assert(ballroom.state.draft.currentDraw.appliedEffects.some(effect => effect.type === 'ballroom_queen' && !effect.degraded), '舞会女王高费充足时应记录只抽3-5费效果');

  const ballroomFallback = createReadyHarness().H;
  const ballroomFallbackCaptain = currentCaptain(ballroomFallback);
  ballroomFallback.state.hexcoreAssignments[ballroomFallbackCaptain.id] = [
    { ...ballroomFallback.sampleData.hexcores.find(hex => hex.id === 'ballroom-queen'), status: 'passive' },
  ];
  let keptHighTier = 0;
  ballroomFallback.state.players
    .filter(player => player.camp === ballroomFallback.selectors.captainCamp(ballroomFallbackCaptain.id) && player.tier >= 3 && player.status === 'available')
    .forEach(player => {
      if (keptHighTier < 2) {
        keptHighTier += 1;
        return;
      }
      player.status = 'drafted';
      player.teamId = 'test_taken';
    });
  ballroomFallback.state.draft.currentDraw = ballroomFallback.shopEngine.generate(ballroomFallbackCaptain.id, { generatedBy: 'test' });
  assert(ballroomFallback.state.draft.currentDraw.cards.some(card => card.tier < 3), '舞会女王高费不足时应允许降级补足1/2费卡');
  assert(ballroomFallback.state.draft.currentDraw.appliedEffects.some(effect => effect.type === 'ballroom_queen' && effect.degraded), '舞会女王降级时应记录明确降级原因');

  const tierOneRefresh = createReadyHarness().H;
  const tierOneCaptain = currentCaptain(tierOneRefresh);
  const tierTwoCards = tierOneRefresh.state.players
    .filter(player => player.camp === tierOneRefresh.selectors.captainCamp(tierOneCaptain.id) && player.tier === 2 && player.status === 'available')
    .slice(0, 3);
  tierOneRefresh.state.draft.currentDraw = {
    id: 'test_no_tier_one',
    captainId: tierOneCaptain.id,
    round: 1,
    pickMode: 'shop',
    generatedBy: 'free_shop',
    cards: tierTwoCards.map((player, index) => ({ slotId: `slot_${index + 1}`, playerId: player.id, tier: player.tier, price: player.tier })),
    appliedEffects: [],
  };
  tierOneRefresh.economyEngine.roundState(tierOneCaptain.id).freeShopUsed = true;
  const tierOneBeforeGold = tierOneCaptain.economy.gold;
  assert(tierOneRefresh.economyEngine.nextRefreshCost(tierOneCaptain.id) === 0, '第一轮商店未出现1费且仍有1费池时应允许免费刷新');
  tierOneRefresh.actions.refreshShop();
  assert(tierOneCaptain.economy.gold === tierOneBeforeGold, '第一轮补1费刷新不应扣金币');

  const noTierOne = createReadyHarness().H;
  const noTierOneCaptain = currentCaptain(noTierOne);
  noTierOne.state.players
    .filter(player => player.camp === noTierOne.selectors.captainCamp(noTierOneCaptain.id) && player.tier === 1)
    .forEach(player => {
      player.status = 'drafted';
      player.teamId = 'test_taken';
    });
  const noTierOneTierTwoCards = noTierOne.state.players
    .filter(player => player.camp === noTierOne.selectors.captainCamp(noTierOneCaptain.id) && player.tier === 2 && player.status === 'available')
    .slice(0, 3);
  noTierOne.state.draft.currentDraw = {
    id: 'test_no_tier_one_pool',
    captainId: noTierOneCaptain.id,
    round: 1,
    pickMode: 'shop',
    generatedBy: 'free_shop',
    cards: noTierOneTierTwoCards.map((player, index) => ({ slotId: `slot_${index + 1}`, playerId: player.id, tier: player.tier, price: player.tier })),
    appliedEffects: [],
  };
  noTierOne.economyEngine.roundState(noTierOneCaptain.id).freeShopUsed = true;
  assert(noTierOne.economyEngine.nextRefreshCost(noTierOneCaptain.id) > 0, '同阵营1费池耗尽后不应继续触发补1费免费刷新');

  const wise = createReadyHarness().H;
  const wiseCaptain = wise.state.captains.find(captain => (wise.state.hexcoreAssignments[captain.id] || []).some(hex => hex.id === 'wise-benevolence'));
  wise.state.draft.round = 2;
  wise.state.draft.currentDraw = null;
  wise.state.draft.currentOrder = wise.state.captains.map(captain => captain.id);
  wise.state.draft.currentIndex = wise.state.draft.currentOrder.indexOf(wiseCaptain.id);
  const wiseBeforeGold = wiseCaptain.economy.gold;
  wise.actions.drawCards();
  assert(wiseCaptain.economy.gold === wiseBeforeGold + wise.state.settings.roundIncome + 2, `贤者的博爱应在该队长第2轮选人阶段额外获得2金币，前 ${wiseBeforeGold}，后 ${wiseCaptain.economy.gold}，收入 ${wise.state.settings.roundIncome}`);
  assert(wiseCaptain.hexcoreEconomy.wiseBenevolenceRefreshCredits === 1, '贤者的博爱应累计1次免费刷新次数');
  assert(wise.economyEngine.roundState(wiseCaptain.id, 2).wiseBenevolenceApplied, `贤者的博爱本轮应记录已触发，防止刷新时重复发放，当前轮 ${wise.state.draft.round}，状态 ${JSON.stringify(wiseCaptain.economy.roundState)}`);
  wise.state.draft.currentDraw = {
    id: 'wise_refresh_test',
    captainId: wiseCaptain.id,
    round: 2,
    pickMode: 'shop',
    generatedBy: 'free_shop',
    cards: [],
    appliedEffects: [],
  };
  wise.economyEngine.roundState(wiseCaptain.id, 2).freeShopUsed = true;
  assert(wise.economyEngine.nextRefreshCost(wiseCaptain.id) === 0 && wise.economyEngine.nextRefreshReason(wiseCaptain.id) === 'wise_benevolence', '贤者的博爱累计刷新次数应让下一次刷新免费');
  const wiseRefreshGold = wiseCaptain.economy.gold;
  wise.actions.refreshShop();
  assert(wiseCaptain.economy.gold === wiseRefreshGold, `贤者的博爱免费刷新不应扣金币，刷新前 ${wiseRefreshGold}，刷新后 ${wiseCaptain.economy.gold}`);
  assert(wiseCaptain.hexcoreEconomy.wiseBenevolenceRefreshCredits === 0, `贤者的博爱免费刷新应消耗1次累计刷新次数，当前剩余 ${wiseCaptain.hexcoreEconomy.wiseBenevolenceRefreshCredits}`);

  const origin = createReadyHarness().H;
  const originCaptain = origin.state.captains[2];
  releaseHexcoreEverywhere(origin, 'origin-sage');
  origin.state.hexcoreAssignments[originCaptain.id] = [];
  const originBeforeGold = originCaptain.economy.gold;
  origin.actions.assignHexcoreToCaptain(originCaptain.id, 'origin-sage');
  assert(originCaptain.economy.gold === originBeforeGold + 2, '神秘贤者·启元获得时应初始资金+2');
  origin.state.draft.currentOrder = origin.state.captains.map(captain => captain.id);
  origin.state.draft.currentIndex = origin.state.draft.currentOrder.indexOf(originCaptain.id);
  origin.state.draft.currentDraw = null;
  origin.state.draft.pickedThisTurn = false;
  origin.economyEngine.roundState(originCaptain.id).purchaseUsed = false;
  const originBeforeIndex = origin.state.draft.currentOrder.indexOf(originCaptain.id);
  assert(originBeforeIndex > 0, '测试前提：启元使用者应不是第一顺位');
  assert(origin.hexcoreEngine.activate('origin-sage').ok, '神秘贤者·启元应可在商店打开前发动');
  assert(origin.state.draft.currentOrder[0] === originCaptain.id, '神秘贤者·启元应将使用者提到本轮第一顺位');
  assert(origin.state.draft.currentIndex === 0, '神秘贤者·启元发动后当前索引应指向使用者');
  assert(!origin.hexcoreEngine.activate('origin-sage').ok, '神秘贤者·启元同轮不能重复发动');

  const vampire = createReadyHarness().H;
  vampire.state.draft.currentIndex = 6;
  const vampireCaptain = currentCaptain(vampire);
  const vampireBeforeGold = vampireCaptain.economy.gold;
  assert(vampire.hexcoreEngine.activate('vampiric-habit').ok, '吸血习性应可从金币最高的其他队长处吸取金币');
  assert(vampireCaptain.economy.gold === vampireBeforeGold + 3, '吸血习性应最多获得3金币');

  const steady = createReadyHarness().H;
  steady.state.draft.currentIndex = 2;
  const steadyCaptain = currentCaptain(steady);
  setOnlyHexcore(steady, steadyCaptain.id, 'steady-reinforce');
  assert(steady.hexcoreEngine.activate('steady-reinforce').ok, '稳健补强应从同阵营最低费用池分配');
  const steadyPlayer = playerById(steady, steadyCaptain.team[0]);
  assert(steadyCaptain.team.length === 1, '稳健补强成功后应入队1人');
  assert(steadyPlayer && steadyPlayer.tier >= 2, '稳健补强重做后第1轮应至少从2费池补强');

  const decompose = createReadyHarness().H;
  const decomposeCaptain = currentCaptain(decompose);
  decompose.state.hexcoreAssignments[decomposeCaptain.id] = [
    { ...decompose.sampleData.hexcores.find(hex => hex.id === 'decompose-knowledge'), status: 'available' },
  ];
  decomposeCaptain.hexcoreEconomy = { decomposeKnowledgeStacks: 2 };
  decompose.economyEngine.roundState(decomposeCaptain.id).decomposeKnowledgeApplied = false;
  decompose.economyEngine.applyCaptainTurnStart(decomposeCaptain.id);
  assert(decomposeCaptain.hexcoreEconomy.decomposeKnowledgeStacks === 3, '知识来源于分解应在队长选人阶段开始时叠到3层');
  const decomposeTarget = decompose.hexcoreEngine.decomposeTargets(decomposeCaptain.id)[0];
  decomposeCaptain.economy.gold = Math.max(5, Number(decomposeTarget.tier) || 5);
  const decomposeResult = decompose.hexcoreEngine.activate('decompose-knowledge', { targetPlayerId: decomposeTarget.id });
  assert(decomposeResult.ok, '知识来源于分解满3层后应可自选高费目标');
  assert(decomposeCaptain.hexcoreEconomy.decomposeKnowledgeStacks === 0, '知识来源于分解发动后应消耗全部3层解构');
  assert(decomposeCaptain.team.includes(decomposeTarget.id), '知识来源于分解应将目标选手加入队伍');

  const decomposeSacrifice = createReadyHarness().H;
  const sacrificeCaptain = currentCaptain(decomposeSacrifice);
  decomposeSacrifice.state.hexcoreAssignments[sacrificeCaptain.id] = [
    { ...decomposeSacrifice.sampleData.hexcores.find(hex => hex.id === 'decompose-knowledge'), status: 'available' },
  ];
  sacrificeCaptain.hexcoreEconomy = { decomposeKnowledgeStacks: 3 };
  const sacrificePlayer = decomposeSacrifice.state.players.find(player =>
    player.camp === decomposeSacrifice.selectors.captainCamp(sacrificeCaptain.id)
    && player.status === 'available'
    && player.tier === 2
    && !decomposeSacrifice.selectors.isCaptainPlayer(player.id)
  );
  sacrificeCaptain.team.push(sacrificePlayer.id);
  sacrificePlayer.status = 'drafted';
  sacrificePlayer.teamId = sacrificeCaptain.id;
  const expensiveTarget = decomposeSacrifice.hexcoreEngine.decomposeTargets(sacrificeCaptain.id)
    .find(player => player.tier >= 4);
  sacrificeCaptain.economy.gold = Math.max(0, (Number(expensiveTarget.tier) || 4) - Number(sacrificePlayer.tier) || 0);
  const sacrificeResult = decomposeSacrifice.hexcoreEngine.activate('decompose-knowledge', {
    targetPlayerId: expensiveTarget.id,
    secondPlayerId: sacrificePlayer.id,
  });
  assert(sacrificeResult.ok, '知识来源于分解在金币不足时应允许分解2/3费队员抵扣');
  assert(sacrificePlayer.status === 'available' && !sacrificePlayer.teamId, '被分解队员应回到可选池');
  assert(sacrificeCaptain.team.includes(expensiveTarget.id), '抵扣后目标选手应加入队伍');

  const stuck = createReadyHarness().H;
  const stuckCaptain = currentCaptain(stuck);
  stuck.state.hexcoreAssignments[stuckCaptain.id] = [
    { ...stuck.sampleData.hexcores.find(hex => hex.id === 'stuck-together'), status: 'available' },
  ];
  const stuckTarget = stuck.hexcoreEngine.stuckTogetherTargets(stuckCaptain.id)
    .find(player => player.camp !== stuck.selectors.captainCamp(stuckCaptain.id));
  assert(stuckTarget, '和我困在一起目标池应包含未被选走的异阵营选手');
  assert(stuck.hexcoreEngine.activate('stuck-together', { targetPlayerId: stuckTarget.id }).ok, '和我困在一起应可指定任意未被选走的可选选手');
  assert(stuck.state.draft.runtimeEffects.some(effect => effect.type === 'stuck_together' && effect.playerId === stuckTarget.id), '和我困在一起应记录下一轮延迟检查效果');
  stuck.state.draft.round = 2;
  stuck.economyEngine.roundState(stuckCaptain.id, 2).purchaseUsed = false;
  stuck.economyEngine.roundState(stuckCaptain.id, 2).skipped = false;
  const stuckResult = stuck.hexcoreEngine.autoAssignBeforeDraw(stuckCaptain.id);
  assert(stuckResult.handled && stuckResult.assigned, '和我困在一起下一轮目标仍可选时应自动入队');
  assert(stuckCaptain.team.includes(stuckTarget.id), '和我困在一起应将锁定目标加入队伍');
  assert(stuckTarget.teamBypassReason === 'stuck_together', '和我困在一起跨阵营入队应记录规则例外来源');
  assert(stuck.economyEngine.roundState(stuckCaptain.id, 2).purchaseUsed, '和我困在一起自动入队后应消耗本轮购买权');

  const stormHarness = createReadyHarness();
  const storm = stormHarness.H;
  storm.state.draft.currentIndex = 0;
  const stormCaptain = currentCaptain(storm);
  storm.state.hexcoreAssignments[stormCaptain.id] = [
    { ...storm.sampleData.hexcores.find(hex => hex.id === 'storm-fog'), status: 'available' },
  ];
  const stormTarget = storm.state.draft.currentOrder[1];
  assert(storm.hexcoreEngine.activate('storm-fog', { targetCaptainId: stormTarget }).ok, '骤雨血雾清风应可选择顺位后方目标队长');
  const fogEffects = storm.state.draft.runtimeEffects.filter(effect => effect.type === 'weather_fog');
  assert(fogEffects.length === 3, `骤雨血雾清风应影响3名非使用者队长，当前 ${fogEffects.length}`);
  assert(fogEffects.every(effect => effect.captainId !== stormCaptain.id), '骤雨血雾清风不应影响使用者自己');
  storm.state.draft.currentIndex = storm.state.draft.currentOrder.indexOf(stormTarget);
  storm.state.draft.currentDraw = storm.shopEngine.generate(stormTarget, { generatedBy: 'free_shop' });
  assert(storm.state.draft.currentDraw.appliedEffects.some(effect => effect.type === 'weather_fog'), '受影响队长开店时应消费天气迷雾效果');
  storm.ui.render();
  assert(stormHarness.app.innerHTML.includes('weather-fog-card'), '天气迷雾商店卡应使用迷雾卡片样式');
  const fogPlayerId = storm.state.draft.currentDraw.cards[0].playerId;
  storm.state.captains.find(captain => captain.id === stormTarget).economy.gold = 20;
  const fogPurchase = storm.assignmentEngine.purchase(stormTarget, fogPlayerId, 'gold_shop_purchase');
  assert(fogPurchase.ok, `天气迷雾真实卡牌应可购买：${fogPurchase.reason || 'ok'}`);
  assert(storm.state.captains.find(captain => captain.id === stormTarget).team.includes(fogPlayerId), '天气迷雾购买后应按真实卡牌选手入队');

  const snowHarness = createReadyHarness();
  const snow = snowHarness.H;
  snow.state.draft.currentIndex = 0;
  const snowCaptain = currentCaptain(snow);
  snow.state.hexcoreAssignments[snowCaptain.id] = [
    { ...snow.sampleData.hexcores.find(hex => hex.id === 'snow-cat'), status: 'available' },
  ];
  const snowTarget = snow.state.draft.currentOrder[1];
  assert(snow.hexcoreEngine.activate('snow-cat', { targetCaptainId: snowTarget }).ok, '雪定饿的喵应可对任意未满员队长使用');
  snow.state.draft.currentIndex = snow.state.draft.currentOrder.indexOf(snowTarget);
  snow.state.draft.currentDraw = null;
  snow.actions.drawCards();
  const snowDraw = snow.state.draft.currentDraw;
  assert(snowDraw.appliedEffects.some(effect => effect.type === 'snow_cat_shuffle'), '目标开店时应消费雪定饿的喵效果');
  assert(snowDraw.cards.length > 1, '测试前提：雪定饿的喵商店应至少有2张卡');
  assert(snowDraw.cards.every(card => card.snowCatShuffled && card.displayPlayerId), '雪定饿的喵应给每张卡设置打乱后的显示身份');
  assert(snowDraw.cards.some(card => card.displayPlayerId !== card.playerId), '雪定饿的喵应至少打乱一张卡的显示身份');
  snow.ui.render();
  assert(snowHarness.app.innerHTML.includes('snow-cat-card') && snowHarness.app.innerHTML.includes('信息扰乱'), '雪定饿的喵商店卡应有信息扰乱样式');
  const snowSlotIndex = snowDraw.cards.findIndex(card => card.displayPlayerId !== card.playerId);
  const snowSlot = snowDraw.cards[snowSlotIndex];
  const snowTargetCaptain = snow.state.captains.find(captain => captain.id === snowTarget);
  const snowBeforeGold = snowTargetCaptain.economy.gold = 20;
  snow.state.draft.selectedSlot = snowSlotIndex;
  snow.actions.pickCard();
  assert(snowTargetCaptain.team.includes(snowSlot.playerId), '雪定饿的喵购买后应按真实选手入队');
  assert(snowTargetCaptain.economy.gold === snowBeforeGold - snowSlot.price, `雪定饿的喵应按显示费用扣款，显示费用 ${snowSlot.price}`);
  assert(snow.state.events.some(event => event.title === '雪定饿的喵揭示' && event.body.includes('真实选手')), '雪定饿的喵购买后应写入揭示日志');

  const snowNextHarness = createReadyHarness();
  const snowNext = snowNextHarness.H;
  snowNext.state.draft.currentIndex = 0;
  const snowNextCaptain = currentCaptain(snowNext);
  const snowNextTarget = snowNext.state.draft.currentOrder[1];
  snowNext.state.hexcoreAssignments[snowNextCaptain.id] = [
    { ...snowNext.sampleData.hexcores.find(hex => hex.id === 'snow-cat'), status: 'available' },
  ];
  assert(snowNext.hexcoreEngine.activate('snow-cat', { targetCaptainId: snowNextTarget }).ok, '雪定饿的喵应能先挂到下一位队长');
  snowNext.state.draft.selectedSlot = 0;
  snowNext.actions.pickCard();
  snowNext.actions.nextCaptain();
  assert(snowNext.selectors.currentCaptain().id === snowNextTarget, '当前队长使用雪定饿的喵并买卡后，点击下一位应推进到目标队长');
  assert(!snowNext.state.draft.currentDraw, '点击下一位后应清空上一位商店');
  assert(snowNextHarness.app.innerHTML.includes(snowNext.selectors.currentCaptain().name), '下一位后界面应渲染目标队长');

  const hungry = createReadyHarness().H;
  hungry.state.draft.currentOrder = hungry.state.captains.map(captain => captain.id);
  hungry.state.draft.currentIndex = 0;
  hungry.state.draft.currentDraw = null;
  const hungryCaptain = currentCaptain(hungry);
  hungry.state.hexcoreAssignments[hungryCaptain.id] = [
    { ...hungry.sampleData.hexcores.find(hex => hex.id === 'hungry-wave'), status: 'passive' },
  ];
  const hungryOriginalRandom = Math.random;
  Math.random = () => 0;
  hungry.actions.drawCards();
  Math.random = hungryOriginalRandom;
  assert(hungry.state.draft.currentOrder[hungry.state.draft.currentIndex] !== hungryCaptain.id, '海浪我没吃饭触发者第一顺位时应在本轮顺位中自动跳过');
  assert(hungryCaptain.economy.gold === 0, '海浪我没吃饭触发者应失去所有金币');
  assert(hungry.state.draft.runtimeEffects.some(effect => effect.type === 'hungry_wave_round' && effect.captainId === hungryCaptain.id && !effect.consumed), '海浪我没吃饭应登记本轮夺取效果');
  const hungryBuyer = currentCaptain(hungry);
  hungry.state.hexcoreAssignments[hungryBuyer.id] = [
    { ...hungry.sampleData.hexcores.find(hex => hex.id === 'price-interference'), status: 'available' },
  ];
  assert(!hungry.hexcoreEngine.activate('price-interference', { targetCaptainId: hungryCaptain.id }).ok, '海浪我没吃饭触发者本轮应免疫其他目标型海克斯');
  const hungrySlot = hungry.state.draft.currentDraw.cards[0];
  hungryBuyer.economy.gold = 20;
  hungry.state.draft.selectedSlot = 0;
  Math.random = () => 0;
  hungry.actions.pickCard();
  Math.random = hungryOriginalRandom;
  assert(hungryCaptain.team.includes(hungrySlot.playerId), '海浪我没吃饭应夺取下一名其他队长购买的真实选手');
  assert(!hungryBuyer.team.includes(hungrySlot.playerId), '被夺取的选手不应留在原购买队长队伍中');
  assert(hungryBuyer.economy.gold === 20, '海浪我没吃饭应返还原购买队长本次费用');
  assert(!hungry.economyEngine.roundState(hungryBuyer.id).purchaseUsed, '被海浪夺取后的队长应重新获得购买权');
  assert(hungry.economyEngine.nextRefreshCost(hungryBuyer.id) === 0, '被海浪夺取后的队长应获得1次免费刷新');
  assert(playerById(hungry, hungrySlot.playerId).teamId === hungryCaptain.id, '被夺取选手归属应更新为海浪持有者');

  const oppositeHungry = createReadyHarness().H;
  oppositeHungry.state.draft.baseOrder = ['c1', 'c6'];
  oppositeHungry.state.draft.currentOrder = ['c1', 'c6'];
  oppositeHungry.state.draft.currentIndex = 0;
  oppositeHungry.state.draft.currentDraw = null;
  const oppositeWaveCaptain = oppositeHungry.state.captains.find(captain => captain.id === 'c1');
  oppositeHungry.state.hexcoreAssignments[oppositeWaveCaptain.id] = [
    { ...oppositeHungry.sampleData.hexcores.find(hex => hex.id === 'hungry-wave'), status: 'passive' },
  ];
  Math.random = () => 0;
  oppositeHungry.actions.drawCards();
  Math.random = hungryOriginalRandom;
  const oppositeBuyer = oppositeHungry.selectors.currentCaptain();
  assert(oppositeBuyer.id === 'c6', '测试前提：异阵营海浪命中应轮到外地队长购买');
  assert(oppositeHungry.selectors.captainCamp(oppositeWaveCaptain.id) !== oppositeHungry.selectors.captainCamp(oppositeBuyer.id), '测试前提：海浪持有者与购买者应为异阵营');
  const oppositeSlot = oppositeHungry.state.draft.currentDraw.cards[0];
  const oppositePlayer = playerById(oppositeHungry, oppositeSlot.playerId);
  const oppositeBuyerGold = oppositeBuyer.economy.gold = 20;
  const oppositeOwnerTeamBefore = oppositeWaveCaptain.team.length;
  oppositeHungry.state.draft.selectedSlot = 0;
  Math.random = () => 0;
  oppositeHungry.actions.pickCard();
  Math.random = hungryOriginalRandom;
  assert(!oppositeWaveCaptain.team.includes(oppositeSlot.playerId), '海浪命中异阵营时不得夺取选手');
  assert(!oppositeBuyer.team.includes(oppositeSlot.playerId), '海浪命中异阵营时应从原购买队伍退回选手');
  assert(oppositePlayer.status === 'available' && !oppositePlayer.teamId, '海浪命中异阵营时应把选手恢复为可选卡池状态');
  assert(oppositeBuyer.economy.gold === oppositeBuyerGold, '海浪命中异阵营时应返还原购买队长金币');
  assert(!oppositeHungry.economyEngine.roundState(oppositeBuyer.id).purchaseUsed, '海浪命中异阵营时应返还原购买队长购买权');
  assert(oppositeHungry.economyEngine.nextRefreshCost(oppositeBuyer.id) === 0, '海浪命中异阵营时应返还1次免费刷新');
  assert(!oppositeHungry.state.draft.currentDraw.cards[0].purchased, '海浪命中异阵营时当前商店卡片应恢复可购买');
  assert(oppositeHungry.state.draft.runtimeEffects.some(effect => effect.type === 'hungry_wave_round' && effect.pendingRoundReward), '海浪命中异阵营后应登记轮末奖励');
  oppositeHungry.actions.nextCaptain();
  assert(oppositeHungry.state.draft.round === 2, '异阵营海浪轮末奖励应在进入下一轮前结算并推进轮次');
  assert(oppositeWaveCaptain.team.length === oppositeOwnerTeamBefore + 1, '异阵营海浪轮末奖励应给海浪持有者补入1名选手');
  const rewardPlayer = playerById(oppositeHungry, oppositeWaveCaptain.team[oppositeWaveCaptain.team.length - 1]);
  assert(rewardPlayer.camp === oppositeHungry.selectors.captainCamp(oppositeWaveCaptain.id), '异阵营海浪轮末奖励只能获得海浪持有者同阵营选手');
  assert(oppositeHungry.state.draft.runtimeEffects.some(effect => effect.type === 'hungry_wave_round' && effect.roundRewardResolved && effect.roundRewardPlayerId === rewardPlayer.id), '异阵营海浪轮末奖励应记录结算结果');

  const cannonHarness = createReadyHarness();
  const cannon = cannonHarness.H;
  cannon.state.draft.currentIndex = 0;
  const cannonCaptain = currentCaptain(cannon);
  cannon.state.hexcoreAssignments[cannonCaptain.id] = [
    { ...cannon.sampleData.hexcores.find(hex => hex.id === 'charged-cannon') },
  ];
  const cannonTarget = cannon.state.draft.currentOrder[1];
  const cannonBeforeIndex = cannon.state.draft.currentOrder.indexOf(cannonTarget);
  assert(cannon.hexcoreEngine.activate('charged-cannon', { firstCaptainId: 'delay', secondCaptainId: cannonTarget }).ok, '大炮已充能雷霆一击应可指定未行动队长');
  const cannonAfterIndex = cannon.state.draft.currentOrder.indexOf(cannonTarget);
  assert(cannonAfterIndex === cannonBeforeIndex + 1, `雷霆一击应让目标顺位后移一位，前 ${cannonBeforeIndex} 后 ${cannonAfterIndex}`);
  assert(!cannon.hexcoreEngine.activate('charged-cannon', { firstCaptainId: 'delay', secondCaptainId: cannon.state.draft.currentOrder[2] }).ok, '大炮已充能每轮只能使用一次');

  const boostHarness = createReadyHarness();
  const boost = boostHarness.H;
  boost.state.draft.currentIndex = 2;
  const boostCaptain = currentCaptain(boost);
  boost.state.hexcoreAssignments[boostCaptain.id] = [
    { ...boost.sampleData.hexcores.find(hex => hex.id === 'charged-cannon') },
  ];
  assert(boost.hexcoreEngine.activate('charged-cannon', { firstCaptainId: 'boost' }).ok, '大炮已充能加速之门应可让自己前移');
  assert(boost.state.draft.currentOrder.indexOf(boostCaptain.id) === 1, '加速之门应让自己本轮顺位前移一位');
  assert(boost.state.draft.currentIndex === 1, '加速之门后当前索引应仍指向使用者');

  const heavenlyHarness = createReadyHarness();
  const heavenly = heavenlyHarness.H;
  const heavenlyOwner = heavenly.state.captains.find(captain => captain.id === 'c2');
  setOnlyHexcore(heavenly, heavenlyOwner.id, 'heavenly-descent');
  const heavenlyTarget = heavenly.state.captains.find(captain => captain.id === 'c5');
  drawForCaptain(heavenly, heavenlyTarget.id);
  heavenlyTarget.economy.gold = 20;
  const heavenlyBeforeGold = heavenlyTarget.economy.gold;
  const heavenlyPlayerId = heavenly.state.draft.currentDraw.cards[0].playerId;
  heavenly.state.draft.selectedSlot = 0;
  heavenly.actions.pickCard();
  const heavenlyPaid = heavenlyBeforeGold - heavenlyTarget.economy.gold;
  assert(heavenly.state.draft.heavenlyWindow && heavenly.state.draft.heavenlyWindow.active, '购买后应开启神兵天降10秒发动窗口');
  assert(heavenlyHarness.app.innerHTML.includes('神兵天降可发动'), '实时抽选页应展示神兵天降发动倒计时');
  assert(heavenlyTarget.team.includes(heavenlyPlayerId), '测试前提：目标队长已购买选手');
  assert(heavenly.actions.useHeavenlyDescent(heavenlyOwner.id).ok, '神兵天降应可在窗口内发动');
  assert(!heavenlyTarget.team.includes(heavenlyPlayerId), '神兵天降应将刚购买选手移回卡池');
  assert(playerById(heavenly, heavenlyPlayerId).status === 'available', '被神兵天降退回的选手应恢复可选');
  assert(heavenlyTarget.economy.gold === heavenlyBeforeGold, `神兵天降应返还购买费用，前 ${heavenlyBeforeGold}，购买实付 ${heavenlyPaid}，后 ${heavenlyTarget.economy.gold}`);
  assert(heavenly.state.draft.currentOrder[heavenly.state.draft.currentOrder.length - 1] === heavenlyTarget.id, '神兵天降应把目标队长追加到本轮末尾补偿回合');
  assert((heavenly.state.hexcoreAssignments[heavenlyOwner.id] || []).find(hex => hex.id === 'heavenly-descent').status === 'used', '神兵天降每局使用后应标记已使用');
  heavenly.state.draft.currentIndex = heavenly.state.draft.currentOrder.length - 1;
  heavenly.actions.drawCards();
  assert(heavenly.state.draft.currentDraw && heavenly.state.draft.currentDraw.captainId === heavenlyTarget.id, '神兵天降补偿回合应允许目标队长重新开店');

  const mystery = createReadyHarness().H;
  const mysteryCaptain = currentCaptain(mystery);
  mystery.state.hexcoreAssignments[mysteryCaptain.id] = [
    { ...mystery.sampleData.hexcores.find(hex => hex.id === 'mystery-box') },
  ];
  mystery.state.draft.currentDraw = null;
  mystery.state.draft.pickedThisTurn = false;
  mysteryCaptain.economy.gold = 6;
  const mysteryBeforeGold = mysteryCaptain.economy.gold;
  const mysteryBeforeTeamSize = mysteryCaptain.team.length;
  const mysteryCandidates = mystery.selectors.availableCampPlayers(mysteryCaptain.id)
    .filter(player => player.tier >= 2 && player.tier <= 5);
  assert(mysteryCandidates.length > 0, '测试前提：神秘贤者盲盒应存在2-5费同阵营可选选手');
  const mysteryResult = mystery.hexcoreEngine.activate('mystery-box');
  assert(mysteryResult.ok, `神秘贤者盲盒应可支付3金币随机抽取：${mysteryResult.reason || 'ok'}`);
  assert(mysteryCaptain.economy.gold === mysteryBeforeGold - 3, '神秘贤者盲盒应固定消耗3金币');
  assert(mysteryCaptain.team.length === mysteryBeforeTeamSize + 1, '神秘贤者盲盒应随机加入1名队员');
  assert(mysteryCaptain.team.some(playerId => mysteryCandidates.some(player => player.id === playerId)), '神秘贤者盲盒应从同阵营2-5费可选池抽取');
  assert(mystery.economyEngine.roundState(mysteryCaptain.id).purchaseUsed, '神秘贤者盲盒应消耗本轮购买权');
  assert((mystery.state.hexcoreAssignments[mysteryCaptain.id] || []).find(hex => hex.id === 'mystery-box').status === 'used', '神秘贤者盲盒每局使用后应标记已使用');

  const transmuteGold = createReadyHarness().H;
  const transmuteGoldCaptain = currentCaptain(transmuteGold);
  transmuteGold.state.hexcoreAssignments[transmuteGoldCaptain.id] = [
    { ...transmuteGold.sampleData.hexcores.find(hex => hex.id === 'transmute-gold'), status: 'available' },
  ];
  transmuteGold.state.draft.currentDraw = null;
  transmuteGold.state.draft.pickedThisTurn = false;
  const goldTargets = transmuteGold.hexcoreEngine.transmuteTargets(transmuteGoldCaptain.id, 'transmute-gold');
  assert(goldTargets.length > 0, '测试前提：质变黄金阶应存在同阵营4费可选选手');
  const transmuteGoldBeforeSize = transmuteGoldCaptain.team.length;
  assert(transmuteGold.hexcoreEngine.activate('transmute-gold').ok, '质变黄金阶应可免费从4费池随机入队');
  assert(transmuteGoldCaptain.team.length === transmuteGoldBeforeSize + 1, '质变黄金阶应让队伍增加1名队员');
  assert(goldTargets.some(player => transmuteGoldCaptain.team.includes(player.id)), '质变黄金阶目标应来自同阵营4费池');
  assert(transmuteGold.economyEngine.roundState(transmuteGoldCaptain.id).purchaseUsed, '质变黄金阶应消耗本轮购买权');

  const transmutePrismatic = createReadyHarness().H;
  const transmutePrismaticCaptain = currentCaptain(transmutePrismatic);
  transmutePrismatic.state.hexcoreAssignments[transmutePrismaticCaptain.id] = [
    { ...transmutePrismatic.sampleData.hexcores.find(hex => hex.id === 'transmute-prismatic'), status: 'available' },
  ];
  transmutePrismatic.state.draft.currentDraw = null;
  transmutePrismatic.state.draft.pickedThisTurn = false;
  const prismaticTargets = transmutePrismatic.hexcoreEngine.transmuteTargets(transmutePrismaticCaptain.id, 'transmute-prismatic');
  assert(prismaticTargets.length > 0, '测试前提：质变棱彩阶应存在同阵营5费可选选手');
  assert(transmutePrismatic.hexcoreEngine.activate('transmute-prismatic').ok, '质变棱彩阶应可免费从5费池随机入队');
  assert(prismaticTargets.some(player => transmutePrismaticCaptain.team.includes(player.id)), '质变棱彩阶目标应来自同阵营5费池');
  assert(transmutePrismatic.economyEngine.roundState(transmutePrismaticCaptain.id).purchaseUsed, '质变棱彩阶应消耗本轮购买权');

  const transmuteEmpty = createReadyHarness().H;
  const transmuteEmptyCaptain = currentCaptain(transmuteEmpty);
  transmuteEmpty.state.hexcoreAssignments[transmuteEmptyCaptain.id] = [
    { ...transmuteEmpty.sampleData.hexcores.find(hex => hex.id === 'transmute-prismatic'), status: 'available' },
  ];
  transmuteEmpty.selectors.availableCampPlayers(transmuteEmptyCaptain.id)
    .filter(player => player.tier === 5)
    .forEach(player => { player.status = 'disabled'; });
  transmuteEmpty.state.draft.currentDraw = null;
  assert(!transmuteEmpty.hexcoreEngine.activate('transmute-prismatic').ok, '质变目标池为空时应失败并保留购买权');
  assert(!transmuteEmpty.economyEngine.roundState(transmuteEmptyCaptain.id).purchaseUsed, '质变失败不应消耗本轮购买权');

  const lastStand = createReadyHarness().H;
  const lastStandCaptain = currentCaptain(lastStand);
  const lastStandOther = lastStand.state.captains[1];
  lastStand.state.hexcoreAssignments[lastStandCaptain.id] = [
    { ...lastStand.sampleData.hexcores.find(hex => hex.id === 'last-stand'), status: 'available' },
  ];
  const nonCaptainPlayers = lastStand.state.players.filter(player => !lastStand.selectors.isCaptainPlayer(player.id));
  nonCaptainPlayers.forEach(player => {
    player.status = 'disabled';
    delete player.teamId;
  });
  const oldPlayers = nonCaptainPlayers.slice(0, 4);
  const pickedPlayers = nonCaptainPlayers.slice(4, 8);
  oldPlayers.forEach(player => {
    player.status = 'drafted';
    player.teamId = lastStandCaptain.id;
  });
  lastStandCaptain.team = oldPlayers.map(player => player.id);
  pickedPlayers.forEach(player => {
    player.status = 'available';
    delete player.teamId;
  });
  pickedPlayers[0].status = 'drafted';
  pickedPlayers[0].teamId = lastStandOther.id;
  lastStandOther.team = [pickedPlayers[0].id];
  lastStand.state.draft.currentDraw = null;
  assert(lastStand.hexcoreEngine.activate('last-stand').ok, '背水一战应可在当前队伍满4名队员时发动');
  assert(pickedPlayers.every(player => lastStandCaptain.team.includes(player.id)), '背水一战应随机换入4名非队长选手');
  assert(!lastStandCaptain.team.some(playerId => oldPlayers.some(player => player.id === playerId)), '背水一战后原队员不应留在使用者队伍中');
  assert(lastStandOther.team.length === 1 && oldPlayers.some(player => lastStandOther.team.includes(player.id)), '被抽走队员的队伍应获得1名原队员补偿');
  assert(pickedPlayers[0].teamId === lastStandCaptain.id, '被抽走选手归属应更新为背水一战使用者');
  assert(lastStand.economyEngine.roundState(lastStandCaptain.id).purchaseUsed, '背水一战应消耗本轮购买权');

  const removed = createReadyHarness().H;
  assert(!removed.sampleData.hexcores.some(hex => ['directed-recruit', 'order-overtake', 'budget-refund'].includes(hex.id)), '废弃海克斯不应继续进入海克斯池');
}

function testHexcoreFiveDrawOneFlow() {
  const { H, app } = createReadyHarness();
  const captain = H.state.captains[0];
  const nextCaptain = H.state.captains[1];
  H.state.hexcoreAssignments[captain.id] = [];
  H.state.hexcoreAssignments[nextCaptain.id] = [];
  H.state.hexcoreDraft.drawOrder = H.state.captains.map(item => item.id);
  H.state.ui.hexCaptainId = captain.id;
  H.actions.setActiveView('hexcores');

  H.actions.drawHexcoreForCaptain(captain.id);
  const firstSlots = [...H.state.hexcoreDraft.slots];
  assert(firstSlots.length === 5, `海克斯抽取应一次生成5张候选，当前 ${firstSlots.length}`);
  assert(new Set(firstSlots).size === 5, '5张海克斯候选不应重复');
  assert(app.innerHTML.includes('刷新此张') && app.innerHTML.includes('hex-draw-card'), '海克斯库UI应展示五抽一候选卡和单张刷新操作');

  H.actions.refreshHexcoreSlot(0);
  const refreshedSlots = [...H.state.hexcoreDraft.slots];
  assert(refreshedSlots.length === 5, '刷新其中1张后仍应保持5张候选');
  assert(new Set(refreshedSlots).size === 5, '刷新后候选列表仍不应重复');
  assert(H.state.hexcoreDraft.refreshUsed, '刷新1张后应标记本次刷新已用');
  assert(refreshedSlots[0] !== firstSlots[0], '刷新应替换指定候选槽');

  const beforeSecondRefresh = [...H.state.hexcoreDraft.slots].join('|');
  H.actions.refreshHexcoreSlot(1);
  assert(H.state.hexcoreDraft.slots.join('|') === beforeSecondRefresh, '同一次五抽一最多只能刷新1张');

  const selectedHexcoreId = H.state.hexcoreDraft.slots[0];
  H.actions.selectHexcoreFromDraw(captain.id, selectedHexcoreId);
  assert((H.state.hexcoreAssignments[captain.id] || []).length === 1, '队长最多选择1个海克斯');
  assert(!H.state.hexcoreDraft.captainId && H.state.hexcoreDraft.slots.length === 0, '选择后应结束当前抽取会话，不应自动生成下一组候选');

  H.actions.drawHexcoreForCaptain(captain.id);
  assert((H.state.hexcoreAssignments[captain.id] || []).length === 1, '已完成选择的队长不能继续抽取海克斯');
  assert(H.state.hexcoreDraft.slots.length === 0, '已完成选择后再次抽取不应产生候选');

  H.actions.nextHexcoreCaptain();
  assert(H.state.ui.hexCaptainId === nextCaptain.id, '点击下一位后应手动切换到下一名未完成队长');
  assert(H.state.hexcoreDraft.slots.length === 0, '手动切换队长不应自动抽取候选');

  H.state.captains.forEach((item, index) => {
    H.state.hexcoreAssignments[item.id] = [assignedHexcore(H.sampleData.hexcores[index])];
  });
  const workflow = H.selectors.workflowStatus();
  assert(!workflow.missingHexcoreCaptains.length, '每队拥有1个海克斯即应通过流程检查');

  H.state.hexcoreAssignments[captain.id] = [
    assignedHexcore(H.sampleData.hexcores[0]),
    assignedHexcore(H.sampleData.hexcores[1]),
  ];
  assert(H.selectors.workflowChecklist().blockingItems.some(item => item.id === 'hexcore-draw'), '运行态队长超过1个海克斯时流程门禁应阻断');
  H.normalizeState(H.state);
  assert((H.state.hexcoreAssignments[captain.id] || []).length === 1, '归一化旧存档时每名队长最多保留1个海克斯');
}

function testHexcoreCategoryClassification() {
  const { H, app } = createReadyHarness();
  const expectedCategories = new Set(['shop_control', 'economy', 'disruption', 'roster_replace', 'order_response']);
  const seenCategories = new Set();
  H.sampleData.hexcores.forEach(hexcore => {
    assert(expectedCategories.has(hexcore.category), `${hexcore.name} 应声明有效业务分类`);
    assert(Array.isArray(hexcore.tags) && hexcore.tags.length > 0, `${hexcore.name} 应声明辅助标签`);
    seenCategories.add(hexcore.category);
  });
  expectedCategories.forEach(category => {
    assert(seenCategories.has(category), `海克斯库应覆盖分类 ${category}`);
  });

  H.state.ui.hexCaptainId = H.state.captains[0].id;
  H.actions.setActiveView('hexcores');
  assert(app.innerHTML.includes('商店操控') && app.innerHTML.includes('金币运营') && app.innerHTML.includes('对手干扰'), '海克斯库应展示业务分类筛选入口');
  H.actions.setHexFilter('economy');
  assert(app.innerHTML.includes('捐赠') && app.innerHTML.includes('金币运营'), '金币运营分类应显示经济类海克斯');
  assert(!app.innerHTML.includes('阵营封锁'), '金币运营分类不应混入对手干扰类海克斯');

  H.actions.drawHexcoreForCaptain(H.state.captains[0].id);
  const cardCategoryClasses = [...app.innerHTML.matchAll(/class="[^"]*(?:hex-draw-card|hex-library-card|owned-hex-card)\s+([^"]*)"/g)]
    .map(match => match[1].split(/\s+/).find(className => expectedCategories.has(className)))
    .filter(Boolean);
  assert(cardCategoryClasses.length > 0, '海克斯卡片应使用业务分类类名驱动配色');
  const legacyBadgeLabels = new Set(['策略', '特殊', '白银', '黄金', '棱彩', '海克斯']);
  const renderedBadgeLabels = [...app.innerHTML.matchAll(/<(?:span)[^>]*>([^<]+)<\/span>/g)]
    .map(match => match[1].trim());
  assert(!renderedBadgeLabels.some(label => legacyBadgeLabels.has(label)), '海克斯卡片不应继续展示旧品质/类型标签');

  setOnlyHexcore(H, H.state.captains[0].id, 'price-interference');
  H.actions.setActiveView('draft');
  assert(app.innerHTML.includes('hex-category-chip') && app.innerHTML.includes('干扰'), '执行队列应展示海克斯业务分类标签');
}

function testHexTargetPickerExplainsInvalidTargets() {
  const { H, app } = createReadyHarness();
  const captain = H.state.captains[0];
  setOnlyHexcore(H, captain.id, 'price-interference');
  H.state.captains
    .filter(item => item.id !== captain.id)
    .forEach(item => {
      item.team = ['filled-1', 'filled-2', 'filled-3', 'filled-4'];
    });

  H.actions.setActiveView('draft');
  H.actions.openHexTargetPicker('price-interference');

  assert(app.innerHTML.includes('hex-target-warning'), '无有效目标时目标选择面板应显示不可执行原因');
  assert(app.innerHTML.includes('冲突/裁决说明') && app.innerHTML.includes('队伍已满员'), '目标被排除时应展示覆盖来源和最终裁决');
  assert(app.innerHTML.includes('确认执行</button>') && app.innerHTML.includes('disabled'), '无有效目标时确认执行按钮应禁用');
}

function testHexcoreGlobalUniquePool() {
  const { H } = createReadyHarness();
  const target = H.state.captains[0];
  const blocker = H.state.captains[1];
  const allHexcores = H.sampleData.hexcores;
  const availableIds = allHexcores.slice(0, 2).map(hex => hex.id);
  H.state.captains.forEach(captain => {
    H.state.hexcoreAssignments[captain.id] = [];
  });
  H.state.hexcoreAssignments[target.id] = [];
  H.state.hexcoreAssignments[blocker.id] = allHexcores
    .filter(hex => !availableIds.includes(hex.id))
    .map(assignedHexcore);
  H.state.ui.hexCaptainId = target.id;
  H.actions.drawHexcoreForCaptain(target.id);
  assert(H.state.hexcoreDraft.slots.length === 2, `全局可用未占用海克斯不足5张时应只抽出可用数量，当前 ${H.state.hexcoreDraft.slots.length}`);
  assert(H.state.hexcoreDraft.slots.every(id => availableIds.includes(id)), '海克斯候选不能出现其他队长已选择的海克斯');

  const occupiedHexcore = H.state.hexcoreAssignments[blocker.id][0];
  H.actions.assignHexcoreToCaptain(target.id, occupiedHexcore.id);
  assert(!(H.state.hexcoreAssignments[target.id] || []).some(hex => hex.id === occupiedHexcore.id), '裁判兜底分配不能重复分配其他队长已选择的海克斯');

  H.state.hexcoreDraft = {
    captainId: target.id,
    slots: [occupiedHexcore.id],
    chosen: [],
    seenIds: [occupiedHexcore.id],
    refreshUsed: false,
  };
  H.actions.selectHexcoreFromDraw(target.id, occupiedHexcore.id);
  assert(!(H.state.hexcoreAssignments[target.id] || []).some(hex => hex.id === occupiedHexcore.id), '过期候选会话不能选择其他队长已占用的海克斯');

  const empty = createReadyHarness().H;
  const emptyTarget = empty.state.captains[0];
  const emptyBlocker = empty.state.captains[1];
  empty.state.captains.forEach(captain => {
    empty.state.hexcoreAssignments[captain.id] = [];
  });
  empty.state.hexcoreAssignments[emptyTarget.id] = [];
  empty.state.hexcoreAssignments[emptyBlocker.id] = empty.sampleData.hexcores.map(assignedHexcore);
  empty.state.ui.hexCaptainId = emptyTarget.id;
  empty.actions.drawHexcoreForCaptain(emptyTarget.id);
  assert(empty.state.hexcoreDraft.slots.length === 0, '全局没有剩余可用海克斯时不应生成候选');
  assert(empty.state.events[0].body === '全局剩余可用海克斯不足 1个', '全局没有剩余可用海克斯时应给出指定失败提示');

  const release = createReadyHarness().H;
  const releaseTarget = release.state.captains[0];
  const releaseOwner = release.state.captains[1];
  const releaseBlocker = release.state.captains[2];
  const releasedHexcore = release.sampleData.hexcores[0];
  release.state.captains.forEach(captain => {
    release.state.hexcoreAssignments[captain.id] = [];
  });
  release.state.hexcoreAssignments[releaseTarget.id] = [];
  release.state.hexcoreAssignments[releaseOwner.id] = [assignedHexcore(releasedHexcore)];
  release.state.hexcoreAssignments[releaseBlocker.id] = release.sampleData.hexcores.slice(1).map(assignedHexcore);
  release.actions.removeHexcore(releaseOwner.id, releasedHexcore.id);
  release.actions.drawHexcoreForCaptain(releaseTarget.id);
  assert(release.state.hexcoreDraft.slots.length === 1 && release.state.hexcoreDraft.slots[0] === releasedHexcore.id, '移除海克斯应释放全局占用，使其可重新进入后续候选池');
}

function testUiNavigationAndSecurity() {
  const { H, app } = createReadyHarness();
  H.actions.setActiveView('draft');
  assert(app.innerHTML.includes('金币') && app.innerHTML.includes('购买此卡') && app.innerHTML.includes('刷新商店'), '实时抽选页应展示金币商店操作');
  assert(app.innerHTML.includes('control-group shop-actions') && app.innerHTML.includes('control-group primary-actions'), '实时抽选页裁判操作应按商店和流程分组');
  assert(app.innerHTML.includes('规则摘要') && app.innerHTML.includes('完整规则'), '实时抽选页应展示压缩后的规则摘要入口');
  assert(app.innerHTML.includes('顺位变更说明') && app.innerHTML.includes('顺位详情'), '实时抽选页应展示基础顺位和海克斯修正来源入口');
  H.actions.drawCards();
  assert(app.innerHTML.includes('本地人') || app.innerHTML.includes('外地人'), '商店卡应显示阵营标签');
  assert(app.innerHTML.includes('hex-execution-queue'), '实时抽选页应展示海克斯执行队列');
  assert(!app.innerHTML.includes('class="hex-list"'), '实时抽选页不应重复展示拥有海克斯列表');

  assert(staticServer.resolveRequestPath('/') === path.join(root, 'index.html'), '静态服务应正常解析首页');
  assert(staticServer.resolveRequestPath('/src/main.js') === path.join(root, 'src', 'main.js'), '静态服务应正常解析项目内资源');
  assert(staticServer.resolveRequestPath('/..%2FHEXCORE2.0_secret%2Fsecret.txt') === null, '静态服务应拒绝同名前缀兄弟目录穿越');
  assert(staticServer.resolveRequestPath('/%E0%A4%A') === null, '静态服务应拒绝非法URL编码');
}

function testRuleTemplateSaveAndLoad() {
  const { H, app } = createHarness();
  H.actions.setActiveView('rules');
  H.actions.saveRuleTemplate();
  assert(H.state.settings.ruleTemplates.length === 1, '规则模板应能保存当前规则');
  assert(app.innerHTML.includes('加载模板'), '规则模板列表应提供加载入口');

  H.state.settings.playersPerTeam = 6;
  H.state.settings.tierNames[1] = '临时一费';
  H.actions.loadRuleTemplate(0);
  assert(H.state.settings.playersPerTeam === 5, '加载模板应恢复每队人数');
  assert(H.state.settings.tierNames[1] !== '临时一费', '加载模板应恢复卡池名称');
  assert(H.state.events.some(event => event.title === '规则设置' && event.body.includes('已加载规则模板')), '加载模板应写入高风险规则日志');

  const locked = createReadyHarness().H;
  locked.actions.saveRuleTemplate();
  locked.actions.loadRuleTemplate(0);
  assert(locked.state.events.some(event => event.title === '加载规则模板失败'), '金币抽卡开始后加载模板应被拦截并提示');
}

function testEventClickLocatesTargets() {
  const { H, app } = createReadyHarness();
  const captain = H.state.captains[0];
  const player = H.state.players.find(item => item.camp === H.selectors.captainCamp(captain.id) && !H.selectors.isCaptainPlayer(item.id));
  const hexcore = H.sampleData.hexcores.find(item => item.id === 'reserved-seat');

  H.eventStore.append('定位测试', `${captain.name} 给 ${player.name} 使用 ${hexcore.name}`, 'info', {
    captainId: captain.id,
    playerId: player.id,
    hexcoreId: hexcore.id,
  });
  H.actions.setActiveView('logs');
  assert(app.innerHTML.includes('定位到相关对象'), '日志项应提供点击定位能力');

  H.actions.locateEvent(0);
  assert(H.state.ui.activeView === 'players', '含选手的日志应优先跳转到选手库');
  assert(H.state.ui.highlightPlayerId === player.id, '日志定位应记录目标选手高亮');
  assert(app.innerHTML.includes('located-card'), '日志定位后目标卡片应有明显高亮样式');

  H.eventStore.append('海克斯定位测试', `${captain.name} 获得 ${hexcore.name}`, 'info', {
    captainId: captain.id,
    hexcoreId: hexcore.id,
  });
  H.actions.locateEvent(0);
  assert(H.state.ui.activeView === 'hexcores', '含海克斯的日志应跳转到海克斯库');
  assert(H.state.ui.highlightHexcoreId === hexcore.id, '日志定位应记录目标海克斯高亮');
}

function testRecoverDraftState() {
  const { H, app } = createReadyHarness();
  const firstCaptain = H.selectors.currentCaptain();
  firstCaptain.team = ['ghost-a', 'ghost-b', 'ghost-c', 'ghost-d'];
  H.state.draft.currentOrder = ['missing-captain'];
  H.state.draft.currentIndex = 5;
  H.state.draft.round = 99;
  H.state.draft.phase = 'round_start';
  H.state.draft.currentDraw = { captainId: firstCaptain.id, cards: [] };

  H.actions.recoverDraftState();

  assert(H.state.draft.round === H.state.draft.maxRounds, '异常恢复应把越界轮次夹回合法范围');
  assert(!H.state.draft.currentOrder.includes('missing-captain'), '异常恢复应重算缺失队长的顺位队列');
  assert(H.state.draft.currentDraw === null, '当前队长满员或顺位异常时应清空旧商店');
  assert(H.state.draft.phase === 'captain_action' || H.state.draft.phase === 'completed', '异常恢复应恢复到可执行阶段或完成状态');
  assert(H.state.events.some(event => event.title === '异常恢复'), '异常恢复应写事件日志');
  H.actions.setActiveView('draft');
  assert(app.innerHTML.includes('修正异常') || app.innerHTML.includes('修正抽选异常'), '实时抽选界面应提供异常恢复入口');
}

function testTournamentByeAndBracketLinks() {
  const { H, app, elements } = createReadyHarness();
  const originalRandom = Math.random;
  Math.random = () => 0;
  H.actions.generateTournamentSchedule();
  Math.random = originalRandom;
  const firstRound = H.state.tournament.rounds[0];
  firstRound.matches.forEach((match, index) => {
    elements[`tournament-score-${firstRound.id}-${match.id}-a`] = { value: String(index + 1) };
    elements[`tournament-score-${firstRound.id}-${match.id}-b`] = { value: '0' };
    H.actions.saveTournamentScore(firstRound.id, match.id);
  });

  const secondRound = H.state.tournament.rounds[1];
  assert(secondRound.matches.length === 3, '10队首轮后5名晋级者应生成2场对阵和1个轮空');
  assert(secondRound.matches.some(match => match.status === 'bye' && match.teamAId && !match.teamBId), '奇数晋级者应正确显示轮空晋级场次');
  assert(secondRound.matches.every(match => !match.teamBId || match.teamAId !== match.teamBId), '后续轮次不能出现同队伍对阵自己');

  H.actions.setActiveView('tournament');
  assert(app.innerHTML.includes('BYE') && app.innerHTML.includes('轮空'), '赛程图应明确显示轮空');
  assert(app.innerHTML.includes('bracket-source') && app.innerHTML.includes('linked'), '赛程图应显示晋级来源和连接路径样式');
}

function testTournamentScheduleRandomizesEntrants() {
  const { H } = createReadyHarness();
  const baseOrder = H.state.draft.baseOrder.join('|');
  const originalRandom = Math.random;
  Math.random = () => 0;
  H.actions.generateTournamentSchedule();
  Math.random = originalRandom;

  const generatedOrder = H.state.tournament.rounds[0].matches
    .flatMap(match => [match.teamAId, match.teamBId])
    .filter(Boolean)
    .join('|');

  assert(generatedOrder !== baseOrder, '生成淘汰赛赛程时应随机打乱队伍顺序，而不是固定使用基础顺位');
}

function testPostTaskIncompleteRetryLimit() {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hexcore-post-task-'));
  const stateFile = path.join(stateDir, 'state.json');
  const args = [
    '--status=incomplete',
    '--doc=docs/06_开发计划.md',
    '--skip-gates=true',
    '--max-attempts=2',
    `--state-file=${stateFile}`,
  ];
  const previousExitCode = process.exitCode;

  withMutedConsole(() => {
    process.exitCode = undefined;
    runTaskLoop({ args: testArgsMap(args) });
    assert(process.exitCode !== 1, '第一次 incomplete 不应触发重试上限');

    process.exitCode = undefined;
    runTaskLoop({ args: testArgsMap(args) });
    assert(process.exitCode !== 1, '第二次 incomplete 不应触发重试上限');

    process.exitCode = undefined;
    runTaskLoop({ args: testArgsMap(args) });
    assert(process.exitCode === 1, '超过 incomplete 重试上限后钩子必须失败，防止无限循环');
  });

  process.exitCode = previousExitCode;
}

function testPostTaskExtractsOpenTableNextAction() {
  const relativeDoc = '.tmp-post-task-open-plan.md';
  const docPath = path.join(root, relativeDoc);
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hexcore-post-task-'));
  const stateFile = path.join(stateDir, 'state.json');
  const previousExitCode = process.exitCode;
  fs.writeFileSync(docPath, [
    '# 临时任务计划',
    '',
    '## 功能验收矩阵',
    '',
    '| 功能 | 状态 | 验收标准 |',
    '| --- | --- | --- |',
    '| 按钮主题适配 | 进行中 | 所有按钮与当前主题一致。 |',
    '| 已完成样例 | 已完成 | 不应被识别为待办。 |',
    '',
  ].join('\n'), 'utf8');

  try {
    const analysis = analyzeTaskDoc(relativeDoc);
    assert(analysis.openTableRows.length === 1, 'post-task 应识别表格中的未完成计划项');
    assert(analysis.openTableRows[0].primary === '按钮主题适配', 'post-task 应提取未完成计划项名称');
    assert(analysis.nextActions.some(item => item.includes('按钮主题适配')), 'post-task 应把未完成表格项转成下一步建议');

    withMutedConsole(() => {
      process.exitCode = undefined;
      const result = runTaskLoop({
        args: testArgsMap([
          '--status=incomplete',
          `--doc=${relativeDoc}`,
          '--skip-gates=true',
          '--max-attempts=2',
          `--state-file=${stateFile}`,
        ]),
      });
      assert(result.analysis.openTableRows.length === 1, '任务循环返回值应保留未完成表格项');
      assert(process.exitCode !== 1, '首次 incomplete 且未超上限时不应失败');
    });
  } finally {
    if (fs.existsSync(docPath)) fs.unlinkSync(docPath);
    process.exitCode = previousExitCode;
  }
}

async function run() {
  const tests = [
    testDefaultEmptySetup,
    testResetLocalStateRendersEmptySetup,
    testCampLockedSetup,
    testCampTeamLimitGuard,
    testCampLockedShop,
    testAssignmentHardGuards,
    testCampChecklistAllowsDraftedPlayers,
    testPurchasedShopCardIsMarked,
    testUndoRestoresShopPermissions,
    testFinalFillSameCamp,
    testPlayersUiAndImport,
    testFullTenTeamGoldShopFlow,
    testRenderKeepsPageScroll,
    testTeamIssueDetectionAndRepair,
    testGoldModeAllowsManualMoveBackToPool,
    testSystemIntegrityCheck,
    testSystemIntegrityCheckMatchesCurrentRules,
    testNavigationResetsPageScroll,
    testNewHexcores,
    testHexcoreFiveDrawOneFlow,
    testHexcoreCategoryClassification,
    testHexTargetPickerExplainsInvalidTargets,
    testHexcoreGlobalUniquePool,
    testUiNavigationAndSecurity,
    testRuleTemplateSaveAndLoad,
    testEventClickLocatesTargets,
    testRecoverDraftState,
    testTournamentByeAndBracketLinks,
    testTournamentScheduleRandomizesEntrants,
    testPostTaskIncompleteRetryLimit,
    testPostTaskExtractsOpenTableNextAction,
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
