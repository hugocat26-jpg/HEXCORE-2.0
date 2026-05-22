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
    c1: take('camp-scout', 'discount-coupon', 'budget-refund'),
    c2: take('directed-recruit', 'reserved-seat', 'order-overtake'),
    c3: take('urgent-restock', 'camp-blockade', 'steady-reinforce'),
    c4: take('price-interference', 'camp-scout', 'budget-refund'),
    c5: take('reserved-seat', 'urgent-restock', 'discount-coupon'),
    c6: take('camp-scout', 'camp-blockade', 'budget-refund'),
    c7: take('directed-recruit', 'price-interference', 'order-overtake'),
    c8: take('reserved-seat', 'steady-reinforce', 'discount-coupon'),
    c9: take('urgent-restock', 'camp-scout', 'budget-refund'),
    c10: take('camp-blockade', 'price-interference', 'order-overtake'),
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

function currentCaptain(H) {
  return H.selectors.currentCaptain();
}

function playerById(H, playerId) {
  return H.state.players.find(player => player.id === playerId);
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
  const goldAfterFreeShop = captain.economy.gold;
  const refreshCountAfterFreeShop = H.economyEngine.roundState(captain.id).refreshCount;
  const refreshCost = H.economyEngine.nextRefreshCost(captain.id);

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

  const directed = createReadyHarness().H;
  directed.state.draft.currentIndex = 1;
  directed.state.draft.currentDraw = null;
  directed.economyEngine.roundState(currentCaptain(directed).id).freeShopUsed = false;
  assert(directed.hexcoreEngine.activate('directed-recruit', { lane: '上路' }).ok, '定向招募应接受位置目标');
  directed.actions.drawCards();
  assert(directed.state.draft.currentDraw.cards.some(card => playerById(directed, card.playerId).lane === '上路'), '定向招募商店应出现指定位置');

  const discount = createReadyHarness().H;
  discount.state.draft.currentIndex = 4;
  const discountCaptain = currentCaptain(discount);
  discount.actions.drawCards();
  const beforeGold = discountCaptain.economy.gold;
  assert(discount.hexcoreEngine.activate('discount-coupon').ok, '压价券应可在购买前使用');
  discount.state.draft.selectedSlot = 0;
  const discountPlayer = playerById(discount, discount.state.draft.currentDraw.cards[0].playerId);
  discount.actions.pickCard();
  assert(discountCaptain.economy.gold === beforeGold - Math.max(1, discountPlayer.tier - 1), '压价券应降低本次购买费用');

  const reserve = createReadyHarness().H;
  reserve.state.draft.currentIndex = 1;
  reserve.actions.drawCards();
  const reservedPlayerId = reserve.state.draft.currentDraw.cards[0].playerId;
  assert(reserve.hexcoreEngine.activate('reserved-seat', { shopCardIndex: 0 }).ok, '保留席位应能保留当前商店卡');
  reserve.actions.refreshShop();
  assert(reserve.state.draft.currentDraw.cards.some(card => card.playerId === reservedPlayerId), '刷新后应保留指定卡');

  const restock = createReadyHarness().H;
  restock.state.draft.currentIndex = 2;
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
  assert(blockade.hexcoreEngine.activate('camp-blockade', { targetCaptainId: 'c4' }).ok, '阵营封锁应能选择同阵营尚未行动队长');
  blockade.state.draft.currentIndex = 3;
  blockade.actions.drawCards();
  assert(blockade.state.draft.currentDraw.cards.length === 4, '阵营封锁生效后目标队长商店应少展示1张卡');

  const { H: price, app: priceApp } = createReadyHarness();
  price.state.draft.currentIndex = 3;
  price.state.draft.currentDraw = null;
  assert(price.hexcoreEngine.activate('price-interference', { targetCaptainId: 'c5' }).ok, '抬价干扰应能选择同阵营尚未行动队长');
  assert(price.hexcoreEngine.effectStatusForCaptain('c5').some(effect => effect.label.includes('购买费用 +1')), '抬价干扰应在目标队长状态中显示待生效');
  price.state.draft.currentIndex = 4;
  price.actions.drawCards();
  assert(priceApp.innerHTML.includes('海克斯影响') && priceApp.innerHTML.includes('抬价干扰'), '目标队长回合状态栏应显示受到抬价干扰影响');
  const priceCaptain = currentCaptain(price);
  const priceBeforeGold = priceCaptain.economy.gold;
  const pricePlayer = playerById(price, price.state.draft.currentDraw.cards[0].playerId);
  price.state.draft.selectedSlot = 0;
  price.actions.pickCard();
  assert(priceCaptain.economy.gold === priceBeforeGold - pricePlayer.tier - 1, '抬价干扰生效后购买费用应实际增加1金币');
  assert(price.state.draft.currentDraw.purchaseEffects.some(effect => effect.type === 'price_interference'), '购买后应记录已生效的抬价干扰');

  const overtake = createReadyHarness().H;
  overtake.state.draft.currentIndex = 1;
  overtake.state.draft.currentDraw = null;
  assert(overtake.hexcoreEngine.activate('order-overtake').ok, '顺位插队应能交换前一位队长');
  assert(overtake.state.draft.currentOrder[0] === 'c2', '顺位插队后当前队长应前移');

  const refund = createReadyHarness().H;
  const refundCaptain = currentCaptain(refund);
  const cheap = refund.state.players.find(player => player.camp === 'local' && player.tier <= 2 && player.status === 'available');
  refund.assignmentEngine.purchase(refundCaptain.id, cheap.id, 'gold_shop_purchase');
  assert(refundCaptain.budgetRefundUsed, '预算返还应在购买1费或2费时自动触发');

  const steady = createReadyHarness().H;
  steady.state.draft.currentIndex = 2;
  assert(steady.hexcoreEngine.activate('steady-reinforce').ok, '稳健补强应从同阵营最低费用池分配');
  assert(currentCaptain(steady).team.length === 1, '稳健补强成功后应入队1人');

  const badTarget = createReadyHarness().H;
  badTarget.state.draft.currentIndex = 2;
  assert(!badTarget.hexcoreEngine.activate('camp-blockade', { targetCaptainId: 'c6' }).ok, '同阵营队长类海克斯应拒绝跨阵营目标');
}

function testUiNavigationAndSecurity() {
  const { H, app } = createReadyHarness();
  H.actions.setActiveView('draft');
  assert(app.innerHTML.includes('金币') && app.innerHTML.includes('购买此卡') && app.innerHTML.includes('刷新商店'), '实时抽选页应展示金币商店操作');
  assert(app.innerHTML.includes('control-group shop-actions') && app.innerHTML.includes('control-group primary-actions'), '实时抽选页裁判操作应按商店和流程分组');
  assert(app.innerHTML.includes('规则摘要') && app.innerHTML.includes('完整规则'), '实时抽选页应展示压缩后的规则摘要入口');
  H.actions.drawCards();
  assert(app.innerHTML.includes('本地人') || app.innerHTML.includes('外地人'), '商店卡应显示阵营标签');
  assert(app.innerHTML.includes('hex-execution-queue'), '实时抽选页应展示海克斯执行队列');
  assert(!app.innerHTML.includes('class="hex-list"'), '实时抽选页不应重复展示拥有海克斯列表');

  assert(staticServer.resolveRequestPath('/') === path.join(root, 'index.html'), '静态服务应正常解析首页');
  assert(staticServer.resolveRequestPath('/src/main.js') === path.join(root, 'src', 'main.js'), '静态服务应正常解析项目内资源');
  assert(staticServer.resolveRequestPath('/..%2FHEXCORE2.0_secret%2Fsecret.txt') === null, '静态服务应拒绝同名前缀兄弟目录穿越');
  assert(staticServer.resolveRequestPath('/%E0%A4%A') === null, '静态服务应拒绝非法URL编码');
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

async function run() {
  const tests = [
    testDefaultEmptySetup,
    testCampLockedSetup,
    testCampTeamLimitGuard,
    testCampLockedShop,
    testAssignmentHardGuards,
    testCampChecklistAllowsDraftedPlayers,
    testPurchasedShopCardIsMarked,
    testUndoRestoresShopPermissions,
    testFinalFillSameCamp,
    testPlayersUiAndImport,
    testRenderKeepsPageScroll,
    testNavigationResetsPageScroll,
    testNewHexcores,
    testUiNavigationAndSecurity,
    testTournamentByeAndBracketLinks,
    testTournamentScheduleRandomizesEntrants,
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
