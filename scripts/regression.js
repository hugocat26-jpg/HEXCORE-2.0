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
    c1: take('camp-scout', 'discount-coupon', 'sponsor-flow'),
    c2: take('donation', 'reserved-seat', 'photographer'),
    c3: take('urgent-restock', 'camp-blockade', 'steady-reinforce'),
    c4: take('price-interference', 'camp-scout', 'open-feast'),
    c5: take('reserved-seat', 'urgent-restock', 'discount-coupon'),
    c6: take('camp-scout', 'camp-blockade', 'giant-slayer'),
    c7: take('vampiric-habit', 'price-interference', 'photographer'),
    c8: take('reserved-seat', 'steady-reinforce', 'wise-benevolence'),
    c9: take('urgent-restock', 'camp-scout', 'sponsor-flow'),
    c10: take('camp-blockade', 'price-interference', 'giant-slayer'),
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
  assert(delayedBlockade.hexcoreEngine.activate('camp-blockade', { targetCaptainId: 'c1' }).ok, '阵营封锁可对本轮已行动队长使用并延迟到下轮生效');

  const { H: price, app: priceApp } = createReadyHarness();
  price.state.draft.currentIndex = 3;
  price.state.draft.currentDraw = null;
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
  donation.state.hexcoreAssignments[donationCaptain.id].pop();
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

  const vampire = createReadyHarness().H;
  vampire.state.draft.currentIndex = 6;
  const vampireCaptain = currentCaptain(vampire);
  const vampireBeforeGold = vampireCaptain.economy.gold;
  assert(vampire.hexcoreEngine.activate('vampiric-habit').ok, '吸血习性应可从金币最高的其他队长处吸取金币');
  assert(vampireCaptain.economy.gold === vampireBeforeGold + 3, '吸血习性应最多获得3金币');

  const steady = createReadyHarness().H;
  steady.state.draft.currentIndex = 2;
  assert(steady.hexcoreEngine.activate('steady-reinforce').ok, '稳健补强应从同阵营最低费用池分配');
  assert(currentCaptain(steady).team.length === 1, '稳健补强成功后应入队1人');

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
  const stuckTarget = stuck.hexcoreEngine.stuckTogetherTargets(stuckCaptain.id)[0];
  assert(stuck.hexcoreEngine.activate('stuck-together', { targetPlayerId: stuckTarget.id }).ok, '和我困在一起应可指定同阵营可选选手');
  assert(stuck.state.draft.runtimeEffects.some(effect => effect.type === 'stuck_together' && effect.playerId === stuckTarget.id), '和我困在一起应记录下一轮延迟检查效果');
  stuck.state.draft.round = 2;
  stuck.economyEngine.roundState(stuckCaptain.id, 2).purchaseUsed = false;
  stuck.economyEngine.roundState(stuckCaptain.id, 2).skipped = false;
  const stuckResult = stuck.hexcoreEngine.autoAssignBeforeDraw(stuckCaptain.id);
  assert(stuckResult.handled && stuckResult.assigned, '和我困在一起下一轮目标仍可选时应自动入队');
  assert(stuckCaptain.team.includes(stuckTarget.id), '和我困在一起应将锁定目标加入队伍');
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
  heavenly.state.hexcoreAssignments[heavenlyOwner.id] = [
    ...(heavenly.state.hexcoreAssignments[heavenlyOwner.id] || []),
    { ...heavenly.sampleData.hexcores.find(hex => hex.id === 'heavenly-descent') },
  ];
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

  const removed = createReadyHarness().H;
  assert(!removed.sampleData.hexcores.some(hex => ['directed-recruit', 'order-overtake', 'budget-refund'].includes(hex.id)), '废弃海克斯不应继续进入海克斯池');
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
