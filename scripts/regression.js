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

function markWorkflowReady(H) {
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
  H.actions.pause();
  assert(!H.state.draft.paused && H.state.draft.currentDraw.timeoutEndsAt && H.state.draft.currentDraw.timeoutEndsAt !== timeoutBeforePause, '恢复后应按剩余时间继续倒计时');
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
  assert(app.innerHTML.includes('导入 JSON/CSV') && app.innerHTML.includes('pool-health-grid'), '选手库应提供导入和卡池容量检测');
  assert(app.innerHTML.includes('队长专属池') && app.innerHTML.includes('卡池等级不可手动设置') && !app.innerHTML.includes('player-tier-'), '选手库应说明系统分池且不允许手动设置卡池');
  assert(app.innerHTML.includes('参赛宣言') && app.innerHTML.includes('player-manifesto-') && app.innerHTML.includes('player-lane-') && app.innerHTML.includes('player-heroes-') && app.innerHTML.includes('autoSavePlayerIfChanged') && app.innerHTML.includes('偏好位置') && app.innerHTML.includes('绝活英雄') && app.innerHTML.includes('readonly-score') && !app.innerHTML.includes('id="player-name-') && !app.innerHTML.includes('player-score-'), '选手卡片应按名字、ID、偏好位置、绝活英雄、参赛宣言、评分展示并支持失焦自动保存');
  assert(!app.innerHTML.includes('>保存</button>'), '选手卡片不应再显示手动保存按钮');
  H.state.captains[0].playerId = 'captain-test-player';
  H.state.players.push({ id: 'captain-test-player', name: '队长测试选手', lane: '中路', gameId: 'CAPTAIN_TEST', score: 120, tier: 4, status: 'available' });
  H.normalizeState(H.state);
  assert(H.state.players.find(player => player.id === 'captain-test-player').tier === 0, '被选为队长的选手应进入队长专属卡池');
  assert(H.state.players.filter(player => player.id !== 'captain-test-player').every(player => player.tier >= 1 && player.tier <= 4), '非队长选手应被系统分配到四个普通卡池');
  const teamCountBeforePromote = H.state.captains.length;
  const emptyCaptainBeforePromote = H.state.captains.find(captain => !captain.playerId && !captain.playerGameId);
  const freePromotePlayer = H.state.players.find(player => player.status === 'available' && player.id !== 'captain-test-player');
  assert(app.innerHTML.includes('设为队长') && app.innerHTML.includes('player-card-head'), '选手库每名非队长选手应有独立卡片和设为队长入口');
  H.actions.promotePlayerToCaptain(freePromotePlayer.id);
  assert(H.state.captains.length === teamCountBeforePromote, '存在空队伍时自由选手设为队长应填入该队伍而不是新建队伍');
  assert(emptyCaptainBeforePromote.playerId === freePromotePlayer.id, '自由选手应被指定为空队伍的队长');
  assert(H.state.players.find(player => player.id === freePromotePlayer.id).tier === 0, '自由选手设为队长后应进入队长专属池');
  const draftedPromotePlayer = H.state.players.find(player => player.status === 'drafted' && player.teamId);
  const ownerBeforePromote = H.state.captains.find(captain => captain.id === draftedPromotePlayer.teamId);
  H.state.players.push({ id: 'old-captain-player', name: '旧队长测试', lane: '辅助', gameId: 'OLD_CAPTAIN', score: 76, tier: 3, status: 'available' });
  ownerBeforePromote.playerId = 'old-captain-player';
  H.normalizeState(H.state);
  H.actions.promotePlayerToCaptain(draftedPromotePlayer.id);
  assert(ownerBeforePromote.playerId === draftedPromotePlayer.id && !ownerBeforePromote.team.includes(draftedPromotePlayer.id), '已入队队员晋升队长时应替换所在队伍队长且不占队员名额');
  assert(H.state.players.find(player => player.id === 'old-captain-player').status === 'available', '原队长应回到自由选手池');
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
    content: 'name,lane,tier,score,gameId\nCSV选手,中路,3,91,CSV_001\n重复选手,上路,2,70,CSV_001',
  });
  assert(H.state.players.some(player => player.name === 'CSV选手' && player.tier >= 1 && player.tier <= 4), '选手库应能导入CSV选手并由系统安排卡池');
  assert(H.state.players.filter(player => player.gameId === 'CSV_001').length === 1, '选手导入应跳过重复游戏ID');
  const importedPlayer = H.state.players.find(player => player.name === 'CSV选手');
  H.actions.deletePlayer(importedPlayer.id);
  assert(!H.state.players.some(player => player.id === importedPlayer.id), '选手库应能删除选手');
  H.actions.setActiveView('hexcores');
  assert(app.innerHTML.includes('抽取 3 个候选') && app.innerHTML.includes('重置所有海克斯') && app.innerHTML.includes('resetAllHexcores') && app.innerHTML.includes('removeHexcore') && app.innerHTML.includes('assignHexcoreToCaptain'), '海克斯库页面应提供三选一抽取、移除、重置和兜底分配入口');
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
  H.actions.removeHexcore('c2', chosenSlot);
  const c2HexBefore = H.state.hexcoreAssignments.c2.length;
  H.actions.assignHexcoreToCaptain('c2', 'origin');
  assert(H.state.hexcoreAssignments.c2.length === c2HexBefore + 1, '海克斯库应能指定分配海克斯');
  H.actions.randomizeHexcoreDrawOrder();
  assert(H.state.hexcoreDraft.drawOrder.length === H.state.captains.length, '海克斯库应能随机制定抽取顺序');
  H.state.draft.runtimeEffects = [{ type: 'blind', sourceCaptainId: 'c2' }];
  H.actions.resetAllHexcores();
  assert(H.state.captains.every(captain => Array.isArray(H.state.hexcoreAssignments[captain.id]) && H.state.hexcoreAssignments[captain.id].length === 0), '重置所有海克斯应清空每个队长持有列表');
  assert(!H.state.hexcoreDraft.captainId && H.state.hexcoreDraft.slots.length === 0 && H.state.hexcoreDraft.drawOrder.length === 0, '重置所有海克斯应清空当前抽取会话和抽取顺序');
  assert(H.state.draft.runtimeEffects.length === 0, '重置所有海克斯应清空运行中的海克斯效果');
  H.actions.setActiveView('teams');
  assert(app.innerHTML.includes('新增队伍') && app.innerHTML.includes('saveCaptainName') && app.innerHTML.includes('待指定队长'), '队伍管理页面应提供实质操作，并对空队伍显示待指定队长');
  H.actions.setActiveView('rules');
  assert(app.innerHTML.includes('保存规则并重算流程'), '规则设置页面应提供保存入口');
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
  elements['rules-round-tier-1'] = { value: '1' };
  elements['rules-round-tier-2'] = { value: '2' };
  elements['rules-round-tier-3'] = { value: '4' };
  elements['rules-round-tier-4'] = { value: '3' };
  H.actions.updateRules();
  assert(H.state.captains.length === targetTeamCount, '规则设置应能调整队伍数量');
  assert(H.state.draft.round === 3, '规则设置应能调整当前轮次');
  assert(H.state.settings.drawCount === 4, '规则设置应能调整基础抽卡张数');
  assert(H.selectors.roundTier(3) === 4, '规则设置应能调整每轮卡池顺序');
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
