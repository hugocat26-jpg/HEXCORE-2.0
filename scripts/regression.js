const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const staticServer = require('./serve.js');
const multiplayerServer = require('./serve-multiplayer.js');
const multiplayerApiServer = require('../apps/server/server.js');
const multiplayerShared = require('../packages/shared');
const multiplayerRules = require('../packages/rules');
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

function createHarness(options = {}) {
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
  let storedState = options.storedState || '';
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
      getItem() { return storedState || null; },
      setItem(_key, value) { storedState = value; },
      removeItem() { storedState = ''; },
    },
    location: { protocol: 'http:', search: options.locationSearch || '', reload() {} },
    confirm() { return true; },
    prompt(message, defaultValue) { return defaultValue || '测试输入'; },
  };
  context.window = context;
  vm.createContext(context);
  sourceFiles.forEach(file => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return {
    H: context.Hexcore2,
    app,
    elements,
    workspaceMain,
    getStoredState() { return storedState; },
  };
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
  harness.H.state.draft.phase = 'setup';
  harness.H.ui.render();
  harness.H.actions.startDraft({ skipSnapshot: true });
  harness.H.actions.drawCards();
  return harness;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hungryWaveCommandIdForRoll({ tournamentId, round, sourceTeamId, buyerTeamId, playerId, remaining, wantedHit }) {
  for (let index = 1; index < 5000; index += 1) {
    const commandId = `cmd-api-hungry-roll-${wantedHit ? 'hit' : 'miss'}-${index}`;
    const seed = `${tournamentId || 'local'}:${round}:${sourceTeamId}:${buyerTeamId}:${playerId}:${commandId}`;
    const roll = Number.parseInt(crypto.createHash('sha256').update(seed).digest('hex').slice(0, 8), 16) % remaining;
    if ((wantedHit && roll === 0) || (!wantedHit && roll !== 0)) return commandId;
  }
  throw new Error('无法构造海浪命中测试 commandId');
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

function closeServer(server) {
  return new Promise(resolve => server.close(resolve));
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function requestJson(port, method, pathname, body, options = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const headers = {
      ...(payload ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      } : {}),
      ...(options.headers || {}),
    };
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathname,
      method,
      headers,
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function subscribeSse(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, method: 'GET' }, res => {
      let buffer = '';
      res.on('data', chunk => {
        buffer += chunk.toString('utf8');
        if (buffer.includes('event: snapshot')) {
          resolve({ req, res, initial: buffer });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function pngCornerAlphas(filePath) {
  const buffer = fs.readFileSync(filePath);
  assert(buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${path.basename(filePath)} 不是有效 PNG`);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const data = buffer.subarray(dataStart, dataEnd);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }

  assert(bitDepth === 8 && colorType === 6, `${path.basename(filePath)} 必须是 8-bit RGBA PNG，便于校验透明背景`);
  const channels = 4;
  const rowBytes = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  let rawOffset = 0;
  let previous = new Uint8Array(rowBytes);
  const corners = [];

  for (let y = 0; y < height; y += 1) {
    const filter = raw[rawOffset];
    rawOffset += 1;
    const current = new Uint8Array(rowBytes);
    for (let x = 0; x < rowBytes; x += 1) {
      const value = raw[rawOffset + x];
      const left = x >= channels ? current[x - channels] : 0;
      const up = previous[x] || 0;
      const upLeft = x >= channels ? previous[x - channels] || 0 : 0;
      let reconstructed = value;
      if (filter === 1) reconstructed = value + left;
      else if (filter === 2) reconstructed = value + up;
      else if (filter === 3) reconstructed = value + Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        const predictor = pa <= pb && pa <= pc ? left : (pb <= pc ? up : upLeft);
        reconstructed = value + predictor;
      } else if (filter !== 0) {
        throw new Error(`${path.basename(filePath)} 使用了未知 PNG filter：${filter}`);
      }
      current[x] = reconstructed & 255;
    }
    rawOffset += rowBytes;
    if (y === 0 || y === height - 1) {
      corners.push(current[3], current[(width - 1) * channels + 3]);
    }
    previous = current;
  }
  return corners;
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

function testTurnContextShowsTeamAndCaptainNames() {
  const { H, app } = createReadyHarness();
  const captain = currentCaptain(H);
  const captainPlayer = H.selectors.captainPlayer(captain.id);
  assert(captain && captainPlayer, '测试前提：当前队伍应有队长选手');
  assert(app.innerHTML.includes(captain.name), '顺位卡片应显示队伍名');
  assert(app.innerHTML.includes(`队长 ${captainPlayer.name}`), '顺位卡片应同时显示队长名称');
  assert(!app.innerHTML.includes(`<em>${captain.record || '待定'}</em>`), '顺位卡片不应继续用战绩/待定占用队长名称位置');
  H.state.ui.orderDrawerOpen = true;
  H.ui.render();
  assert(app.innerHTML.includes(`队长 ${captainPlayer.name}`), '顺位详情也应显示队长名称');
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

  assert(H.state.players.length === 50, '默认测试数据应提供10队组队所需的50名选手');
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

function testReloadDoesNotAutoStartShop() {
  const first = createHarness();
  installReadyTestData(first.H);
  first.H.state.draft.phase = 'captain_action';
  first.H.state.draft.started = true;
  first.H.state.draft.currentDraw = null;
  first.H.state.draft.currentIndex = 0;
  first.H.storageService.save(first.H.state);
  const stored = first.getStoredState();
  const storedEventCount = JSON.parse(stored).state.events.length;

  const reloaded = createHarness({ storedState: stored });
  const firstCaptain = reloaded.H.state.captains[0];
  const roundState = reloaded.H.economyEngine.roundState(firstCaptain.id, 1);
  assert(!reloaded.H.state.draft.currentDraw, '刷新页面不应自动为当前队长生成商店');
  assert(!roundState.freeShopUsed, '刷新页面不应自动消耗当前队长本轮免费商店权');
  assert(reloaded.H.state.events.length === storedEventCount, '刷新页面不应追加自动开店日志');
}

function testBootRecoveryDoesNotClearSavedState() {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const recoverStart = html.indexOf('function recoverOnce');
  const recoverEnd = html.indexOf('window.addEventListener', recoverStart);
  const recoverBody = html.slice(recoverStart, recoverEnd);
  const errorHandlerStart = html.indexOf("window.addEventListener('error'");
  const errorHandlerEnd = html.indexOf("window.addEventListener('unhandledrejection'", errorHandlerStart);
  const errorHandlerBody = html.slice(errorHandlerStart, errorHandlerEnd);
  assert(recoverStart >= 0 && recoverEnd > recoverStart, '首页应保留启动恢复逻辑，便于校验数据安全');
  assert(!recoverBody.includes('storageRemove(window.localStorage, STORAGE_KEY)'), '启动错误自动恢复不能删除本地状态，否则会清空选手库');
  assert(recoverBody.includes('window.location.replace'), '启动错误可自动重载一次，但必须保留 localStorage 状态供人工恢复');
  assert(errorHandlerBody.includes("!('message' in event)") || errorHandlerBody.includes('!("message" in event)'), '启动错误恢复应忽略图片等资源加载失败，避免买卡重渲染时误判为系统崩溃');
  const uiSource = fs.readFileSync(path.join(root, 'src/ui/referee-console.js'), 'utf8');
  assert(uiSource.includes('var root=this.closest&&this.closest') && uiSource.includes('if(root) root.classList.add'), '海克斯图标加载失败处理应保护 closest 为空的情况');
}

function testScoreFallbackDirectTier() {
  const { H } = createHarness();
  H.state.captains = [];
  H.state.players = [
    { id: 'f5', name: '兜底五费', gameId: 'F5', lane: '全能', camp: 'local', score: 5, status: 'available' },
    { id: 'f4', name: '兜底四费', gameId: 'F4', lane: '全能', camp: 'local', score: 4, status: 'available' },
    { id: 'f1', name: '兜底一费', gameId: 'F1', lane: '全能', camp: 'local', score: 1, status: 'available' },
    { id: 'legacy', name: '旧兜底四费', gameId: 'LEGACY', lane: '全能', camp: 'local', score: 4, resultScore: 4, status: 'available' },
    { id: 'history', name: '历史优先', gameId: 'HISTORY', lane: '全能', camp: 'local', score: 1, seasonResults: { S1: '冠军' }, status: 'available' },
  ];
  H.normalizeState(H.state);

  const byId = id => H.state.players.find(player => player.id === id);
  assert(byId('f5').tier === 5 && byId('f5').tierSource === 'score', '无历史成绩时 score=5 应直接进入5费池');
  assert(byId('f4').tier === 4 && byId('f4').tierSource === 'score', '无历史成绩时 score=4 应直接进入4费池');
  assert(byId('f1').tier === 1 && byId('f1').tierSource === 'score', '无历史成绩时 score=1 应直接进入1费池');
  assert(byId('legacy').tier === 4 && byId('legacy').tierSource === 'score', '旧存档中由 score 兜底生成的 resultScore 不应被误判为官方成绩');
  assert(byId('history').tier === 5 && byId('history').tierSource === 'seasonResults', '有S1-S6历史成绩时应优先按官方成绩分档，而不是直接使用score');
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
  H.state.draft.currentDraw = null;
  H.ui.render();
  assert((app.innerHTML.match(/shop-empty-slot/g) || []).length >= 6, '未开店时商店应常驻6个卡片占位');
  assert(app.innerHTML.includes('card-back') && app.innerHTML.includes('待开店') && app.innerHTML.includes('备用卡位'), '未开店空卡片应显示前5个待开店和第6个备用卡位');
  H.actions.drawCards();
  const selectedSlot = H.state.draft.currentDraw.cards[0];
  const expectedTierClass = `tier-${selectedSlot.price || selectedSlot.tier}`;
  assert(app.innerHTML.includes(expectedTierClass), '商店卡片应按费用渲染费用边框类');
  assert(app.innerHTML.includes('shop-reveal') && app.innerHTML.includes('--slot-index:0'), '抽卡后商店卡片应进入翻转揭示状态');
  H.ui.render();
  assert(!app.innerHTML.includes('shop-reveal'), '商店卡片已翻开后，普通重渲染不应再次播放翻转动画');
  assert((app.innerHTML.match(/player-card tier-/g) || []).length === H.state.draft.currentDraw.cards.length, '有额外抽卡海克斯时应按实际抽到数量展示选手卡片');
  const extraPlayer = H.state.players.find(player =>
    player.status === 'available'
    && !H.state.draft.currentDraw.cards.some(card => card.playerId === player.id)
  );
  H.state.draft.currentDraw.cards.push({
    playerId: extraPlayer.id,
    displayPlayerId: extraPlayer.id,
    tier: Number(extraPlayer.tier) || 1,
    price: Number(extraPlayer.tier) || 1,
  });
  H.ui.render();
  assert((app.innerHTML.match(/player-card tier-/g) || []).length >= 6, '海克斯额外抽到第6张时，第6个常驻卡位应显示选手卡片');
  assert(!app.innerHTML.includes('备用卡位'), '第6张有选手卡片时不应继续显示备用卡位');
  assert(app.innerHTML.includes('shop-card-action-hint') && app.innerHTML.includes('点击购买'), '可购买商店卡应展示直接点击购买提示');
  assert(!app.innerHTML.includes('购买此卡'), '直接点击购买模式下裁判操作区不应再显示购买此卡按钮');

  H.actions.buyCard(0);

  assert(H.state.draft.currentDraw.cards[0].purchased, '购买成功后当前商店卡应标记为已购买');
  assert(app.innerHTML.includes('shop-empty-slot'), '购买成功后商店原位置应显示为空槽');
  assert(!app.innerHTML.includes('purchased-card'), '购买成功后不应继续显示已购买卡片');
  const teamSizeAfterPurchase = H.selectors.teamSize(H.selectors.currentCaptain().id);
  H.actions.buyCard(1);
  assert(H.selectors.teamSize(H.selectors.currentCaptain().id) === teamSizeAfterPurchase, '已购买后再次点击其他卡不应重复入队');
  assert(H.state.events[0].title === '购买失败' && H.state.events[0].body.includes('购买权已使用'), '重复点击购买应给出明确失败原因');

  const poor = createReadyHarness();
  const poorCaptain = poor.H.selectors.currentCaptain();
  poorCaptain.economy.gold = 0;
  const poorSlot = poor.H.state.draft.currentDraw.cards[0];
  poor.H.actions.buyCard(0);
  assert(!poorSlot.purchased, '金币不足时点击卡片不应标记为已购买');
  assert(!poorCaptain.team.includes(poorSlot.playerId), '金币不足时点击卡片不应把选手加入队伍');
  assert(poor.H.state.events[0].title === '购买失败' && poor.H.state.events[0].body.includes('金币不足'), '金币不足时应记录明确失败原因');
}

function testDraftRequiresStartButtonAndOriginSageNotice() {
  const harness = createHarness();
  const H = harness.H;
  installReadyTestData(H);
  releaseHexcoreEverywhere(H, 'origin-sage');
  const originCaptain = H.state.captains[2];
  setOnlyHexcore(H, originCaptain.id, 'origin-sage');
  H.state.draft.phase = 'setup';
  H.state.draft.round = 1;
  H.state.draft.currentIndex = 0;
  H.state.draft.currentDraw = null;
  H.turnOrderEngine.recompute();
  H.ui.render();
  assert(!H.selectors.currentCaptain(), '第一轮开始前不应直接进入第一位队长');
  assert(harness.app.innerHTML.includes('开始抽卡') && harness.app.innerHTML.includes('触发轮初海克斯'), '第一轮开始前应显示开始抽卡按钮');
  H.actions.drawCards();
  assert(!H.state.draft.currentDraw, '未点击开始抽卡前不应允许直接生成商店');
  H.actions.startDraft();
  assert(H.state.draft.phase === 'captain_action', '点击开始抽卡后应进入队长操作阶段');
  assert(H.state.draft.started, '点击开始抽卡后应记录抽卡流程已开始，避免旧状态再次被迁移回待开始');
  assert(H.state.ui.originSageNotice && H.state.ui.originSageNotice.captainIds.includes(originCaptain.id), '点击开始抽卡后应触发神秘贤者启元轮初弹窗');
  assert(!H.state.draft.currentDraw, '轮初海克斯弹窗未处理前不应打开商店');
  assert(harness.app.innerHTML.includes('处理轮初海克斯') && harness.app.innerHTML.includes('请先关闭神秘贤者·启元提示'), '启元提示存在时商店按钮应禁用并提示先处理轮初海克斯');
  assert(H.state.draft.currentOrder[0] === originCaptain.id, '神秘贤者启元应在第一轮开始时将持有者提到首位');

  const directHarness = createHarness();
  const direct = directHarness.H;
  installReadyTestData(direct);
  releaseHexcoreEverywhere(direct, 'origin-sage');
  const directOriginCaptain = direct.state.captains[3];
  setOnlyHexcore(direct, directOriginCaptain.id, 'origin-sage');
  direct.state.draft.phase = 'captain_action';
  direct.state.draft.started = true;
  direct.state.draft.round = 1;
  direct.state.draft.currentIndex = 0;
  direct.state.draft.currentDraw = null;
  direct.state.ui.originSageNotice = null;
  direct.turnOrderEngine.recompute();
  direct.actions.drawCards();
  assert(direct.state.ui.originSageNotice && direct.state.ui.originSageNotice.captainIds.includes(directOriginCaptain.id), '直接开店时若刚触发神秘贤者启元，也应先弹出提示');
  assert(!direct.state.draft.currentDraw, '直接开店时刚触发启元提示也不应同步生成商店');

  const legacyHarness = createHarness();
  const legacy = legacyHarness.H;
  installReadyTestData(legacy);
  legacy.state.draft.phase = 'captain_action';
  legacy.state.draft.started = false;
  legacy.state.draft.round = 1;
  legacy.state.draft.currentIndex = 0;
  legacy.state.draft.currentDraw = null;
  legacy.state.draft.pickedThisTurn = false;
  legacy.state.captains.forEach(captain => {
    captain.team = [];
    Object.values(captain.economy.roundState || {}).forEach(state => {
      state.freeShopUsed = false;
      state.refreshCount = 0;
      state.purchaseUsed = false;
      state.skipped = false;
    });
  });
  legacy.normalizeState(legacy.state);
  assert(legacy.state.draft.phase === 'setup', '旧存档若第一轮未实际开店，应迁移回待开始并显示开始按钮');
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
  assert(app.innerHTML.includes('本地人卡池 25'), '选手库应展示本地人卡池人数');
  assert(app.innerHTML.includes('外地人卡池 25'), '选手库应展示外地人卡池人数');
  assert(app.innerHTML.includes('选手可超过组队需求'), '选手库应说明允许空闲选手');
  assert(app.innerHTML.includes('队长锁定'), '队长应在费用池中显示队长锁定标记');
  assert(app.innerHTML.includes('费边界'), '选手卡应展示费用池边界解释');
  assert(app.innerHTML.includes('历史成绩有效的选手按官方成绩五档重分') || app.innerHTML.includes('score 直落'), '选手卡应说明官方成绩分档或score直落规则');

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
  assert(H.state.ui.playerImportSelected.length === 1, '导入预览应默认勾选全部可导入选手');
  assert(app.innerHTML.includes('确认导入 1 名') && app.innerHTML.includes('type="checkbox"'), '导入预览应显示可勾选选手并按选择数更新确认按钮');
  H.actions.togglePlayerImportSelection(0);
  assert(H.state.ui.playerImportSelected.length === 0, '导入预览应允许取消勾选单个选手');
  assert(app.innerHTML.includes('确认导入 0 名') || app.innerHTML.includes('disabled'), '未选择选手时确认导入应不可用');
  H.actions.setPlayerImportSelection('all');
  H.actions.confirmPlayerImport();
  assert(H.state.players.length === initialPlayerCount + 1, '确认导入后才写入有效选手');

  H.state.players = [];
  const overflowRows = ['name,gameId,lane,camp,score'];
  for (let index = 1; index <= 55; index += 1) {
    overflowRows.push(`扩展选手${index},EXTRA_${index},全能,${index <= 30 ? '本地人' : '外地人'},${80 - (index % 20)}`);
  }
  H.actions.importPlayers({ name: 'overflow.csv', content: overflowRows.join('\n') });
  assert(H.state.ui.playerImportPreview.accepted.length === 55, '导入预览不应再按50人上限截断');
  H.actions.setPlayerImportSelection('none');
  H.actions.togglePlayerImportSelection(0);
  H.actions.togglePlayerImportSelection(1);
  H.actions.confirmPlayerImport();
  assert(H.state.players.length === 2, '确认导入时只应写入已勾选的选手');
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
  assert(H.state.ui.playerImportSelected.length === 50, '完整流程导入预览应默认全选50名选手');
  assert(H.state.ui.playerImportPage === 1 && H.state.ui.playerImportTab === 'accepted', '导入预览应默认停留在可导入列表第一页');
  H.actions.setPlayerImportPage(2);
  assert(H.state.ui.playerImportPage === 2, '导入预览人数较多时应支持分页');
  H.actions.setPlayerImportTab('skipped');
  assert(H.state.ui.playerImportTab === 'skipped' && H.state.ui.playerImportPage === 1, '导入预览切换跳过项时应重置分页');
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

function testDissolveTeamsKeepsCaptainsAndHexcores() {
  const { H, app } = createReadyHarness();
  const captain = H.state.captains[0];
  const captainPlayer = H.selectors.captainPlayer(captain.id);
  const teammate = H.state.players.find(player =>
    player.status === 'available'
    && player.camp === H.selectors.captainCamp(captain.id)
    && !H.selectors.isCaptainPlayer(player.id)
  );
  teammate.status = 'drafted';
  teammate.teamId = captain.id;
  captain.team = [teammate.id];
  H.state.hexcoreAssignments[captain.id] = [assignedHexcore(H.sampleData.hexcores.find(hex => hex.id === 'charged-cannon'))];
  H.state.draft.currentDraw = { captainId: captain.id, cards: [{ slot: 0, playerId: teammate.id, price: 1 }] };
  H.state.draft.phase = 'captain_action';
  H.state.draft.round = 3;
  H.state.draft.currentIndex = 5;
  H.state.draft.started = true;
  H.state.draft.runtimeEffects = [{ type: 'test_effect', captainId: captain.id }];
  captain.economy.gold = 1;
  captain.economy.roundState[3].freeShopUsed = true;
  captain.economy.roundState[3].purchaseUsed = true;
  captain.hexcoreEconomy = { decomposeKnowledgeStacks: 2 };

  H.actions.setActiveView('teams');
  assert(app.innerHTML.includes('一键解散队伍'), '队伍管理工具栏应显示一键解散队伍按钮');
  H.actions.openDissolveTeamsDialog();
  assert(H.state.ui.dissolveTeamsConfirm && app.innerHTML.includes('保留队长并解散'), '点击一键解散应打开模式选择弹窗');
  H.actions.dissolveAllTeams(true);

  assert(captain.team.length === 0, '保留队长解散时普通队员应全部移出队伍');
  assert(teammate.status === 'available' && !teammate.teamId, '保留队长解散时普通队员应返回可选池');
  assert(captain.playerId === captainPlayer.id && captainPlayer.status === 'captain', '保留队长解散时队长身份应保留');
  assert((H.state.hexcoreAssignments[captain.id] || []).some(hex => hex.id === 'charged-cannon'), '保留队长解散时海克斯应保留');
  assert(!H.state.draft.currentDraw && H.state.draft.runtimeEffects.length === 0, '一键解散后应清空当前商店和轮内临时效果');
  assert(H.state.draft.phase === 'setup' && H.state.draft.round === 1 && H.state.draft.currentIndex === 0 && !H.state.draft.started, '保留队长解散后应回到第一轮开始前');
  assert(H.selectors.workflowStatus().playersDraftReady, '保留队长和海克斯后应允许直接重新开始选人');
  assert(captain.economy.gold === H.state.settings.initialGold && !captain.economy.roundState[3].purchaseUsed, '保留队长解散后应重置金币和轮次购买状态');
  assert((H.state.hexcoreAssignments[captain.id] || [])[0].status !== 'used' && !(H.state.hexcoreAssignments[captain.id] || [])[0].lastUsedRound, '保留队长解散后主动海克斯应恢复可用状态');
  assert(!H.state.ui.dissolveTeamsConfirm, '一键解散后应关闭确认弹窗');
  assert(H.state.events[0] && H.state.events[0].title === '一键解散队伍', '一键解散应写入事件日志');
}

function testDissolveTeamsReleasesCaptainsAndHexcores() {
  const { H } = createReadyHarness();
  const captain = H.state.captains[0];
  const captainPlayer = H.selectors.captainPlayer(captain.id);
  const teammate = H.state.players.find(player =>
    player.status === 'available'
    && player.camp === H.selectors.captainCamp(captain.id)
    && !H.selectors.isCaptainPlayer(player.id)
  );
  teammate.status = 'drafted';
  teammate.teamId = captain.id;
  captain.team = [teammate.id];
  H.state.hexcoreAssignments[captain.id] = [assignedHexcore(H.sampleData.hexcores.find(hex => hex.id === 'charged-cannon'))];
  H.state.hexcoreDraft.captainId = captain.id;
  H.state.hexcoreDraft.slots = ['charged-cannon'];

  H.actions.openDissolveTeamsDialog();
  H.actions.dissolveAllTeams(false);

  assert(captain.team.length === 0 && !captain.playerId, '不保留队长解散时队伍应变为空壳');
  assert(captainPlayer.status === 'available' && !captainPlayer.teamId, '不保留队长解散时队长应回到可选池');
  assert(teammate.status === 'available' && !teammate.teamId, '不保留队长解散时普通队员也应回到可选池');
  assert((H.state.hexcoreAssignments[captain.id] || []).length === 0, '不保留队长解散时该队海克斯应清空');
  assert(!H.state.hexcoreDraft.captainId && H.state.hexcoreDraft.slots.length === 0, '不保留队长解散时应清空正在进行的海克斯抽取会话');
  assert(!H.selectors.workflowStatus().captainReady && !H.selectors.workflowStatus().playersDraftReady, '全部回卡池后应要求先重新设置队长并抽海克斯');
  const workflowAfterDissolve = H.selectors.workflowStatus();
  assert(
    workflowAfterDissolve.checklist.blockingItems.some(item => item.id === 'captain-player')
      && workflowAfterDissolve.stage.order <= 2,
    `全部回卡池后的下一步应回到队长配置，当前阶段：${workflowAfterDissolve.stage.id}`
  );
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

  assert(H.meta.version === '2.0.18' && app.innerHTML.includes('HEXCORE 2.0 v2.0.18 裁判端'), '系统设置页应展示统一项目版本号');
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
  captain.team = [otherCampPlayer.id];

  H.actions.runSystemCheck();
  assert(
    H.state.ui.systemCheckResult.issues.some(issue => issue.type === '跨阵营'),
    '完整性检查应按绝对阵营锁识别所有跨阵营入队，即使旧数据带有规则例外标记'
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

  const wiseHarness = createReadyHarness();
  const wise = wiseHarness.H;
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
  wise.ui.render();
  assert(wiseHarness.app.innerHTML.includes('免费刷新（1）') && wiseHarness.app.innerHTML.includes('贤者的博爱'), '拥有贤者的博爱免费刷新时界面应显示免费刷新次数');
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
  assert(!origin.hexcoreEngine.activate('origin-sage').ok, '神秘贤者·启元改为轮次开始自动生效后不应再允许手动发动');
  assert(origin.state.draft.currentOrder[originBeforeIndex] === originCaptain.id, '神秘贤者·启元手动调用失败时不应改变当前顺位');

  const originAutoHarness = createReadyHarness();
  const originAuto = originAutoHarness.H;
  const originAutoCaptain = originAuto.state.captains[2];
  releaseHexcoreEverywhere(originAuto, 'origin-sage');
  originAuto.state.hexcoreAssignments[originAutoCaptain.id] = [];
  originAuto.actions.assignHexcoreToCaptain(originAutoCaptain.id, 'origin-sage');
  originAuto.state.draft.currentOrder = originAuto.state.captains.map(captain => captain.id);
  originAuto.state.draft.currentIndex = originAuto.state.draft.currentOrder.length - 1;
  originAuto.state.draft.currentDraw = null;
  originAuto.actions.nextCaptain({ skipSnapshot: true });
  assert(originAuto.state.draft.round === 2, '测试前提：启元自动生效应在进入第2轮时检查');
  assert(originAuto.state.draft.currentOrder[0] === originAutoCaptain.id, '神秘贤者·启元应在轮次开始时自动将持有者提到第一顺位');
  const originAutoHex = originAuto.state.hexcoreAssignments[originAutoCaptain.id].find(hex => hex.id === 'origin-sage');
  assert(Number(originAutoHex.lastUsedRound) === 2, '神秘贤者·启元轮次开始自动生效后应记录本轮已使用');
  assert(originAuto.state.events.some(event => event.title === '神秘贤者·启元' && event.body.includes('自动生效')), '神秘贤者·启元轮次开始自动生效应写入明显日志');
  assert(originAuto.state.ui.originSageNotice && originAuto.state.ui.originSageNotice.captainIds.includes(originAutoCaptain.id), '神秘贤者·启元自动生效应创建居中提示弹窗状态');
  originAuto.ui.render();
  assert(originAutoHarness.app.innerHTML.includes('origin-sage-modal') && originAutoHarness.app.innerHTML.includes('顺位来到了第一名'), '神秘贤者·启元自动生效应在界面中央展示提示弹窗');
  originAuto.state.ui.originSageNotice.expiresAt = Date.now() + 2200;
  originAuto.ui.render();
  assert(originAutoHarness.app.innerHTML.includes('data-countdown="origin-sage">3</b> 秒后自动关闭') || originAutoHarness.app.innerHTML.includes('data-countdown="origin-sage">2</b> 秒后自动关闭'), '神秘贤者·启元弹窗倒计时应按剩余时间实时显示');
  originAuto.actions.closeOriginSageNotice();
  assert(!originAuto.state.ui.originSageNotice, '神秘贤者·启元提示弹窗应可提前关闭');

  const vampireHarness = createReadyHarness();
  const vampire = vampireHarness.H;
  vampire.state.draft.currentIndex = 6;
  vampire.ui.render();
  const vampireCaptain = currentCaptain(vampire);
  const vampireBeforeGold = vampireCaptain.economy.gold;
  const vampireResult = vampire.actions.useHexcore('vampiric-habit');
  assert(vampireResult && vampireResult.ok, '吸血习性应可从金币最高的其他队长处吸取金币');
  assert(vampireCaptain.economy.gold === vampireBeforeGold + 3, '吸血习性应最多获得3金币');
  assert(vampire.state.ui.economyReveal && vampire.state.ui.economyReveal.rows.length === 3, '吸血习性结算后应打开经济弹窗并列出3名来源队长');
  assert(vampireHarness.app.innerHTML.includes('吸血习性结算') && vampireHarness.app.innerHTML.includes('当前队长获得金币') && vampireHarness.app.innerHTML.includes('-1'), '吸血习性弹窗应展示获得总额和每位队长扣除金币');
  vampire.actions.confirmEconomyReveal();
  assert(!vampire.state.ui.economyReveal, '吸血习性经济弹窗应可确认关闭');

  const steady = createReadyHarness().H;
  steady.state.draft.currentIndex = 2;
  const steadyCaptain = currentCaptain(steady);
  setOnlyHexcore(steady, steadyCaptain.id, 'steady-reinforce');
  const steadyResult = steady.hexcoreEngine.activate('steady-reinforce');
  assert(steadyResult.ok, '稳健补强应从同阵营最低费用池分配');
  assert(steadyResult.reveal && steadyResult.reveal.playerIds.length === 1, '稳健补强成功后应返回入队揭示数据');
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
  assert(decomposeResult.reveal && decomposeResult.reveal.playerIds.includes(decomposeTarget.id), '知识来源于分解成功后应返回入队揭示数据');
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
  const stuckMaxTier = stuck.hexcoreEngine.stuckTogetherMaxTier();
  assert(stuckMaxTier === 2, '和我困在一起第1轮费用上限应为2费');
  const overCapTarget = stuck.state.players.find(player =>
    player.status === 'available'
    && player.camp === stuck.selectors.captainCamp(stuckCaptain.id)
    && Number(player.tier) > stuckMaxTier
    && !stuck.selectors.isCaptainPlayer(player.id)
  ) || {
    id: 'regression-stuck-over-cap',
    name: '上限外测试选手',
    camp: stuck.selectors.captainCamp(stuckCaptain.id),
    tier: stuckMaxTier + 1,
    score: 99,
    status: 'available',
  };
  if (!stuck.state.players.some(player => player.id === overCapTarget.id)) {
    stuck.state.players.push(overCapTarget);
  }
  assert(
    !stuck.hexcoreEngine.stuckTogetherTargets(stuckCaptain.id).some(player => player.id === overCapTarget.id),
    '和我困在一起目标池应排除超过本轮费用上限的全池选手'
  );
  const overCapResult = stuck.hexcoreEngine.activate('stuck-together', { targetPlayerId: overCapTarget.id });
  assert(
    !overCapResult.ok && overCapResult.reason.includes(`不高于${stuckMaxTier}费`),
    '和我困在一起选择超过费用上限的选手时应失败并提示费用限制'
  );
  const stuckTarget = stuck.hexcoreEngine.stuckTogetherTargets(stuckCaptain.id)
    .find(player => player.camp === stuck.selectors.captainCamp(stuckCaptain.id));
  assert(stuckTarget, '和我困在一起目标池应包含未被选走的同阵营选手');
  assert(
    stuck.hexcoreEngine.stuckTogetherTargets(stuckCaptain.id).every(player => player.camp === stuck.selectors.captainCamp(stuckCaptain.id)),
    '和我困在一起目标池不得出现异阵营选手'
  );
  assert(
    stuck.hexcoreEngine.stuckTogetherTargets(stuckCaptain.id).every(player => Number(player.tier) <= stuckMaxTier),
    '和我困在一起目标池不得出现超过本轮费用上限的选手'
  );
  assert(stuck.hexcoreEngine.activate('stuck-together', { targetPlayerId: stuckTarget.id }).ok, '和我困在一起应可指定同阵营未被选走的可选选手');
  assert(stuck.state.draft.runtimeEffects.some(effect => effect.type === 'stuck_together' && effect.playerId === stuckTarget.id), '和我困在一起应记录下一轮延迟检查效果');
  stuck.state.draft.round = 2;
  stuck.economyEngine.roundState(stuckCaptain.id, 2).purchaseUsed = false;
  stuck.economyEngine.roundState(stuckCaptain.id, 2).skipped = false;
  const stuckResult = stuck.hexcoreEngine.autoAssignBeforeDraw(stuckCaptain.id);
  assert(stuckResult.handled && stuckResult.assigned, '和我困在一起下一轮目标仍可选时应自动入队');
  assert(stuckResult.reveal && stuckResult.reveal.playerIds.includes(stuckTarget.id), '和我困在一起延迟入队成功后应返回入队揭示数据');
  assert(stuckCaptain.team.includes(stuckTarget.id), '和我困在一起应将锁定目标加入队伍');
  assert(!stuckTarget.teamBypassReason, '和我困在一起同阵营入队不应记录跨阵营例外来源');
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
  assert(storm.state.draft.currentDraw.appliedEffects.some(effect => effect.type === 'weather_fog'), '受影响队长开店时应进入天气迷雾效果');
  assert(!fogEffects.find(effect => effect.captainId === stormTarget).consumed, '天气迷雾不应在首次开店时被消费');
  storm.state.draft.currentDraw = storm.shopEngine.generate(stormTarget, { generatedBy: 'paid_refresh' });
  assert(storm.state.draft.currentDraw.appliedEffects.some(effect => effect.type === 'weather_fog'), '受影响队长刷新商店后仍应保持天气迷雾');
  assert(!fogEffects.find(effect => effect.captainId === stormTarget).consumed, '刷新商店不应清除天气迷雾效果');
  storm.ui.render();
  assert(stormHarness.app.innerHTML.includes('weather-fog-card'), '天气迷雾商店卡应使用迷雾卡片样式');
  const fogPlayerId = storm.state.draft.currentDraw.cards[0].playerId;
  storm.state.captains.find(captain => captain.id === stormTarget).economy.gold = 20;
  storm.state.draft.selectedSlot = 0;
  storm.actions.pickCard(0);
  const purchasedFogSlot = storm.state.draft.currentDraw.cards[0];
  assert(purchasedFogSlot.purchased, '天气迷雾购买后应标记卡槽已购买');
  assert(Number(purchasedFogSlot.revealUntil) > Date.now(), '天气迷雾购买后应保留5秒真实揭示窗口');
  assert(storm.state.captains.find(captain => captain.id === stormTarget).team.includes(fogPlayerId), '天气迷雾购买后应按真实卡牌选手入队');
  storm.ui.render();
  assert(stormHarness.app.innerHTML.includes('purchased-reveal-card'), '天气迷雾购买后应临时显示真实信息卡片');
  assert(stormHarness.app.innerHTML.includes('weather-fog-revealing'), '天气迷雾购买后应保留逐渐消失的雾层动画');
  assert(stormHarness.app.innerHTML.includes('已购买揭示'), '天气迷雾购买后应提示真实信息揭示中');
  delete purchasedFogSlot.revealUntil;
  purchasedFogSlot.revealFlipUntil = Date.now() + 500;
  storm.ui.render();
  assert(!stormHarness.app.innerHTML.includes('purchased-reveal-card'), '天气迷雾揭示期结束后不应继续显示真实信息卡片');
  assert(stormHarness.app.innerHTML.includes('purchased-flip-in'), '天气迷雾揭示期结束后应先播放翻转为已购买的动画');
  assert(stormHarness.app.innerHTML.includes('shop-empty-slot purchased'), '天气迷雾揭示期结束后应回到已购买卡位');
  purchasedFogSlot.revealFlipUntil = Date.now() - 1;
  storm.ui.render();
  assert(!stormHarness.app.innerHTML.includes('purchased-flip-in'), '天气迷雾翻转动画结束后应回到稳定的已购买卡位');
  storm.actions.nextCaptain({ skipSnapshot: true });
  assert(fogEffects.find(effect => effect.captainId === stormTarget).consumed, '受影响队长购买权结束后应清除天气迷雾');

  const stormHungry = createReadyHarness().H;
  stormHungry.state.draft.currentIndex = 0;
  const stormHungryCaptain = currentCaptain(stormHungry);
  stormHungry.state.hexcoreAssignments[stormHungryCaptain.id] = [
    { ...stormHungry.sampleData.hexcores.find(hex => hex.id === 'storm-fog'), status: 'available' },
  ];
  const hungryFogTarget = stormHungry.state.captains.find(captain =>
    captain.id !== stormHungryCaptain.id
    && stormHungry.state.draft.currentOrder.indexOf(captain.id) > 1
  );
  releaseHexcoreEverywhere(stormHungry, 'hungry-wave');
  stormHungry.state.hexcoreAssignments[hungryFogTarget.id] = [
    { ...stormHungry.sampleData.hexcores.find(hex => hex.id === 'hungry-wave'), status: 'passive' },
  ];
  assert(!stormHungry.hexcoreEngine.weatherFogTargets(stormHungryCaptain.id).some(captain => captain.id === hungryFogTarget.id), '拥有海浪我没吃饭的队伍不能作为骤雨血雾清风起点目标');
  assert(!stormHungry.hexcoreEngine.activate('storm-fog', { targetCaptainId: hungryFogTarget.id }).ok, '骤雨血雾清风不能直接选中拥有海浪我没吃饭的队伍');
  const hungryStartIndex = stormHungry.state.draft.currentOrder.indexOf(hungryFogTarget.id);
  const beforeHungryTarget = stormHungry.state.draft.currentOrder[Math.max(0, hungryStartIndex - 1)];
  assert(stormHungry.hexcoreEngine.activate('storm-fog', { targetCaptainId: beforeHungryTarget }).ok, '测试前提：血雾应可选择海浪队伍前一位作为起点');
  const hungrySkippedFogEffects = stormHungry.state.draft.runtimeEffects.filter(effect => effect.type === 'weather_fog');
  assert(!hungrySkippedFogEffects.some(effect => effect.captainId === hungryFogTarget.id), '骤雨血雾清风顺延链也应跳过拥有海浪我没吃饭的队伍');

  const stormWrap = createReadyHarness().H;
  stormWrap.state.draft.currentIndex = stormWrap.state.draft.currentOrder.length - 1;
  const stormWrapCaptain = currentCaptain(stormWrap);
  stormWrap.state.hexcoreAssignments[stormWrapCaptain.id] = [
    { ...stormWrap.sampleData.hexcores.find(hex => hex.id === 'storm-fog'), status: 'available' },
  ];
  const wrapTarget = stormWrap.state.draft.currentOrder[0];
  const skippedNextRoundCaptain = stormWrap.state.draft.currentOrder[1];
  stormWrap.economyEngine.roundState(skippedNextRoundCaptain, 2).purchaseUsed = true;
  assert(stormWrap.hexcoreEngine.activate('storm-fog', { targetCaptainId: wrapTarget }).ok, '最后一位队长应可对本轮第一位队长使用骤雨血雾清风');
  const wrapFogEffects = stormWrap.state.draft.runtimeEffects.filter(effect => effect.type === 'weather_fog');
  assert(wrapFogEffects.length === 3, `骤雨血雾清风跨轮应补足3名有效队长，当前 ${wrapFogEffects.length}`);
  assert(Number(wrapFogEffects[0].triggerRound) === 2 && wrapFogEffects[0].captainId === wrapTarget, '对已过本轮窗口的目标使用时，血雾起点应挂到下一轮该目标实际行动时生效');
  assert(!wrapFogEffects.some(effect => effect.captainId === stormWrapCaptain.id), '血雾跨轮补位应跳过使用者');
  assert(wrapFogEffects.map(effect => effect.captainId).join(',') === [wrapTarget, skippedNextRoundCaptain, stormWrap.state.draft.currentOrder[2]].join(','), '血雾应从指定目标开始按后续轮次最终顺位顺延补足有效队长');
  assert(wrapFogEffects.map(effect => Number(effect.triggerRound)).join(',') === '2,3,3', '若目标在下一轮最终顺位末尾，后续血雾应顺延到再下一轮');

  const stormSkip = createReadyHarness().H;
  stormSkip.state.draft.currentIndex = stormSkip.state.draft.currentOrder.length - 1;
  const stormSkipCaptain = currentCaptain(stormSkip);
  stormSkip.state.hexcoreAssignments[stormSkipCaptain.id] = [
    { ...stormSkip.sampleData.hexcores.find(hex => hex.id === 'storm-fog'), status: 'available' },
  ];
  const skippedByHeavenly = stormSkip.state.draft.currentOrder[1];
  stormSkip.state.draft.runtimeEffects.push({
    type: 'skip_round',
    captainId: skippedByHeavenly,
    round: 2,
    sourceHexcoreId: 'heavenly-descent',
    reason: '测试：神兵天降跳过下一轮',
  });
  const skipPreview = stormSkip.turnOrderEngine.preview(2, { includeOriginSagePreview: true }).order;
  assert(!skipPreview.includes(skippedByHeavenly), '测试前提：神兵天降跳过效果应从下一轮顺位预览中移除该队伍');
  assert(stormSkip.hexcoreEngine.activate('storm-fog', { targetCaptainId: stormSkip.state.draft.currentOrder[0] }).ok, '血雾跨轮时应可命中下一轮有效起点');
  const skipFogEffects = stormSkip.state.draft.runtimeEffects.filter(effect => effect.type === 'weather_fog');
  const expectedSkipFogTargets = [
    stormSkip.state.draft.currentOrder[0],
    skippedByHeavenly,
    stormSkip.state.draft.currentOrder[2],
  ];
  assert(!skipFogEffects.some(effect =>
    effect.captainId === skippedByHeavenly
    && Number(effect.triggerRound) === 2
  ), '神兵天降跳过下一轮的队伍若正好位于血雾生效轮，血雾应先顺延给下一位有效队长');
  assert(
    skipFogEffects.map(effect => effect.captainId).join(',') === expectedSkipFogTargets.join(','),
    `血雾应只跳过神兵天降导致无购买权的当轮；购买权恢复后仍可响应，实际 ${skipFogEffects.map(effect => effect.captainId).join(',')}，期望 ${expectedSkipFogTargets.join(',')}`
  );
  assert(
    skipFogEffects.find(effect => effect.captainId === skippedByHeavenly && Number(effect.triggerRound) === 3),
    '神兵天降跳过队伍下一轮无购买权时不吃血雾，但购买权恢复后的后续轮次应可响应'
  );

  const stormOrigin = createReadyHarness().H;
  const originFogTarget = stormOrigin.state.captains[5];
  releaseHexcoreEverywhere(stormOrigin, 'origin-sage');
  stormOrigin.state.draft.round = 1;
  stormOrigin.state.draft.currentIndex = stormOrigin.state.draft.currentOrder.indexOf(stormOrigin.state.captains[6].id);
  const stormOriginCaptain = currentCaptain(stormOrigin);
  stormOrigin.state.hexcoreAssignments[stormOriginCaptain.id] = [
    { ...stormOrigin.sampleData.hexcores.find(hex => hex.id === 'storm-fog'), status: 'available' },
  ];
  stormOrigin.state.hexcoreAssignments[originFogTarget.id] = [
    { ...stormOrigin.sampleData.hexcores.find(hex => hex.id === 'origin-sage'), status: 'available' },
  ];
  assert(stormOrigin.hexcoreEngine.activate('storm-fog', { targetCaptainId: originFogTarget.id }).ok, '血雾应允许指定下一轮由启元提位的目标队长');
  const originFogEffects = stormOrigin.state.draft.runtimeEffects.filter(effect => effect.type === 'weather_fog');
  const originFogPreview = stormOrigin.turnOrderEngine.preview(2, { includeOriginSagePreview: true }).order;
  assert(originFogPreview[0] === originFogTarget.id, '测试前提：启元预览应把血雾目标提到下一轮第一位');
  assert(
    originFogEffects.map(effect => effect.captainId).join(',') === originFogPreview.slice(0, 3).join(','),
    `血雾跨轮目标应按下一轮启元和蛇形反转后的最终顺位展开，实际 ${originFogEffects.map(effect => effect.captainId).join(',')}，期望 ${originFogPreview.slice(0, 3).join(',')}`
  );
  assert(originFogEffects.every(effect => Number(effect.triggerRound) === 2), '血雾命中过去窗口目标时应统一挂到下一轮生效');

  const snowHarness = createReadyHarness();
  const snow = snowHarness.H;
  snow.state.draft.currentIndex = 0;
  const snowCaptain = currentCaptain(snow);
  snow.state.hexcoreAssignments[snowCaptain.id] = [
    { ...snow.sampleData.hexcores.find(hex => hex.id === 'snow-cat'), status: 'available' },
  ];
  const snowTarget = snow.state.draft.currentOrder[1];
  assert(!snow.hexcoreEngine.activate('snow-cat', { targetCaptainId: snowCaptain.id }).ok, '雪定饿的喵不能对自己使用');
  assert(!snow.hexcoreEngine.openCaptainTargets(snowCaptain.id, false).some(captain => captain.id === snowCaptain.id), '雪定饿的喵目标列表应排除自己队伍');
  assert(snow.hexcoreEngine.activate('snow-cat', { targetCaptainId: snowTarget }).ok, '雪定饿的喵应可对任意未满员队长使用');
  snow.state.draft.currentIndex = snow.state.draft.currentOrder.indexOf(snowTarget);
  snow.state.draft.currentDraw = null;
  snow.actions.drawCards();
  const snowDraw = snow.state.draft.currentDraw;
  assert(snowDraw.appliedEffects.some(effect => effect.type === 'snow_cat_shuffle'), '目标开店时应消费雪定饿的喵效果');
  assert(snowDraw.cards.length > 1, '测试前提：雪定饿的喵商店应至少有2张卡');
  assert(snowDraw.cards.every(card => card.snowCatShuffled && card.displayPlayerId), '雪定饿的喵应给每张卡设置打乱后的显示身份');
  assert(snowDraw.cards.some(card => card.displayPlayerId !== card.playerId), '雪定饿的喵应至少打乱一张卡的显示身份');
  const snowRealIds = snowDraw.cards.map(card => card.playerId).sort().join(',');
  const snowDisplayIds = snowDraw.cards.map(card => card.displayPlayerId).sort().join(',');
  assert(snowDisplayIds === snowRealIds, `雪定饿的喵显示身份只能来自本次商店抽出的卡，真实 ${snowRealIds}，显示 ${snowDisplayIds}`);
  snowDraw.cards.forEach(card => {
    const realCardPlayer = snow.state.players.find(player => player.id === card.playerId);
    assert(Number(card.price) === Number(realCardPlayer.tier), '雪定饿的喵不应打乱费用，卡位费用应保持真实选手费用');
  });
  snow.ui.render();
  assert(snowHarness.app.innerHTML.includes('snow-cat-card') && snowHarness.app.innerHTML.includes('信息扰乱'), '雪定饿的喵商店卡应有信息扰乱样式');
  const snowSlotIndex = snowDraw.cards.findIndex(card => card.displayPlayerId !== card.playerId);
  const snowSlot = snowDraw.cards[snowSlotIndex];
  const snowRealPlayer = snow.state.players.find(player => player.id === snowSlot.playerId);
  const snowDisplayPlayer = snow.state.players.find(player => player.id === snowSlot.displayPlayerId);
  assert(snowDisplayPlayer && snowRealPlayer && snowDisplayPlayer.id !== snowRealPlayer.id, '测试前提：雪定饿的喵应存在显示身份不同的卡');
  const snowSlotMarker = `--slot-index:${snowSlotIndex}`;
  const snowCardStart = snowHarness.app.innerHTML.indexOf(snowSlotMarker);
  const snowCardEnd = snowHarness.app.innerHTML.indexOf('</button>', snowCardStart);
  const snowCardHtml = snowHarness.app.innerHTML.slice(snowCardStart, snowCardEnd);
  assert(snowCardStart >= 0 && snowCardEnd > snowCardStart, '测试前提：应能定位雪定饿的喵被扰乱卡片');
  assert(snowCardHtml.includes(snowDisplayPlayer.name), '雪定饿的喵卡片应展示被打乱后的名称');
  assert(snowCardHtml.includes(snowDisplayPlayer.gameId), '雪定饿的喵卡片应展示被打乱后的ID');
  assert(!snowCardHtml.includes(snowRealPlayer.name), '雪定饿的喵卡片不应提前展示真实名称');
  assert(!snowCardHtml.includes(snowRealPlayer.gameId), '雪定饿的喵卡片不应提前展示真实ID');
  if ((snowDisplayPlayer.heroes || [])[0] && (snowRealPlayer.heroes || [])[0] && snowDisplayPlayer.heroes[0] !== snowRealPlayer.heroes[0]) {
    assert(snowCardHtml.includes(snowDisplayPlayer.heroes[0]), '雪定饿的喵卡片应展示被打乱后的擅长英雄');
    assert(!snowCardHtml.includes(snowRealPlayer.heroes[0]), '雪定饿的喵卡片不应提前展示真实擅长英雄');
  }
  const snowTargetCaptain = snow.state.captains.find(captain => captain.id === snowTarget);
  const snowBeforeGold = snowTargetCaptain.economy.gold = 20;
  const snowExpectedPrice = Number(snowSlot.price);
  snow.state.draft.selectedSlot = snowSlotIndex;
  snow.actions.pickCard();
  assert(snowTargetCaptain.team.includes(snowSlot.playerId), '雪定饿的喵购买后应按真实选手入队');
  assert(snowTargetCaptain.economy.gold === snowBeforeGold - snowExpectedPrice, `雪定饿的喵应按真实卡位费用扣款，卡位费用 ${snowExpectedPrice}`);
  assert(Number(snowSlot.revealUntil) > Date.now(), '雪定饿的喵购买后应保留5秒真实揭示窗口');
  assert(snowSlot.purchaseRevealReason === 'snow_cat', '雪定饿的喵购买后应标记揭示来源');
  snow.ui.render();
  assert(snowHarness.app.innerHTML.includes('purchased-reveal-card') && snowHarness.app.innerHTML.includes('snow-cat-revealing'), '雪定饿的喵购买后应临时显示真实信息并播放抖动揭示动画');
  assert(snowHarness.app.innerHTML.includes(snowRealPlayer.name), '雪定饿的喵揭示期应显示真实选手名称');
  delete snowSlot.revealUntil;
  snowSlot.revealFlipUntil = Date.now() + 500;
  snow.ui.render();
  assert(!snowHarness.app.innerHTML.includes('purchased-reveal-card'), '雪定饿的喵揭示期结束后不应继续显示真实信息卡片');
  assert(snowHarness.app.innerHTML.includes('purchased-flip-in'), '雪定饿的喵揭示期结束后应播放翻转为已购买动画');
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

  const snowRestock = createReadyHarness().H;
  const snowRestockCaptain = currentCaptain(snowRestock);
  snowRestock.state.hexcoreAssignments[snowRestockCaptain.id] = [
    { ...snowRestock.sampleData.hexcores.find(hex => hex.id === 'urgent-restock'), status: 'available' },
  ];
  snowRestock.state.draft.runtimeEffects.push({
    type: 'snow_cat_shuffle',
    captainId: snowRestockCaptain.id,
    sourceCaptainId: 'c2',
    consumed: false,
    reason: '测试：雪定饿的喵影响当前商店',
  });
  snowRestock.actions.drawCards();
  const snowRestockDraw = snowRestock.state.draft.currentDraw;
  assert(snowRestockDraw.appliedEffects.some(effect => effect.type === 'snow_cat_shuffle'), '测试前提：加急调货前商店应受雪定饿的喵影响');
  let snowRestockShown = new Set(snowRestockDraw.cards.map(card => card.playerId));
  let snowRestockIndex = snowRestockDraw.cards.findIndex(card => {
    const player = playerById(snowRestock, card.playerId);
    return player && snowRestock.selectors.availableCampPlayers(snowRestockCaptain.id, snowRestockShown)
      .some(candidate => candidate.tier === player.tier);
  });
  if (snowRestockIndex < 0) {
    const firstCard = snowRestockDraw.cards[0];
    const firstPlayer = playerById(snowRestock, firstCard.playerId);
    const fallback = snowRestock.selectors.availableCampPlayers(snowRestockCaptain.id, snowRestockShown)[0];
    if (firstPlayer && fallback) fallback.tier = firstPlayer.tier;
    snowRestockIndex = 0;
  }
  assert(snowRestockIndex >= 0, '测试前提：雪定饿的喵商店应存在可加急调货的卡槽');
  assert(snowRestock.hexcoreEngine.activate('urgent-restock', { shopCardIndex: snowRestockIndex }).ok, '加急调货应可替换被雪定饿的喵扰乱的商店卡');
  const restockRealIds = snowRestockDraw.cards.map(card => card.playerId).sort().join(',');
  const restockDisplayIds = snowRestockDraw.cards.map(card => card.displayPlayerId).sort().join(',');
  assert(restockDisplayIds === restockRealIds, `加急调货后雪定饿的喵显示身份仍应来自当前商店卡，真实 ${restockRealIds}，显示 ${restockDisplayIds}`);

  const hungryHarness = createReadyHarness();
  const hungry = hungryHarness.H;
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
  assert(hungryHarness.app.innerHTML.includes('hungry-wave-alert') && hungryHarness.app.innerHTML.includes('海浪判定生效中'), '海浪我没吃饭触发后应在实时抽选页显示醒目的判定生效提示');
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
  assert(hungry.state.ui.recruitReveal && hungry.state.ui.recruitReveal.playerIds.includes(hungrySlot.playerId), '海浪同阵营夺取成功后应打开入队揭示弹窗');

  const fogHungryHarness = createReadyHarness();
  const fogHungry = fogHungryHarness.H;
  fogHungry.state.draft.baseOrder = ['c1', 'c2'];
  fogHungry.state.draft.currentOrder = ['c1', 'c2'];
  fogHungry.state.draft.currentIndex = 0;
  fogHungry.state.draft.currentDraw = null;
  const fogHungryCaptain = fogHungry.state.captains.find(captain => captain.id === 'c1');
  const fogHungryBuyer = fogHungry.state.captains.find(captain => captain.id === 'c2');
  fogHungry.state.hexcoreAssignments[fogHungryCaptain.id] = [
    { ...fogHungry.sampleData.hexcores.find(hex => hex.id === 'hungry-wave'), status: 'passive' },
  ];
  fogHungry.state.draft.runtimeEffects.push({
    type: 'weather_fog',
    captainId: fogHungryBuyer.id,
    sourceCaptainId: 'c3',
    triggerRound: 1,
    round: 1,
    reason: '组合回归：血雾卡被海浪夺走后原卡位显示已购买',
  });
  Math.random = () => 0;
  fogHungry.actions.drawCards();
  Math.random = hungryOriginalRandom;
  assert(fogHungry.selectors.currentCaptain().id === fogHungryBuyer.id, '测试前提：血雾同阵营海浪应轮到受影响的本地队长购买');
  assert(
    fogHungry.state.draft.currentDraw.appliedEffects.some(effect => effect.type === 'weather_fog'),
    '测试前提：同阵营海浪购买者商店应处于骤雨血雾清风遮蔽状态'
  );
  const fogHungrySlot = fogHungry.state.draft.currentDraw.cards[0];
  const fogHungryPlayer = playerById(fogHungry, fogHungrySlot.playerId);
  assert(fogHungryPlayer.camp === fogHungry.selectors.captainCamp(fogHungryCaptain.id), '测试前提：血雾购买卡应与海浪持有者同阵营');
  fogHungryBuyer.economy.gold = 20;
  fogHungry.state.draft.selectedSlot = 0;
  Math.random = () => 0;
  fogHungry.actions.pickCard();
  Math.random = hungryOriginalRandom;
  assert(fogHungryCaptain.team.includes(fogHungrySlot.playerId), '血雾商店同阵营海浪命中时真实选手应被海浪带回自己的队伍');
  assert(!fogHungryBuyer.team.includes(fogHungrySlot.playerId), '血雾商店同阵营海浪命中时真实选手不应留在原购买队伍');
  assert(fogHungryPlayer.status === 'drafted' && fogHungryPlayer.teamId === fogHungryCaptain.id, '血雾商店同阵营海浪命中后真实选手归属应更新为海浪队伍');
  assert(fogHungrySlot.purchased && !fogHungrySlot.revealUntil && !fogHungrySlot.purchaseRevealReason, '血雾同阵营卡被海浪带走后原卡位应立即显示已购买并清除揭示状态');
  assert(fogHungryHarness.app.innerHTML.includes('shop-empty-slot purchased'), '血雾同阵营卡被海浪带走后界面原位置应显示已购买空槽');
  assert(fogHungryHarness.app.innerHTML.includes('海浪满载而归') && fogHungryHarness.app.innerHTML.includes('带回了自己的队伍'), '血雾同阵营卡被海浪带走后应弹窗提示带回自己的队伍');
  assert(!fogHungry.economyEngine.roundState(fogHungryBuyer.id).purchaseUsed, '血雾同阵营卡被海浪带走后应返还原购买队长购买权');
  assert(fogHungry.economyEngine.nextRefreshCost(fogHungryBuyer.id) === 0, '血雾同阵营卡被海浪带走后应返还1次免费刷新');

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
  assert(oppositeHungry.state.draft.currentDraw.cards[0].purchased, '海浪命中异阵营时原商店卡位应保持已处理，不能把退回卡池的选手留在当前商店');
  const oppositeBuyerTeamSize = oppositeBuyer.team.length;
  oppositeHungry.state.draft.selectedSlot = 0;
  oppositeHungry.actions.pickCard();
  assert(oppositeBuyer.team.length === oppositeBuyerTeamSize, '海浪命中异阵营返池后原购买队长不能从当前商店再次购买同一卡位');
  assert(oppositeHungry.state.draft.runtimeEffects.some(effect => effect.type === 'hungry_wave_round' && effect.pendingRoundReward), '海浪命中异阵营后应登记轮末奖励');
  oppositeHungry.actions.nextCaptain();
  assert(oppositeHungry.state.draft.round === 2, '异阵营海浪轮末奖励应在进入下一轮前结算并推进轮次');
  assert(oppositeWaveCaptain.team.length === oppositeOwnerTeamBefore + 1, '异阵营海浪轮末奖励应给海浪持有者补入1名选手');
  const rewardPlayer = playerById(oppositeHungry, oppositeWaveCaptain.team[oppositeWaveCaptain.team.length - 1]);
  assert(rewardPlayer.camp === oppositeHungry.selectors.captainCamp(oppositeWaveCaptain.id), '异阵营海浪轮末奖励只能获得海浪持有者同阵营选手');
  assert(oppositeHungry.state.draft.runtimeEffects.some(effect => effect.type === 'hungry_wave_round' && effect.roundRewardResolved && effect.roundRewardPlayerId === rewardPlayer.id), '异阵营海浪轮末奖励应记录结算结果');
  assert(oppositeHungry.state.ui.recruitReveal && oppositeHungry.state.ui.recruitReveal.playerIds.includes(rewardPlayer.id), '海浪轮末补偿成功后应打开入队揭示弹窗');

  const fogOppositeHungryHarness = createReadyHarness();
  const fogOppositeHungry = fogOppositeHungryHarness.H;
  fogOppositeHungry.state.draft.baseOrder = ['c1', 'c6'];
  fogOppositeHungry.state.draft.currentOrder = ['c1', 'c6'];
  fogOppositeHungry.state.draft.currentIndex = 0;
  fogOppositeHungry.state.draft.currentDraw = null;
  const fogWaveCaptain = fogOppositeHungry.state.captains.find(captain => captain.id === 'c1');
  const fogBuyer = fogOppositeHungry.state.captains.find(captain => captain.id === 'c6');
  fogOppositeHungry.state.hexcoreAssignments[fogWaveCaptain.id] = [
    { ...fogOppositeHungry.sampleData.hexcores.find(hex => hex.id === 'hungry-wave'), status: 'passive' },
  ];
  fogOppositeHungry.state.draft.runtimeEffects.push({
    type: 'weather_fog',
    captainId: fogBuyer.id,
    sourceCaptainId: 'c2',
    triggerRound: 1,
    round: 1,
    reason: '组合回归：受血雾影响的队伍触发异阵营海浪退回',
  });
  Math.random = () => 0;
  fogOppositeHungry.actions.drawCards();
  Math.random = hungryOriginalRandom;
  assert(fogOppositeHungry.selectors.currentCaptain().id === fogBuyer.id, '测试前提：血雾异阵营海浪应轮到受影响的外地队长购买');
  assert(
    fogOppositeHungry.state.draft.currentDraw.appliedEffects.some(effect => effect.type === 'weather_fog'),
    '测试前提：购买者商店应处于骤雨血雾清风遮蔽状态'
  );
  const fogOppositeSlot = fogOppositeHungry.state.draft.currentDraw.cards[0];
  const fogOppositePlayer = playerById(fogOppositeHungry, fogOppositeSlot.playerId);
  fogBuyer.economy.gold = 20;
  fogOppositeHungry.state.draft.selectedSlot = 0;
  Math.random = () => 0;
  fogOppositeHungry.actions.pickCard();
  Math.random = hungryOriginalRandom;
  assert(!fogWaveCaptain.team.includes(fogOppositeSlot.playerId), '血雾商店命中异阵营海浪时不得被海浪队伍夺取');
  assert(!fogBuyer.team.includes(fogOppositeSlot.playerId), '血雾商店命中异阵营海浪时应从原购买队伍移除选手');
  assert(fogOppositePlayer.status === 'available' && !fogOppositePlayer.teamId, '血雾商店命中异阵营海浪时真实购买选手应回到可选卡池');
  assert(fogOppositeSlot.purchased && !fogOppositeSlot.revealUntil && !fogOppositeSlot.purchaseRevealReason, '血雾异阵营卡被海浪命中后原卡位应显示已购买并清除揭示状态');
  assert(fogOppositeHungryHarness.app.innerHTML.includes('shop-empty-slot purchased'), '血雾异阵营卡被海浪命中后界面原位置应显示已购买空槽');
  assert(fogOppositeHungryHarness.app.innerHTML.includes('海浪空手而归') && fogOppositeHungryHarness.app.innerHTML.includes('冲回了卡池'), '血雾异阵营卡被海浪命中后应弹窗提示海浪空手而归');
  assert(!fogOppositeHungry.economyEngine.roundState(fogBuyer.id).purchaseUsed, '血雾商店命中异阵营海浪时应返还购买权');
  assert(fogOppositeHungry.state.draft.runtimeEffects.some(effect => effect.type === 'hungry_wave_round' && effect.pendingRoundReward), '血雾商店命中异阵营海浪后仍应登记轮末奖励');

  const cannonHarness = createReadyHarness();
  const cannon = cannonHarness.H;
  releaseHexcoreEverywhere(cannon, 'charged-cannon');
  const cannonCaptain = cannon.state.captains[0];
  cannon.state.hexcoreAssignments[cannonCaptain.id] = [
    { ...cannon.sampleData.hexcores.find(hex => hex.id === 'charged-cannon'), status: 'available' },
  ];
  cannon.state.draft.round = 1;
  cannon.state.draft.currentIndex = 0;
  cannon.state.draft.currentDraw = null;
  cannon.turnOrderEngine.recompute();
  const cannonQueueItem = cannon.hexcoreEngine.executionQueue(cannonCaptain.id).find(item => item.id === 'charged-cannon');
  assert(cannonQueueItem && !cannonQueueItem.executable && cannonQueueItem.status === '轮初决策', '大炮已充能不应在选人阶段执行队列中提供选择目标');
  const cannonTarget = cannon.state.draft.currentOrder[1];
  const cannonBeforeIndex = cannon.state.draft.currentOrder.indexOf(cannonTarget);
  assert(cannon.hexcoreEngine.chargedCannonDelayTargets(cannonCaptain.id).some(target => target.id === cannonTarget), '雷霆一击轮初目标列表应包含非最后顺位普通队长');
  assert(cannon.hexcoreEngine.activateChargedCannonDelay(cannonCaptain.id, cannonTarget).ok, '大炮已充能雷霆一击应在轮初指定队长');
  const cannonAfterIndex = cannon.state.draft.currentOrder.indexOf(cannonTarget);
  assert(cannonAfterIndex === cannonBeforeIndex + 1, `雷霆一击应让目标顺位后移一位，前 ${cannonBeforeIndex} 后 ${cannonAfterIndex}`);
  assert(!cannon.hexcoreEngine.activateChargedCannonDelay(cannonCaptain.id, cannon.state.draft.currentOrder[2]).ok, '大炮已充能每轮只能使用一次');

  const boostHarness = createReadyHarness();
  const boost = boostHarness.H;
  releaseHexcoreEverywhere(boost, 'charged-cannon');
  releaseHexcoreEverywhere(boost, 'origin-sage');
  const originProtectedCaptain = boost.state.captains[0];
  const boostCaptain = boost.state.captains[2];
  boost.state.hexcoreAssignments[originProtectedCaptain.id] = [
    { ...boost.sampleData.hexcores.find(hex => hex.id === 'origin-sage'), status: 'available' },
  ];
  boost.state.hexcoreAssignments[boostCaptain.id] = [
    { ...boost.sampleData.hexcores.find(hex => hex.id === 'charged-cannon'), status: 'available' },
  ];
  boost.state.draft.round = 1;
  boost.state.draft.currentIndex = 0;
  boost.state.draft.currentDraw = null;
  boost.turnOrderEngine.recompute();
  boost.hexcoreEngine.ensureOriginSageForRound(1);
  const boostPreview = boost.hexcoreEngine.chargedCannonBoostPreview(boostCaptain.id);
  assert(boostPreview.canBoost, '测试前提：启元保护首位后，第三顺位的大炮持有者应可前移到第二');
  assert(boostPreview.afterOrder[0] === originProtectedCaptain.id, '加速之门预览不能越过神秘贤者·启元首位');
  assert(boostPreview.afterOrder[1] === boostCaptain.id, '加速之门预览应让自己前移1位');
  assert(boost.hexcoreEngine.activateChargedCannonBoost(boostCaptain.id).ok, '大炮已充能加速之门应在轮初让自己前移');
  assert(boost.state.draft.currentOrder[0] === originProtectedCaptain.id, '加速之门生效后仍不能越过启元第一顺位');
  assert(boost.state.draft.currentOrder[1] === boostCaptain.id, '加速之门生效后使用者应前移到启元之后');
  assert(!boost.hexcoreEngine.activateChargedCannonDelay(boostCaptain.id, boost.state.draft.currentOrder[2]).ok, '加速之门使用后本轮不能再使用雷霆一击');
  assert(!boost.hexcoreEngine.chargedCannonDelayTargets(boostCaptain.id).some(target => target.id === originProtectedCaptain.id), '雷霆一击目标列表不能包含本轮受启元保护的队长');
  const lastOrderCaptain = boost.state.draft.currentOrder[boost.state.draft.currentOrder.length - 1];
  assert(!boost.hexcoreEngine.chargedCannonDelayTargets(boostCaptain.id).some(target => target.id === lastOrderCaptain), '雷霆一击目标列表不能包含最后顺位队长');

  const cannonTargetCountHarness = createReadyHarness();
  const cannonTargetCount = cannonTargetCountHarness.H;
  releaseHexcoreEverywhere(cannonTargetCount, 'charged-cannon');
  releaseHexcoreEverywhere(cannonTargetCount, 'origin-sage');
  const cannonSource = cannonTargetCount.state.captains[0];
  const originHolder = cannonTargetCount.state.captains[5];
  cannonTargetCount.state.hexcoreAssignments[cannonSource.id] = [
    { ...cannonTargetCount.sampleData.hexcores.find(hex => hex.id === 'charged-cannon'), status: 'available' },
  ];
  cannonTargetCount.state.hexcoreAssignments[originHolder.id] = [
    { ...cannonTargetCount.sampleData.hexcores.find(hex => hex.id === 'origin-sage'), status: 'available' },
  ];
  const fullTarget = cannonTargetCount.state.captains[3];
  const fullCapacity = cannonTargetCount.selectors.teamMemberCapacity(fullTarget.id);
  cannonTargetCount.state.players
    .filter(player => player.camp === cannonTargetCount.selectors.captainCamp(fullTarget.id) && player.status === 'available' && !cannonTargetCount.selectors.isCaptainPlayer(player.id))
    .slice(0, fullCapacity)
    .forEach(player => {
      player.status = 'drafted';
      player.teamId = fullTarget.id;
      fullTarget.team.push(player.id);
    });
  cannonTargetCount.state.draft.currentOrder = cannonTargetCount.state.captains.map(captain => captain.id);
  cannonTargetCount.state.draft.baseOrder = [...cannonTargetCount.state.draft.currentOrder];
  cannonTargetCount.state.draft.currentIndex = 0;
  cannonTargetCount.state.draft.currentDraw = null;
  assert(cannonTargetCount.hexcoreEngine.chargedCannonOrder().length === 10, '大炮已充能应按10位队长完整轮初顺位计算目标，而不是只看仍可抽选顺位');
  const normalDelayTargets = cannonTargetCount.hexcoreEngine.chargedCannonDelayTargets(cannonSource.id);
  assert(normalDelayTargets.length === 7, `雷霆一击应只排除自己、最后顺位和启元队长，当前应有7名目标，实际 ${normalDelayTargets.length}`);
  assert(normalDelayTargets.some(target => target.id === fullTarget.id), '雷霆一击是顺位效果，已满员队长仍应可作为后移目标');
  assert(!normalDelayTargets.some(target => target.id === cannonSource.id), '雷霆一击目标不能包含自己');
  assert(!normalDelayTargets.some(target => target.id === originHolder.id), '雷霆一击目标不能包含持有神秘贤者·启元的队长');
  assert(!normalDelayTargets.some(target => target.id === cannonTargetCount.state.draft.currentOrder[cannonTargetCount.state.draft.currentOrder.length - 1]), '雷霆一击目标不能包含最后顺位队长');

  const lastSourceOrder = [
    ...cannonTargetCount.state.draft.currentOrder.filter(id => id !== cannonSource.id),
    cannonSource.id,
  ];
  cannonTargetCount.state.draft.currentOrder = lastSourceOrder;
  cannonTargetCount.state.draft.baseOrder = [...lastSourceOrder];
  const lastSourceDelayTargets = cannonTargetCount.hexcoreEngine.chargedCannonDelayTargets(cannonSource.id);
  assert(lastSourceDelayTargets.length === 8, `自己是最后顺位时，雷霆一击应只排除自己和启元队长，当前应有8名目标，实际 ${lastSourceDelayTargets.length}`);
  assert(!lastSourceDelayTargets.some(target => target.id === cannonSource.id), '自己是最后顺位时仍不能选择自己');
  assert(!lastSourceDelayTargets.some(target => target.id === originHolder.id), '自己是最后顺位时仍不能选择启元队长');
  const hungryDelayTarget = lastSourceDelayTargets[0];
  cannonTargetCount.state.draft.runtimeEffects.push({
    type: 'hungry_wave_round',
    captainId: hungryDelayTarget.id,
    round: 1,
    immune: true,
    consumed: false,
    remainingChecks: 8,
    reason: `${hungryDelayTarget.name} 触发海浪，我没吃饭，本轮自动跳过并免疫其他海克斯`,
  });
  const hungryFilteredTargets = cannonTargetCount.hexcoreEngine.chargedCannonDelayTargets(cannonSource.id);
  assert(!hungryFilteredTargets.some(target => target.id === hungryDelayTarget.id), '海浪我没吃饭触发者本轮跳过且不受顺位影响，不能成为雷霆一击目标');
  assert(hungryFilteredTargets.length === 7, `自己是最后顺位且存在海浪触发者时，雷霆一击应有7名目标，实际 ${hungryFilteredTargets.length}`);

  const cannonHungryOwner = createReadyHarness().H;
  releaseHexcoreEverywhere(cannonHungryOwner, 'charged-cannon');
  releaseHexcoreEverywhere(cannonHungryOwner, 'hungry-wave');
  releaseHexcoreEverywhere(cannonHungryOwner, 'origin-sage');
  const cannonHungrySource = cannonHungryOwner.state.captains[0];
  const cannonHungryTarget = cannonHungryOwner.state.captains[1];
  cannonHungryOwner.state.hexcoreAssignments[cannonHungrySource.id] = [
    { ...cannonHungryOwner.sampleData.hexcores.find(hex => hex.id === 'charged-cannon'), status: 'available' },
  ];
  cannonHungryOwner.state.hexcoreAssignments[cannonHungryTarget.id] = [
    { ...cannonHungryOwner.sampleData.hexcores.find(hex => hex.id === 'hungry-wave'), status: 'passive' },
  ];
  cannonHungryOwner.state.draft.currentOrder = cannonHungryOwner.state.captains.map(captain => captain.id);
  cannonHungryOwner.state.draft.baseOrder = [...cannonHungryOwner.state.draft.currentOrder];
  assert(!cannonHungryOwner.hexcoreEngine.chargedCannonDelayTargets(cannonHungrySource.id).some(target => target.id === cannonHungryTarget.id), '持有海浪我没吃饭的队长不应成为雷霆一击目标，即使本轮尚未触发海浪');

  const cannonModalHarness = createHarness();
  const cannonModal = cannonModalHarness.H;
  installReadyTestData(cannonModal);
  releaseHexcoreEverywhere(cannonModal, 'charged-cannon');
  releaseHexcoreEverywhere(cannonModal, 'origin-sage');
  const modalCaptain = cannonModal.state.captains[2];
  const modalOriginCaptain = cannonModal.state.captains[4];
  cannonModal.state.hexcoreAssignments[modalCaptain.id] = [
    { ...cannonModal.sampleData.hexcores.find(hex => hex.id === 'charged-cannon'), status: 'available' },
  ];
  cannonModal.state.hexcoreAssignments[modalOriginCaptain.id] = [
    { ...cannonModal.sampleData.hexcores.find(hex => hex.id === 'origin-sage'), status: 'available' },
  ];
  cannonModal.state.draft.phase = 'setup';
  cannonModal.ui.render();
  cannonModal.actions.startDraft({ skipSnapshot: true });
  assert(cannonModal.state.ui.originSageNotice && cannonModal.state.ui.originSageNotice.captainIds.includes(modalOriginCaptain.id), '开始抽卡后应先显示神秘贤者·启元弹窗');
  assert(!cannonModal.state.ui.chargedCannonDecision, '神秘贤者·启元弹窗关闭前不应打开大炮已充能弹窗');
  cannonModal.actions.drawCards();
  assert(!cannonModal.state.draft.currentDraw, '启元弹窗未关闭且大炮待处理时不应允许开店');
  cannonModal.actions.closeOriginSageNotice();
  assert(cannonModal.state.ui.chargedCannonDecision && cannonModal.state.ui.chargedCannonDecision.captainId === modalCaptain.id, '关闭神秘贤者·启元弹窗后才应打开大炮已充能转换技弹窗');
  assert(cannonModalHarness.app.innerHTML.includes('处理轮初海克斯') && cannonModalHarness.app.innerHTML.includes('请先处理轮初大炮已充能'), '大炮弹窗存在时商店按钮应禁用并提示先处理轮初海克斯');
  cannonModal.actions.drawCards();
  assert(!cannonModal.state.draft.currentDraw, '大炮轮初弹窗未处理前不应允许开店');
  cannonModal.actions.chooseChargedCannonMode('boost');
  assert(cannonModal.state.ui.chargedCannonDecision.step === 'boost', '点击加速之门后应进入顺位预览页');
  cannonModal.actions.backChargedCannonDecision();
  assert(cannonModal.state.ui.chargedCannonDecision.step === 'choose', '加速预览页应可返回转换技选择页');
  cannonModal.actions.skipChargedCannonDecision();
  assert(!cannonModal.state.ui.chargedCannonDecision, '本轮不使用后应关闭大炮弹窗');
  assert(!cannonModal.hexcoreEngine.chargedCannonPendingOwners(1).some(captain => captain.id === modalCaptain.id), '跳过大炮后本轮不应再次询问该队长');

  const cannonDirectHarness = createHarness();
  const cannonDirect = cannonDirectHarness.H;
  installReadyTestData(cannonDirect);
  releaseHexcoreEverywhere(cannonDirect, 'charged-cannon');
  const directCannonCaptain = cannonDirect.state.captains[2];
  cannonDirect.state.hexcoreAssignments[directCannonCaptain.id] = [
    { ...cannonDirect.sampleData.hexcores.find(hex => hex.id === 'charged-cannon'), status: 'available' },
  ];
  cannonDirect.state.draft.phase = 'captain_action';
  cannonDirect.state.draft.started = true;
  cannonDirect.state.draft.round = 1;
  cannonDirect.state.draft.currentIndex = 0;
  cannonDirect.state.draft.currentDraw = null;
  cannonDirect.state.ui.chargedCannonDecision = null;
  cannonDirect.turnOrderEngine.recompute();
  cannonDirect.actions.drawCards();
  assert(cannonDirect.state.ui.chargedCannonDecision && cannonDirect.state.ui.chargedCannonDecision.captainId === directCannonCaptain.id, '直接开店时若刚发现大炮待处理，也应先打开大炮已充能弹窗');
  assert(!cannonDirect.state.draft.currentDraw, '直接开店时刚打开大炮弹窗也不应同步生成商店');
  assert(cannonDirectHarness.app.innerHTML.includes('处理轮初海克斯') && cannonDirectHarness.app.innerHTML.includes('请先处理轮初大炮已充能'), '直接触发大炮弹窗后商店按钮应禁用并提示先处理轮初海克斯');

  const cannonConfirmHarness = createHarness();
  const cannonConfirm = cannonConfirmHarness.H;
  installReadyTestData(cannonConfirm);
  releaseHexcoreEverywhere(cannonConfirm, 'charged-cannon');
  releaseHexcoreEverywhere(cannonConfirm, 'origin-sage');
  const confirmCaptain = cannonConfirm.state.captains[2];
  const confirmOriginCaptain = cannonConfirm.state.captains[4];
  cannonConfirm.state.hexcoreAssignments[confirmCaptain.id] = [
    { ...cannonConfirm.sampleData.hexcores.find(hex => hex.id === 'charged-cannon'), status: 'available' },
  ];
  cannonConfirm.state.hexcoreAssignments[confirmOriginCaptain.id] = [
    { ...cannonConfirm.sampleData.hexcores.find(hex => hex.id === 'origin-sage'), status: 'available' },
  ];
  cannonConfirm.state.draft.phase = 'setup';
  cannonConfirm.ui.render();
  cannonConfirm.actions.startDraft({ skipSnapshot: true });
  cannonConfirm.actions.closeOriginSageNotice();
  assert(cannonConfirm.state.ui.chargedCannonDecision && cannonConfirm.state.ui.chargedCannonDecision.captainId === confirmCaptain.id, '确认测试前提：应打开大炮已充能弹窗');
  const confirmBeforeIndex = cannonConfirm.state.draft.currentOrder.indexOf(confirmCaptain.id);
  cannonConfirm.actions.chooseChargedCannonMode('boost');
  const confirmBoostResult = cannonConfirm.actions.confirmChargedCannonBoost();
  assert(confirmBoostResult && confirmBoostResult.ok, '点击确定使用加速之门后应成功结算');
  assert(!cannonConfirm.state.ui.chargedCannonDecision, '加速之门确认成功后应关闭大炮弹窗');
  assert(cannonConfirm.state.draft.currentOrder.indexOf(confirmCaptain.id) === confirmBeforeIndex - 1, '加速之门确认成功后使用者应前移一位');
  assert(cannonConfirm.state.events.some(event => event.title === '大炮已充能' && event.body.includes('加速之门')), '加速之门确认成功后应写入日志反馈');

  const cannonFailHarness = createHarness();
  const cannonFail = cannonFailHarness.H;
  installReadyTestData(cannonFail);
  releaseHexcoreEverywhere(cannonFail, 'charged-cannon');
  const failCaptain = cannonFail.state.captains[2];
  cannonFail.state.hexcoreAssignments[failCaptain.id] = [
    { ...cannonFail.sampleData.hexcores.find(hex => hex.id === 'charged-cannon'), status: 'available' },
  ];
  cannonFail.state.draft.phase = 'setup';
  cannonFail.ui.render();
  cannonFail.actions.startDraft({ skipSnapshot: true });
  assert(cannonFail.state.ui.chargedCannonDecision && cannonFail.state.ui.chargedCannonDecision.captainId === failCaptain.id, '失败提示测试前提：应打开大炮已充能弹窗');
  cannonFail.actions.chooseChargedCannonMode('boost');
  cannonFail.state.draft.currentDraw = { captainId: failCaptain.id, cards: [] };
  const failBoostResult = cannonFail.actions.confirmChargedCannonBoost();
  assert(failBoostResult && !failBoostResult.ok, '商店已打开时确认加速之门应被拒绝');
  assert(cannonFail.state.ui.chargedCannonDecision && cannonFail.state.ui.chargedCannonDecision.error.includes('商店打开前'), '加速之门确认失败时应把原因保留在弹窗状态中');
  assert(cannonFailHarness.app.innerHTML.includes('商店打开前'), '加速之门确认失败时应在弹窗内显示原因，避免看起来无反应');

  const heavenlyHarness = createReadyHarness();
  const heavenly = heavenlyHarness.H;
  const heavenlyOwner = heavenly.state.captains.find(captain => captain.id === 'c2');
  setOnlyHexcore(heavenly, heavenlyOwner.id, 'heavenly-descent');
  const heavenlyTarget = heavenly.state.captains.find(captain => captain.id === 'c5');
  drawForCaptain(heavenly, heavenlyTarget.id);
  assert(heavenly.selectors.captainCamp(heavenlyOwner.id) === heavenly.selectors.captainCamp(heavenlyTarget.id), '测试前提：神兵天降成功用例必须为同阵营');
  heavenlyTarget.economy.gold = 20;
  const heavenlyBeforeGold = heavenlyTarget.economy.gold;
  const heavenlyPlayerId = heavenly.state.draft.currentDraw.cards[0].playerId;
  heavenly.state.draft.selectedSlot = 0;
  heavenly.actions.pickCard();
  const heavenlyPaid = heavenlyBeforeGold - heavenlyTarget.economy.gold;
  assert(heavenly.state.draft.heavenlyWindow && heavenly.state.draft.heavenlyWindow.active, '购买后应开启神兵天降10秒发动窗口');
  assert(heavenlyHarness.app.innerHTML.includes('神兵天降可发动'), '实时抽选页应展示神兵天降发动倒计时');
  heavenly.state.draft.heavenlyWindow.expiresAt = Date.now() + 3200;
  heavenly.ui.render();
  assert(heavenlyHarness.app.innerHTML.includes('data-countdown="heavenly-window">4</b> 秒内可夺取') || heavenlyHarness.app.innerHTML.includes('data-countdown="heavenly-window">3</b> 秒内可夺取'), '神兵天降发动窗口倒计时应按剩余时间实时显示');
  assert(heavenlyTarget.team.includes(heavenlyPlayerId), '测试前提：目标队长已购买选手');
  assert(heavenly.actions.useHeavenlyDescent(heavenlyOwner.id).ok, '神兵天降应可在窗口内发动');
  assert(!heavenlyTarget.team.includes(heavenlyPlayerId), '神兵天降应将刚购买选手从原购买队伍移除');
  assert(heavenlyOwner.team.includes(heavenlyPlayerId), '神兵天降发动者队伍未满时应获得刚购买选手');
  assert(playerById(heavenly, heavenlyPlayerId).teamId === heavenlyOwner.id, '被神兵天降夺取的选手归属应改为发动者');
  assert(heavenly.state.ui.recruitReveal && heavenly.state.ui.recruitReveal.playerIds.includes(heavenlyPlayerId), '神兵天降成功夺取后应打开入队揭示弹窗');
  assert(heavenlyTarget.economy.gold === heavenlyBeforeGold, `神兵天降应返还购买费用，前 ${heavenlyBeforeGold}，购买实付 ${heavenlyPaid}，后 ${heavenlyTarget.economy.gold}`);
  assert(!heavenly.economyEngine.roundState(heavenlyTarget.id).purchaseUsed, '神兵天降应返还原购买队长本轮购买权');
  assert(heavenly.state.draft.runtimeEffects.some(effect =>
    effect.type === 'skip_round'
    && effect.captainId === heavenlyOwner.id
    && Number(effect.round) === Number(heavenly.state.draft.round) + 1
    && effect.sourceHexcoreId === 'heavenly-descent'
  ), '神兵天降发动者成功入队后应跳过下一轮选人回合');
  assert(!heavenly.state.draft.runtimeEffects.some(effect => effect.type === 'compensation_turn' && effect.sourceCaptainId === heavenlyOwner.id), '神兵天降新规则不应再追加补偿回合');
  assert((heavenly.state.hexcoreAssignments[heavenlyOwner.id] || []).find(hex => hex.id === 'heavenly-descent').status === 'used', '神兵天降每局使用后应标记已使用');

  const heavenlySelfHarness = createReadyHarness();
  const heavenlySelf = heavenlySelfHarness.H;
  const heavenlySelfCaptain = heavenlySelf.state.captains.find(captain => captain.id === 'c2');
  setOnlyHexcore(heavenlySelf, heavenlySelfCaptain.id, 'heavenly-descent');
  drawForCaptain(heavenlySelf, heavenlySelfCaptain.id);
  heavenlySelfCaptain.economy.gold = 20;
  heavenlySelf.actions.pickCard();
  assert(!heavenlySelf.state.draft.heavenlyWindow, '神兵天降持有者自己购买后不应开启发动窗口');
  assert(!heavenlySelfHarness.app.innerHTML.includes('神兵天降可发动'), '神兵天降持有者自己购买后不应显示发动横幅');

  const heavenlyCrossHarness = createReadyHarness();
  const heavenlyCross = heavenlyCrossHarness.H;
  const heavenlyCrossOwner = heavenlyCross.state.captains.find(captain => captain.id === 'c2');
  const heavenlyCrossTarget = heavenlyCross.state.captains.find(captain => captain.id === 'c6');
  setOnlyHexcore(heavenlyCross, heavenlyCrossOwner.id, 'heavenly-descent');
  drawForCaptain(heavenlyCross, heavenlyCrossTarget.id);
  assert(heavenlyCross.selectors.captainCamp(heavenlyCrossOwner.id) !== heavenlyCross.selectors.captainCamp(heavenlyCrossTarget.id), '测试前提：神兵天降跨阵营用例必须为异阵营');
  heavenlyCrossTarget.economy.gold = 20;
  const crossBeforeGold = heavenlyCrossTarget.economy.gold;
  const crossPlayerId = heavenlyCross.state.draft.currentDraw.cards[0].playerId;
  heavenlyCross.actions.pickCard();
  const crossPlayer = playerById(heavenlyCross, crossPlayerId);
  const crossHexcore = (heavenlyCross.state.hexcoreAssignments[heavenlyCrossOwner.id] || []).find(hex => hex.id === 'heavenly-descent');
  assert(!heavenlyCross.state.draft.heavenlyWindow, '跨阵营购买后不应开启神兵天降窗口');
  const crossResult = heavenlyCross.actions.useHeavenlyDescent(heavenlyCrossOwner.id);
  assert(!crossResult.ok && crossResult.reason.includes('窗口'), '没有可发动窗口时神兵天降应拒绝执行');
  assert(heavenlyCrossTarget.team.includes(crossPlayerId), '跨阵营拒绝时不得移除原购买队伍的选手');
  assert(crossPlayer.teamId === heavenlyCrossTarget.id, '跨阵营拒绝时选手归属应保持原购买队伍');
  assert(!heavenlyCrossOwner.team.includes(crossPlayerId), '跨阵营拒绝时发动者不能获得选手');
  assert(heavenlyCrossTarget.economy.gold < crossBeforeGold, '跨阵营拒绝时不应返还原购买队长金币');
  assert(heavenlyCross.economyEngine.roundState(heavenlyCrossTarget.id).purchaseUsed, '跨阵营拒绝时不应返还原购买队长购买权');
  assert(crossHexcore.status !== 'used', '跨阵营拒绝时不应消耗神兵天降');
  assert(!heavenlyCrossHarness.app.innerHTML.includes('神兵天降可发动'), '没有同阵营可发动队长时不应显示神兵天降横幅');
  assert(!heavenlyCrossHarness.app.innerHTML.includes('不可发动'), '神兵天降横幅不应展示不可发动按钮');

  const heavenlyFullHarness = createReadyHarness();
  const heavenlyFull = heavenlyFullHarness.H;
  const heavenlyFullOwner = heavenlyFull.state.captains.find(captain => captain.id === 'c2');
  setOnlyHexcore(heavenlyFull, heavenlyFullOwner.id, 'heavenly-descent');
  while (heavenlyFullOwner.team.length < heavenlyFull.selectors.teamMemberCapacity(heavenlyFullOwner.id)) {
    const filler = heavenlyFull.state.players.find(player =>
      player.status === 'available'
      && player.camp === heavenlyFull.selectors.captainCamp(heavenlyFullOwner.id)
      && !heavenlyFull.selectors.isCaptainPlayer(player.id)
    );
    heavenlyFull.assignmentEngine.assign(heavenlyFullOwner.id, filler.id, 'manual_backfill');
  }
  const heavenlyFullTarget = heavenlyFull.state.captains.find(captain => captain.id === 'c5');
  drawForCaptain(heavenlyFull, heavenlyFullTarget.id);
  heavenlyFullTarget.economy.gold = 20;
  const heavenlyFullPlayerId = heavenlyFull.state.draft.currentDraw.cards[0].playerId;
  heavenlyFull.actions.pickCard();
  assert(heavenlyFull.actions.useHeavenlyDescent(heavenlyFullOwner.id).ok, '神兵天降发动者满员时仍应可发动');
  assert(!heavenlyFullOwner.team.includes(heavenlyFullPlayerId), '神兵天降发动者满员时不能获得选手');
  assert(playerById(heavenlyFull, heavenlyFullPlayerId).status === 'available', '神兵天降发动者满员时被夺取选手应回到卡池');
  assert(heavenlyFull.state.draft.currentDraw.cards[0].purchased, '神兵天降满员返池时原商店卡位应保持已处理，不能把卡退回当前商店');
  const heavenlyFullTargetSize = heavenlyFullTarget.team.length;
  heavenlyFull.state.draft.selectedSlot = 0;
  heavenlyFull.actions.pickCard();
  assert(heavenlyFullTarget.team.length === heavenlyFullTargetSize, '神兵天降满员返池后原购买队长不能从当前商店再次购买同一卡位');

  const heavenlySkipHarness = createReadyHarness();
  const heavenlySkip = heavenlySkipHarness.H;
  setOnlyHexcore(heavenlySkip, 'c2', 'heavenly-descent');
  const heavenlySkipTarget = heavenlySkip.state.captains.find(captain => captain.id === 'c5');
  drawForCaptain(heavenlySkip, heavenlySkipTarget.id);
  heavenlySkipTarget.economy.gold = 20;
  heavenlySkip.actions.pickCard();
  const beforeSkipIndex = heavenlySkip.state.draft.currentIndex;
  heavenlySkip.actions.nextCaptain();
  assert(heavenlySkip.state.draft.currentIndex === beforeSkipIndex + 1, '神兵天降询问期间点击下一位应稳定推进到下一位');
  assert(!heavenlySkip.state.draft.heavenlyWindow.active, '点击下一位应关闭神兵天降发动窗口');

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
  assert(mysteryResult.reveal && mysteryResult.reveal.playerIds.length === 1, '神秘贤者盲盒成功后应返回入队揭示数据');
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
  const transmuteGoldResult = transmuteGold.hexcoreEngine.activate('transmute-gold');
  assert(transmuteGoldResult.ok, '质变黄金阶应可免费从4费池随机入队');
  assert(transmuteGoldResult.reveal && transmuteGoldResult.reveal.title.includes('质变'), '质变黄金阶成功后应返回质变入队揭示数据');
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
  const transmutePrismaticResult = transmutePrismatic.hexcoreEngine.activate('transmute-prismatic');
  assert(transmutePrismaticResult.ok, '质变棱彩阶应可免费从5费池随机入队');
  assert(transmutePrismaticResult.reveal && transmutePrismaticResult.reveal.playerIds.length === 1, '质变棱彩阶成功后应返回入队揭示选手');
  assert(prismaticTargets.some(player => transmutePrismaticCaptain.team.includes(player.id)), '质变棱彩阶目标应来自同阵营5费池');
  assert(transmutePrismatic.economyEngine.roundState(transmutePrismaticCaptain.id).purchaseUsed, '质变棱彩阶应消耗本轮购买权');

  const transmutePrismaticFallback = createReadyHarness().H;
  const transmutePrismaticFallbackCaptain = currentCaptain(transmutePrismaticFallback);
  transmutePrismaticFallback.state.hexcoreAssignments[transmutePrismaticFallbackCaptain.id] = [
    { ...transmutePrismaticFallback.sampleData.hexcores.find(hex => hex.id === 'transmute-prismatic'), status: 'available' },
  ];
  transmutePrismaticFallback.state.draft.currentDraw = null;
  transmutePrismaticFallback.state.draft.pickedThisTurn = false;
  transmutePrismaticFallback.selectors.availableCampPlayers(transmutePrismaticFallbackCaptain.id)
    .filter(player => player.tier === 5)
    .forEach(player => { player.status = 'disabled'; });
  const prismaticFallbackPlan = transmutePrismaticFallback.hexcoreEngine.transmutePlan(transmutePrismaticFallbackCaptain.id, 'transmute-prismatic');
  assert(prismaticFallbackPlan.targets.length > 0 && prismaticFallbackPlan.tier < 5, '质变棱彩阶5费池为空时应逐级降档寻找可用卡池');
  const transmutePrismaticFallbackResult = transmutePrismaticFallback.hexcoreEngine.activate('transmute-prismatic');
  assert(transmutePrismaticFallbackResult.ok, '质变棱彩阶目标池为空时应降级随机获得低一档可用选手');
  assert(
    prismaticFallbackPlan.targets.some(player => transmutePrismaticFallbackCaptain.team.includes(player.id)),
    '质变棱彩阶降级后应从实际可用降档卡池入队'
  );
  assert(
    transmutePrismaticFallback.state.events.some(event => event.title === '质变：棱彩阶' && event.body.includes('已降级')),
    '质变棱彩阶降级结算应写入降级说明日志'
  );

  const transmuteGoldFallback = createReadyHarness().H;
  const transmuteGoldFallbackCaptain = currentCaptain(transmuteGoldFallback);
  transmuteGoldFallback.state.hexcoreAssignments[transmuteGoldFallbackCaptain.id] = [
    { ...transmuteGoldFallback.sampleData.hexcores.find(hex => hex.id === 'transmute-gold'), status: 'available' },
  ];
  transmuteGoldFallback.state.draft.currentDraw = null;
  transmuteGoldFallback.state.draft.pickedThisTurn = false;
  transmuteGoldFallback.selectors.availableCampPlayers(transmuteGoldFallbackCaptain.id)
    .filter(player => player.tier === 4)
    .forEach(player => { player.status = 'disabled'; });
  const goldFallbackPlan = transmuteGoldFallback.hexcoreEngine.transmutePlan(transmuteGoldFallbackCaptain.id, 'transmute-gold');
  assert(goldFallbackPlan.targets.length > 0 && goldFallbackPlan.tier < 4, '质变黄金阶4费池为空时应逐级降档寻找可用卡池');
  const transmuteGoldFallbackResult = transmuteGoldFallback.hexcoreEngine.activate('transmute-gold');
  assert(transmuteGoldFallbackResult.ok, '质变黄金阶目标池为空时应降级随机获得低一档可用选手');
  assert(
    goldFallbackPlan.targets.some(player => transmuteGoldFallbackCaptain.team.includes(player.id)),
    '质变黄金阶降级后应从实际可用降档卡池入队'
  );

  const transmuteUiHarness = createReadyHarness();
  const transmuteUi = transmuteUiHarness.H;
  const transmuteUiCaptain = currentCaptain(transmuteUi);
  transmuteUi.state.hexcoreAssignments[transmuteUiCaptain.id] = [
    { ...transmuteUi.sampleData.hexcores.find(hex => hex.id === 'transmute-gold'), status: 'available' },
  ];
  transmuteUi.state.draft.currentDraw = null;
  transmuteUi.state.draft.pickedThisTurn = false;
  const transmuteUiBeforeIndex = transmuteUi.state.draft.currentIndex;
  const transmuteUiResult = transmuteUi.actions.useHexcore('transmute-gold');
  assert(transmuteUiResult.ok, '通过裁判按钮使用质变黄金阶应成功');
  assert(transmuteUi.state.ui.recruitReveal, '通过裁判按钮使用质变后应先打开入队揭示弹窗');
  assert(transmuteUiHarness.app.innerHTML.includes('recruit-reveal-modal') && transmuteUiHarness.app.innerHTML.includes('确认并继续'), '入队揭示弹窗应醒目展示确认入口');
  assert(transmuteUi.state.draft.currentIndex === transmuteUiBeforeIndex, '入队揭示确认前不应自动跳到下一位队长');
  transmuteUi.actions.confirmRecruitReveal();
  assert(transmuteUi.state.draft.currentIndex === transmuteUiBeforeIndex + 1, '确认入队揭示后才进入下一位队长');

  const transmuteEmpty = createReadyHarness().H;
  const transmuteEmptyCaptain = currentCaptain(transmuteEmpty);
  transmuteEmpty.state.hexcoreAssignments[transmuteEmptyCaptain.id] = [
    { ...transmuteEmpty.sampleData.hexcores.find(hex => hex.id === 'transmute-prismatic'), status: 'available' },
  ];
  transmuteEmpty.selectors.availableCampPlayers(transmuteEmptyCaptain.id)
    .forEach(player => { player.status = 'disabled'; });
  transmuteEmpty.state.draft.currentDraw = null;
  assert(!transmuteEmpty.hexcoreEngine.activate('transmute-prismatic').ok, '质变目标及以下卡池全空时应失败并保留购买权');
  assert(!transmuteEmpty.economyEngine.roundState(transmuteEmptyCaptain.id).purchaseUsed, '质变失败不应消耗本轮购买权');
  assert(transmuteEmpty.state.events.some(event => event.body.includes('质变失败')), '质变失败时应提示目标及以下卡池均无可选选手');

  const lastStandBlocked = createReadyHarness().H;
  const lastStandBlockedCaptain = currentCaptain(lastStandBlocked);
  lastStandBlocked.state.hexcoreAssignments[lastStandBlockedCaptain.id] = [
    { ...lastStandBlocked.sampleData.hexcores.find(hex => hex.id === 'last-stand'), status: 'available' },
  ];
  const blockedCamp = lastStandBlocked.selectors.captainCamp(lastStandBlockedCaptain.id);
  const blockedOldPlayers = lastStandBlocked.state.players
    .filter(player => player.camp === blockedCamp && !lastStandBlocked.selectors.isCaptainPlayer(player.id))
    .slice(0, 4);
  blockedOldPlayers.forEach(player => {
    player.status = 'drafted';
    player.teamId = lastStandBlockedCaptain.id;
  });
  lastStandBlockedCaptain.team = blockedOldPlayers.map(player => player.id);
  lastStandBlocked.state.players
    .filter(player => !lastStandBlocked.selectors.isCaptainPlayer(player.id) && !blockedOldPlayers.includes(player))
    .forEach(player => {
      player.status = player.camp === blockedCamp ? 'disabled' : 'available';
      delete player.teamId;
    });
  const blockedQueueItem = lastStandBlocked.hexcoreEngine.executionQueue(lastStandBlockedCaptain.id).find(item => item.id === 'last-stand');
  assert(blockedQueueItem && !blockedQueueItem.executable, '背水一战不能用异阵营候选凑满4人');
  assert(!lastStandBlocked.hexcoreEngine.activate('last-stand').ok, '本阵营替换候选不足4人时背水一战应失败');

  const lastStandHungry = createReadyHarness().H;
  const lastStandHungryCaptain = currentCaptain(lastStandHungry);
  const lastStandHungryOwner = lastStandHungry.state.captains[1];
  lastStandHungry.state.hexcoreAssignments[lastStandHungryCaptain.id] = [
    { ...lastStandHungry.sampleData.hexcores.find(hex => hex.id === 'last-stand'), status: 'available' },
  ];
  lastStandHungry.state.hexcoreAssignments[lastStandHungryOwner.id] = [
    { ...lastStandHungry.sampleData.hexcores.find(hex => hex.id === 'hungry-wave'), status: 'passive' },
  ];
  const hungryCamp = lastStandHungry.selectors.captainCamp(lastStandHungryCaptain.id);
  const hungryOldPlayers = lastStandHungry.state.players
    .filter(player => player.camp === hungryCamp && !lastStandHungry.selectors.isCaptainPlayer(player.id))
    .slice(0, 4);
  const hungryOwnedCandidate = lastStandHungry.state.players
    .find(player => player.camp === hungryCamp && !lastStandHungry.selectors.isCaptainPlayer(player.id) && !hungryOldPlayers.includes(player));
  hungryOldPlayers.forEach(player => {
    player.status = 'drafted';
    player.teamId = lastStandHungryCaptain.id;
  });
  lastStandHungryCaptain.team = hungryOldPlayers.map(player => player.id);
  hungryOwnedCandidate.status = 'drafted';
  hungryOwnedCandidate.teamId = lastStandHungryOwner.id;
  lastStandHungryOwner.team = [hungryOwnedCandidate.id];
  assert(!lastStandHungry.hexcoreEngine.lastStandCandidates(lastStandHungryCaptain.id).some(player => player.id === hungryOwnedCandidate.id), '背水一战候选不应包含海浪我没吃饭队伍当前拥有的队员');

  const lastStandHarness = createReadyHarness();
  const lastStand = lastStandHarness.H;
  const lastStandCaptain = currentCaptain(lastStand);
  const lastStandOther = lastStand.state.captains[1];
  lastStand.state.hexcoreAssignments[lastStandCaptain.id] = [
    { ...lastStand.sampleData.hexcores.find(hex => hex.id === 'last-stand'), status: 'available' },
  ];
  const lastStandCamp = lastStand.selectors.captainCamp(lastStandCaptain.id);
  const nonCaptainPlayers = lastStand.state.players.filter(player => !lastStand.selectors.isCaptainPlayer(player.id));
  nonCaptainPlayers.forEach(player => {
    player.status = 'disabled';
    delete player.teamId;
  });
  const campPlayers = nonCaptainPlayers.filter(player => player.camp === lastStandCamp);
  const outsiderPlayers = nonCaptainPlayers.filter(player => player.camp !== lastStandCamp).slice(0, 4);
  const oldPlayers = campPlayers.slice(0, 4);
  const pickedPlayers = campPlayers.slice(4, 8);
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
  outsiderPlayers.forEach(player => {
    player.status = 'available';
    delete player.teamId;
  });
  lastStand.state.draft.currentDraw = null;
  lastStand.turnOrderEngine.recompute();
  assert(lastStand.state.draft.currentOrder.includes(lastStandCaptain.id), '已满员但可发动背水一战的队长仍应保留在本轮顺位中');
  const lastStandQueueItem = lastStand.hexcoreEngine.executionQueue(lastStandCaptain.id).find(item => item.id === 'last-stand');
  assert(lastStandQueueItem && lastStandQueueItem.executable, '背水一战在队伍已有4名队员时应在执行队列中可发动');
  const uiResult = lastStand.actions.useHexcore('last-stand');
  assert(uiResult && uiResult.pendingConfirm, '通过裁判按钮发动背水一战应先打开确认弹窗');
  assert(lastStand.state.ui.lastStandConfirm && lastStandHarness.app.innerHTML.includes('last-stand-modal'), '背水一战确认弹窗应写入UI状态并渲染');
  assert(lastStandHarness.app.innerHTML.includes('本阵营候选') && lastStandHarness.app.innerHTML.includes('不可跨阵营置换') && lastStandHarness.app.innerHTML.includes('确认发动'), '背水一战弹窗应说明候选范围并提供确认入口');
  assert(lastStandHarness.app.innerHTML.includes('last-stand-candidate-panel'), '背水一战候选池预览应有独立可滚动容器');
  assert(lastStandCaptain.team.every(playerId => oldPlayers.some(player => player.id === playerId)), '确认前不应提前置换队伍');
  assert(lastStand.actions.confirmLastStand().ok, '确认弹窗后背水一战应可在当前队伍满4名队员时发动');
  assert(pickedPlayers.every(player => lastStandCaptain.team.includes(player.id)), '背水一战应随机换入4名非队长选手');
  assert(!lastStandCaptain.team.some(playerId => oldPlayers.some(player => player.id === playerId)), '背水一战后原队员不应留在使用者队伍中');
  assert(lastStandOther.team.length === 1 && oldPlayers.some(player => lastStandOther.team.includes(player.id)), '被抽走队员的队伍应获得1名原队员补偿');
  assert(pickedPlayers[0].teamId === lastStandCaptain.id, '被抽走选手归属应更新为背水一战使用者');
  assert(lastStandCaptain.team.every(playerId => playerById(lastStand, playerId).camp === lastStandCamp), '背水一战换入队员必须全部来自本阵营');
  assert(outsiderPlayers.every(player => !lastStandCaptain.team.includes(player.id)), '背水一战不得抽入异阵营候选');
  assert(oldPlayers.filter(player => player.status === 'available' && !player.teamId).length === 3, '未作为补偿的原队员应回到可选池');
  assert(!lastStand.economyEngine.roundState(lastStandCaptain.id).purchaseUsed, '背水一战本身不应消耗购买权；满员后购买权自然失效');

  const lastStandAutoHarness = createReadyHarness();
  const lastStandAuto = lastStandAutoHarness.H;
  const lastStandAutoCaptain = currentCaptain(lastStandAuto);
  lastStandAuto.state.hexcoreAssignments[lastStandAutoCaptain.id] = [
    { ...lastStandAuto.sampleData.hexcores.find(hex => hex.id === 'last-stand'), status: 'available' },
  ];
  const autoCamp = lastStandAuto.selectors.captainCamp(lastStandAutoCaptain.id);
  const autoPlayers = lastStandAuto.state.players
    .filter(player => player.camp === autoCamp && !lastStandAuto.selectors.isCaptainPlayer(player.id))
    .slice(0, 4);
  autoPlayers.slice(0, 3).forEach(player => {
    player.status = 'drafted';
    player.teamId = lastStandAutoCaptain.id;
  });
  lastStandAutoCaptain.team = autoPlayers.slice(0, 3).map(player => player.id);
  lastStandAuto.state.draft.currentDraw = {
    id: 'last_stand_auto_shop',
    captainId: lastStandAutoCaptain.id,
    round: lastStandAuto.state.draft.round,
    pickMode: 'shop',
    generatedBy: 'test',
    cards: [{ slotId: 'auto_slot_1', playerId: autoPlayers[3].id, tier: autoPlayers[3].tier, price: 0 }],
    appliedEffects: [],
  };
  lastStandAutoCaptain.economy.gold = 10;
  lastStandAuto.state.draft.selectedSlot = 0;
  lastStandAuto.actions.pickCard();
  assert(lastStandAuto.state.ui.lastStandConfirm && lastStandAuto.state.ui.lastStandConfirm.autoOneChance, '拥有背水一战的队伍满员后应自动弹出一次性确认窗口');
  assert(lastStandAutoHarness.app.innerHTML.includes('唯一一次机会') && lastStandAutoHarness.app.innerHTML.includes('确认发动'), '背水一战自动弹窗应强提示只有一次机会');
  lastStandAuto.actions.cancelLastStand();
  assert(lastStandAuto.state.draft.runtimeEffects.some(effect => effect.type === 'last_stand_declined' && effect.captainId === lastStandAutoCaptain.id), '取消自动背水弹窗应记录本轮已放弃，避免重复询问');

  const lastStandPurchased = createReadyHarness().H;
  const lastStandPurchasedCaptain = currentCaptain(lastStandPurchased);
  lastStandPurchased.state.hexcoreAssignments[lastStandPurchasedCaptain.id] = [
    { ...lastStandPurchased.sampleData.hexcores.find(hex => hex.id === 'last-stand'), status: 'available' },
  ];
  const purchasedCamp = lastStandPurchased.selectors.captainCamp(lastStandPurchasedCaptain.id);
  const purchasedOldPlayers = lastStandPurchased.state.players
    .filter(player => player.camp === purchasedCamp && !lastStandPurchased.selectors.isCaptainPlayer(player.id))
    .slice(0, 4);
  purchasedOldPlayers.forEach(player => {
    player.status = 'drafted';
    player.teamId = lastStandPurchasedCaptain.id;
  });
  lastStandPurchasedCaptain.team = purchasedOldPlayers.map(player => player.id);
  lastStandPurchased.economyEngine.roundState(lastStandPurchasedCaptain.id).purchaseUsed = true;
  const purchasedQueueItem = lastStandPurchased.hexcoreEngine.executionQueue(lastStandPurchasedCaptain.id).find(item => item.id === 'last-stand');
  assert(purchasedQueueItem && purchasedQueueItem.executable, '背水一战在队伍满员后即使无购买权也应可发动');
  assert(lastStandPurchased.hexcoreEngine.activate('last-stand').ok, '本轮已购买但队伍满员后仍可发动背水一战');

  const lastStandOrder = createReadyHarness().H;
  const lastStandOrderCaptain = lastStandOrder.state.captains[5];
  lastStandOrder.state.hexcoreAssignments[lastStandOrderCaptain.id] = [
    { ...lastStandOrder.sampleData.hexcores.find(hex => hex.id === 'last-stand'), status: 'available' },
  ];
  lastStandOrder.state.draft.round = 4;
  lastStandOrder.turnOrderEngine.recompute();
  const lastStandOrderReason = (lastStandOrder.state.draft.explanations.find(item => item.captainId === lastStandOrderCaptain.id) || {}).reasons || [];
  assert(!lastStandOrderReason.some(reason => reason.includes('背水一战')), '背水一战不应再产生第4轮顺位效果');

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
  assert(app.innerHTML.includes('hex-effect-icon'), '海克斯卡片应使用效果语义图标而不是纯文字或emoji');

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

function testDraftOrderFollowsHexcoreDrawOrder() {
  const { H } = createHarness();
  installReadyTestData(H);
  const customOrder = ['c5', 'c2', 'c9', 'c1', 'c7', 'c3', 'c10', 'c4', 'c8', 'c6'];
  H.state.draft.phase = 'setup';
  H.state.draft.baseOrder = H.state.captains.map(captain => captain.id);
  H.state.draft.currentOrder = H.state.captains.map(captain => captain.id);
  H.state.hexcoreDraft.drawOrder = [...customOrder];
  H.actions.startDraft({ skipSnapshot: true });

  assert(
    H.state.draft.baseOrder.join(',') === customOrder.join(','),
    `队员抽选基础顺位应继承海克斯抽取顺序，实际 ${H.state.draft.baseOrder.join(',')}，期望 ${customOrder.join(',')}`
  );
  assert(
    H.state.draft.currentOrder.join(',') === customOrder.join(','),
    `第1轮当前顺位应继承海克斯抽取顺序，实际 ${H.state.draft.currentOrder.join(',')}，期望 ${customOrder.join(',')}`
  );
  assert(H.state.draft.currentIndex === 0, '开始队员抽选后应从海克斯抽取顺序第一位开始');
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
  assert(app.innerHTML.includes('hex-library-icon') && app.innerHTML.includes('hex-effect-icon'), '海克斯库下方卡片应展示效果语义图标');
  assert(app.innerHTML.includes('hex-library-desc') && app.innerHTML.includes('showHexDetail'), '海克斯库描述应以摘要+详情点击入口展示');
  H.actions.showHexDetail('camp-blockade');
  assert(H.state.ui.hexDetailModal && H.state.ui.hexDetailModal.hexcoreId === 'camp-blockade', '点击详情后应打开海克斯详情弹窗状态');
  assert(
    app.innerHTML.includes('hex-detail-modal')
    && app.innerHTML.includes('阵营封锁')
    && app.innerHTML.includes('规则介绍')
    && app.innerHTML.includes('使用技巧')
    && app.innerHTML.includes('注意事项'),
    '详情弹窗应渲染海克斯完整介绍、技巧和注意事项'
  );
  assert(
    app.innerHTML.includes('规则特性')
    && app.innerHTML.includes('需要目标')
    && app.innerHTML.includes('商店影响'),
    '详情弹窗规则特性应显示中文标签'
  );
  H.actions.closeHexDetail();
  assert(!H.state.ui.hexDetailModal, '点击关闭后应隐藏海克斯详情弹窗');
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

  H.state.hexcoreDraft = {
    captainId: H.state.captains[0].id,
    slots: ['snow-cat'],
    chosen: [],
    seenIds: ['snow-cat'],
    refreshUsed: false,
  };
  H.ui.render();
  assert(app.innerHTML.includes('aria-label="商店信息打乱"'), '雪定饿的喵图标应表达商店信息打乱效果');
  assert(!app.innerHTML.includes('&#10052;') && !app.innerHTML.includes('雪花'), '雪定饿的喵不应再使用雪花图标');

  setOnlyHexcore(H, H.state.captains[0].id, 'price-interference');
  H.actions.setActiveView('draft');
  assert(app.innerHTML.includes('hex-category-chip') && app.innerHTML.includes('干扰'), '执行队列应展示海克斯业务分类标签');
}

function testDraftRosterBoard() {
  const { H, app } = createReadyHarness();
  const target = H.selectors.currentCaptain();
  const captainPlayer = H.selectors.captainPlayer(target.id);
  const candidates = H.state.players
    .filter(player => player.status === 'available' && player.camp === captainPlayer.camp && !H.selectors.isCaptainPlayer(player.id))
    .slice(0, 2);
  candidates.forEach(player => {
    player.status = 'drafted';
    player.teamId = target.id;
    target.team.push(player.id);
  });
  target.economy.gold = 7;
  H.state.hexcoreAssignments[target.id] = [assignedHexcore(H.sampleData.hexcores.find(hex => hex.id === 'heavenly-descent'))];
  H.ui.render();

  assert(app.innerHTML.includes('roster-board') && app.innerHTML.includes('team-roster-card'), '实时抽选页应渲染紧凑队伍阵容看板');
  assert(app.innerHTML.includes('金币 7'), '阵容看板应显示队伍剩余金币');
  assert(app.innerHTML.includes(`队长 ${captainPlayer.name}`), '阵容看板应显示队长姓名');
  assert(app.innerHTML.includes('神兵天降'), '阵容看板应显示持有海克斯名称');
  assert(app.innerHTML.includes(`${candidates[0].tier}费 ${candidates[0].name}`), '阵容看板应显示队员费用和姓名摘要');
  assert(app.innerHTML.includes('roster-card-popover') && app.innerHTML.includes('异常：无异常'), '阵容看板 hover 详情应包含完整状态和异常说明');
  assert(app.innerHTML.includes('status-dot current'), '当前操作队伍应有明确状态点');

  const broken = H.state.captains[1];
  const brokenCaptainId = broken.playerId;
  delete broken.playerId;
  if (brokenCaptainId) {
    const player = H.state.players.find(item => item.id === brokenCaptainId);
    if (player) {
      player.status = 'available';
      delete player.teamId;
    }
  }
  H.ui.render();
  assert(app.innerHTML.includes('team-roster-card abnormal') && app.innerHTML.includes('缺队长'), '缺队长队伍应在看板中以异常状态显示');

  const previousIndex = H.state.draft.currentIndex;
  H.actions.focusTeamFromRoster(target.id);
  assert(H.state.ui.activeView === 'teams', '点击阵容看板队伍卡应切换到队伍管理页');
  assert(H.state.ui.highlightCaptainId === target.id, '点击阵容看板队伍卡应高亮目标队伍');
  assert(!H.state.ui.scrollCaptainIntoViewId, '队伍定位渲染后应清除一次性居中滚动目标');
  assert(H.state.draft.currentIndex === previousIndex, '点击阵容看板只定位队伍，不应改变当前抽选顺位');
  assert(app.innerHTML.includes('located-card') && app.innerHTML.includes(`data-captain-id="${target.id}"`), '队伍管理页应显示被定位队伍的高亮状态和可滚动定位标记');
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

  const stuckPicker = createReadyHarness();
  const stuckCaptain = stuckPicker.H.selectors.currentCaptain();
  setOnlyHexcore(stuckPicker.H, stuckCaptain.id, 'stuck-together');
  const stuckMaxTier = stuckPicker.H.hexcoreEngine.stuckTogetherMaxTier();
  const stuckTarget = stuckPicker.H.hexcoreEngine.stuckTogetherTargets(stuckCaptain.id)[0];
  stuckPicker.H.actions.setActiveView('draft');
  stuckPicker.H.actions.openHexTargetPicker('stuck-together');
  assert(
    stuckPicker.app.innerHTML.includes('费用上限')
    && stuckPicker.app.innerHTML.includes(`最多锁定 ${stuckMaxTier} 费`)
    && stuckPicker.app.innerHTML.includes(`锁定选手（${stuckMaxTier}费及以下）`),
    '和我困在一起目标选择面板应展示本轮费用上限'
  );
  assert(
    stuckTarget && stuckPicker.app.innerHTML.includes(`${stuckTarget.tier}费 · 评分 ${stuckTarget.score}`),
    '和我困在一起目标选择项应标注选手费用和评分'
  );
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

  const oldBlocked = createReadyHarness().H;
  const oldTarget = oldBlocked.state.captains[0];
  const oldHexcore = { id: 'legacy-only-test', name: '旧海克斯测试', mode: 'manual', uses: 1, category: 'shop_control', desc: '旧海克斯不应进入金币模式。' };
  oldBlocked.sampleData.hexcores.push(oldHexcore);
  oldBlocked.state.captains.forEach(captain => {
    oldBlocked.state.hexcoreAssignments[captain.id] = [];
  });
  oldBlocked.state.hexcoreAssignments[oldBlocked.state.captains[1].id] = oldBlocked.sampleData.hexcores
    .filter(hex => hex.id !== oldHexcore.id)
    .map(assignedHexcore);
  oldBlocked.actions.drawHexcoreForCaptain(oldTarget.id);
  assert(!oldBlocked.state.hexcoreDraft.slots.includes(oldHexcore.id), '旧海克斯不应进入金币模式五抽一候选池');
  oldBlocked.actions.assignHexcoreToCaptain(oldTarget.id, oldHexcore.id);
  assert(!(oldBlocked.state.hexcoreAssignments[oldTarget.id] || []).some(hex => hex.id === oldHexcore.id), '旧海克斯不允许被裁判兜底分配');
  oldBlocked.state.hexcoreDraft = {
    captainId: oldTarget.id,
    slots: [oldHexcore.id],
    chosen: [],
    seenIds: [oldHexcore.id],
    refreshUsed: false,
  };
  oldBlocked.actions.selectHexcoreFromDraw(oldTarget.id, oldHexcore.id);
  assert(!(oldBlocked.state.hexcoreAssignments[oldTarget.id] || []).some(hex => hex.id === oldHexcore.id), '伪造候选会话也不能选择旧海克斯');
}

function testUiNavigationAndSecurity() {
  const { H, app } = createReadyHarness();
  H.actions.setActiveView('draft');
  assert(app.innerHTML.includes('金币') && app.innerHTML.includes('点击购买') && app.innerHTML.includes('刷新（'), '实时抽选页应展示金币商店操作、卡片直接购买提示和刷新费用');
  assert(!app.innerHTML.includes('购买此卡'), '实时抽选页裁判操作区不应再展示二段式购买按钮');
  assert(app.innerHTML.includes('control-group shop-actions') && app.innerHTML.includes('control-group primary-actions'), '实时抽选页裁判操作应按商店和流程分组');
  const freeOpen = createHarness();
  installReadyTestData(freeOpen.H);
  freeOpen.H.actions.startDraft({ skipSnapshot: true });
  const freeOpenCaptain = freeOpen.H.selectors.currentCaptain();
  freeOpen.H.economyEngine.roundState(freeOpenCaptain.id).purchaseUsed = true;
  freeOpen.H.actions.setActiveView('draft');
  assert(freeOpen.app.innerHTML.includes('开始抽卡') || freeOpen.app.innerHTML.includes('首次免费'), '免费开店入口应照常展示');
  assert(!freeOpen.app.innerHTML.includes('已无购买权'), '未开本轮免费商店时，不应因购买权状态禁用开店入口');
  freeOpen.H.actions.drawCards();
  assert(freeOpen.H.state.draft.currentDraw && freeOpen.H.state.draft.currentDraw.generatedBy === 'free_shop', '免费开店不应受购买权状态影响');
  const blockedRefresh = createReadyHarness();
  blockedRefresh.H.actions.setActiveView('draft');
  const blockedCaptain = blockedRefresh.H.selectors.currentCaptain();
  blockedRefresh.H.economyEngine.roundState(blockedCaptain.id).purchaseUsed = true;
  blockedRefresh.H.ui.render();
  assert(
    blockedRefresh.app.innerHTML.includes('已无购买权')
    && blockedRefresh.app.innerHTML.includes('本轮购买权已使用')
    && blockedRefresh.app.innerHTML.includes('ghost-btn disabled'),
    '本轮购买权用尽后，商店刷新入口应禁用并说明原因'
  );
  assert(app.innerHTML.includes('规则摘要') && app.innerHTML.includes('完整规则'), '实时抽选页应展示压缩后的规则摘要入口');
  assert(app.innerHTML.includes('顺位变更说明') && app.innerHTML.includes('顺位详情'), '实时抽选页应展示基础顺位和海克斯修正来源入口');
  const nextRoundPreview = createReadyHarness();
  const previewH = nextRoundPreview.H;
  releaseHexcoreEverywhere(previewH, 'origin-sage');
  const originPreviewCaptain = previewH.state.captains[2];
  setOnlyHexcore(previewH, originPreviewCaptain.id, 'origin-sage');
  previewH.state.draft.round = 1;
  previewH.turnOrderEngine.recompute();
  previewH.state.draft.currentIndex = previewH.state.draft.currentOrder.length - 1;
  previewH.ui.render();
  assert(
    nextRoundPreview.app.innerHTML.includes('下一轮首位')
    && nextRoundPreview.app.innerHTML.includes(originPreviewCaptain.name),
    '当前处于本轮末位时，下一位应预览下一轮第一位，并考虑神秘贤者·启元提首'
  );
  assert(!previewH.state.draft.runtimeEffects.some(effect => effect.sourceHexcoreId === 'origin-sage' && Number(effect.round) === 2), '下一轮顺位预览不应提前写入启元运行时效果');
  assert(!app.innerHTML.includes('暂停选人流程') && !app.innerHTML.includes('继续选人流程'), '实时抽选页不应再显示暂停/继续按钮');
  assert(typeof H.actions.pause === 'undefined', '暂停/继续动作应从公开操作中移除');
  H.actions.drawCards();
  assert(app.innerHTML.includes('本地人') || app.innerHTML.includes('外地人'), '商店卡应显示阵营标签');
  assert(app.innerHTML.includes('hex-execution-queue'), '实时抽选页应展示海克斯执行队列');
  assert(!app.innerHTML.includes('class="hex-list"'), '实时抽选页不应重复展示拥有海克斯列表');
  H.actions.nextCaptain();
  const usableCaptain = H.selectors.currentCaptain();
  setOnlyHexcore(H, usableCaptain.id, 'camp-scout');
  H.actions.setActiveView('draft');
  assert(app.innerHTML.includes('当前有海克斯可使用') && app.innerHTML.includes('usable-hex-alert'), '海克斯满足可用条件时应在实时抽选页顶部醒目提示');
  assert(app.innerHTML.includes('可使用'), '可执行海克斯队列项应带有明确可使用标识');
  const autoWarn = createReadyHarness();
  const autoWarnCaptain = autoWarn.H.selectors.currentCaptain();
  const autoWarnTarget = autoWarn.H.hexcoreEngine.stuckTogetherTargets(autoWarnCaptain.id)[0];
  autoWarn.H.state.hexcoreAssignments[autoWarnCaptain.id] = [
    assignedHexcore(autoWarn.H.sampleData.hexcores.find(hex => hex.id === 'stuck-together')),
    assignedHexcore(autoWarn.H.sampleData.hexcores.find(hex => hex.id === 'steady-reinforce')),
  ];
  autoWarn.H.state.draft.runtimeEffects.push({
    type: 'stuck_together',
    captainId: autoWarnCaptain.id,
    sourceCaptainId: autoWarnCaptain.id,
    playerId: autoWarnTarget.id,
    triggerRound: autoWarn.H.state.draft.round + 1,
    reason: `${autoWarnCaptain.name} 已锁定 ${autoWarnTarget.name}`,
  });
  autoWarn.H.actions.setActiveView('draft');
  assert(
    autoWarn.app.innerHTML.includes('延迟自动入队提醒')
    && autoWarn.app.innerHTML.includes('自动入队失效')
    && autoWarn.app.innerHTML.includes('稳健补强'),
    '存在延迟自动入队效果时，应提醒使用者不要先使用会消耗购买权或占名额的海克斯'
  );

  assert(staticServer.resolveRequestPath('/') === path.join(root, 'index.html'), '静态服务应正常解析首页');
  assert(staticServer.resolveRequestPath('/src/main.js') === path.join(root, 'src', 'main.js'), '静态服务应正常解析项目内资源');
  assert(staticServer.resolveRequestPath('/assets/hex-icons/camp-scout.png') === path.join(root, 'public', 'assets', 'hex-icons', 'camp-scout.png'), '静态服务应将 assets 图标路径映射到 public/assets');
  assert(staticServer.resolveRequestPath('/scripts/serve.js') === null, '静态服务不应暴露部署脚本源码');
  assert(staticServer.resolveRequestPath('/docs/00_项目总览.md') === null, '静态服务不应暴露项目文档目录');
  assert(staticServer.resolveRequestPath('/..%2FHEXCORE2.0_secret%2Fsecret.txt') === null, '静态服务应拒绝同名前缀兄弟目录穿越');
  assert(staticServer.resolveRequestPath('/%E0%A4%A') === null, '静态服务应拒绝非法URL编码');
}

function testMultiplayerCopyIsolation() {
  const localAppRoot = path.join(root, 'apps', 'multiplayer');
  assert(fs.existsSync(path.join(localAppRoot, 'index.html')), '多人端版本管理副本应包含独立 index.html');
  assert(fs.existsSync(path.join(localAppRoot, 'src', 'main.js')), '多人端版本管理副本应包含独立 src/main.js');
  assert(fs.existsSync(path.join(localAppRoot, 'assets', 'brand', 'hexcore-brand.png')), '多人端版本管理副本应包含独立静态资产');
  assert(multiplayerServer.appRoot === localAppRoot, '多人端服务默认应使用当前 worktree 内的 apps/multiplayer');
  const html = fs.readFileSync(path.join(localAppRoot, 'index.html'), 'utf8');
  assert(html.includes('src/core/sample-data.js') && html.includes('src/main.js'), '多人端副本首页应从副本内 src 加载脚本');
  assert(multiplayerServer.resolveRequestPath('/') === path.join(localAppRoot, 'index.html'), '多人端服务应解析副本首页');
  assert(multiplayerServer.resolveRequestPath('/src/main.js') === path.join(localAppRoot, 'src', 'main.js'), '多人端服务应解析副本内源码');
  assert(multiplayerServer.resolveRequestPath('/assets/hex-icons/camp-scout.png') === path.join(localAppRoot, 'assets', 'hex-icons', 'camp-scout.png'), '多人端服务应解析副本内资产');
  assert(multiplayerServer.resolveRequestPath('/scripts/serve.js') === null, '多人端服务不应暴露根目录脚本');
  assert(multiplayerServer.resolveRequestPath('/docs/06_开发计划.md') === null, '多人端服务不应暴露根目录文档');
  assert(multiplayerServer.resolveRequestPath('/..%2F..%2Fpackage.json') === null, '多人端服务应拒绝穿越到项目根目录');
  assert(multiplayerServer.resolveRequestPath('/%E0%A4%A') === null, '多人端服务应拒绝非法URL编码');
}

function testMultiplayerSharedRulePreflight() {
  const state = multiplayerRules.createAuthorityState({
    tournamentId: 'tournament-test',
    snapshot: {
      currentTeamId: 'team-1',
      teams: [
        { teamId: 'team-1', name: '测试1队', renameUsed: false },
        { teamId: 'team-2', name: '测试2队', renameUsed: false },
      ],
      hexcoreActionWindows: [
        { teamId: 'team-2', hexcoreId: 'charged-cannon', active: true },
      ],
    },
  });
  const command = multiplayerShared.createCommand({
    commandId: 'cmd-001',
    tournamentId: 'tournament-test',
    type: multiplayerShared.COMMAND_TYPES.PURCHASE_SHOP_CARD,
    actorId: 'captain-user-1',
    role: multiplayerShared.ROLES.CAPTAIN,
    teamId: 'team-1',
    baseVersion: 0,
    payload: { teamId: 'team-1', slotId: 'slot-1' },
  });
  const accepted = multiplayerRules.acceptCommandAsEvent(
    state,
    command,
    { actorId: 'captain-user-1', role: multiplayerShared.ROLES.CAPTAIN, teamId: 'team-1' },
    multiplayerShared.EVENT_TYPES.SHOP_CARD_PURCHASED,
    { teamId: 'team-1', slotId: 'slot-1' }
  );
  assert(accepted.state.stateVersion === 1, '多人端规则包追加事件后应推进 stateVersion');
  assert(accepted.event.sourceCommandId === command.commandId, '多人端事件应记录来源 commandId');
  const openShopCommand = multiplayerShared.createCommand({
    commandId: 'cmd-open-shop-1',
    tournamentId: 'tournament-test',
    type: multiplayerShared.COMMAND_TYPES.OPEN_SHOP,
    actorId: 'captain-user-1',
    role: multiplayerShared.ROLES.CAPTAIN,
    teamId: 'team-1',
    baseVersion: 0,
    payload: { teamId: 'team-1' },
  });
  assert(
    multiplayerRules.preflightCommand(
      state,
      openShopCommand,
      { actorId: 'captain-user-1', role: multiplayerShared.ROLES.CAPTAIN, teamId: 'team-1' }
    ).ok,
    '队长本人回合应可提交开店 command'
  );
  const shopProjected = multiplayerRules.acceptCommandAsEvent(
    state,
    openShopCommand,
    { actorId: 'captain-user-1', role: multiplayerShared.ROLES.CAPTAIN, teamId: 'team-1' },
    multiplayerShared.EVENT_TYPES.SHOP_OPENED,
    {
      teamId: 'team-1',
      round: 1,
      commandRole: multiplayerShared.ROLES.REFEREE,
      currentShop: {
        id: 'shop-rule-1',
        teamId: 'team-1',
        round: 1,
        cards: [{ slotId: 'slot-1', playerId: 'player-1', tier: 2, price: 2, camp: 'local' }],
      },
      hexcoreActionWindows: [{ teamId: 'team-2', hexcoreId: 'heavenly-descent', active: true }],
    }
  );
  assert(
    shopProjected.state.snapshot.currentShop.cards.length === 0
    && shopProjected.state.snapshot.roundStates['team-1']['1'].freeShopUsed
    && !shopProjected.state.snapshot.hexcoreActionWindows.some(window => window.hexcoreId === 'heavenly-descent'),
    '队长端 command 不应通过 payload 伪造权威商店卡或海克斯窗口'
  );
  const refereeShopCommand = multiplayerShared.createCommand({
    commandId: 'cmd-ref-shop',
    tournamentId: 'tournament-test',
    type: multiplayerShared.COMMAND_TYPES.OPEN_SHOP,
    actorId: 'referee-user-1',
    role: multiplayerShared.ROLES.REFEREE,
    teamId: 'team-1',
    baseVersion: 0,
    payload: { teamId: 'team-1' },
  });
  const refereeShopProjected = multiplayerRules.acceptCommandAsEvent(
    state,
    refereeShopCommand,
    { actorId: 'referee-user-1', role: multiplayerShared.ROLES.REFEREE, teamId: '' },
    multiplayerShared.EVENT_TYPES.SHOP_OPENED,
    {
      teamId: 'team-1',
      round: 1,
      currentShop: {
        id: 'shop-rule-referee',
        teamId: 'team-1',
        round: 1,
        cards: [{ slotId: 'slot-1', playerId: 'player-1', tier: 2, price: 2, camp: 'local' }],
      },
      hexcoreActionWindows: [{ teamId: 'team-2', hexcoreId: 'heavenly-descent', active: true }],
    }
  );
  assert(
    refereeShopProjected.state.snapshot.currentShop.cards[0].playerId === 'player-1'
    && refereeShopProjected.state.snapshot.roundStates['team-1']['1'].freeShopUsed
    && refereeShopProjected.state.snapshot.hexcoreActionWindows[0].hexcoreId === 'heavenly-descent',
    '裁判可信动作可以把公开商店、轮内状态和海克斯窗口落入快照，供多端同步投影使用'
  );
  const trustedPurchaseCommand = multiplayerShared.createCommand({
    commandId: 'cmd-purchase-from-trusted-shop',
    tournamentId: 'tournament-test',
    type: multiplayerShared.COMMAND_TYPES.PURCHASE_SHOP_CARD,
    actorId: 'captain-user-1',
    role: multiplayerShared.ROLES.CAPTAIN,
    teamId: 'team-1',
    baseVersion: 1,
    payload: { teamId: 'team-1', slotId: 'slot-1', playerId: 'forged-player', displayPlayerId: 'forged-visible' },
  });
  const trustedPurchase = multiplayerRules.acceptCommandAsEvent(
    refereeShopProjected.state,
    trustedPurchaseCommand,
    { actorId: 'captain-user-1', role: multiplayerShared.ROLES.CAPTAIN, teamId: 'team-1' },
    multiplayerShared.EVENT_TYPES.SHOP_CARD_PURCHASED,
    trustedPurchaseCommand.payload
  );
  assert(
    trustedPurchase.state.snapshot.currentShop.cards[0].purchased === true
    && trustedPurchase.state.snapshot.lastPurchase.playerId === 'player-1'
    && trustedPurchase.state.snapshot.lastPurchase.displayPlayerId === ''
    && trustedPurchase.state.snapshot.roundStates['team-1']['1'].purchaseUsed,
    '购买权威商店卡时应从服务端商店槽位推导选手信息，不能信任队长 payload 里的 playerId'
  );
  const duplicate = multiplayerRules.acceptCommandAsEvent(
    accepted.state,
    command,
    { actorId: 'captain-user-1', role: multiplayerShared.ROLES.CAPTAIN, teamId: 'team-1' },
    multiplayerShared.EVENT_TYPES.SHOP_CARD_PURCHASED,
    { teamId: 'team-1', slotId: 'slot-1' }
  );
  assert(duplicate.duplicate === true && duplicate.event.eventSeq === accepted.event.eventSeq, '重复 command 应幂等返回首次事件');

  let staleRejected = false;
  try {
    multiplayerRules.preflightCommand(accepted.state, multiplayerShared.createCommand({
      ...command,
      commandId: 'cmd-002',
      baseVersion: 0,
    }), { actorId: 'captain-user-1', role: multiplayerShared.ROLES.CAPTAIN, teamId: 'team-1' });
  } catch (error) {
    staleRejected = /状态版本过期/.test(error.message);
  }
  assert(staleRejected, '多人端规则包应拒绝过期 stateVersion 的 command');

  let crossTeamRejected = false;
  try {
    multiplayerRules.preflightCommand(state, multiplayerShared.createCommand({
      ...command,
      commandId: 'cmd-003',
      teamId: 'team-2',
      payload: { teamId: 'team-2', slotId: 'slot-1' },
    }), { actorId: 'captain-user-1', role: multiplayerShared.ROLES.CAPTAIN, teamId: 'team-1' });
  } catch (error) {
    crossTeamRejected = /自己的队伍/.test(error.message);
  }
  assert(crossTeamRejected, '队长端 command 不应操作其它队伍');

  let forgedRoleRejected = false;
  try {
    multiplayerRules.acceptCommandAsEvent(
      state,
      multiplayerShared.createCommand({
        commandId: 'cmd-004',
        tournamentId: 'tournament-test',
        type: multiplayerShared.COMMAND_TYPES.FORCE_REFEREE_RULING,
        actorId: 'captain-user-1',
        role: multiplayerShared.ROLES.REFEREE,
        baseVersion: 0,
        payload: { reason: '伪造裁判权限', patchSummary: 'bad' },
      }),
      { actorId: 'captain-user-1', role: multiplayerShared.ROLES.CAPTAIN, teamId: 'team-1' },
      multiplayerShared.EVENT_TYPES.REFEREE_RULING_FORCED,
      { reason: 'bad' }
    );
  } catch (error) {
    forgedRoleRejected = /角色绑定/.test(error.message);
  }
  assert(forgedRoleRejected, '服务端预检应拒绝客户端自报裁判角色');

  let viewerRejected = false;
  try {
    multiplayerShared.createCommand({
      commandId: 'cmd-005',
      tournamentId: 'tournament-test',
      type: multiplayerShared.COMMAND_TYPES.PURCHASE_SHOP_CARD,
      actorId: 'viewer-1',
      role: multiplayerShared.ROLES.VIEWER,
      baseVersion: 0,
      payload: { teamId: 'team-1', slotId: 'slot-1' },
    });
  } catch (error) {
    viewerRejected = /无权执行/.test(error.message);
  }
  assert(viewerRejected, '观众角色不应创建写入型 command');

  const renameCommand = multiplayerShared.createCommand({
    commandId: 'cmd-rename-1',
    tournamentId: 'tournament-test',
    type: multiplayerShared.COMMAND_TYPES.RENAME_TEAM,
    actorId: 'captain-user-1',
    role: multiplayerShared.ROLES.CAPTAIN,
    teamId: 'team-1',
    baseVersion: 0,
    payload: { teamId: 'team-1', name: '新队名' },
  });
  const renamed = multiplayerRules.acceptCommandAsEvent(
    state,
    renameCommand,
    { actorId: 'captain-user-1', role: multiplayerShared.ROLES.CAPTAIN, teamId: 'team-1' },
    multiplayerShared.EVENT_TYPES.TEAM_RENAMED,
    { teamId: 'team-1', name: '新队名' }
  );
  assert(renamed.state.snapshot.teams[0].name === '新队名' && renamed.state.snapshot.teams[0].renameUsed === true, '队长首次改名应更新队名并消耗一次改名权');

  let renameAgainRejected = false;
  try {
    multiplayerRules.preflightCommand(renamed.state, multiplayerShared.createCommand({
      ...renameCommand,
      commandId: 'cmd-rename-2',
      baseVersion: 1,
      payload: { teamId: 'team-1', name: '第二次改名' },
    }), { actorId: 'captain-user-1', role: multiplayerShared.ROLES.CAPTAIN, teamId: 'team-1' });
  } catch (error) {
    renameAgainRejected = /改名权/.test(error.message);
  }
  assert(renameAgainRejected, '队长仅应拥有一次主动改名权');

  let longNameRejected = false;
  try {
    multiplayerShared.createCommand({
      ...renameCommand,
      commandId: 'cmd-rename-long',
      payload: { teamId: 'team-1', name: '超过十二个字符的超长队伍名称' },
    });
  } catch (error) {
    longNameRejected = /队伍名称/.test(error.message);
  }
  assert(longNameRejected, '队伍名称应限制为 1-12 个字符');

  let offTurnRejected = false;
  try {
    multiplayerRules.preflightCommand(state, multiplayerShared.createCommand({
      ...command,
      commandId: 'cmd-off-turn',
      actorId: 'captain-user-2',
      teamId: 'team-2',
      baseVersion: 0,
      payload: { teamId: 'team-2', slotId: 'slot-1' },
    }), { actorId: 'captain-user-2', role: multiplayerShared.ROLES.CAPTAIN, teamId: 'team-2' });
  } catch (error) {
    offTurnRejected = /自己回合/.test(error.message);
  }
  assert(offTurnRejected, '队长非自己回合不应执行普通操作');

  const offTurnHexcore = multiplayerShared.createCommand({
    commandId: 'cmd-off-turn-hexcore',
    tournamentId: 'tournament-test',
    type: multiplayerShared.COMMAND_TYPES.USE_HEXCORE,
    actorId: 'captain-user-2',
    role: multiplayerShared.ROLES.CAPTAIN,
    teamId: 'team-2',
    baseVersion: 0,
    payload: { teamId: 'team-2', hexcoreId: 'charged-cannon' },
  });
  const hexcorePreflight = multiplayerRules.preflightCommand(
    state,
    offTurnHexcore,
    { actorId: 'captain-user-2', role: multiplayerShared.ROLES.CAPTAIN, teamId: 'team-2' }
  );
  assert(hexcorePreflight.ok && !hexcorePreflight.duplicate, '队长非自己回合仅在海克斯允许窗口可执行对应海克斯操作');
}

async function testMultiplayerApiServer() {
  const server = multiplayerApiServer.createServer();
  const port = await listen(server);
  let sse = null;
  let captainSse = null;
  try {
    const health = await requestJson(port, 'GET', '/health');
    assert(
      health.status === 200
      && health.body.ok
      && health.body.rulesVersion === multiplayerShared.RULES_VERSION
      && health.body.startedAt
      && Number.isInteger(Number(health.body.uptimeSeconds))
      && health.body.runtime
      && health.body.runtime.storage === 'memory'
      && Number.isInteger(Number(health.body.runtime.tournamentCount)),
      '多人端服务应提供健康检查、规则版本和基础运行状态'
    );

    const durableFile = path.join(os.tmpdir(), `hexcore-store-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
    let durableServer = multiplayerApiServer.createServer({ dataFile: durableFile });
    let durablePort = await listen(durableServer);
    const durableCreated = await requestJson(durablePort, 'POST', '/api/tournaments', {
      id: 't-durable',
      name: '持久化回归赛事',
      actorId: 'referee-durable',
      teams: [{ teamId: 'durable-team', name: '持久队', code: 'durable-captain-code', camp: 'local' }],
      refereeCode: 'durable-referee-code',
    });
    const durableCaptainJoin = await requestJson(durablePort, 'POST', '/api/tournaments/t-durable/join', {
      code: durableCreated.body.room.captainCodes[0].code,
      displayName: '持久队长',
    });
    const durableRefereeJoin = await requestJson(durablePort, 'POST', '/api/tournaments/t-durable/join', {
      code: durableCreated.body.room.refereeCode,
      displayName: '持久裁判',
    });
    await new Promise(resolve => durableServer.close(resolve));
    durableServer = multiplayerApiServer.createServer({ dataFile: durableFile });
    durablePort = await listen(durableServer);
    const durableHealth = await requestJson(durablePort, 'GET', '/health');
    const durableSnapshot = await requestJson(durablePort, 'GET', '/api/tournaments/t-durable/snapshot');
    const durableRoom = await requestJson(durablePort, 'GET', `/api/tournaments/t-durable/room?sessionToken=${encodeURIComponent(durableRefereeJoin.body.session.sessionToken)}`);
    const durableRename = await requestJson(durablePort, 'POST', '/api/tournaments/t-durable/commands', {
      sessionToken: durableCaptainJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-durable-rename',
        type: multiplayerShared.COMMAND_TYPES.RENAME_TEAM,
        baseVersion: 1,
        payload: { teamId: 'durable-team', name: '持久新名' },
      },
    });
    const durableRejoin = await requestJson(durablePort, 'POST', '/api/tournaments/t-durable/join', {
      code: durableCreated.body.room.captainCodes[0].code,
      displayName: '重启后队长',
    });
    await new Promise(resolve => durableServer.close(resolve));
    try { fs.unlinkSync(durableFile); } catch (error) {}
    assert(
      durableCreated.status === 201
      && durableCaptainJoin.status === 200
      && durableRefereeJoin.status === 200
      && durableHealth.body.runtime.storage === 'memory+file'
      && durableCreated.body.tournament.tournamentId === 't-durable'
      && !durableCreated.body.tournament.snapshot.tournamentId
      && durableSnapshot.status === 200
      && durableSnapshot.body.tournament.snapshot.name === '持久化回归赛事'
      && durableRoom.status === 200
      && durableRename.status === 200
      && durableRename.body.tournament.snapshot.teams[0].name === '持久新名'
      && durableRejoin.status === 200,
      '多人端文件持久化应在服务重启后恢复赛事、房间凭据摘要和 session，并继续接受 command'
    );

    const sqliteFile = path.join(os.tmpdir(), `hexcore-store-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
    let sqliteServer = multiplayerApiServer.createServer({ sqliteFile });
    let sqlitePort = await listen(sqliteServer);
    const sqliteCreated = await requestJson(sqlitePort, 'POST', '/api/tournaments', {
      id: 't-sqlite',
      name: '数据库回归赛事',
      actorId: 'referee-sqlite',
      teams: [{ teamId: 'sqlite-team', name: '数据库队', code: 'sqlite-captain-code', camp: 'local' }],
      refereeCode: 'sqlite-referee-code',
    });
    const sqliteCaptainJoin = await requestJson(sqlitePort, 'POST', '/api/tournaments/t-sqlite/join', {
      code: sqliteCreated.body.room.captainCodes[0].code,
      displayName: '数据库队长',
    });
    const sqliteRefereeJoin = await requestJson(sqlitePort, 'POST', '/api/tournaments/t-sqlite/join', {
      code: sqliteCreated.body.room.refereeCode,
      displayName: '数据库裁判',
    });
    await new Promise(resolve => sqliteServer.close(resolve));
    sqliteServer = multiplayerApiServer.createServer({ sqliteFile });
    sqlitePort = await listen(sqliteServer);
    const sqliteHealth = await requestJson(sqlitePort, 'GET', '/health');
    const sqliteRoom = await requestJson(sqlitePort, 'GET', `/api/tournaments/t-sqlite/room?sessionToken=${encodeURIComponent(sqliteRefereeJoin.body.session.sessionToken)}`);
    const sqliteExport = await requestJson(sqlitePort, 'GET', '/api/tournaments/t-sqlite/export', null, {
      headers: { Authorization: `Bearer ${sqliteRefereeJoin.body.session.sessionToken}` },
    });
    const sqliteRename = await requestJson(sqlitePort, 'POST', '/api/tournaments/t-sqlite/commands', {
      sessionToken: sqliteCaptainJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-sqlite-rename',
        type: multiplayerShared.COMMAND_TYPES.RENAME_TEAM,
        baseVersion: 1,
        payload: { teamId: 'sqlite-team', name: '数据库新名' },
      },
    });
    await new Promise(resolve => sqliteServer.close(resolve));
    try { fs.unlinkSync(sqliteFile); } catch (error) {}
    assert(
      sqliteCreated.status === 201
      && sqliteCaptainJoin.status === 200
      && sqliteRefereeJoin.status === 200
      && sqliteHealth.body.runtime.storage === 'memory+sqlite'
      && !sqliteHealth.body.runtime.sqliteFile
      && sqliteRoom.status === 200
      && sqliteExport.status === 200
      && sqliteExport.body.backup.storage === 'memory+sqlite'
      && sqliteRename.status === 200
      && sqliteRename.body.tournament.snapshot.teams[0].name === '数据库新名',
      '多人端 SQLite 数据库存储应在服务重启后恢复赛事、房间凭据摘要和 session，并导出正确存储类型'
    );

    const created = await requestJson(port, 'POST', '/api/tournaments', {
      id: 't-api',
      name: 'API 回归赛事',
      actorId: 'referee-1',
      teams: [
        { teamId: 'team-1', name: '测试1队', code: 'captain-code-1', camp: 'local' },
        { teamId: 'team-2', name: '测试2队', code: 'captain-code-2', camp: 'outsider' },
        { teamId: 'team-3', name: '测试3队', code: 'captain-code-3', camp: 'local' },
        { teamId: 'team-4', name: '测试4队', code: 'captain-code-4', camp: 'outsider' },
      ],
      tournament: {
        type: 'single_elimination',
        status: 'running',
        pairingMode: 'camp_versus',
        rounds: [
          {
            id: 'r1',
            name: '第 1 轮',
            matches: [
              { id: 'r1m1', teamAId: 'team-1', teamBId: 'team-2', scoreA: 1, scoreB: 0, winnerId: 'team-1', status: 'completed', hiddenNote: 'schedule-secret' },
              { id: 'r1m2', teamAId: 'team-3', teamBId: 'team-4', scoreA: '', scoreB: '', winnerId: '', status: 'pending', hiddenNote: 'other-secret' },
            ],
          },
          {
            id: 'r2',
            name: '决赛',
            matches: [
              { id: 'r2m1', teamAId: 'team-1', teamBId: '', scoreA: '', scoreB: '', winnerId: '', status: 'pending' },
            ],
          },
        ],
      },
      viewerCode: 'viewer-code',
    });
    assert(created.status === 201 && created.body.tournament.stateVersion === 1, '创建赛事应写入 TournamentCreated 事件并推进版本');
    assert(created.body.tournament.events[0].type === multiplayerShared.EVENT_TYPES.TOURNAMENT_CREATED, '创建赛事应返回创建事件');
    assert(created.body.room && created.body.room.captainCodes[0].code === 'captain-code-1', '创建赛事响应应一次性返回初始房间码');
    assert(!created.body.room.displayCode, '多人端当前不提供大屏端房间码');
    assert(!created.body.tournament.events[0].payload.refereeCode && !created.body.tournament.snapshot.refereeCode, '公开快照和事件不应包含房间明文码');

    const anonymousRoom = await requestJson(port, 'GET', '/api/tournaments/t-api/room');
    assert(anonymousRoom.status === 401 && /sessionToken/.test(anonymousRoom.body.error), '匿名用户不应读取房间码管理信息');

    const captainJoin = await requestJson(port, 'POST', '/api/tournaments/t-api/join', {
      code: created.body.room.captainCodes[0].code,
      displayName: '队长用户',
    });
    assert(captainJoin.status === 200 && captainJoin.body.session.role === multiplayerShared.ROLES.CAPTAIN, '队长应能通过队伍码加入房间');
    assert(captainJoin.body.session.teamId === 'team-1' && captainJoin.body.session.sessionToken, '队长 session 应绑定自己的队伍');
    assert(captainJoin.body.tournament && captainJoin.body.tournament.stateVersion === 1, '加入房间应返回当前公开快照，供前端初始化 stateVersion');
    assert(!captainJoin.body.session.sessionTokenHash && !/^session-/.test(captainJoin.body.session.sessionToken), '客户端不应收到 session 摘要，sessionToken 不应使用可预测旧格式');

    const anonymousCaptainProjection = await requestJson(port, 'GET', '/api/tournaments/t-api/projection?view=captain');
    assert(anonymousCaptainProjection.status === 401 && /sessionToken/.test(anonymousCaptainProjection.body.error), '队长投影必须通过有效 sessionToken 绑定本队视角');
    const captainProjection = await requestJson(port, 'GET', `/api/tournaments/t-api/projection?view=captain&sessionToken=${encodeURIComponent(captainJoin.body.session.sessionToken)}`);
    const captainProjectionText = JSON.stringify(captainProjection.body);
    assert(
      captainProjection.status === 200
      && captainProjection.body.tournament.view === 'captain'
      && captainProjection.body.tournament.perspective.teamId === 'team-1'
      && captainProjection.body.tournament.snapshot.tournament.rounds.length === 2
      && captainProjectionText.includes('r1m1')
      && captainProjectionText.includes('r2m1')
      && !captainProjectionText.includes('r1m2')
      && !captainProjectionText.includes('schedule-secret')
      && !captainProjectionText.includes('other-secret'),
      '队长赛程投影只应返回本队相关场次，不暴露无关赛程或私有字段'
    );

    const viewerJoin = await requestJson(port, 'POST', '/api/tournaments/t-api/join', {
      code: created.body.room.viewerCode,
      displayName: '观众用户',
    });
    assert(viewerJoin.status === 200 && viewerJoin.body.session.role === multiplayerShared.ROLES.VIEWER, '观众应能通过观众码加入房间');

    const refereeJoin = await requestJson(port, 'POST', '/api/tournaments/t-api/join', {
      code: created.body.room.refereeCode,
      displayName: '裁判用户',
    });
    assert(refereeJoin.status === 200 && refereeJoin.body.session.role === multiplayerShared.ROLES.REFEREE, '裁判应能通过创建时返回的裁判码加入房间');

    const room = await requestJson(port, 'GET', `/api/tournaments/t-api/room?sessionToken=${encodeURIComponent(refereeJoin.body.session.sessionToken)}`);
    assert(room.status === 200 && room.body.room.captainCodes[0].codeIssued === true, '裁判 session 应能读取房间码管理摘要');
    assert(!room.body.room.refereeCodeHash && !room.body.room.refereeCode.code && !room.body.room.captainCodes[0].code, '房间码管理摘要不应返回明文码或摘要');
    assert(!room.body.room.displayCode, '房间码管理摘要不应保留大屏端入口');

    const anonymousRefereeProjection = await requestJson(port, 'GET', '/api/tournaments/t-api/projection?view=referee');
    const refereeProjection = await requestJson(port, 'GET', `/api/tournaments/t-api/projection?view=referee&sessionToken=${encodeURIComponent(refereeJoin.body.session.sessionToken)}`);
    const refereeProjectionText = JSON.stringify(refereeProjection.body);
    assert(anonymousRefereeProjection.status === 401 && /sessionToken/.test(anonymousRefereeProjection.body.error), '裁判投影必须通过有效裁判 sessionToken 读取');
    assert(
      refereeProjection.status === 200
      && refereeProjection.body.tournament.view === 'referee'
      && refereeProjection.body.tournament.role === multiplayerShared.ROLES.REFEREE
      && refereeProjectionText.includes('r1m1')
      && refereeProjectionText.includes('r1m2')
      && !refereeProjectionText.includes('schedule-secret')
      && !refereeProjectionText.includes('other-secret'),
      '裁判投影应能读取完整赛程公开字段，但不泄漏赛程私有字段'
    );

    const healthAfterCreate = await requestJson(port, 'GET', '/health');
    assert(
      healthAfterCreate.status === 200
      && healthAfterCreate.body.runtime.tournamentCount >= 1
      && healthAfterCreate.body.runtime.roomCount >= 1,
      '健康检查应暴露可用于本地运维的赛事和房间数量'
    );
    const anonymousExport = await requestJson(port, 'GET', '/api/tournaments/t-api/export');
    assert(anonymousExport.status === 401 && !anonymousExport.body.backup, '匿名用户不应导出权威赛事备份');
    const refereeQueryExport = await requestJson(port, 'GET', `/api/tournaments/t-api/export?sessionToken=${encodeURIComponent(refereeJoin.body.session.sessionToken)}`);
    assert(refereeQueryExport.status === 401 && !refereeQueryExport.body.backup, '赛事备份导出不应接受 URL 查询参数中的 sessionToken');
    const viewerExport = await requestJson(port, 'GET', '/api/tournaments/t-api/export', undefined, {
      headers: { Authorization: `Bearer ${viewerJoin.body.session.sessionToken}` },
    });
    assert(viewerExport.status === 403 && !viewerExport.body.backup, '观众不应导出权威赛事备份');
    const refereeExport = await requestJson(port, 'GET', '/api/tournaments/t-api/export', undefined, {
      headers: { Authorization: `Bearer ${refereeJoin.body.session.sessionToken}` },
    });
    const exportText = JSON.stringify(refereeExport.body);
    assert(
      refereeExport.status === 200
      && refereeExport.body.backup.backupVersion === 'hexcore-multiplayer-backup-v1'
      && /^[a-f0-9]{64}$/.test(refereeExport.body.backup.checksum)
      && refereeExport.body.backup.tournament.tournamentId === 't-api'
      && Array.isArray(refereeExport.body.backup.tournament.events)
      && !exportText.includes(refereeJoin.body.session.sessionToken)
      && !exportText.includes('refereeCodeHash')
      && !exportText.includes('viewerCodeHash')
      && !exportText.includes('captain-code-1'),
      '裁判导出的权威备份应包含校验和和赛事状态，但不能包含 sessionToken 或房间码凭据'
    );

    const snapshot = await requestJson(port, 'GET', '/api/tournaments/t-api/snapshot');
    assert(snapshot.status === 200 && snapshot.body.tournament.snapshot.name === 'API 回归赛事', '多人端服务应读取赛事快照');
    assert(!JSON.stringify(snapshot.body).includes('r1m2') && !JSON.stringify(snapshot.body).includes('schedule-secret'), '公开快照不应直接暴露完整赛程');

    sse = await subscribeSse(port, '/api/tournaments/t-api/events');
    assert(sse.initial.includes('event: snapshot') && sse.initial.includes('"tournamentId":"t-api"'), 'SSE 应先推送当前快照');
    const rejectedQueryStreamSession = await requestJson(port, 'POST', `/api/tournaments/t-api/stream-token?sessionToken=${encodeURIComponent(captainJoin.body.session.sessionToken)}`, {});
    assert(rejectedQueryStreamSession.status === 401 && /sessionToken/.test(rejectedQueryStreamSession.body.error), '短期实时订阅凭据接口不应接受 URL 查询参数中的长期 sessionToken');
    const rejectedLongTokenSse = await requestJson(port, 'GET', `/api/tournaments/t-api/events?view=captain&sessionToken=${encodeURIComponent(captainJoin.body.session.sessionToken)}`);
    assert(rejectedLongTokenSse.status === 401 && /streamToken/.test(rejectedLongTokenSse.body.error), '队长 SSE 不应回退接受 URL 查询参数中的长期 sessionToken');
    const invalidStreamToken = await requestJson(port, 'POST', '/api/tournaments/t-api/stream-token', {
      sessionToken: 'session-bad',
    });
    assert(invalidStreamToken.status === 401 && /sessionToken/.test(invalidStreamToken.body.error), '短期实时订阅凭据必须由有效 sessionToken 换取');
    const streamToken = await requestJson(port, 'POST', '/api/tournaments/t-api/stream-token', {
      sessionToken: captainJoin.body.session.sessionToken,
    });
    assert(
      streamToken.status === 200
      && /^stream_/.test(streamToken.body.streamToken)
      && streamToken.body.expiresAt
      && streamToken.body.streamToken !== captainJoin.body.session.sessionToken,
      '队长 SSE 应先用长期 sessionToken 换取短期 streamToken，不能把长期 sessionToken 放进事件订阅 URL'
    );
    captainSse = await subscribeSse(port, `/api/tournaments/t-api/events?view=captain&streamToken=${encodeURIComponent(streamToken.body.streamToken)}`);
    assert(captainSse.initial.includes('r1m1') && !captainSse.initial.includes('r1m2') && !captainSse.initial.includes(captainJoin.body.session.sessionToken), '队长 SSE 初始快照应使用本队赛程投影，且不泄漏长期 sessionToken');
    captainSse.req.destroy();
    captainSse = null;

    const command = await requestJson(port, 'POST', '/api/tournaments/t-api/commands', {
      sessionToken: captainJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-1',
        type: multiplayerShared.COMMAND_TYPES.PURCHASE_SHOP_CARD,
        baseVersion: 1,
        payload: { teamId: 'team-1', slotId: 'slot-1' },
      },
    });
    assert(command.status === 200 && command.body.event.type === multiplayerShared.EVENT_TYPES.SHOP_CARD_PURCHASED, '提交 command 应生成对应事件');
    assert(command.body.tournament.stateVersion === 2, '提交 command 应推进 stateVersion');

    const openShop = await requestJson(port, 'POST', '/api/tournaments/t-api/commands', {
      sessionToken: captainJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-open-shop',
        type: multiplayerShared.COMMAND_TYPES.OPEN_SHOP,
        baseVersion: 2,
        payload: {
          teamId: 'team-1',
          round: 1,
          commandRole: multiplayerShared.ROLES.REFEREE,
          currentShop: {
            id: 'shop-api-1',
            teamId: 'team-1',
            round: 1,
            cards: [
              { slotId: 'slot-1', playerId: 'hidden-player', displayPlayerId: 'visible-player', tier: 3, price: 3, camp: 'local', snowCatShuffled: true },
            ],
          },
          hexcoreActionWindows: [{ teamId: 'team-1', hexcoreId: 'heavenly-descent', active: true, slotId: 'slot-1' }],
        },
      },
    });
    assert(openShop.status === 200 && openShop.body.event.type === multiplayerShared.EVENT_TYPES.SHOP_OPENED, '队长本人回合应能通过 API 提交开店 command');
    assert(openShop.body.tournament.stateVersion === 3, '开店 command 应推进 stateVersion');
    assert(
      openShop.body.tournament.snapshot.currentShop.cards.length === 0
      && !JSON.stringify(openShop.body.tournament).includes('hidden-player')
      && openShop.body.tournament.snapshot.roundStates['team-1']['1'].freeShopUsed
      && !openShop.body.tournament.snapshot.hexcoreActionWindows.length,
      '队长 command 可推进开店状态，但不能伪造服务端公开商店卡或海克斯窗口'
    );

    const duplicate = await requestJson(port, 'POST', '/api/tournaments/t-api/commands', {
      sessionToken: captainJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-1',
        type: multiplayerShared.COMMAND_TYPES.PURCHASE_SHOP_CARD,
        baseVersion: 1,
        payload: { teamId: 'team-1', slotId: 'slot-1' },
      },
    });
    assert(duplicate.status === 200 && duplicate.body.duplicate === true, '重复 command 应通过 API 幂等返回');
    assert(duplicate.body.event.eventSeq === command.body.event.eventSeq, '重复 command 返回的事件序号应保持一致');

    const rejected = await requestJson(port, 'POST', '/api/tournaments/t-api/commands', {
      sessionToken: viewerJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-2',
        type: multiplayerShared.COMMAND_TYPES.PURCHASE_SHOP_CARD,
        baseVersion: 3,
        payload: { teamId: 'team-1', slotId: 'slot-1' },
      },
    });
    assert(rejected.status === 400 && /无权执行/.test(rejected.body.error), '观众通过 API 写入应被拒绝');

    const invalidSession = await requestJson(port, 'POST', '/api/tournaments/t-api/commands', {
      sessionToken: 'session-bad',
      command: {
        commandId: 'cmd-api-3',
        type: multiplayerShared.COMMAND_TYPES.PURCHASE_SHOP_CARD,
        baseVersion: 3,
        payload: { teamId: 'team-1', slotId: 'slot-1' },
      },
    });
    assert(invalidSession.status === 400 && /sessionToken/.test(invalidSession.body.error), '无效 sessionToken 不应提交 command');

    const scoreCreated = await requestJson(port, 'POST', '/api/tournaments', {
      id: 't-score-sync',
      name: '比分同步回归',
      actorId: 'referee-score',
      teams: [
        { teamId: 'team-1', name: '比分1队', code: 'score-captain-1', camp: 'local' },
        { teamId: 'team-2', name: '比分2队', code: 'score-captain-2', camp: 'outsider' },
        { teamId: 'team-3', name: '比分3队', code: 'score-captain-3', camp: 'local' },
        { teamId: 'team-4', name: '比分4队', code: 'score-captain-4', camp: 'outsider' },
      ],
      tournament: {
        type: 'single_elimination',
        status: 'running',
        rounds: [
          {
            id: 'r1',
            name: '第 1 轮',
            matches: [
              { id: 'r1m1', teamAId: 'team-1', teamBId: 'team-2', scoreA: '', scoreB: '', winnerId: '', status: 'pending', hiddenNote: 'score-secret' },
              { id: 'r1m2', teamAId: 'team-3', teamBId: 'team-4', scoreA: 1, scoreB: 0, winnerId: 'team-3', status: 'completed' },
            ],
          },
        ],
      },
      viewerCode: 'score-viewer-code',
    });
    const scoreCaptainJoin = await requestJson(port, 'POST', '/api/tournaments/t-score-sync/join', {
      code: scoreCreated.body.room.captainCodes[0].code,
      displayName: '比分队长',
    });
    const scoreViewerJoin = await requestJson(port, 'POST', '/api/tournaments/t-score-sync/join', {
      code: scoreCreated.body.room.viewerCode,
      displayName: '比分观众',
    });
    const scoreRefereeJoin = await requestJson(port, 'POST', '/api/tournaments/t-score-sync/join', {
      code: scoreCreated.body.room.refereeCode,
      displayName: '比分裁判',
    });
    const scoreCommand = await requestJson(port, 'POST', '/api/tournaments/t-score-sync/commands', {
      sessionToken: scoreRefereeJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-score-r1m1',
        type: multiplayerShared.COMMAND_TYPES.RECORD_MATCH_SCORE,
        baseVersion: 1,
        payload: { roundId: 'r1', matchId: 'r1m1', scoreA: 2, scoreB: 0, winnerTeamId: 'team-1' },
      },
    });
    const scoreCaptainProjection = await requestJson(port, 'GET', `/api/tournaments/t-score-sync/projection?view=captain&sessionToken=${encodeURIComponent(scoreCaptainJoin.body.session.sessionToken)}`);
    const scoreViewerProjection = await requestJson(port, 'GET', `/api/tournaments/t-score-sync/projection?view=viewer&sessionToken=${encodeURIComponent(scoreViewerJoin.body.session.sessionToken)}`);
    const scoreCaptainText = JSON.stringify(scoreCaptainProjection.body);
    const scoreViewerText = JSON.stringify(scoreViewerProjection.body);
    assert(
      scoreCommand.status === 200
      && scoreCommand.body.event.type === multiplayerShared.EVENT_TYPES.MATCH_SCORE_RECORDED
      && scoreCaptainProjection.status === 200
      && scoreCaptainProjection.body.tournament.snapshot.tournament.rounds.some(round => round.matches.some(match => match.id === 'r1m1' && match.scoreA === 2 && match.scoreB === 0 && match.winnerId === 'team-1'))
      && scoreCaptainProjection.body.tournament.snapshot.tournament.rounds.some(round => round.matches.some(match => match.id === 'r2m1' && match.teamAId === 'team-1'))
      && !scoreCaptainText.includes('score-secret')
      && scoreViewerProjection.status === 200
      && scoreViewerText.includes('r1m1')
      && scoreViewerText.includes('r2m1')
      && !scoreViewerText.includes('score-secret'),
      '裁判记录比分应写入服务端并实时投影给队长和观众当前视角，且不泄漏私有字段'
    );

    const hexCreated = await requestJson(port, 'POST', '/api/tournaments', {
      id: 't-hex-sync',
      name: '海克斯同步回归',
      actorId: 'referee-hex',
      settings: { initialGold: 6 },
      teams: [
        { teamId: 'team-1', name: '海克斯1队', code: 'hex-captain-1', camp: 'local', economy: { gold: 6 } },
        { teamId: 'team-2', name: '海克斯2队', code: 'hex-captain-2', camp: 'outsider', economy: { gold: 6 } },
      ],
      viewerCode: 'hex-viewer-code',
    });
    const hexCaptainJoin = await requestJson(port, 'POST', '/api/tournaments/t-hex-sync/join', {
      code: hexCreated.body.room.captainCodes[0].code,
      displayName: '海克斯队长',
    });
    const hexViewerJoin = await requestJson(port, 'POST', '/api/tournaments/t-hex-sync/join', {
      code: hexCreated.body.room.viewerCode,
      displayName: '海克斯观众',
    });
    const hexRefereeJoin = await requestJson(port, 'POST', '/api/tournaments/t-hex-sync/join', {
      code: hexCreated.body.room.refereeCode,
      displayName: '海克斯裁判',
    });
    const hexOrder = await requestJson(port, 'POST', '/api/tournaments/t-hex-sync/commands', {
      sessionToken: hexRefereeJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-hex-order',
        type: multiplayerShared.COMMAND_TYPES.SET_HEXCORE_DRAW_ORDER,
        baseVersion: 1,
        payload: { teamIds: ['team-1', 'team-2'] },
      },
    });
    assert(
      hexOrder.status === 200
      && hexOrder.body.event.type === multiplayerShared.EVENT_TYPES.HEXCORE_DRAW_ORDER_SET
      && hexOrder.body.tournament.snapshot.currentTeamId === 'team-1'
      && hexOrder.body.tournament.snapshot.hexcoreDraft.drawOrder.join('|') === 'team-1|team-2',
      '裁判制定海克斯抽取顺序应写入服务端，使队长端和观众端知道当前海克斯操作队伍'
    );
    const hexDraw = await requestJson(port, 'POST', '/api/tournaments/t-hex-sync/commands', {
      sessionToken: hexCaptainJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-hex-draw',
        type: multiplayerShared.COMMAND_TYPES.START_HEXCORE_DRAW,
        baseVersion: 2,
        payload: {
          teamId: 'team-1',
          slots: ['donation', 'storm-fog', 'snow-cat'],
          candidateIds: ['donation', 'storm-fog', 'snow-cat'],
          seenIds: ['donation', 'storm-fog', 'snow-cat'],
        },
      },
    });
    assert(
      hexDraw.status === 200
      && hexDraw.body.event.type === multiplayerShared.EVENT_TYPES.HEXCORE_CANDIDATES_CREATED
      && hexDraw.body.tournament.snapshot.hexcoreDraft.captainId === 'team-1'
      && hexDraw.body.tournament.snapshot.hexcoreDraft.slots.includes('donation'),
      '队长抽取海克斯候选应写入服务端权威会话并返回公开投影'
    );
    const hexRefresh = await requestJson(port, 'POST', '/api/tournaments/t-hex-sync/commands', {
      sessionToken: hexCaptainJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-hex-refresh',
        type: multiplayerShared.COMMAND_TYPES.REFRESH_HEXCORE_CANDIDATE,
        baseVersion: 3,
        payload: {
          teamId: 'team-1',
          candidateSlot: 1,
          replacementId: 'origin-sage',
          hexcoreId: 'origin-sage',
        },
      },
    });
    assert(
      hexRefresh.status === 200
      && hexRefresh.body.tournament.snapshot.hexcoreDraft.refreshUsed
      && hexRefresh.body.tournament.snapshot.hexcoreDraft.slots[1] === 'origin-sage',
      '刷新海克斯候选应同步候选槽和刷新使用状态'
    );
    const hexPick = await requestJson(port, 'POST', '/api/tournaments/t-hex-sync/commands', {
      sessionToken: hexCaptainJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-hex-pick',
        type: multiplayerShared.COMMAND_TYPES.PICK_HEXCORE,
        baseVersion: 4,
        payload: { teamId: 'team-1', hexcoreId: 'donation', hexcoreStatus: 'passive' },
      },
    });
    const hexViewerProjection = await requestJson(port, 'GET', `/api/tournaments/t-hex-sync/projection?view=viewer&sessionToken=${encodeURIComponent(hexViewerJoin.body.session.sessionToken)}`);
    assert(
      hexPick.status === 200
      && hexPick.body.event.type === multiplayerShared.EVENT_TYPES.HEXCORE_PICKED
      && hexPick.body.tournament.snapshot.hexcoreAssignments['team-1'][0].id === 'donation'
      && hexPick.body.tournament.snapshot.teams[0].economy.gold === 8
      && hexViewerProjection.status === 200
      && hexViewerProjection.body.tournament.snapshot.hexcoreAssignments['team-1'][0].id === 'donation',
      '队长选择海克斯后裁判端和观众端公开投影都应看到已持有海克斯，并同步被动经济效果'
    );

    const shopCreated = await requestJson(port, 'POST', '/api/tournaments', {
      id: 't-shop',
      name: '服务端商店回归',
      actorId: 'referee-shop',
      settings: { initialGold: 6, refreshCosts: [1, 2, 3, 4] },
      teams: [{ teamId: 'team-local', name: '本地队', camp: 'local', code: 'shop-captain-code', economy: { gold: 6 } }],
      players: [
        { id: 'local-1', name: '本地一号', gameId: 'L1', camp: 'local', tier: 1, score: 81, status: 'available', heroes: ['阿狸'] },
        { id: 'local-2', name: '本地二号', gameId: 'L2', camp: 'local', tier: 2, score: 82, status: 'available', heroes: ['蔚'] },
        { id: 'local-3', name: '本地三号', gameId: 'L3', camp: 'local', tier: 3, score: 83, status: 'available', heroes: ['发条'] },
        { id: 'local-4', name: '本地四号', gameId: 'L4', camp: 'local', tier: 4, score: 84, status: 'available', heroes: ['奥恩'] },
        { id: 'local-5', name: '本地五号', gameId: 'L5', camp: 'local', tier: 5, score: 85, status: 'available', heroes: ['卡莎'] },
        { id: 'local-captain', name: '本地队长', gameId: 'LC', camp: 'local', tier: 5, score: 99, status: 'captain', isCaptain: true },
        { id: 'outsider-1', name: '外地一号', gameId: 'O1', camp: 'outsider', tier: 1, score: 80, status: 'available' },
      ],
    });
    assert(
      shopCreated.status === 201
      && !JSON.stringify(shopCreated.body.tournament.snapshot).includes('local-1')
      && shopCreated.body.tournament.snapshot.teams[0].camp === 'local',
      '创建赛事可保存服务端私有选手池，但公开快照只返回必要队伍信息'
    );
    const shopCaptainJoin = await requestJson(port, 'POST', '/api/tournaments/t-shop/join', {
      code: shopCreated.body.room.captainCodes[0].code,
      displayName: '商店队长',
    });
    const generatedShop = await requestJson(port, 'POST', '/api/tournaments/t-shop/commands', {
      sessionToken: shopCaptainJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-generated-shop',
        type: multiplayerShared.COMMAND_TYPES.OPEN_SHOP,
        baseVersion: 1,
        payload: {
          teamId: 'team-local',
          round: 1,
          currentShop: {
            cards: [{ slotId: 'slot-1', playerId: 'forged-shop-player', tier: 5, camp: 'outsider' }],
          },
          commandRole: multiplayerShared.ROLES.REFEREE,
        },
      },
    });
    const generatedCards = generatedShop.body.tournament.snapshot.currentShop.cards;
    const generatedShopText = JSON.stringify(generatedShop.body);
    assert(
      generatedShop.status === 200
      && generatedShop.body.tournament.stateVersion === 2
      && generatedShop.body.event.payload.currentShop.cards.length === 5
      && generatedShop.body.tournament.snapshot.teams[0].economy.gold === 6
      && generatedCards.length === 5
      && generatedCards.every(card => card.camp === 'local' && card.playerId.startsWith('local-') && card.name.startsWith('本地'))
      && !generatedShopText.includes('forged-shop-player')
      && !generatedShopText.includes('outsider-1')
      && !generatedShopText.includes('local-captain')
      && !generatedShopText.includes('_serverGeneratedProjection'),
      '队长开店应由服务端从导入选手池生成同阵营商店，不能使用队长 payload 伪造卡面'
    );
    const generatedRefresh = await requestJson(port, 'POST', '/api/tournaments/t-shop/commands', {
      sessionToken: shopCaptainJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-refresh-generated-shop',
        type: multiplayerShared.COMMAND_TYPES.REFRESH_SHOP,
        baseVersion: 2,
        payload: {
          teamId: 'team-local',
          round: 1,
          currentShop: {
            cards: [{ slotId: 'slot-1', playerId: 'forged-refresh-player', tier: 5, camp: 'outsider' }],
          },
          refreshCostPaid: 0,
          commandRole: multiplayerShared.ROLES.REFEREE,
        },
      },
    });
    const refreshedCards = generatedRefresh.body.tournament.snapshot.currentShop.cards;
    assert(
      generatedRefresh.status === 200
      && generatedRefresh.body.tournament.stateVersion === 3
      && generatedRefresh.body.tournament.snapshot.teams[0].economy.gold === 5
      && generatedRefresh.body.tournament.snapshot.currentShop.refreshCostPaid === 1
      && generatedRefresh.body.tournament.snapshot.roundStates['team-local']['1'].refreshCount === 1
      && refreshedCards.length === 5
      && !JSON.stringify(generatedRefresh.body).includes('forged-refresh-player'),
      '队长刷新商店应由服务端扣除刷新金币、推进刷新次数，并忽略队长伪造卡面和费用'
    );
    const generatedPlayerId = refreshedCards[0].playerId;
    const generatedPlayerPrice = refreshedCards[0].price;
    const generatedPurchase = await requestJson(port, 'POST', '/api/tournaments/t-shop/commands', {
      sessionToken: shopCaptainJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-purchase-generated-shop',
        type: multiplayerShared.COMMAND_TYPES.PURCHASE_SHOP_CARD,
        baseVersion: 3,
        payload: {
          teamId: 'team-local',
          slotId: refreshedCards[0].slotId,
          playerId: 'forged-purchase-player',
        },
      },
    });
    const purchasedTeam = generatedPurchase.body.tournament.snapshot.teams[0];
    const purchasedCard = generatedPurchase.body.tournament.snapshot.currentShop.cards[0];
    const generatedPurchaseText = JSON.stringify(generatedPurchase.body);
    assert(
      generatedPurchase.status === 200
      && generatedPurchase.body.tournament.stateVersion === 4
      && purchasedCard.purchased === true
      && purchasedTeam.team.includes(generatedPlayerId)
      && purchasedTeam.economy.gold === 5 - generatedPlayerPrice
      && generatedPurchase.body.tournament.snapshot.lastPurchase.playerId === generatedPlayerId
      && generatedPurchase.body.tournament.snapshot.lastPurchase.pricePaid === generatedPlayerPrice
      && generatedPurchase.body.tournament.snapshot.lastPurchase.goldAfter === 5 - generatedPlayerPrice
      && generatedPurchase.body.tournament.snapshot.roundStates['team-local']['1'].purchaseUsed
      && !generatedPurchase.body.tournament.snapshot.players
      && !generatedPurchaseText.includes('forged-purchase-player'),
      '购买服务端生成商店卡后，应扣除服务端价格、更新公开队伍成员和购买状态，但不公开完整私有选手池或伪造选手 ID'
    );
    const refreshAfterPurchase = await requestJson(port, 'POST', '/api/tournaments/t-shop/commands', {
      sessionToken: shopCaptainJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-refresh-after-purchase',
        type: multiplayerShared.COMMAND_TYPES.REFRESH_SHOP,
        baseVersion: 4,
        payload: { teamId: 'team-local', round: 1 },
      },
    });
    const afterBlockedRefresh = await requestJson(port, 'GET', '/api/tournaments/t-shop/snapshot');
    assert(
      refreshAfterPurchase.status === 400
      && /购买权已使用/.test(refreshAfterPurchase.body.error)
      && afterBlockedRefresh.body.tournament.stateVersion === 4
      && afterBlockedRefresh.body.tournament.snapshot.roundStates['team-local']['1'].purchaseUsed
      && afterBlockedRefresh.body.tournament.snapshot.teams[0].economy.gold === 5 - generatedPlayerPrice,
      '服务端购买后应固化本轮权限，不能再通过刷新重置购买状态或再次扣费'
    );

    const snowCreated = await requestJson(port, 'POST', '/api/tournaments', {
      id: 't-snow-cat',
      name: '雪定饿的喵权威回归',
      actorId: 'referee-snow',
      settings: { initialGold: 9, refreshCosts: [1, 2, 3, 4] },
      teams: [
        { teamId: 'snow-source', name: '雪猫来源', camp: 'local', code: 'snow-source-code', economy: { gold: 9 } },
        { teamId: 'snow-target', name: '雪猫目标', camp: 'local', code: 'snow-target-code', economy: { gold: 9 } },
        { teamId: 'snow-wave', name: '海浪免疫', camp: 'local', code: 'snow-wave-code', economy: { gold: 9 } },
      ],
      hexcoreAssignments: {
        'snow-source': [{ id: 'snow-cat', status: 'available' }],
        'snow-wave': [{ id: 'hungry-wave', status: 'passive' }],
      },
      players: [
        { id: 'snow-local-1', name: '雪猫一号', gameId: 'S1', camp: 'local', tier: 1, score: 71, status: 'available' },
        { id: 'snow-local-2', name: '雪猫二号', gameId: 'S2', camp: 'local', tier: 2, score: 72, status: 'available' },
        { id: 'snow-local-3', name: '雪猫三号', gameId: 'S3', camp: 'local', tier: 3, score: 73, status: 'available' },
        { id: 'snow-local-4', name: '雪猫四号', gameId: 'S4', camp: 'local', tier: 4, score: 74, status: 'available' },
        { id: 'snow-local-5', name: '雪猫五号', gameId: 'S5', camp: 'local', tier: 5, score: 75, status: 'available' },
      ],
    });
    const snowSourceJoin = await requestJson(port, 'POST', '/api/tournaments/t-snow-cat/join', {
      code: snowCreated.body.room.captainCodes[0].code,
      displayName: '雪猫来源队长',
    });
    const snowTargetJoin = await requestJson(port, 'POST', '/api/tournaments/t-snow-cat/join', {
      code: snowCreated.body.room.captainCodes[1].code,
      displayName: '雪猫目标队长',
    });
    const snowWaveRejected = await requestJson(port, 'POST', '/api/tournaments/t-snow-cat/commands', {
      sessionToken: snowSourceJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-use-snow-cat-wave',
        type: multiplayerShared.COMMAND_TYPES.USE_HEXCORE,
        baseVersion: 1,
        payload: { teamId: 'snow-source', hexcoreId: 'snow-cat', targetTeamId: 'snow-wave' },
      },
    });
    const snowUsed = await requestJson(port, 'POST', '/api/tournaments/t-snow-cat/commands', {
      sessionToken: snowSourceJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-use-snow-cat',
        type: multiplayerShared.COMMAND_TYPES.USE_HEXCORE,
        baseVersion: 1,
        payload: { teamId: 'snow-source', hexcoreId: 'snow-cat', targetTeamId: 'snow-target' },
      },
    });
    const snowUsedAgain = await requestJson(port, 'POST', '/api/tournaments/t-snow-cat/commands', {
      sessionToken: snowSourceJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-use-snow-cat-again',
        type: multiplayerShared.COMMAND_TYPES.USE_HEXCORE,
        baseVersion: 2,
        payload: { teamId: 'snow-source', hexcoreId: 'snow-cat', targetTeamId: 'snow-target' },
      },
    });
    const snowSkip = await requestJson(port, 'POST', '/api/tournaments/t-snow-cat/commands', {
      sessionToken: snowSourceJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-snow-source-skip',
        type: multiplayerShared.COMMAND_TYPES.SKIP_TURN,
        baseVersion: 2,
        payload: { teamId: 'snow-source', round: 1 },
      },
    });
    const snowTargetShop = await requestJson(port, 'POST', '/api/tournaments/t-snow-cat/commands', {
      sessionToken: snowTargetJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-snow-target-shop',
        type: multiplayerShared.COMMAND_TYPES.OPEN_SHOP,
        baseVersion: 3,
        payload: { teamId: 'snow-target', round: 1 },
      },
    });
    const snowCards = snowTargetShop.body.tournament.snapshot.currentShop.cards;
    const snowText = JSON.stringify(snowTargetShop.body);
    assert(
      snowUsed.status === 200
      && snowWaveRejected.status === 400
      && /海浪免疫/.test(snowWaveRejected.body.error)
      && snowUsedAgain.status === 400
      && /未持有/.test(snowUsedAgain.body.error)
      && snowSkip.status === 200
      && snowTargetShop.status === 200
      && snowCards.length === 5
      && snowCards.some(card => card.masked)
      && snowCards.every(card => Number(card.price) === Number(card.tier))
      && !snowText.includes('shopDisturbances'),
      '雪定饿的喵应由服务端登记并在目标下一次商店扰乱公开信息，费用和真实槽位仍由服务端控制且不泄漏内部扰乱状态'
    );

    const stormCreated = await requestJson(port, 'POST', '/api/tournaments', {
      id: 't-storm-fog',
      name: '血雾权威回归',
      actorId: 'referee-storm',
      teams: [
        { teamId: 'storm-source', name: '血雾来源', camp: 'local', code: 'storm-source-code', economy: { gold: 9 } },
        { teamId: 'storm-a', name: '血雾A', camp: 'local', code: 'storm-a-code', economy: { gold: 9 } },
        { teamId: 'storm-b', name: '血雾B', camp: 'local', code: 'storm-b-code', economy: { gold: 9 } },
        { teamId: 'storm-c', name: '血雾C', camp: 'local', code: 'storm-c-code', economy: { gold: 9 } },
      ],
      hexcoreAssignments: {
        'storm-source': [{ id: 'storm-fog', status: 'available' }],
      },
      players: [
        { id: 'storm-local-1', name: '血雾一号', gameId: 'F1', camp: 'local', tier: 1, score: 71, status: 'available' },
        { id: 'storm-local-2', name: '血雾二号', gameId: 'F2', camp: 'local', tier: 2, score: 72, status: 'available' },
        { id: 'storm-local-3', name: '血雾三号', gameId: 'F3', camp: 'local', tier: 3, score: 73, status: 'available' },
        { id: 'storm-local-4', name: '血雾四号', gameId: 'F4', camp: 'local', tier: 4, score: 74, status: 'available' },
        { id: 'storm-local-5', name: '血雾五号', gameId: 'F5', camp: 'local', tier: 5, score: 75, status: 'available' },
      ],
    });
    const stormSourceJoin = await requestJson(port, 'POST', '/api/tournaments/t-storm-fog/join', {
      code: stormCreated.body.room.captainCodes[0].code,
      displayName: '血雾来源队长',
    });
    const stormTargetJoin = await requestJson(port, 'POST', '/api/tournaments/t-storm-fog/join', {
      code: stormCreated.body.room.captainCodes[1].code,
      displayName: '血雾目标队长',
    });
    const stormUsed = await requestJson(port, 'POST', '/api/tournaments/t-storm-fog/commands', {
      sessionToken: stormSourceJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-use-storm-fog',
        type: multiplayerShared.COMMAND_TYPES.USE_HEXCORE,
        baseVersion: 1,
        payload: { teamId: 'storm-source', hexcoreId: 'storm-fog', targetTeamId: 'storm-a' },
      },
    });
    const stormUsedAgain = await requestJson(port, 'POST', '/api/tournaments/t-storm-fog/commands', {
      sessionToken: stormSourceJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-use-storm-fog-again',
        type: multiplayerShared.COMMAND_TYPES.USE_HEXCORE,
        baseVersion: 2,
        payload: { teamId: 'storm-source', hexcoreId: 'storm-fog', targetTeamId: 'storm-a' },
      },
    });
    const stormSkip = await requestJson(port, 'POST', '/api/tournaments/t-storm-fog/commands', {
      sessionToken: stormSourceJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-storm-source-skip',
        type: multiplayerShared.COMMAND_TYPES.SKIP_TURN,
        baseVersion: 2,
        payload: { teamId: 'storm-source', round: 1 },
      },
    });
    const stormShop = await requestJson(port, 'POST', '/api/tournaments/t-storm-fog/commands', {
      sessionToken: stormTargetJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-storm-target-shop',
        type: multiplayerShared.COMMAND_TYPES.OPEN_SHOP,
        baseVersion: 3,
        payload: { teamId: 'storm-a', round: 1 },
      },
    });
    const stormCards = stormShop.body.tournament.snapshot.currentShop.cards;
    const stormText = JSON.stringify(stormShop.body);
    assert(
      stormUsed.status === 200
      && stormUsedAgain.status === 400
      && /未持有/.test(stormUsedAgain.body.error)
      && stormSkip.status === 200
      && stormShop.status === 200
      && stormCards.length === 5
      && stormCards.some(card => card.masked)
      && stormCards.every(card => Number(card.price) === Number(card.tier))
      && !stormText.includes('shopDisturbances'),
      '骤雨血雾清风应由服务端登记最多3名目标的商店扰乱，目标公开商店隐藏身份但不泄漏内部扰乱状态'
    );

    const stormHungryCreated = await requestJson(port, 'POST', '/api/tournaments', {
      id: 't-storm-fog-hungry',
      name: '血雾跳过海浪权威回归',
      actorId: 'referee-storm-hungry',
      teams: [
        { teamId: 'storm-h-source', name: '血雾来源', camp: 'local', code: 'storm-h-source-code', economy: { gold: 9 } },
        { teamId: 'storm-h-a', name: '血雾A', camp: 'local', code: 'storm-h-a-code', economy: { gold: 9 } },
        { teamId: 'storm-h-wave', name: '海浪免疫', camp: 'local', code: 'storm-h-wave-code', economy: { gold: 9 } },
        { teamId: 'storm-h-b', name: '血雾B', camp: 'local', code: 'storm-h-b-code', economy: { gold: 9 } },
      ],
      hexcoreAssignments: {
        'storm-h-source': [{ id: 'storm-fog', status: 'available' }],
        'storm-h-wave': [{ id: 'hungry-wave', status: 'passive' }],
      },
      players: [
        { id: 'storm-h-local-1', name: '血雾海浪一号', gameId: 'HF1', camp: 'local', tier: 1, score: 71, status: 'available' },
        { id: 'storm-h-local-2', name: '血雾海浪二号', gameId: 'HF2', camp: 'local', tier: 2, score: 72, status: 'available' },
        { id: 'storm-h-local-3', name: '血雾海浪三号', gameId: 'HF3', camp: 'local', tier: 3, score: 73, status: 'available' },
        { id: 'storm-h-local-4', name: '血雾海浪四号', gameId: 'HF4', camp: 'local', tier: 4, score: 74, status: 'available' },
        { id: 'storm-h-local-5', name: '血雾海浪五号', gameId: 'HF5', camp: 'local', tier: 5, score: 75, status: 'available' },
      ],
    });
    const stormHungrySourceJoin = await requestJson(port, 'POST', '/api/tournaments/t-storm-fog-hungry/join', {
      code: stormHungryCreated.body.room.captainCodes[0].code,
      displayName: '血雾海浪来源',
    });
    const stormHungryAJoin = await requestJson(port, 'POST', '/api/tournaments/t-storm-fog-hungry/join', {
      code: stormHungryCreated.body.room.captainCodes[1].code,
      displayName: '血雾A队长',
    });
    const stormHungryWaveJoin = await requestJson(port, 'POST', '/api/tournaments/t-storm-fog-hungry/join', {
      code: stormHungryCreated.body.room.captainCodes[2].code,
      displayName: '海浪队长',
    });
    const stormHungryDirectRejected = await requestJson(port, 'POST', '/api/tournaments/t-storm-fog-hungry/commands', {
      sessionToken: stormHungrySourceJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-use-storm-fog-hungry-direct',
        type: multiplayerShared.COMMAND_TYPES.USE_HEXCORE,
        baseVersion: 1,
        payload: { teamId: 'storm-h-source', hexcoreId: 'storm-fog', targetTeamId: 'storm-h-wave' },
      },
    });
    const stormHungryUsed = await requestJson(port, 'POST', '/api/tournaments/t-storm-fog-hungry/commands', {
      sessionToken: stormHungrySourceJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-use-storm-fog-hungry',
        type: multiplayerShared.COMMAND_TYPES.USE_HEXCORE,
        baseVersion: 1,
        payload: { teamId: 'storm-h-source', hexcoreId: 'storm-fog', targetTeamId: 'storm-h-a' },
      },
    });
    const stormHungrySkipSource = await requestJson(port, 'POST', '/api/tournaments/t-storm-fog-hungry/commands', {
      sessionToken: stormHungrySourceJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-storm-h-source-skip',
        type: multiplayerShared.COMMAND_TYPES.SKIP_TURN,
        baseVersion: 2,
        payload: { teamId: 'storm-h-source', round: 1 },
      },
    });
    const stormHungryAShop = await requestJson(port, 'POST', '/api/tournaments/t-storm-fog-hungry/commands', {
      sessionToken: stormHungryAJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-storm-h-a-shop',
        type: multiplayerShared.COMMAND_TYPES.OPEN_SHOP,
        baseVersion: 3,
        payload: { teamId: 'storm-h-a', round: 1 },
      },
    });
    const stormHungrySkipA = await requestJson(port, 'POST', '/api/tournaments/t-storm-fog-hungry/commands', {
      sessionToken: stormHungryAJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-storm-h-a-skip',
        type: multiplayerShared.COMMAND_TYPES.SKIP_TURN,
        baseVersion: 4,
        payload: { teamId: 'storm-h-a', round: 1 },
      },
    });
    const stormHungryWaveShop = await requestJson(port, 'POST', '/api/tournaments/t-storm-fog-hungry/commands', {
      sessionToken: stormHungryWaveJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-storm-h-wave-shop',
        type: multiplayerShared.COMMAND_TYPES.OPEN_SHOP,
        baseVersion: 5,
        payload: { teamId: 'storm-h-wave', round: 1 },
      },
    });
    assert(
      stormHungryDirectRejected.status === 400
      && /海浪免疫/.test(stormHungryDirectRejected.body.error)
      && stormHungryUsed.status === 200
      && stormHungrySkipSource.status === 200
      && stormHungryAShop.status === 200
      && stormHungryAShop.body.tournament.snapshot.currentShop.cards.some(card => card.masked)
      && stormHungrySkipA.status === 200
      && stormHungryWaveShop.status === 200
      && stormHungryWaveShop.body.tournament.snapshot.currentShop === null
      && stormHungryWaveShop.body.tournament.snapshot.roundStates['storm-h-wave']['1'].skipped,
      '骤雨血雾清风服务端权威目标应跳过海浪免疫队伍，且海浪队伍开店时会被服务端自动跳过'
    );

    const hungrySameCreated = await requestJson(port, 'POST', '/api/tournaments', {
      id: 't-hungry-wave-same',
      name: '同阵营海浪权威回归',
      actorId: 'referee-hungry-same',
      settings: { initialGold: 9, refreshCosts: [1, 2, 3, 4] },
      teams: [
        { teamId: 'wave-source', name: '海浪来源', camp: 'local', code: 'wave-source-code', economy: { gold: 0 } },
        { teamId: 'wave-buyer', name: '海浪购买者', camp: 'local', code: 'wave-buyer-code', economy: { gold: 9 } },
      ],
      hexcoreAssignments: {
        'wave-source': [{ id: 'hungry-wave', status: 'passive' }],
      },
      hungryWaveRound: {
        captainId: 'wave-source',
        round: 1,
        active: true,
      },
      players: [
        { id: 'wave-local-1', name: '海浪本地一号', gameId: 'HW1', camp: 'local', tier: 2, score: 82, status: 'available' },
      ],
    });
    const hungrySameSourceJoin = await requestJson(port, 'POST', '/api/tournaments/t-hungry-wave-same/join', {
      code: hungrySameCreated.body.room.captainCodes[0].code,
      displayName: '海浪来源队长',
    });
    const hungrySameBuyerJoin = await requestJson(port, 'POST', '/api/tournaments/t-hungry-wave-same/join', {
      code: hungrySameCreated.body.room.captainCodes[1].code,
      displayName: '海浪购买队长',
    });
    const hungrySameSkip = await requestJson(port, 'POST', '/api/tournaments/t-hungry-wave-same/commands', {
      sessionToken: hungrySameSourceJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-hungry-same-skip',
        type: multiplayerShared.COMMAND_TYPES.SKIP_TURN,
        baseVersion: 1,
        payload: { teamId: 'wave-source', round: 1 },
      },
    });
    const hungrySameShop = await requestJson(port, 'POST', '/api/tournaments/t-hungry-wave-same/commands', {
      sessionToken: hungrySameBuyerJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-hungry-same-shop',
        type: multiplayerShared.COMMAND_TYPES.OPEN_SHOP,
        baseVersion: 2,
        payload: { teamId: 'wave-buyer', round: 1 },
      },
    });
    const hungrySamePurchase = await requestJson(port, 'POST', '/api/tournaments/t-hungry-wave-same/commands', {
      sessionToken: hungrySameBuyerJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-hungry-same-purchase',
        type: multiplayerShared.COMMAND_TYPES.PURCHASE_SHOP_CARD,
        baseVersion: 3,
        payload: { teamId: 'wave-buyer', slotId: hungrySameShop.body.tournament.snapshot.currentShop.cards[0].slotId },
      },
    });
    const hungrySameText = JSON.stringify(hungrySamePurchase.body);
    assert(
      hungrySameSkip.status === 200
      && hungrySameShop.status === 200
      && hungrySamePurchase.status === 200
      && hungrySamePurchase.body.tournament.snapshot.teams[0].team.includes('wave-local-1')
      && !hungrySamePurchase.body.tournament.snapshot.teams[1].team.includes('wave-local-1')
      && hungrySamePurchase.body.tournament.snapshot.teams[1].economy.gold === 9
      && hungrySamePurchase.body.tournament.snapshot.roundStates['wave-buyer']['1'].purchaseUsed === false
      && hungrySamePurchase.body.tournament.snapshot.lastHungryWave.type === 'same_camp_steal'
      && hungrySamePurchase.body.tournament.snapshot.lastPurchase.hungryWave.type === 'same_camp_steal'
      && !hungrySameText.includes('hungryWaveRound')
      && !hungrySameText.includes('"players"'),
      '服务端海浪同阵营命中时应夺取真实购买选手、返还购买者金币和购买权，并且公开投影不泄漏内部海浪监听状态'
    );

    const hungryStartCreated = await requestJson(port, 'POST', '/api/tournaments', {
      id: 't-hungry-wave-start',
      name: '海浪轮初权威回归',
      actorId: 'referee-hungry-start',
      settings: { initialGold: 9, refreshCosts: [1, 2, 3, 4] },
      teams: [
        { teamId: 'wave-start-source', name: '轮初海浪', camp: 'local', code: 'wave-start-source-code', economy: { gold: 9 } },
        { teamId: 'wave-start-buyer', name: '轮初购买者', camp: 'local', code: 'wave-start-buyer-code', economy: { gold: 9 } },
      ],
      hexcoreAssignments: {
        'wave-start-source': [{ id: 'hungry-wave', status: 'passive' }],
      },
      players: [
        { id: 'wave-start-local-1', name: '轮初本地一号', gameId: 'HS1', camp: 'local', tier: 2, score: 82, status: 'available' },
      ],
    });
    const hungryStartSourceJoin = await requestJson(port, 'POST', '/api/tournaments/t-hungry-wave-start/join', {
      code: hungryStartCreated.body.room.captainCodes[0].code,
      displayName: '轮初海浪队长',
    });
    const hungryStartBuyerJoin = await requestJson(port, 'POST', '/api/tournaments/t-hungry-wave-start/join', {
      code: hungryStartCreated.body.room.captainCodes[1].code,
      displayName: '轮初购买队长',
    });
    const hungryStartSkip = await requestJson(port, 'POST', '/api/tournaments/t-hungry-wave-start/commands', {
      sessionToken: hungryStartSourceJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-hungry-start-skip',
        type: multiplayerShared.COMMAND_TYPES.SKIP_TURN,
        baseVersion: 1,
        payload: { teamId: 'wave-start-source', round: 1 },
      },
    });
    const hungryStartShop = await requestJson(port, 'POST', '/api/tournaments/t-hungry-wave-start/commands', {
      sessionToken: hungryStartBuyerJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-hungry-start-shop',
        type: multiplayerShared.COMMAND_TYPES.OPEN_SHOP,
        baseVersion: 2,
        payload: { teamId: 'wave-start-buyer', round: 1 },
      },
    });
    const hungryStartPurchase = await requestJson(port, 'POST', '/api/tournaments/t-hungry-wave-start/commands', {
      sessionToken: hungryStartBuyerJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-hungry-start-purchase',
        type: multiplayerShared.COMMAND_TYPES.PURCHASE_SHOP_CARD,
        baseVersion: 3,
        payload: { teamId: 'wave-start-buyer', slotId: hungryStartShop.body.tournament.snapshot.currentShop.cards[0].slotId },
      },
    });
    const hungryStartRefresh = await requestJson(port, 'POST', '/api/tournaments/t-hungry-wave-start/commands', {
      sessionToken: hungryStartBuyerJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-hungry-start-free-refresh',
        type: multiplayerShared.COMMAND_TYPES.REFRESH_SHOP,
        baseVersion: 4,
        payload: { teamId: 'wave-start-buyer', round: 1 },
      },
    });
    const hungryStartText = JSON.stringify(hungryStartPurchase.body);
    assert(
      hungryStartSkip.status === 200
      && hungryStartSkip.body.tournament.snapshot.teams[0].economy.gold === 0
      && hungryStartSkip.body.tournament.snapshot.lastHungryWave.type === 'round_start'
      && hungryStartSkip.body.tournament.snapshot.lastHungryWave.goldBefore === 9
      && hungryStartShop.status === 200
      && hungryStartPurchase.status === 200
      && hungryStartPurchase.body.tournament.snapshot.teams[0].team.includes('wave-start-local-1')
      && hungryStartPurchase.body.tournament.snapshot.teams[1].economy.gold === 9
      && hungryStartPurchase.body.tournament.snapshot.roundStates['wave-start-buyer']['1'].purchaseUsed === false
      && hungryStartPurchase.body.tournament.snapshot.roundStates['wave-start-buyer']['1'].hungryWaveFreeRefreshes === 1
      && hungryStartPurchase.body.tournament.snapshot.lastHungryWave.type === 'same_camp_steal'
      && hungryStartRefresh.status === 200
      && hungryStartRefresh.body.tournament.snapshot.currentShop.refreshCostPaid === 0
      && hungryStartRefresh.body.tournament.snapshot.teams[1].economy.gold === 9
      && hungryStartRefresh.body.tournament.snapshot.roundStates['wave-start-buyer']['1'].hungryWaveFreeRefreshes === 0
      && !hungryStartText.includes('hungryWaveRound')
      && !hungryStartText.includes('"players"'),
      '服务端应在海浪持有者本轮跳过时登记海浪监听并清零金币，后续购买命中仍由服务端权威结算且返还1次免费刷新'
    );

    const hungryAutoCreated = await requestJson(port, 'POST', '/api/tournaments', {
      id: 't-hungry-wave-auto',
      name: '海浪自动跳过权威回归',
      actorId: 'referee-hungry-auto',
      settings: { initialGold: 9, refreshCosts: [1, 2, 3, 4] },
      teams: [
        { teamId: 'wave-auto-source', name: '自动海浪', camp: 'local', code: 'wave-auto-source-code', economy: { gold: 9 } },
        { teamId: 'wave-auto-buyer', name: '自动购买者', camp: 'local', code: 'wave-auto-buyer-code', economy: { gold: 9 } },
      ],
      hexcoreAssignments: {
        'wave-auto-source': [{ id: 'hungry-wave', status: 'passive' }],
      },
      players: [
        { id: 'wave-auto-local-1', name: '自动本地一号', gameId: 'HA1', camp: 'local', tier: 2, score: 82, status: 'available' },
      ],
    });
    const hungryAutoSourceJoin = await requestJson(port, 'POST', '/api/tournaments/t-hungry-wave-auto/join', {
      code: hungryAutoCreated.body.room.captainCodes[0].code,
      displayName: '自动海浪队长',
    });
    const hungryAutoBuyerJoin = await requestJson(port, 'POST', '/api/tournaments/t-hungry-wave-auto/join', {
      code: hungryAutoCreated.body.room.captainCodes[1].code,
      displayName: '自动购买队长',
    });
    const hungryAutoOpen = await requestJson(port, 'POST', '/api/tournaments/t-hungry-wave-auto/commands', {
      sessionToken: hungryAutoSourceJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-hungry-auto-open',
        type: multiplayerShared.COMMAND_TYPES.OPEN_SHOP,
        baseVersion: 1,
        payload: { teamId: 'wave-auto-source', round: 1 },
      },
    });
    const hungryAutoOpenText = JSON.stringify(hungryAutoOpen.body);
    const hungryAutoShop = await requestJson(port, 'POST', '/api/tournaments/t-hungry-wave-auto/commands', {
      sessionToken: hungryAutoBuyerJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-hungry-auto-shop',
        type: multiplayerShared.COMMAND_TYPES.OPEN_SHOP,
        baseVersion: 2,
        payload: { teamId: 'wave-auto-buyer', round: 1 },
      },
    });
    assert(
      hungryAutoOpen.status === 200
      && hungryAutoOpen.body.tournament.snapshot.currentTeamId === 'wave-auto-buyer'
      && hungryAutoOpen.body.tournament.snapshot.currentShop === null
      && hungryAutoOpen.body.tournament.snapshot.teams[0].economy.gold === 0
      && hungryAutoOpen.body.tournament.snapshot.roundStates['wave-auto-source']['1'].skipped
      && hungryAutoOpen.body.tournament.snapshot.lastHungryWave.type === 'round_start'
      && !hungryAutoOpenText.includes('wave-auto-local-1')
      && !hungryAutoOpenText.includes('hungryWaveRound')
      && hungryAutoShop.status === 200
      && hungryAutoShop.body.tournament.snapshot.currentShop.cards.length === 1,
      '海浪触发队伍尝试开店时服务端应自动登记海浪并跳过，不生成或泄漏该队商店'
    );

    const hungryRollCreated = await requestJson(port, 'POST', '/api/tournaments', {
      id: 't-hungry-wave-roll',
      name: '海浪概率权威回归',
      actorId: 'referee-hungry-roll',
      settings: { initialGold: 9, refreshCosts: [1, 2, 3, 4] },
      teams: [
        { teamId: 'wave-roll-source', name: '概率海浪', camp: 'local', code: 'wave-roll-source-code', economy: { gold: 9 } },
        { teamId: 'wave-roll-a', name: '概率A', camp: 'local', code: 'wave-roll-a-code', economy: { gold: 9 } },
        { teamId: 'wave-roll-b', name: '概率B', camp: 'local', code: 'wave-roll-b-code', economy: { gold: 9 } },
      ],
      hexcoreAssignments: {
        'wave-roll-source': [{ id: 'hungry-wave', status: 'passive' }],
      },
      hungryWaveRound: {
        captainId: 'wave-roll-source',
        round: 1,
        active: true,
      },
      players: [
        { id: 'wave-roll-local-1', name: '概率本地一号', gameId: 'HR1', camp: 'local', tier: 2, score: 82, status: 'available' },
        { id: 'wave-roll-local-2', name: '概率本地二号', gameId: 'HR2', camp: 'local', tier: 3, score: 83, status: 'available' },
      ],
    });
    const hungryRollSourceJoin = await requestJson(port, 'POST', '/api/tournaments/t-hungry-wave-roll/join', {
      code: hungryRollCreated.body.room.captainCodes[0].code,
      displayName: '概率海浪队长',
    });
    const hungryRollAJoin = await requestJson(port, 'POST', '/api/tournaments/t-hungry-wave-roll/join', {
      code: hungryRollCreated.body.room.captainCodes[1].code,
      displayName: '概率A队长',
    });
    const hungryRollBJoin = await requestJson(port, 'POST', '/api/tournaments/t-hungry-wave-roll/join', {
      code: hungryRollCreated.body.room.captainCodes[2].code,
      displayName: '概率B队长',
    });
    const hungryRollSkip = await requestJson(port, 'POST', '/api/tournaments/t-hungry-wave-roll/commands', {
      sessionToken: hungryRollSourceJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-hungry-roll-source-skip',
        type: multiplayerShared.COMMAND_TYPES.SKIP_TURN,
        baseVersion: 1,
        payload: { teamId: 'wave-roll-source', round: 1 },
      },
    });
    const hungryRollAShop = await requestJson(port, 'POST', '/api/tournaments/t-hungry-wave-roll/commands', {
      sessionToken: hungryRollAJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-hungry-roll-a-shop',
        type: multiplayerShared.COMMAND_TYPES.OPEN_SHOP,
        baseVersion: 2,
        payload: { teamId: 'wave-roll-a', round: 1 },
      },
    });
    const hungryRollAPlayerId = hungryRollAShop.body.tournament.snapshot.currentShop.cards[0].playerId;
    const hungryRollMissCommandId = hungryWaveCommandIdForRoll({
      tournamentId: '',
      round: 1,
      sourceTeamId: 'wave-roll-source',
      buyerTeamId: 'wave-roll-a',
      playerId: hungryRollAPlayerId,
      remaining: 2,
      wantedHit: false,
    });
    const hungryRollMiss = await requestJson(port, 'POST', '/api/tournaments/t-hungry-wave-roll/commands', {
      sessionToken: hungryRollAJoin.body.session.sessionToken,
      command: {
        commandId: hungryRollMissCommandId,
        type: multiplayerShared.COMMAND_TYPES.PURCHASE_SHOP_CARD,
        baseVersion: 3,
        payload: { teamId: 'wave-roll-a', slotId: hungryRollAShop.body.tournament.snapshot.currentShop.cards[0].slotId },
      },
    });
    const hungryRollASkip = await requestJson(port, 'POST', '/api/tournaments/t-hungry-wave-roll/commands', {
      sessionToken: hungryRollAJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-hungry-roll-a-skip',
        type: multiplayerShared.COMMAND_TYPES.SKIP_TURN,
        baseVersion: 4,
        payload: { teamId: 'wave-roll-a', round: 1 },
      },
    });
    const hungryRollBShop = await requestJson(port, 'POST', '/api/tournaments/t-hungry-wave-roll/commands', {
      sessionToken: hungryRollBJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-hungry-roll-b-shop',
        type: multiplayerShared.COMMAND_TYPES.OPEN_SHOP,
        baseVersion: 5,
        payload: { teamId: 'wave-roll-b', round: 1 },
      },
    });
    const hungryRollHit = await requestJson(port, 'POST', '/api/tournaments/t-hungry-wave-roll/commands', {
      sessionToken: hungryRollBJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-hungry-roll-b-hit',
        type: multiplayerShared.COMMAND_TYPES.PURCHASE_SHOP_CARD,
        baseVersion: 6,
        payload: { teamId: 'wave-roll-b', slotId: hungryRollBShop.body.tournament.snapshot.currentShop.cards[0].slotId },
      },
    });
    assert(
      hungryRollSkip.status === 200
      && hungryRollAShop.status === 200
      && hungryRollMiss.status === 200
      && hungryRollMiss.body.tournament.snapshot.lastHungryWave === null
      && hungryRollMiss.body.tournament.snapshot.lastPurchase.hungryWave.type === 'miss'
      && hungryRollMiss.body.tournament.snapshot.lastPurchase.hungryWave.chanceBase === 2
      && hungryRollMiss.body.tournament.snapshot.roundStates['wave-roll-a']['1'].purchaseUsed === true
      && hungryRollASkip.status === 200
      && hungryRollBShop.status === 200
      && hungryRollHit.status === 200
      && hungryRollHit.body.tournament.snapshot.lastHungryWave.type === 'same_camp_steal'
      && hungryRollHit.body.tournament.snapshot.lastHungryWave.chanceBase === 1,
      '海浪购买判定应按剩余候选数做可重放 1/N 判定，未命中时保留原购买并继续等待后续购买'
    );

    const hungryOppositeCreated = await requestJson(port, 'POST', '/api/tournaments', {
      id: 't-hungry-wave-opposite',
      name: '异阵营海浪权威回归',
      actorId: 'referee-hungry-opposite',
      settings: { initialGold: 9, refreshCosts: [1, 2, 3, 4] },
      teams: [
        { teamId: 'wave-local', name: '本地海浪', camp: 'local', code: 'wave-local-code', economy: { gold: 0 } },
        { teamId: 'wave-outsider', name: '外地购买者', camp: 'outsider', code: 'wave-outsider-code', economy: { gold: 9 } },
      ],
      hexcoreAssignments: {
        'wave-local': [{ id: 'hungry-wave', status: 'passive' }],
      },
      hungryWaveRound: {
        captainId: 'wave-local',
        round: 1,
        active: true,
      },
      players: [
        { id: 'wave-outsider-1', name: '海浪外地一号', gameId: 'HO1', camp: 'outsider', tier: 3, score: 83, status: 'available' },
        { id: 'wave-local-reward-1', name: '海浪本地补偿', gameId: 'HLR1', camp: 'local', tier: 2, score: 82, status: 'available' },
      ],
    });
    const hungryOppositeSourceJoin = await requestJson(port, 'POST', '/api/tournaments/t-hungry-wave-opposite/join', {
      code: hungryOppositeCreated.body.room.captainCodes[0].code,
      displayName: '本地海浪队长',
    });
    const hungryOppositeBuyerJoin = await requestJson(port, 'POST', '/api/tournaments/t-hungry-wave-opposite/join', {
      code: hungryOppositeCreated.body.room.captainCodes[1].code,
      displayName: '外地购买队长',
    });
    const hungryOppositeSkip = await requestJson(port, 'POST', '/api/tournaments/t-hungry-wave-opposite/commands', {
      sessionToken: hungryOppositeSourceJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-hungry-opposite-skip',
        type: multiplayerShared.COMMAND_TYPES.SKIP_TURN,
        baseVersion: 1,
        payload: { teamId: 'wave-local', round: 1 },
      },
    });
    const hungryOppositeShop = await requestJson(port, 'POST', '/api/tournaments/t-hungry-wave-opposite/commands', {
      sessionToken: hungryOppositeBuyerJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-hungry-opposite-shop',
        type: multiplayerShared.COMMAND_TYPES.OPEN_SHOP,
        baseVersion: 2,
        payload: { teamId: 'wave-outsider', round: 1 },
      },
    });
    const hungryOppositePurchase = await requestJson(port, 'POST', '/api/tournaments/t-hungry-wave-opposite/commands', {
      sessionToken: hungryOppositeBuyerJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-hungry-opposite-purchase',
        type: multiplayerShared.COMMAND_TYPES.PURCHASE_SHOP_CARD,
        baseVersion: 3,
        payload: { teamId: 'wave-outsider', slotId: hungryOppositeShop.body.tournament.snapshot.currentShop.cards[0].slotId },
      },
    });
    const hungryOppositeRoundEnd = await requestJson(port, 'POST', '/api/tournaments/t-hungry-wave-opposite/commands', {
      sessionToken: hungryOppositeBuyerJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-hungry-opposite-round-end',
        type: multiplayerShared.COMMAND_TYPES.SKIP_TURN,
        baseVersion: 4,
        payload: { teamId: 'wave-outsider', round: 1 },
      },
    });
    const hungryOppositeText = JSON.stringify(hungryOppositePurchase.body);
    assert(
      hungryOppositeSkip.status === 200
      && hungryOppositeShop.status === 200
      && hungryOppositePurchase.status === 200
      && !hungryOppositePurchase.body.tournament.snapshot.teams[0].team.includes('wave-outsider-1')
      && !hungryOppositePurchase.body.tournament.snapshot.teams[1].team.includes('wave-outsider-1')
      && hungryOppositePurchase.body.tournament.snapshot.teams[1].economy.gold === 9
      && hungryOppositePurchase.body.tournament.snapshot.roundStates['wave-outsider']['1'].purchaseUsed === false
      && hungryOppositePurchase.body.tournament.snapshot.lastHungryWave.type === 'opposite_camp_return'
      && hungryOppositePurchase.body.tournament.snapshot.lastHungryWave.pendingRoundReward === true
      && hungryOppositeRoundEnd.status === 200
      && hungryOppositeRoundEnd.body.tournament.snapshot.currentRound === 2
      && hungryOppositeRoundEnd.body.tournament.snapshot.teams[0].team.includes('wave-local-reward-1')
      && hungryOppositeRoundEnd.body.tournament.snapshot.lastHungryWave.type === 'round_reward'
      && hungryOppositeRoundEnd.body.tournament.snapshot.lastHungryWave.playerId === 'wave-local-reward-1'
      && !hungryOppositeText.includes('hungryWaveRound')
      && !hungryOppositeText.includes('"players"'),
      '服务端海浪异阵营命中时应退回真实购买选手、返还购买者金币和购买权，并在轮末发放同阵营补偿'
    );

    const poorCreated = await requestJson(port, 'POST', '/api/tournaments', {
      id: 't-poor-refresh',
      name: '刷新金币不足回归',
      actorId: 'referee-poor',
      settings: { initialGold: 0, refreshCosts: [1, 2, 3, 4] },
      teams: [{ teamId: 'poor-team', name: '贫穷队', camp: 'local', code: 'poor-code', economy: { gold: 0 } }],
      players: [
        { id: 'poor-local-1', name: '贫穷一号', gameId: 'P1', camp: 'local', tier: 1, score: 70, status: 'available' },
      ],
    });
    const poorJoin = await requestJson(port, 'POST', '/api/tournaments/t-poor-refresh/join', {
      code: poorCreated.body.room.captainCodes[0].code,
      displayName: '贫穷队长',
    });
    const poorOpen = await requestJson(port, 'POST', '/api/tournaments/t-poor-refresh/commands', {
      sessionToken: poorJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-poor-open',
        type: multiplayerShared.COMMAND_TYPES.OPEN_SHOP,
        baseVersion: 1,
        payload: { teamId: 'poor-team', round: 1 },
      },
    });
    const poorRefresh = await requestJson(port, 'POST', '/api/tournaments/t-poor-refresh/commands', {
      sessionToken: poorJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-poor-refresh',
        type: multiplayerShared.COMMAND_TYPES.REFRESH_SHOP,
        baseVersion: 2,
        payload: { teamId: 'poor-team', round: 1 },
      },
    });
    const poorAfterFailedRefresh = await requestJson(port, 'GET', '/api/tournaments/t-poor-refresh/snapshot');
    assert(
      poorOpen.status === 200
      && poorRefresh.status === 400
      && /金币不足/.test(poorRefresh.body.error)
      && poorAfterFailedRefresh.body.tournament.stateVersion === 2
      && poorAfterFailedRefresh.body.tournament.snapshot.teams[0].economy.gold === 0
      && poorAfterFailedRefresh.body.tournament.snapshot.roundStates['poor-team']['1'].refreshCount === 0,
      '服务端刷新金币不足时应拒绝 command，且不能推进版本、扣成负金币或增加刷新次数'
    );

    const skipCreated = await requestJson(port, 'POST', '/api/tournaments', {
      id: 't-skip-turn',
      name: '跳过推进回归',
      actorId: 'referee-skip',
      teams: [
        { teamId: 'skip-a', name: '跳过A队', camp: 'local', code: 'skip-code-a', economy: { gold: 6 } },
        { teamId: 'skip-b', name: '跳过B队', camp: 'local', code: 'skip-code-b', economy: { gold: 6 } },
      ],
    });
    const skipJoin = await requestJson(port, 'POST', '/api/tournaments/t-skip-turn/join', {
      code: skipCreated.body.room.captainCodes[0].code,
      displayName: '跳过队长',
    });
    const skippedTurn = await requestJson(port, 'POST', '/api/tournaments/t-skip-turn/commands', {
      sessionToken: skipJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-skip-turn',
        type: multiplayerShared.COMMAND_TYPES.SKIP_TURN,
        baseVersion: 1,
        payload: { teamId: 'skip-a', round: 1, nextTeamId: 'skip-a', nextRound: 8 },
      },
    });
    assert(
      skippedTurn.status === 200
      && skippedTurn.body.tournament.stateVersion === 2
      && skippedTurn.body.tournament.snapshot.currentTeamId === 'skip-b'
      && skippedTurn.body.tournament.snapshot.currentRound === 1
      && skippedTurn.body.tournament.snapshot.currentShop === null
      && skippedTurn.body.tournament.snapshot.roundStates['skip-a']['1'].skipped,
      '服务端跳过本轮应清空当前商店、标记跳过并推进到下一队，且不能信任队长 payload 伪造下一队或下一轮'
    );
    const skipBJoin = await requestJson(port, 'POST', '/api/tournaments/t-skip-turn/join', {
      code: skipCreated.body.room.captainCodes[1].code,
      displayName: '跳过B队长',
    });
    const skippedRoundWrap = await requestJson(port, 'POST', '/api/tournaments/t-skip-turn/commands', {
      sessionToken: skipBJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-skip-round-wrap',
        type: multiplayerShared.COMMAND_TYPES.SKIP_TURN,
        baseVersion: 2,
        payload: { teamId: 'skip-b', round: 1 },
      },
    });
    assert(
      skippedRoundWrap.status === 200
      && skippedRoundWrap.body.tournament.stateVersion === 3
      && skippedRoundWrap.body.tournament.snapshot.currentTeamId === 'skip-a'
      && skippedRoundWrap.body.tournament.snapshot.currentRound === 2
      && skippedRoundWrap.body.tournament.snapshot.teams.every(team => team.economy.gold === 9)
      && skippedRoundWrap.body.tournament.snapshot.lastRoundIncome.round === 2
      && skippedRoundWrap.body.tournament.snapshot.lastRoundIncome.income === 3
      && skippedRoundWrap.body.tournament.snapshot.roundStates['skip-b']['1'].skipped,
      '服务端回合绕回下一轮时应由权威层统一发放轮次收入，并公开同步金币余额'
    );

    const trustedShop = await requestJson(port, 'POST', '/api/tournaments/t-api/commands', {
      sessionToken: refereeJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-ref-shop',
        type: multiplayerShared.COMMAND_TYPES.OPEN_SHOP,
        baseVersion: 3,
        payload: {
          teamId: 'team-1',
          round: 1,
          currentShop: {
            id: 'shop-api-referee',
            teamId: 'team-1',
            round: 1,
            cards: [
              { slotId: 'slot-1', playerId: 'hidden-player', displayPlayerId: 'visible-player', tier: 3, price: 3, camp: 'local', snowCatShuffled: true },
            ],
          },
          hexcoreActionWindows: [{ teamId: 'team-1', hexcoreId: 'heavenly-descent', active: true, slotId: 'slot-1' }],
        },
      },
    });
    assert(
      trustedShop.status === 200
      && trustedShop.body.tournament.stateVersion === 4
      && trustedShop.body.tournament.snapshot.currentShop.cards[0].playerId === 'visible-player'
      && !JSON.stringify(trustedShop.body.tournament).includes('hidden-player')
      && trustedShop.body.tournament.snapshot.hexcoreActionWindows[0].hexcoreId === 'heavenly-descent',
      '裁判可信投影应输出商店和海克斯窗口，并隐藏被打乱商店的真实暗牌 ID'
    );

    const trustedPurchase = await requestJson(port, 'POST', '/api/tournaments/t-api/commands', {
      sessionToken: captainJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-purchase-trusted-shop',
        type: multiplayerShared.COMMAND_TYPES.PURCHASE_SHOP_CARD,
        baseVersion: 4,
        payload: {
          teamId: 'team-1',
          slotId: 'slot-1',
          playerId: 'forged-player',
          displayPlayerId: 'forged-visible',
        },
      },
    });
    const trustedPurchaseText = JSON.stringify(trustedPurchase.body);
    assert(
      trustedPurchase.status === 200
      && trustedPurchase.body.tournament.stateVersion === 5
      && trustedPurchase.body.tournament.snapshot.currentShop.cards[0].purchased === true
      && trustedPurchase.body.tournament.snapshot.lastPurchase.playerId === 'visible-player'
      && trustedPurchase.body.tournament.snapshot.roundStates['team-1']['1'].purchaseUsed
      && !trustedPurchaseText.includes('hidden-player')
      && !trustedPurchaseText.includes('forged-player')
      && !trustedPurchaseText.includes('forged-visible'),
      '队长购买可信商店卡时只能按槽位购买，公开投影不应泄漏真实暗牌或伪造选手 ID'
    );

    const importedSecret = await requestJson(port, 'POST', '/api/tournaments/t-api/commands', {
      sessionToken: refereeJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-secret',
        type: multiplayerShared.COMMAND_TYPES.IMPORT_STATE,
        baseVersion: 5,
        payload: {
          checksum: 'checksum-public-projection',
          sourceVersion: 'legacy-local',
          refereeCode: 'should-not-leak',
          realPlayerId: 'hidden-player',
          randomSeed: 'hidden-seed',
          summary: '公开摘要',
        },
      },
    });
    assert(importedSecret.status === 200 && importedSecret.body.tournament.stateVersion === 6, '裁判导入命令应能推进公开投影测试状态');
    const paused = await requestJson(port, 'POST', '/api/tournaments/t-api/commands', {
      sessionToken: refereeJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-pause',
        type: multiplayerShared.COMMAND_TYPES.PAUSE_TOURNAMENT,
        baseVersion: 6,
        payload: {
          reason: '裁判暂停复核',
        },
      },
    });
    assert(
      paused.status === 200
      && paused.body.tournament.stateVersion === 7
      && paused.body.tournament.paused === true
      && paused.body.event.type === multiplayerShared.EVENT_TYPES.TOURNAMENT_PAUSED
      && !JSON.stringify(paused.body.tournament).includes('auditLog'),
      '裁判暂停应推进权威版本并同步 paused 状态，但公开投影不应直接暴露审计日志'
    );
    const anonymousAudit = await requestJson(port, 'GET', '/api/tournaments/t-api/audit');
    assert(anonymousAudit.status === 401 && !anonymousAudit.body.auditLog, '匿名用户不应读取裁判审计日志');
    const viewerAudit = await requestJson(port, 'GET', `/api/tournaments/t-api/audit?sessionToken=${encodeURIComponent(viewerJoin.body.session.sessionToken)}`);
    assert(viewerAudit.status === 403 && !viewerAudit.body.auditLog, '观众不应读取裁判审计日志');
    const refereeAudit = await requestJson(port, 'GET', `/api/tournaments/t-api/audit?sessionToken=${encodeURIComponent(refereeJoin.body.session.sessionToken)}`);
    const auditText = JSON.stringify(refereeAudit.body);
    assert(
      refereeAudit.status === 200
      && refereeAudit.body.auditLog.length >= 2
      && refereeAudit.body.auditLog.some(entry => entry.eventType === multiplayerShared.EVENT_TYPES.STATE_IMPORTED && entry.reason === '')
      && refereeAudit.body.auditLog.some(entry => entry.eventType === multiplayerShared.EVENT_TYPES.TOURNAMENT_PAUSED && entry.reason === '裁判暂停复核' && entry.commandRole === multiplayerShared.ROLES.REFEREE)
      && !auditText.includes(refereeJoin.body.session.sessionToken),
      '裁判应能读取高影响动作审计摘要，审计日志不应回传 sessionToken'
    );
    const captainWhilePaused = await requestJson(port, 'POST', '/api/tournaments/t-api/commands', {
      sessionToken: captainJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-paused-captain',
        type: multiplayerShared.COMMAND_TYPES.OPEN_SHOP,
        baseVersion: 7,
        payload: { teamId: 'team-1', round: 1 },
      },
    });
    assert(captainWhilePaused.status === 400 && /赛事已暂停/.test(captainWhilePaused.body.error), '赛事暂停后队长端普通操作应被服务端拒绝');
    const resumed = await requestJson(port, 'POST', '/api/tournaments/t-api/commands', {
      sessionToken: refereeJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-resume',
        type: multiplayerShared.COMMAND_TYPES.RESUME_TOURNAMENT,
        baseVersion: 7,
        payload: {
          reason: '复核完成继续',
        },
      },
    });
    const auditAfterResume = await requestJson(port, 'GET', `/api/tournaments/t-api/audit?sessionToken=${encodeURIComponent(refereeJoin.body.session.sessionToken)}`);
    assert(
      resumed.status === 200
      && resumed.body.tournament.stateVersion === 8
      && resumed.body.tournament.paused === false
      && auditAfterResume.body.auditLog.some(entry => entry.eventType === multiplayerShared.EVENT_TYPES.TOURNAMENT_RESUMED && entry.reason === '复核完成继续'),
      '裁判恢复应解除 paused 状态并写入审计摘要'
    );
    const forcedRuling = await requestJson(port, 'POST', '/api/tournaments/t-api/commands', {
      sessionToken: refereeJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-force-ruling',
        type: multiplayerShared.COMMAND_TYPES.FORCE_REFEREE_RULING,
        baseVersion: 8,
        payload: {
          reason: '裁判公告：本轮按现场判定继续',
          patchSummary: '仅公告，不直接改写队伍或选手状态',
          hiddenSeed: 'ruling-hidden-seed',
          players: [{ id: 'should-not-leak-player' }],
        },
      },
    });
    const rulingText = JSON.stringify(forcedRuling.body);
    assert(
      forcedRuling.status === 200
      && forcedRuling.body.tournament.stateVersion === 9
      && forcedRuling.body.tournament.snapshot.lastRefereeRuling.reason === '裁判公告：本轮按现场判定继续'
      && forcedRuling.body.tournament.snapshot.lastRefereeRuling.patchSummary === '仅公告，不直接改写队伍或选手状态'
      && !rulingText.includes('ruling-hidden-seed')
      && !rulingText.includes('should-not-leak-player'),
      '强制裁决第一版应只公开裁判公告原因和摘要，不能借 payload 泄漏隐藏字段或任意改写状态'
    );
    const auditAfterRuling = await requestJson(port, 'GET', `/api/tournaments/t-api/audit?sessionToken=${encodeURIComponent(refereeJoin.body.session.sessionToken)}`);
    assert(
      auditAfterRuling.body.auditLog.some(entry => entry.eventType === multiplayerShared.EVENT_TYPES.REFEREE_RULING_FORCED && entry.patchSummary === '仅公告，不直接改写队伍或选手状态'),
      '强制裁决应进入裁判审计摘要'
    );
    const viewerProjection = await requestJson(port, 'GET', '/api/tournaments/t-api/projection?view=viewer');
    const projectionText = JSON.stringify(viewerProjection.body);
    assert(viewerProjection.status === 200 && viewerProjection.body.tournament.view === 'viewer', '观众投影接口应返回 viewer 视图');
    assert(viewerProjection.body.tournament.perspective && viewerProjection.body.tournament.perspective.teamId === 'team-1', '观众投影应使用当前回合队长视角');
    assert(
      viewerProjection.body.tournament.snapshot.tournament
      && projectionText.includes('r1m1')
      && projectionText.includes('r2m1')
      && !projectionText.includes('r1m2')
      && !projectionText.includes('schedule-secret'),
      '观众端应接收当前回合队长赛程视角，但不应接收完整赛程管理数据或私有字段'
    );
    assert(projectionText.includes('公开摘要'), '观众投影应保留允许公开的摘要字段');
    assert(projectionText.includes('裁判公告：本轮按现场判定继续') && projectionText.includes('仅公告，不直接改写队伍或选手状态'), '观众投影应展示裁判强制裁决公告');
    assert(!projectionText.includes('should-not-leak') && !projectionText.includes('hidden-player') && !projectionText.includes('hidden-seed') && !projectionText.includes('ruling-hidden-seed') && !projectionText.includes('should-not-leak-player'), '观众投影不应泄漏房间码、真实暗牌、内部随机字段或裁决 payload 额外字段');
    const rollback = await requestJson(port, 'POST', '/api/tournaments/t-api/commands', {
      sessionToken: refereeJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-rollback',
        type: multiplayerShared.COMMAND_TYPES.ROLLBACK_TO_VERSION,
        baseVersion: 9,
        payload: {
          targetStateVersion: 8,
          reason: '回滚到裁判公告前',
        },
      },
    });
    const rollbackText = JSON.stringify(rollback.body);
    assert(
      rollback.status === 200
      && rollback.body.event.type === multiplayerShared.EVENT_TYPES.STATE_ROLLED_BACK
      && rollback.body.tournament.stateVersion === 10
      && rollback.body.tournament.snapshot.lastRollback.targetStateVersion === 8
      && rollback.body.tournament.snapshot.lastRollback.reason === '回滚到裁判公告前'
      && rollback.body.tournament.snapshot.lastRefereeRuling === null
      && !rollbackText.includes('auditLog')
      && !rollbackText.includes('should-not-leak-player'),
      '裁判回滚应恢复到目标版本快照，公开回滚提示，不暴露私有检查点或审计日志'
    );
    const viewerAfterRollback = await requestJson(port, 'GET', '/api/tournaments/t-api/projection?view=viewer');
    assert(
      JSON.stringify(viewerAfterRollback.body).includes('回滚到裁判公告前')
      && !JSON.stringify(viewerAfterRollback.body).includes('裁判公告：本轮按现场判定继续'),
      '回滚后观众投影应同步新版本快照，并移除被回滚掉的裁判公告'
    );
    const auditAfterRollback = await requestJson(port, 'GET', `/api/tournaments/t-api/audit?sessionToken=${encodeURIComponent(refereeJoin.body.session.sessionToken)}`);
    assert(
      auditAfterRollback.body.auditLog.some(entry => entry.eventType === multiplayerShared.EVENT_TYPES.STATE_ROLLED_BACK && entry.targetStateVersion === 8 && entry.restoredStateVersion === 8),
      '回滚动作应进入裁判审计摘要'
    );
    const captainRollback = await requestJson(port, 'POST', '/api/tournaments/t-api/commands', {
      sessionToken: captainJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-captain-rollback',
        type: multiplayerShared.COMMAND_TYPES.ROLLBACK_TO_VERSION,
        baseVersion: 10,
        payload: {
          targetStateVersion: 8,
          reason: '队长越权回滚',
        },
      },
    });
    assert(captainRollback.status === 400 && /无权/.test(captainRollback.body.error), '队长端不应能提交回滚命令');
    const viewerRollback = await requestJson(port, 'POST', '/api/tournaments/t-api/commands', {
      sessionToken: viewerJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-viewer-rollback',
        type: multiplayerShared.COMMAND_TYPES.ROLLBACK_TO_VERSION,
        baseVersion: 10,
        payload: {
          targetStateVersion: 8,
          reason: '观众越权回滚',
        },
      },
    });
    assert(viewerRollback.status === 400 && /无权/.test(viewerRollback.body.error), '观众端不应能提交回滚命令');
    const badRollback = await requestJson(port, 'POST', '/api/tournaments/t-api/commands', {
      sessionToken: refereeJoin.body.session.sessionToken,
      command: {
        commandId: 'cmd-api-bad-rollback',
        type: multiplayerShared.COMMAND_TYPES.ROLLBACK_TO_VERSION,
        baseVersion: 10,
        payload: {
          targetStateVersion: 10,
          reason: '无效回滚',
        },
      },
    });
    assert(badRollback.status === 400 && /早于当前版本/.test(badRollback.body.error), '回滚目标必须早于当前服务端版本');
    const badProjection = await requestJson(port, 'GET', '/api/tournaments/t-api/projection?view=referee');
    assert(badProjection.status === 401 && /sessionToken/.test(badProjection.body.error), '裁判只读投影必须校验 sessionToken，匿名请求不能读取');

    const riskCreated = await requestJson(port, 'POST', '/api/tournaments', {
      id: 'risk-demo',
      name: '旧攻击路径回归',
    });
    const leakedRoom = await requestJson(port, 'GET', '/api/tournaments/risk-demo/room');
    assert(leakedRoom.status === 401 && !leakedRoom.body.room, '旧攻击路径第一步应失败：匿名用户不能读取 refereeCode');
    const guessedRefereeJoin = await requestJson(port, 'POST', '/api/tournaments/risk-demo/join', {
      code: 'risk-demo-referee',
      displayName: '猜码用户',
    });
    assert(guessedRefereeJoin.status === 400 && /房间码无效/.test(guessedRefereeJoin.body.error), '旧攻击路径第二步应失败：默认裁判码不再可预测');
    assert(riskCreated.body.room.refereeCode && riskCreated.body.room.refereeCode !== 'risk-demo-referee', '创建赛事返回的裁判码应为随机码而非旧默认格式');
  } finally {
    if (sse && sse.req) sse.req.destroy();
    if (captainSse && captainSse.req) captainSse.req.destroy();
    await closeServer(server);
  }
}

async function testMultiplayerSessionExpiry() {
  const server = multiplayerApiServer.createServer({ sessionTtlMs: 5 });
  const port = await listen(server);
  try {
    const health = await requestJson(port, 'GET', '/health');
    assert(health.body.runtime.sessionTtlSeconds === 1, '健康检查应返回最小化后的 session TTL 秒数，便于运维确认过期策略');
    const created = await requestJson(port, 'POST', '/api/tournaments', {
      id: 't-session-expire',
      name: '会话过期回归',
      teams: [{ teamId: 'expire-team', name: '过期队', camp: 'local', code: 'expire-code' }],
    });
    const join = await requestJson(port, 'POST', '/api/tournaments/t-session-expire/join', {
      code: created.body.room.captainCodes[0].code,
      displayName: '短会话队长',
    });
    assert(join.status === 200 && join.body.session.expiresAt && !join.body.session.sessionTokenHash, '加入房间应返回 session 过期时间，但不返回 session 摘要');
    await delay(15);
    const expiredProjection = await requestJson(port, 'GET', `/api/tournaments/t-session-expire/projection?view=captain&sessionToken=${encodeURIComponent(join.body.session.sessionToken)}`);
    const expiredCommand = await requestJson(port, 'POST', '/api/tournaments/t-session-expire/commands', {
      sessionToken: join.body.session.sessionToken,
      command: {
        commandId: 'cmd-expired-session',
        type: multiplayerShared.COMMAND_TYPES.OPEN_SHOP,
        baseVersion: 1,
        payload: { teamId: 'expire-team', round: 1 },
      },
    });
    assert(
      expiredProjection.status === 401
      && /sessionToken/.test(expiredProjection.body.error)
      && expiredCommand.status === 400
      && /sessionToken/.test(expiredCommand.body.error),
      'session 过期后应统一拒绝队长投影和 command 写入',
    );
  } finally {
    await closeServer(server);
  }
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
  H.actions.generateTournamentSchedule();
  const firstRound = H.state.tournament.rounds[0];
  assert(firstRound.matches.every(match =>
    match.teamAId
    && match.teamBId
    && H.selectors.captainCamp(match.teamAId) === 'local'
    && H.selectors.captainCamp(match.teamBId) === 'outsider'
  ), '阵营对抗一键生成时首轮应自动填入本地 vs 外地队伍');
  firstRound.matches.forEach((match, index) => {
    elements[`tournament-score-${firstRound.id}-${match.id}-a`] = { value: String(index + 1) };
    elements[`tournament-score-${firstRound.id}-${match.id}-b`] = { value: '0' };
    H.actions.saveTournamentScore(firstRound.id, match.id);
  });

  const secondRound = H.state.tournament.rounds[1];
  assert(secondRound.matches.length === 3, '10队首轮后5名晋级者应生成2场对阵和1个轮空');
  assert(secondRound.matches.some(match => match.status === 'bye' && match.teamAId && !match.teamBId), '奇数晋级者应正确显示轮空晋级场次');
  assert(secondRound.matches.every(match => !match.teamBId || match.teamAId !== match.teamBId), '后续轮次不能出现同队伍对阵自己');
  const secondPlayable = secondRound.matches.find(match => match.teamAId && match.teamBId);
  elements[`tournament-score-${secondRound.id}-${secondPlayable.id}-a`] = { value: '2' };
  elements[`tournament-score-${secondRound.id}-${secondPlayable.id}-b`] = { value: '1' };
  H.actions.saveTournamentScore(secondRound.id, secondPlayable.id);
  assert(secondPlayable.status === 'completed' && secondPlayable.winnerId === secondPlayable.teamAId, '第二轮有双方队伍的场次应允许录入比分并保存');

  H.actions.setActiveView('tournament');
  assert(app.innerHTML.includes('BYE') && app.innerHTML.includes('轮空'), '赛程图应明确显示轮空');
  assert(app.innerHTML.includes('tournament-bye-card') && !app.innerHTML.includes('VS</em>\\n                        <label class="tournament-slot empty'), '轮空场次应只显示轮空卡，不应显示VS空队伍');
  assert(app.innerHTML.includes('bracket-source') && app.innerHTML.includes('linked'), '赛程图应显示晋级来源和连接路径样式');

  let guard = 0;
  while (H.state.tournament.status !== 'completed' && guard < 10) {
    guard += 1;
    const currentRound = H.state.tournament.rounds[H.state.tournament.rounds.length - 1];
    const playable = currentRound.matches.find(match => match.teamAId && match.teamBId && match.status !== 'completed');
    if (!playable) break;
    elements[`tournament-score-${currentRound.id}-${playable.id}-a`] = { value: '2' };
    elements[`tournament-score-${currentRound.id}-${playable.id}-b`] = { value: '1' };
    H.actions.saveTournamentScore(currentRound.id, playable.id);
  }
  assert(H.state.tournament.status === 'completed' && H.state.tournament.championId, '决赛保存比分后应产生冠军');
  H.actions.setActiveView('tournament');
  const championName = H.state.captains.find(captain => captain.id === H.state.tournament.championId).name;
  assert(app.innerHTML.includes('tournament-champion-showcase') && app.innerHTML.includes('HEXCORE 2.0 最终胜者'), '赛程完成后应展示冠军展示区');
  assert(app.innerHTML.includes(championName) && app.innerHTML.includes('亚军队伍') && app.innerHTML.includes('决赛'), '冠军展示区应包含冠军、亚军和决赛信息');
}

function testTournamentScheduleRandomizesEntrants() {
  const { H, app } = createReadyHarness();
  H.actions.generateTournamentSchedule();
  const firstRound = H.state.tournament.rounds[0];
  const secondMatch = firstRound.matches[1];
  const firstLocalId = firstRound.matches[0].teamAId;
  const firstOutsiderId = firstRound.matches[0].teamBId;
  const secondLocalId = secondMatch.teamAId;
  const outsiderCaptain = H.state.captains.find(captain => H.selectors.captainCamp(captain.id) === 'outsider');
  assert(firstRound.pairingMode === 'camp_versus' && H.state.tournament.pairingMode === 'camp_versus', '赛程应标记为阵营A/B对抗模式');
  assert(firstRound.matches.length === 5, '10队阵营对抗应生成5场首轮对阵');
  assert(firstRound.matches.every(match =>
    match.pairingMode === 'camp_versus'
    && match.teamAId
    && match.teamBId
    && H.selectors.captainCamp(match.teamAId) === 'local'
    && H.selectors.captainCamp(match.teamBId) === 'outsider'
  ), '阵营对抗一键生成必须全部为本地队伍 vs 外地队伍');
  delete firstRound.matches[0].pairingMode;

  H.actions.setActiveView('tournament');
  assert(app.innerHTML.includes('一键生成赛程') && app.innerHTML.includes('阵营对抗') && app.innerHTML.includes('更换'), '赛程页应提供一键生成和点击槽位更换入口');
  H.actions.openTournamentSlotPicker(firstRound.id, firstRound.matches[0].id, 'A');
  assert(H.state.ui.tournamentSlotPicker && app.innerHTML.includes('tournament-slot-picker-modal'), '点击首轮槽位应打开赛程队伍选择弹窗');
  assert(app.innerHTML.includes(`data-picker-captain-id="${firstLocalId}"`) && !app.innerHTML.includes(`data-picker-captain-id="${firstOutsiderId}"`), '左侧本地槽位弹窗只应列出本地队伍');
  H.actions.closeTournamentSlotPicker();
  assert(!H.state.ui.tournamentSlotPicker, '关闭赛程队伍选择弹窗后应清理UI状态');
  firstRound.matches[0].pairingMode = 'camp_versus';

  H.actions.assignTournamentSlot(firstRound.id, firstRound.matches[0].id, 'A', outsiderCaptain.id);
  assert(firstRound.matches[0].teamAId === firstLocalId, '外地队伍不能拖入阵营对抗左侧本地槽位');
  H.actions.openTournamentSlotPicker(firstRound.id, firstRound.matches[0].id, 'B');
  assert(app.innerHTML.includes(`data-picker-captain-id="${firstOutsiderId}"`) && !app.innerHTML.includes(`data-picker-captain-id="${firstLocalId}"`), '右侧外地槽位弹窗只应列出外地队伍');
  H.actions.closeTournamentSlotPicker();
  H.actions.openTournamentSlotPicker(firstRound.id, secondMatch.id, 'A');
  assert(!app.innerHTML.includes(`data-picker-captain-id="${firstLocalId}"`) && app.innerHTML.includes(`data-picker-captain-id="${secondLocalId}"`), '已在其它场次的队伍不应出现在新槽位选择列表中，当前槽位队伍仍应显示');
  H.actions.closeTournamentSlotPicker();
  firstRound.matches[0].status = 'pending_opponent';
  H.actions.setActiveView('tournament');
  assert(app.innerHTML.includes('左蓝本地') && app.innerHTML.includes('右红外地'), '赛程页应展示阵营对抗左右槽位文案');
  assert(app.innerHTML.includes('更换') && app.innerHTML.includes('移出') && app.innerHTML.includes('清空本场'), '赛程页已放入队伍后应提供更换、移出和清空本场操作');
  assert(app.innerHTML.includes('待录分'), '双方都已填入队伍时，即使旧状态仍是待补齐，也应显示待录分');
  assert(!app.innerHTML.includes('确认轮空'), '双方都已填入队伍时，即使旧状态仍是待补齐，也不应显示确认轮空');

  H.actions.setTournamentCampVersus(false);
  H.actions.generateTournamentSchedule();
  const randomRound = H.state.tournament.rounds[0];
  const randomIds = randomRound.matches.flatMap(match => [match.teamAId, match.teamBId]).filter(Boolean);
  assert(H.state.tournament.pairingMode === 'random', '取消阵营对抗后应生成全随机赛程');
  assert(new Set(randomIds).size === H.state.captains.length, '全随机赛程应把全部队伍唯一放入首轮');
  assert(randomRound.matches.every(match => match.pairingMode !== 'camp_versus'), '全随机赛程不应带阵营对抗槽位限制');
  H.actions.setActiveView('tournament');
  assert(app.innerHTML.includes('全随机对抗'), '赛程页应显示当前为全随机对抗模式');
}

function testTournamentManualByeAndReorder() {
  const { H, app, elements } = createReadyHarness();
  H.actions.generateTournamentSchedule();
  const firstRound = H.state.tournament.rounds[0];
  const firstMatch = firstRound.matches[0];
  const secondMatch = firstRound.matches[1];
  const localCaptains = H.state.captains.filter(captain => H.selectors.captainCamp(captain.id) === 'local');
  const outsiderCaptains = H.state.captains.filter(captain => H.selectors.captainCamp(captain.id) === 'outsider');

  H.actions.removeTournamentSlot(firstRound.id, firstMatch.id, 'B');
  assert(firstMatch.status === 'pending_opponent' && !firstMatch.winnerId, '单边队伍必须保持待补齐，不能自动晋级');
  H.actions.setActiveView('tournament');
  assert(app.innerHTML.includes('待补齐') && app.innerHTML.includes('确认轮空') && app.innerHTML.includes('等待阵营B队伍'), '单边待补齐场次应显示确认轮空和等待另一侧文案');

  H.actions.confirmTournamentBye(firstRound.id, firstMatch.id);
  assert(firstMatch.status === 'bye' && firstMatch.byeConfirmed && firstMatch.winnerId === firstMatch.teamAId, '点击确认轮空后单边队伍才应晋级');
  H.actions.removeTournamentSlot(firstRound.id, firstMatch.id, 'A');
  assert(!firstMatch.teamAId && !firstMatch.teamBId && !firstMatch.winnerId && firstMatch.status === 'empty', '移出轮空队伍后应清空本场并回到空场次');

  H.actions.clearTournamentMatch(firstRound.id, secondMatch.id);
  H.actions.assignTournamentSlot(firstRound.id, firstMatch.id, 'A', localCaptains[0].id);
  H.actions.assignTournamentSlot(firstRound.id, firstMatch.id, 'B', outsiderCaptains[0].id);
  H.actions.assignTournamentSlot(firstRound.id, secondMatch.id, 'A', localCaptains[1].id);
  H.actions.assignTournamentSlot(firstRound.id, secondMatch.id, 'B', outsiderCaptains[1].id);
  elements[`tournament-score-${firstRound.id}-${firstMatch.id}-a`] = { value: '2' };
  elements[`tournament-score-${firstRound.id}-${firstMatch.id}-b`] = { value: '1' };
  H.actions.saveTournamentScore(firstRound.id, firstMatch.id);
  assert(firstMatch.status === 'completed' && firstMatch.winnerId === localCaptains[0].id, '测试前提：首场比分保存后应产生胜者');
  H.actions.removeTournamentSlot(firstRound.id, firstMatch.id, 'A');
  assert(firstMatch.teamAId === '' && firstMatch.scoreA === '' && firstMatch.scoreB === '' && firstMatch.winnerId === '', '移出已完成场次队伍应清空比分和胜者');
  assert(H.state.tournament.rounds.length === 1, '移出已产生胜者的首轮队伍后应清空后续晋级链');

  H.actions.clearTournamentMatch(firstRound.id, secondMatch.id);
  assert(!secondMatch.teamAId && !secondMatch.teamBId && secondMatch.status === 'empty', '清空本场应移出两侧队伍并恢复为空场次');
}

function testTournamentReportsIncompleteTeamsBeforeMissingCamps() {
  const { H } = createHarness();
  H.actions.generateTournamentSchedule();
  const event = H.state.events[0];
  assert(event && event.title === '生成赛程失败', '队伍人员不齐时生成赛程应写入失败事件');
  assert(event.body.includes('当前已有 10 支队伍') && event.body.includes('队伍已指定队长选手') && event.body.includes('补齐队伍人员'), '赛程生成失败应提示队伍人员不齐，而不是误报没有阵营队伍');
}

function testBandleDefenseScheduleAndScoring() {
  const { H, app, elements } = createReadyHarness();
  H.actions.generateBandleDefenseSchedule();
  assert(H.state.tournament.type === 'bandle_defense', '班德尔保卫战应使用独立赛制类型');
  assert(H.state.tournament.rounds.length === 2, '班德尔保卫战应生成两天赛程');
  assert(H.state.tournament.rounds.every(round => round.matches.length === 25), '每天应生成 25 场 5x5 全交叉比赛');
  assert(H.state.tournament.rounds.every(round => round.matches.every(match =>
    H.selectors.captainCamp(match.teamAId) === 'local'
    && H.selectors.captainCamp(match.teamBId) === 'outsider'
  )), '班德尔保卫战必须全部为本地队伍 vs 外地队伍');

  const firstMatch = H.state.tournament.rounds[0].matches[0];
  elements[`bandle-score-day1-${firstMatch.id}-a`] = { value: '2' };
  elements[`bandle-score-day1-${firstMatch.id}-b`] = { value: '1' };
  elements[`bandle-yordle-day1-${firstMatch.id}`] = { value: '3' };
  H.actions.saveBandleDefenseScore('day1', firstMatch.id);
  assert(firstMatch.status === 'completed' && firstMatch.winnerId === firstMatch.teamAId, '保存班德尔比分后应产生单场胜者');
  assert(firstMatch.bandlePoints === 2.5 && firstMatch.invaderPoints === 0, '班德尔胜场 +1 且约德尔 3 人应额外 +1.5');

  H.state.tournament.rounds.forEach(round => {
    round.matches.forEach(match => {
      if (match.status === 'completed') return;
      elements[`bandle-score-${round.id}-${match.id}-a`] = { value: '2' };
      elements[`bandle-score-${round.id}-${match.id}-b`] = { value: '0' };
      elements[`bandle-yordle-${round.id}-${match.id}`] = { value: '0' };
      H.actions.saveBandleDefenseScore(round.id, match.id);
    });
  });
  assert(H.state.tournament.status === 'completed' && H.state.tournament.winnerCamp === 'bandle', '50 场完成且分差大于 5 时应直接产生班德尔获胜阵营');
  assert(H.state.tournament.winnerReason === 'points', '直接获胜应记录为积分决胜');
  H.actions.setActiveView('tournament');
  assert(app.innerHTML.includes('班德尔保卫战') && app.innerHTML.includes('班德尔守住了家园'), '赛程页应渲染班德尔保卫战和阵营胜利展示');
}

function testBandleDefenseFinalBattle() {
  const { H, app, elements } = createReadyHarness();
  H.actions.generateBandleDefenseSchedule();
  H.state.tournament.rounds.forEach(round => {
    round.matches.forEach((match, index) => {
      const bandleWins = index % 2 === 0;
      elements[`bandle-score-${round.id}-${match.id}-a`] = { value: bandleWins ? '2' : '0' };
      elements[`bandle-score-${round.id}-${match.id}-b`] = { value: bandleWins ? '0' : '2' };
      elements[`bandle-yordle-${round.id}-${match.id}`] = { value: '0' };
      H.actions.saveBandleDefenseScore(round.id, match.id);
    });
  });
  assert(H.state.tournament.status === 'running' && H.state.tournament.finalBattle.enabled, '50 场后分差不超过 5 应开启隐藏大决战');
  assert(H.state.tournament.finalBattle.games.length === 5, '隐藏大决战应生成 BO5 五局录分位');
  [0, 1, 2].forEach(index => {
    elements[`bandle-final-${index}-a`] = { value: '2' };
    elements[`bandle-final-${index}-b`] = { value: '1' };
    H.actions.saveBandleFinalBattleGame(index);
  });
  assert(H.state.tournament.status === 'completed' && H.state.tournament.winnerCamp === 'bandle', 'BO5 先赢 3 局后应产生最终获胜阵营');
  assert(H.state.tournament.winnerReason === 'final_battle', 'BO5 获胜应记录为隐藏大决战决胜');
  assert(H.state.tournament.finalBandlePoints === 36 && H.state.tournament.finalInvaderPoints === 24, 'BO5 胜方应在原积分基础上 +10');
  H.actions.setActiveView('tournament');
  assert(app.innerHTML.includes('隐藏大决战') && app.innerHTML.includes('最强约德尔人'), '赛程页应展示隐藏大决战 BO5 区域');
}

function testBandleDefenseDayLayoutStyles() {
  const css = fs.readFileSync(path.join(root, 'src/styles/main.css'), 'utf8').replace(/\r\n/g, '\n');
  assert(
    css.includes('.bandle-days-grid {\n  display: grid;\n  grid-template-columns: minmax(0, 1fr);'),
    '班德尔保卫战 Day 1 和 Day 2 应上下单列分布，避免并排压缩导致显示不全',
  );
  assert(
    css.includes('.bandle-matrix {\n  display: grid;\n  grid-template-columns: repeat(5, minmax(160px, 1fr));'),
    '每个 Day 内部仍应保持 5 列对阵矩阵',
  );
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

function testPostTaskIgnoresCompletedAcceptanceLanguage() {
  const relativeDoc = '.tmp-post-task-completed-acceptance.md';
  const docPath = path.join(root, relativeDoc);
  fs.writeFileSync(docPath, [
    '# 临时已完成计划',
    '',
    '## 验收矩阵',
    '',
    '| 功能 | 状态 | 验收标准 |',
    '| --- | --- | --- |',
    '| 购买失败日志 | 已完成 | 失败原因、风险属性和注意事项均能在日志中展示。 |',
    '',
    '| 场景 | 卡片提示 |',
    '| --- | --- |',
    '| 金币不足 | 金币不足 |',
    '| 已购买 | 已购买 |',
    '',
    '目标：记录已完成目标，不应作为未完成线索。',
  ].join('\n'), 'utf8');

  try {
    const analysis = analyzeTaskDoc(relativeDoc);
    assert(analysis.openTableRows.length === 0, 'post-task 不应把已完成验收表中的场景或失败原因误判为未完成计划项');
    assert(analysis.openPlanSignals.length === 0, 'post-task 不应把已完成描述里的失败原因、风险属性或目标描述误判为严格计划线索');
  } finally {
    if (fs.existsSync(docPath)) fs.unlinkSync(docPath);
  }
}

function testHexcoreLibraryResponsiveStyles() {
  const css = fs.readFileSync(path.join(root, 'src/styles/main.css'), 'utf8').replace(/\r\n/g, '\n');
  const uiSource = fs.readFileSync(path.join(root, 'src/ui/referee-console.js'), 'utf8').replace(/\r\n/g, '\n');
  assert(css.includes('grid-template-columns: minmax(220px, 0.9fr) minmax(260px, 1.05fr) minmax(300px, 1.15fr);') && css.includes('justify-content: stretch;') && css.includes('overflow-x: auto;'), '裁判操作应横向填满操作栏，宽度不足时使用横向滚动');
  assert(css.includes('.shop-actions') && css.includes('grid-template-columns: minmax(0, 1fr);') && css.includes('.system-actions'), '裁判操作商店分组应只保留一个刷新/开店按钮');
  assert(css.includes('.primary-actions') && css.includes('grid-template-columns: repeat(2, minmax(0, 1fr));'), '流程分组取消购买按钮后应按剩余两个按钮重新均分');
  assert(css.includes('.action-btn {\n  width: 100%;') && css.includes('height: 54px;'), '裁判操作按钮应使用固定紧凑高度，避免因文字撑大');
  assert(css.includes('.action-btn strong') && css.includes('text-overflow: ellipsis;') && css.includes('white-space: nowrap;'), '裁判操作按钮文字应单行省略，不应撑开按钮');
  assert(css.includes('.cards-grid.shop-grid .player-card') && css.includes('.shop-empty-slot.card-back') && css.includes('@keyframes shopCardFlipIn'), '队员商店应固定卡位、显示卡背占位并支持抽卡翻转动画');
  assert(css.includes('repeat(auto-fit, minmax(min(288px, 100%), 1fr))'), '海克斯库列宽应使用容器约束，避免窄宽度下卡片越界');
  assert(css.includes('.hex-library-card {\n  border-left: 3px solid currentColor;') && css.includes('overflow: hidden;'), '海克斯库卡片应限制内部内容溢出');
  assert(css.includes('.hex-library-card span') && css.includes('white-space: normal;'), '海克斯库状态文字应允许换行，避免挤压图标后横向溢出');
  assert(css.includes('.hex-library-icon') && css.includes('flex: 0 0 64px;'), '海克斯库图标容器应固定尺寸，避免随标题压缩变形');
  assert(css.includes('.hex-library-desc > span') && css.includes('-webkit-line-clamp: 3'), '海克斯库描述应在卡片内摘要显示');
  assert(css.includes('.hex-detail-backdrop') && css.includes('.hex-detail-modal') && css.includes('overflow-y: auto'), '海克斯详情应使用固定尺寸弹窗并在正文区域滚动');
  assert(css.includes('.hex-draw-actions') && css.includes('grid-template-columns: repeat(3, minmax(0, 1fr));'), '海克斯候选卡的详情、刷新、选择按钮应固定同一行三列显示');
  assert(css.includes('.hex-draw-actions > button') && css.includes('min-height: 36px;') && css.includes('text-overflow: ellipsis;'), '海克斯候选卡底部按钮应统一尺寸、字重和溢出处理');
  assert(
    css.includes('.cannon-choice-grid button') && css.includes('display: inline-flex;')
    && css.includes('flex-direction: row;') && css.includes('justify-content: center;')
    && css.includes('min-height: 44px;') && css.includes('.cannon-choice-grid span')
    && css.includes('white-space: nowrap;'),
    '大炮已充能选择按钮应使用单行横向居中布局，避免文字贴上边或换行'
  );
  assert(css.includes('.hex-draw-actions .hex-detail-trigger') && css.includes('.hex-select-btn') && css.includes('linear-gradient(180deg, #12d9ff, #00aee4)'), '海克斯候选卡详情/刷新/选择按钮应共用按钮基线，并保留选择按钮主操作强调');
  assert(css.includes('.workspace > .workspace-main') && css.includes('overflow-y: auto;'), '实时抽选主内容超出视口高度时应在内容容器内纵向滚动');
  assert(uiSource.includes('function hexcoreIcon') && uiSource.includes('assets/hex-icons/${safeId}.png') && uiSource.includes('hex-svg-fallback'), '海克斯图标应优先加载同名本地 PNG，并保留 SVG 兜底');
  assert(
    !uiSource.includes('const hexcoreIconFiles')
    && uiSource.includes('data-icon-file="${safeId}"'),
    '海克斯图标应按海克斯 ID 读取同名 PNG，不应再使用显式错配映射',
  );
  assert(css.includes('.hex-png-icon') && css.includes('object-fit: contain') && css.includes('.hex-png-icon.is-missing .hex-svg-fallback'), '海克斯 PNG 图标容器应固定尺寸并支持缺图兜底');
  assert(
    css.includes('.hex-png-icon.size-lg') && css.includes('width: 80px;')
    && css.includes('.hex-png-icon.size-md') && css.includes('width: 54px;')
    && css.includes('.hex-png-icon.size-sm') && css.includes('width: 38px;')
    && css.includes('.hex-png-icon.size-popover') && css.includes('width: 42px;'),
    '海克斯 PNG 图标应覆盖候选卡、海克斯库、已拥有和详情弹窗四种独立尺寸',
  );
  assert(
    css.includes('.team-roster-card')
    && css.includes('.roster-card-popover')
    && css.includes('width: 280px;')
    && css.includes('max-height: none;')
    && css.includes('overflow: visible;')
    && css.includes('.status-dot.abnormal'),
    '实时抽选阵容看板应有固定卡片、hover自适应详情和异常状态样式',
  );
  assert(
    css.includes('.located-card') && css.includes('animation: locatePulse 0.72s ease-in-out 2;'),
    '定位队伍高亮应只荧光闪烁2次，避免持续闪烁干扰裁判操作',
  );
}

function testThemeSafeModalsAndScrollbars() {
  const css = fs.readFileSync(path.join(root, 'src/styles/main.css'), 'utf8').replace(/\r\n/g, '\n');
  assert(
    css.includes('--overlay-strong:') && css.includes('--modal-bg:') && css.includes('--input-bg:'),
    '主题变量应包含弹层遮罩、弹窗背景和输入框背景，避免组件硬编码单一主题颜色',
  );
  assert(
    css.includes('.form-modal,\n.origin-sage-modal,\n.charged-cannon-modal,\n.last-stand-modal,\n.recruit-reveal-modal,\n.economy-reveal-modal,\n.hex-detail-modal')
    && css.includes('background: var(--modal-bg);')
    && css.includes('color: var(--text);'),
    '所有主要弹窗应使用主题背景和主题文字色',
  );
  assert(
    css.includes('.import-preview-workbench,\n.import-preview-stats div,\n.import-preview-row')
    && css.includes('background: var(--surface);')
    && css.includes('.import-preview-row strong')
    && css.includes('color: var(--text);'),
    '导入预览的统计、列表和文本应使用主题安全色，保证浅色主题可读',
  );
  assert(
    css.includes(':root[data-theme="apple"] .form-modal')
    && css.includes(':root[data-theme="apple"] .import-preview-workbench')
    && css.includes('background: var(--surface-strong);'),
    'Apple 浅色主题应覆盖导入预览和弹窗内部面板，不能沿用深色硬编码',
  );
  assert(
    css.includes('scrollbar-color: var(--scroll-thumb) var(--scroll-track);')
    && css.includes('.import-preview-list::-webkit-scrollbar-thumb')
    && css.includes('border-color: var(--scroll-track);'),
    '全局和主要滚动容器应使用主题滚动条变量',
  );
  assert(
    css.includes('.last-stand-body section {\n  display: grid;')
    && css.includes('height: 296px;')
    && css.includes('.last-stand-chip-list.candidates {\n  grid-template-columns: repeat(2, minmax(0, 1fr));\n  align-content: start;\n  overflow-y: auto;'),
    '背水一战候选池预览应与当前队员框等高，并在框内滚动',
  );
  assert(
    css.includes(':root[data-theme="apple"] select option:checked') && css.includes('color: #ffffff;'),
    'Apple 主题下拉选中项应使用高对比文字色',
  );
  assert(
    css.includes(':where(.form-modal, .origin-sage-modal, .charged-cannon-modal, .last-stand-modal, .recruit-reveal-modal, .economy-reveal-modal, .hex-detail-modal) button:not(.primary-btn):not(.danger-btn):not(.danger-inline)')
    && css.includes('.import-preview-tabs button.active')
    && css.includes(':root[data-theme="apple"] .icon-close'),
    '弹窗内普通按钮、页签按钮和关闭按钮应使用统一主题按钮基线',
  );
  assert(
    css.includes('--cyan: #4cc9e8;')
    && css.includes('rgba(76, 201, 232, 0.14)')
    && css.includes('rgba(231, 102, 141, 0.1)')
    && !css.includes('--cyan: #00d8ff;')
    && !css.includes('rgba(255, 35, 101, 0.2)'),
    '霓虹主题应使用柔和青色和低透明光斑，避免高饱和大面积背景刺眼',
  );
}

function testHexcorePngIconAssets() {
  const { H, app } = createHarness();
  H.actions.setActiveView('hexcores');
  const requiredIds = H.sampleData.hexcores
    .filter(hex => !H.hexcoreEngine.isDisabledInGoldMode || !H.hexcoreEngine.isDisabledInGoldMode(hex.id))
    .map(hex => hex.id)
    .sort();
  const iconDir = path.join(root, 'public/assets/hex-icons');
  const missing = requiredIds.filter(id => !fs.existsSync(path.join(iconDir, `${id}.png`)));
  assert(missing.length === 0, `当前金币模式可用海克斯缺少 PNG 图标：${missing.join(', ')}`);
  const opaqueCorners = requiredIds.filter(id => pngCornerAlphas(path.join(iconDir, `${id}.png`)).some(alpha => alpha !== 0));
  assert(opaqueCorners.length === 0, `海克斯 PNG 图标必须是透明背景，以下文件仍有不透明边角：${opaqueCorners.join(', ')}`);
  assert(app.innerHTML.includes('hex-png-icon') && app.innerHTML.includes('hex-svg-fallback'), '海克斯库渲染应输出 PNG 图标容器和 SVG 兜底');
  assert(app.innerHTML.includes('assets/hex-icons/camp-scout.png'), '海克斯库应使用本地 PNG 路径渲染图标');
}

function testMultiplayerCaptainUiReusesRefereeScreensWithScopedAccess() {
  const ui = fs.readFileSync(path.join(root, 'apps/multiplayer/src/ui/referee-console.js'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'apps/multiplayer/src/main.js'), 'utf8');
  assert(
    ui.includes('clientRole()') && ui.includes('isCaptainClient()') && ui.includes('clientTeamId()'),
    '多人队长端应通过客户端角色和队伍绑定裁剪裁判端页面，而不是新建另一套 UI',
  );
  assert(
    ui.includes("['draft', 'draft', '实时抽选']")
    && ui.includes("['team', 'teams', '队伍总览']")
    && ui.includes("['hex', 'hexcores', '海克斯图录']")
    && ui.includes("['trophy', 'tournament', '我的赛程']"),
    '队长端导航应只保留实时抽选、队伍总览、海克斯图录和我的赛程',
  );
  assert(
    ui.includes('captainCanOperateCurrentTurn()')
    && ui.includes('非你的回合，仅可查看')
    && ui.includes('当前绑定：${escapeHtml(boundName)}')
    && ui.includes('本人回合可完成海克斯选择、金币商店抽选和本队信息维护')
    && !ui.includes('当前页面直接复用裁判端画面')
    && ui.includes("isCaptainClient() ? '' : workflowGatePanel()")
    && ui.includes("canBuy ? `onclick=\"window.hexcoreUI.buyCard")
    && ui.includes('const showShopPanelButton = !isReadonlyClient() && (!isCaptainClient() || !shopPanelBlockReason)')
    && ui.includes("if (isReadonlyClient() || (isCaptainClient() && shopDisabled && !skipEnabled)) return '';")
    && ui.includes("isCaptainClient() || isReadonlyClient() ? '' : `<div class=\"captain-title\">刷新：")
    && ui.includes("isCaptainClient() ? '' : '<button class=\"export-btn\"")
    && !ui.includes("captainAllowedView(view) && view === 'logs'"),
    '队长端实时抽选应按本人回合开放按钮，非本人回合隐藏商店/流程禁用按钮和顶栏刷新状态，并移除流程门禁、撤回、日志导出等裁判专属入口',
  );
  assert(
    ui.includes("['draft', 'teams', 'hexcores', 'tournament', 'rules'].includes(view)")
    && ui.includes('captainRulesPage()')
    && ui.includes('完整规则')
    && ui.includes('队长端只读查看完整规则')
    && ui.includes("if (isCaptainClient()) return captainRulesPage()"),
    '规则摘要的完整规则按钮在队长端应打开只读完整规则页，不能无反应或暴露规则编辑',
  );
  assert(
    ui.includes('captainsForTeamsPage()')
    && ui.includes('captain-readonly-team')
    && ui.includes('captain-own-team')
    && ui.includes('只有自己的队伍名称可编辑')
    && ui.includes('captainClientReadonlyNotice'),
    '队伍页应复用裁判端队伍卡，队长端可查看全部队伍但只能编辑自己队伍',
  );
  assert(
    ui.includes('captainHexcoreCatalogPage()')
    && ui.includes('海克斯图录')
    && ui.includes('captain-hex-catalog')
    && !ui.includes('captain-hex-catalog" onclick'),
    '海克斯页在队长端应只显示图录和详情，不提供抽取、移除或兜底分配操作',
  );
  assert(
    ui.includes('captainTournamentPage()')
    && ui.includes('matchesForClientCaptain')
    && ui.includes('只显示自己队伍相关场次'),
    '赛程页应裁剪为队长自己的赛程，不显示全局排赛和比分保存入口',
  );
  assert(
    ui.includes('captainHexcoreDraftPanel()')
    && ui.includes('队长海克斯选择')
    && ui.includes('window.hexcoreUI.drawHexcoreForCaptain(${safeJsonString(own.id)})')
    && ui.includes('window.hexcoreUI.refreshHexcoreSlot')
    && ui.includes('window.hexcoreUI.selectHexcoreFromDraw(${safeJsonString(own.id)}'),
    '队长端实时抽选页应开放本人海克斯抽取、刷新候选和选择入口',
  );
  assert(
    main.includes('captainClientCanActOn(captainId, actionLabel)')
    && main.includes('队长端无权操作其它队伍')
    && main.includes('captainClientCanUseHexcoreSession(actionLabel)')
    && main.includes('队长端不可执行裁判海克斯动作'),
    '队长端海克斯动作不能只靠隐藏按钮，应在动作函数中拦截越权调用',
  );
  assert(
    main.includes("captainClientCanOperateCurrentTurn('跳过失败')")
    && main.includes("captainClientCanOperateCurrentTurn('开店失败')")
    && main.includes("captainClientCanOperateCurrentTurn('刷新失败')")
    && main.includes("captainClientCanOperateCurrentTurn('购买失败')")
    && main.includes('skipCaptainClientGuard')
    && main.includes('this.nextCaptain({ skipSnapshot: true, skipCaptainClientGuard: true })'),
    '队长端本人回合商店动作应先校验回合权限，跳过本轮再允许内部推进到下一位',
  );
  assert(
    ui.includes('captainCanUseHexcoreFor(captainId)')
    && ui.includes('captainHexcoreActionAttr')
    && ui.includes('队长端仅可发动自己的海克斯')
    && ui.includes('const visibleEligibleOwners = isCaptainClient()')
    && ui.includes('targetContextForCaptain(captain)')
    && ui.includes('captainOwnHexcorePanel()')
    && ui.includes('picker.captainId')
    && main.includes('hexTargetPicker = { hexcoreId, captainId: ownerId }')
    && main.includes("captainClientCanUseOwnedHexcore(id, '海克斯执行失败')")
    && main.includes("captainClientCanUseOwnedHexcore(hexcoreId, '海克斯执行失败')"),
    '队长端可发动海克斯窗口应只开放本人海克斯，目标选择面板必须绑定海克斯持有者，不能操作当前视角队长或其它队长的海克斯',
  );
}

function testMultiplayerViewerUiIsReadonlyCurrentCaptainPerspective() {
  const ui = fs.readFileSync(path.join(root, 'apps/multiplayer/src/ui/referee-console.js'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'apps/multiplayer/src/main.js'), 'utf8');
  assert(
    ui.includes("role === 'viewer' ? 'viewer'")
    && ui.includes('isViewerClient()')
    && ui.includes('isReadonlyClient()'),
    '观众端应有独立 viewer 角色识别，并统一走只读客户端判断',
  );
  assert(
    ui.includes("['draft', 'draft', '实时抽选']")
    && ui.includes("['team', 'teams', '队伍总览']")
    && ui.includes("['hex', 'hexcores', '海克斯图录']")
    && ui.includes('viewerAllowedView(view)')
    && !ui.includes("['trophy', 'tournament', '观众赛程']"),
    '观众端导航应只保留实时抽选、队伍总览和海克斯图录，不提供赛程管理或裁判入口',
  );
  assert(
    ui.includes('viewerReadonlyNotice()')
    && ui.includes('观众端只读')
    && ui.includes('当前回合队长视角')
    && ui.includes("isReadonlyClient() ? '' : (isCaptainClient() ? '' : workflowGatePanel())")
    && ui.includes("isReadonlyClient() ? '' : (isCaptainClient() ? '' : '<button class=\"export-btn\"")
    && ui.includes("isReadonlyClient() ? '观众端' : (isCaptainClient() ? '队长端' : '裁判代执行')"),
    '观众端实时抽选页应显示当前回合队长视角说明，并隐藏流程门禁、日志导出和裁判模式文案',
  );
  assert(
    ui.includes('readonlyShopReason()')
    && ui.includes('观众端只读，无法操作')
    && ui.includes('const canBuy = Boolean(captain && roundState && !isReadonlyClient()')
    && ui.includes("isCaptainClient() || isReadonlyClient() ? '' : `<button class=\"ghost-btn")
    && ui.includes('const showShopPanelButton = !isReadonlyClient() && (!isCaptainClient() || !shopPanelBlockReason)')
    && ui.includes("if (isReadonlyClient() || (isCaptainClient() && shopDisabled && !skipEnabled)) return '';")
    && ui.includes("isCaptainClient() || isReadonlyClient() ? '' : `<div class=\"captain-title\">刷新：")
    && ui.includes("isReadonlyClient() ? '' : refereeControls()"),
    '观众端商店卡、开店刷新购买、流程按钮和顶栏刷新状态都应为只读隐藏，不允许写操作入口',
  );
  assert(
    main.includes('rejectViewerClient(actionLabel)')
    && main.includes('观众端只读，无法操作'),
    '观众端写操作不能只靠隐藏按钮，动作函数也应拒绝 viewer 调用',
  );
}

function testMultiplayerJoinGateAndCors() {
  const ui = fs.readFileSync(path.join(root, 'apps/multiplayer/src/ui/referee-console.js'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'apps/multiplayer/src/main.js'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'apps/server/server.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'apps/multiplayer/src/styles/main.css'), 'utf8');
  const appState = fs.readFileSync(path.join(root, 'apps/multiplayer/src/core/app-state.js'), 'utf8');
  const packageJson = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
  const stackScript = fs.readFileSync(path.join(root, 'scripts/start-multiplayer-stack.js'), 'utf8');
  const multiplayerServe = fs.readFileSync(path.join(root, 'scripts/serve-multiplayer.js'), 'utf8');
  assert(
    ui.includes('joinGatePage()')
    && ui.includes("classList.toggle('join-gate-root', shouldShowJoinGate())")
    && ui.includes('多人房间')
    && ui.includes('加入已有赛事')
    && ui.includes('join-tournament-id')
    && ui.includes('join-room-code')
    && ui.includes('window.hexcoreUI.joinRoom()')
    && ui.includes('shouldShowJoinGate()')
    && ui.includes('裁判创建赛事')
    && ui.includes('create-tournament-id')
    && ui.includes('create-tournament-name')
    && ui.includes('createdRoomPanel()')
    && ui.includes('window.hexcoreUI.enterCreatedRefereeRoom()')
    && ui.includes("window.hexcoreUI.copyCreatedRoomCodes('all')")
    && ui.includes("window.hexcoreUI.copyCreatedRoomCodes('referee')")
    && ui.includes("window.hexcoreUI.copyCreatedRoomCodes('captains')")
    && ui.includes("window.hexcoreUI.copyCreatedRoomCodes('viewer')")
    && ui.includes('captain:${item.teamId || \'\'}')
    && ui.includes('服务地址：${apiBase}')
    && ui.includes('身份：${singleCaptain.teamName || singleCaptain.teamId || \'队长\'}')
    && ui.includes('window.hexcoreUI.downloadCreatedRoomCodes()')
    && ui.includes('room-code-copy-source')
    && ui.includes('room-code-row-head')
    && ui.includes('joinGateMessagePanel()')
    && ui.includes('message.tips')
    && ui.includes('joinGateMessage')
    && ui.includes('role-status-strip')
    && ui.includes('当前权限')
    && ui.includes('返回多人房间')
    && ui.includes('window.hexcoreUI.leaveMultiplayerRoom()')
    && ui.includes('Hexcore2.volatileCreatedRoom')
    && ui.includes('房间码明文已清空')
    && ui.includes('创建前会先校验服务端是否已有同名赛事')
    && ui.includes('roomSyncInfo()')
    && ui.includes('最近同步')
    && ui.includes('会话：')
    && ui.includes('roomCommandSubmitting')
    && ui.includes('购买提交中')
    && ui.includes('房间码明文只显示一次'),
    '多人端无角色会话时应显示房间加入页，而不是直接暴露裁判控制台',
  );
  assert(
    main.includes('MULTIPLAYER_SESSION_KEY')
    && main.includes('joinRoom()')
    && main.includes('MULTIPLAYER_API_BASE_KEY')
    && main.includes('recentMultiplayerApiBase()')
    && main.includes('rememberMultiplayerApiBase(apiBase)')
    && main.includes('defaultMultiplayerApiBase()')
    && main.includes('shouldUseSameOriginApiBase')
    && main.includes("port === '4186'")
    && main.includes('location.origin')
    && main.includes('localMultiplayerApiBase(location)')
    && main.includes('Hexcore2.volatileCreatedRoom')
    && main.includes('verifyTournamentAvailableForCreate')
    && main.includes('/api/tournaments/${encodeURIComponent(tournamentId)}/snapshot')
    && main.includes('赛事 ID 已存在')
    && main.includes('currentCreatedRoom()')
    && main.includes('setRoomCommandSubmitting(type)')
    && main.includes('clearRoomCommandSubmitting(finalStatus)')
    && main.includes("roomSyncStatus = 'submitting'")
    && main.includes("roomSyncStatus = 'reconnecting'")
    && main.includes('roomSyncStatusFromError')
    && main.includes('location.hostname')
    && main.includes('shouldPreferCurrentHostApiBase')
    && main.includes('服务地址无法连接')
    && main.includes('赛事 ID 不存在')
    && main.includes('加入码无效')
    && main.includes('function joinFailureMessage(error)')
    && main.includes("joinFailureKind = 'network'")
    && main.includes('确认服务地址填写的是裁判电脑 API 地址')
    && main.includes('确认赛事 ID 与裁判创建赛事后分发文本中的赛事 ID 完全一致')
    && main.includes('加入失败，请检查分发文本或联系裁判')
    && main.includes('copyCreatedRoomCodes')
    && main.includes('downloadCreatedRoomCodes')
    && main.includes('createdRoomText')
    && main.includes("String(kind || '').startsWith('captain:')")
    && main.includes('服务地址：${apiBase}')
    && main.includes('身份：裁判')
    && main.includes('身份：观众')
    && main.includes('/api/tournaments/${encodeURIComponent(tournamentId)}/join')
    && main.includes('session.sessionToken')
    && main.includes("role=viewer")
    && main.includes("role=captain&teamId=")
    && main.includes('createTournamentRoom()')
    && main.includes('enterCreatedRefereeRoom()')
    && main.includes('leaveMultiplayerRoom()')
    && main.includes('localStorage.removeItem(MULTIPLAYER_SESSION_KEY)')
    && main.includes('Hexcore2.roomEventSource.close')
    && main.includes('history.replaceState({}, \'\', path)')
    && main.includes('/api/tournaments')
    && main.includes('persistJoinedSession(apiBase, tournamentId, payload)')
    && main.includes('房间码明文只显示一次'),
    '加入房间应调用服务端 join 接口，保存 sessionToken，按返回角色进入对应端，并能清理会话返回多人房间',
  );
  assert(
    appState.includes('delete state.ui.createdRoom')
    && appState.includes('createdRoomNotice')
    && appState.includes('sanitizeText(state.ui.createdRoomNotice.tournamentId')
    && appState.includes('state.ui.joinGateMessage = {')
    && appState.includes('state.ui.joinGateMessage.tips.map')
    && appState.includes('delete state.ui.roomCommandSubmitting')
    && appState.includes("['online', 'submitting', 'reconnecting', 'offline', 'expired']"),
    '房间码明文不得随裁判端完整状态长期持久化，旧 saved state 应清理 createdRoom，只保留安全提示摘要',
  );
  assert(
    stackScript.includes("process.env.HOST || '0.0.0.0'")
    && stackScript.includes('os.networkInterfaces()')
    && stackScript.includes('局域网访问页面')
    && multiplayerServe.includes("process.env.HOST || '0.0.0.0'")
    && server.includes("process.env.HOST || '0.0.0.0'"),
    '多人端默认启动应监听局域网地址，并在控制台打印手机可访问的页面和 API 地址',
  );
  assert(
    server.includes('Access-Control-Allow-Origin')
    && server.includes('Access-Control-Allow-Headers')
    && server.includes("req.method === 'OPTIONS'"),
    '多人端 API 应允许本地前端跨端口提交 join 请求，并处理 OPTIONS 预检',
  );
  assert(
    css.includes('.join-gate-page')
    && css.includes('#app.join-gate-root')
    && css.includes('#app:has(.join-gate-page)')
    && css.includes('html:has(#app.join-gate-root)')
    && css.includes('body:has(.join-gate-page)')
    && css.includes('min-width: 0 !important')
    && css.includes('grid-column: 1 / -1')
    && css.includes('place-items: center')
    && css.includes('.join-gate-panel')
    && css.includes('width: min(980px, calc(100vw - 64px))')
    && css.includes('.room-code-actions')
    && css.includes('.room-code-copy-source')
    && css.includes('.room-code-row-head')
    && css.includes('text-overflow: ellipsis')
    && css.includes('.join-gate-message')
    && css.includes('.join-gate-message ul')
    && css.includes('.role-status-strip')
    && css.includes('.join-gate-grid')
    && css.includes('.created-room-panel')
    && css.includes('.created-room-panel-stale')
    && css.includes('.form-hint')
    && css.includes('.sync-state.online')
    && css.includes('.sync-state.expired')
    && css.includes('.is-submitting')
    && css.includes('.room-code-row')
    && css.includes('.multiplayer-return-btn')
    && css.includes('max-width: 100%')
    && css.includes('@media (max-width: 760px)'),
    '加入页应脱离主控制台侧边栏栅格，居中显示完整表单，不能被压成窄列逐字换行',
  );
  assert(
    packageJson.includes('"start:multiplayer:stack"')
    && stackScript.includes('spawn(process.execPath')
    && stackScript.includes('MULTIPLAYER_APP_PORT')
    && stackScript.includes('MULTIPLAYER_API_PORT')
    && stackScript.includes('windowsHide: true')
    && !stackScript.includes('shell: true'),
    '多人端应提供本地堆栈启动脚本，并避免通过 shell 拼接启动命令',
  );
}

function testMultiplayerClientSubmitsAuthoritativeCommands() {
  const main = fs.readFileSync(path.join(root, 'apps/multiplayer/src/main.js'), 'utf8');
  assert(
    main.includes('function multiplayerSession()')
    && main.includes('async function submitRoomCommand(type, payload = {}, options = {})')
    && main.includes('/api/tournaments/${encodeURIComponent(session.tournamentId)}/commands')
    && main.includes('session.sessionToken')
    && main.includes('baseVersion: Number(session.stateVersion || 0)')
    && main.includes('commandId: `${type}-${Date.now()}-${Math.random().toString(16).slice(2)}`'),
    '多人端前端应有统一 command 提交桥，使用 sessionToken 和 stateVersion 调用服务端 commands',
  );
  assert(
    main.includes("await submitRoomCommand('OpenShop'")
    && main.includes("await submitRoomCommand('RefreshShop'")
    && main.includes("await submitRoomCommand('PurchaseShopCard'")
    && main.includes("await submitRoomCommand('SkipTurn'")
    && main.includes("await submitRoomCommand('RenameTeam'")
    && main.includes("await submitRoomCommand('SetHexcoreDrawOrder'")
    && main.includes("await submitRoomCommand('StartHexcoreDraw'")
    && main.includes("await submitRoomCommand('RefreshHexcoreCandidate'")
    && main.includes("await submitRoomCommand('PickHexcore'")
    && main.includes("await submitRoomCommand('RecordMatchScore'"),
    '开店、刷新、购买、跳过、改名、海克斯抽取顺序、海克斯抽选和裁判比分录入应在有房间 session 时提交服务端 command，再同步公开投影',
  );
  assert(
    main.includes('function serverSyncedHexcoreUsePayload')
    && main.includes("submitRoomCommand('UseHexcore', syncedPayload)")
    && main.includes("id !== 'snow-cat' && id !== 'storm-fog'")
    && main.includes('targetTeamId'),
    '目标型主动海克斯应通过 UseHexcore command 交给服务端权威校验和同步，当前覆盖雪定饿的喵与骤雨血雾清风'
  );
  assert(
    main.includes('syncSessionFromTournament(responsePayload.tournament)')
    && main.includes('状态版本过期')
    && main.includes('sessionStorage'),
    'command 成功后应同步服务端 stateVersion，版本过期时保留明确提示',
  );
  assert(
    main.includes('function applyRoomProjection(tournament)')
    && main.includes('captain.team = nextTeam')
    && main.includes("player.status = 'drafted'")
    && main.includes('applyCurrentShopProjection(snapshot.currentShop)')
    && main.includes('applyProjectedShopPlayers(normalizedCards)')
    && main.includes('applyLastPurchaseProjection(snapshot.lastPurchase)')
    && main.includes('applyLastHungryWaveProjection(snapshot.lastHungryWave)')
    && main.includes('hungryWaveFreeRefreshes')
    && main.includes('applyRoundStatesProjection(snapshot.roundStates)')
    && main.includes('applyHexcoreWindowProjection(snapshot.hexcoreActionWindows)')
    && main.includes('applyHexcoreAssignmentsProjection(snapshot.hexcoreAssignments)')
    && main.includes('applyHexcoreDraftProjection(snapshot.hexcoreDraft)')
    && main.includes('if (event.tournament)')
    && main.includes('applyTournamentProjection(snapshot.tournament)')
    && main.includes('connectRoomEventStream()')
    && main.includes('new global.EventSource')
    && main.includes('requestRoomStreamToken(session)')
    && main.includes('async function fetchRoomProjection')
    && main.includes('projectionViewForSession(session)')
    && main.includes('/projection?view=${encodeURIComponent(view)}')
    && main.includes("Authorization: `Bearer ${session.sessionToken}`")
    && main.includes('await fetchRoomProjection(session)')
    && main.includes('/stream-token')
    && main.includes("params.set('streamToken', streamToken)")
    && main.includes('function projectionViewForSession')
    && main.includes("if (session.role === 'referee') return 'referee'")
    && main.includes("session.role === 'captain' || session.role === 'referee'")
    && !main.includes("params.set('sessionToken', session.sessionToken)")
    && main.includes('eventSource.addEventListener')
    && main.includes('fetchRoomProjection(multiplayerSession())')
    && main.includes('applyRoomProjection(responsePayload.tournament)'),
    '多人端应在 command 成功、SSE 快照/事件到达和断线恢复时应用服务端公开投影；队长/裁判恢复请求用 Authorization，SSE 只能使用短期 streamToken，避免长期 sessionToken 进入订阅 URL',
  );
  const rules = fs.readFileSync(path.join(root, 'packages/rules/index.js'), 'utf8');
  const projections = fs.readFileSync(path.join(root, 'apps/server/projections.js'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'apps/server/server.js'), 'utf8');
  assert(
    rules.includes('EVENT_TYPES.HEXCORE_CANDIDATES_CREATED')
    && rules.includes('EVENT_TYPES.HEXCORE_DRAW_ORDER_SET')
    && rules.includes('EVENT_TYPES.HEXCORE_CANDIDATE_REFRESHED')
    && rules.includes('EVENT_TYPES.HEXCORE_PICKED')
    && rules.includes('EVENT_TYPES.MATCH_SCORE_RECORDED')
    && rules.includes('recordTournamentMatchScore(next, payload)')
    && projections.includes('publicHexcoreAssignments')
    && projections.includes('publicHexcoreDraft')
    && projections.includes('VIEW_TYPES.REFEREE')
    && server.includes('createReadOnlyProjection(nextState, view, projectionOptions)')
    && server.includes('requireStreamToken: true')
    && server.includes('bearerSessionTokenFromRequest(req) || String(body.sessionToken'),
    '服务端应把海克斯候选、刷新和选择写入权威状态，并通过公开投影/SSE 同步给裁判、队长和观众',
  );
  const refereeConsole = fs.readFileSync(path.join(root, 'apps/multiplayer/src/ui/referee-console.js'), 'utf8');
  assert(
    refereeConsole.includes('function projectedHungryWaveBanner()')
    && refereeConsole.includes('Hexcore2.state.multiplayer.lastHungryWave')
    && refereeConsole.includes('海浪同步')
    && refereeConsole.includes('服务端权威'),
    '多人端 UI 应展示服务端同步的海浪摘要，刷新或 SSE 重连后仍能解释最近海浪结算',
  );
  const postgresSchema = fs.readFileSync(path.join(root, 'apps/server/postgres/schema.sql'), 'utf8');
  const postgresBackup = fs.readFileSync(path.join(root, 'scripts/postgres-backup.ps1'), 'utf8');
  const postgresRestore = fs.readFileSync(path.join(root, 'scripts/postgres-restore.ps1'), 'utf8');
  const postgresStore = fs.readFileSync(path.join(root, 'apps/server/postgres-store.js'), 'utf8');
  const multiplayerOpsDoc = fs.readFileSync(path.join(root, 'docs/17_多人端部署运维说明.md'), 'utf8');
  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  const compose = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');
  const dockerignore = fs.readFileSync(path.join(root, '.dockerignore'), 'utf8');
  const dockerEnv = fs.readFileSync(path.join(root, '.env.docker.example'), 'utf8');
  assert(
    postgresSchema.includes('CREATE TABLE IF NOT EXISTS hexcore_tournaments')
    && postgresSchema.includes('CREATE TABLE IF NOT EXISTS hexcore_room_access')
    && postgresSchema.includes('CREATE TABLE IF NOT EXISTS hexcore_sessions')
    && postgresSchema.includes('CREATE TABLE IF NOT EXISTS hexcore_events')
    && postgresSchema.includes('CREATE TABLE IF NOT EXISTS hexcore_audit_log')
    && postgresSchema.includes('CREATE TABLE IF NOT EXISTS hexcore_checkpoints')
    && postgresSchema.includes('session_json::TEXT NOT LIKE')
    && postgresSchema.includes('access_json::TEXT NOT LIKE')
    && postgresSchema.includes('access_json::TEXT NOT LIKE \'%"code":%\'')
    && postgresSchema.includes("'supervisor'")
    && postgresBackup.includes('$env:HEXCORE_POSTGRES_URL')
    && postgresBackup.includes('$env:PGDATABASE = $env:HEXCORE_POSTGRES_URL')
    && postgresBackup.includes('pg_dump')
    && !postgresBackup.includes('--dbname="$env:HEXCORE_POSTGRES_URL"')
    && postgresRestore.includes('$env:HEXCORE_POSTGRES_URL')
    && postgresRestore.includes('$env:PGDATABASE = $env:HEXCORE_POSTGRES_URL')
    && postgresRestore.includes('pg_restore')
    && !postgresRestore.includes('--dbname=$env:HEXCORE_POSTGRES_URL')
    && postgresStore.includes('class PostgresTournamentStore extends MemoryTournamentStore')
    && postgresStore.includes('static async create')
    && postgresStore.includes('await this.pool.query(schema)')
    && postgresStore.includes('const previous = this.tournaments.get(id)')
    && postgresStore.includes('this.tournaments.set(id, previous)')
    && postgresStore.includes('this.eventWatermarks.set(id, Math.max')
    && postgresStore.includes('this.publish(id, event, nextState)')
    && postgresStore.includes('crossInstanceEventPolling: true')
    && postgresStore.includes('HEXCORE_POSTGRES_EVENT_POLL_MS')
    && postgresStore.includes('this.eventWatermarks = new Map()')
    && postgresStore.includes('ensureEventPoller()')
    && postgresStore.includes('pollExternalEvents()')
    && postgresStore.includes('pollTournamentEvents(id)')
    && postgresStore.includes('WHERE e.tournament_id = $1 AND e.event_seq > $2')
    && postgresStore.includes('this.publish(id, event, state)')
    && postgresStore.includes('storageLabel()')
    && postgresStore.includes("return 'postgres'")
    && postgresStore.includes('session_token_hash')
    && postgresStore.includes('hashSecret(String(sessionToken || \'\'))')
    && postgresStore.includes('roomAccessSummary(access)')
    && server.includes('const postgresUrl = String(options.postgresUrl || process.env.HEXCORE_POSTGRES_URL || \'\').trim()')
    && server.includes('return PostgresTournamentStore.create')
    && server.includes('const storePromise = Promise.resolve(createTournamentStore(options))')
    && server.includes('const store = await storePromise')
    && server.includes('await store.getSessionBinding')
    && server.includes('await store.replaceTournament')
    && multiplayerOpsDoc.includes('HEXCORE_POSTGRES_URL')
    && multiplayerOpsDoc.includes('HEXCORE_POSTGRES_EVENT_POLL_MS')
    && multiplayerOpsDoc.includes('crossInstanceEventPolling')
    && multiplayerOpsDoc.includes('请求链路不能用阻塞式外部 `psql` 命令临时代替'),
    'PostgreSQL 正式持久化应提供异步 store 适配器、schema、备份/恢复脚本和安全部署说明，且不保存房间码或 sessionToken 明文',
  );
  assert(
    dockerfile.includes('FROM node:24-slim')
    && dockerfile.includes('npm ci --omit=dev')
    && dockerfile.includes('HEALTHCHECK')
    && dockerfile.includes('/health')
    && compose.includes('postgres:16-alpine')
    && compose.includes('HEXCORE_POSTGRES_PASSWORD:?')
    && compose.includes('HEXCORE_POSTGRES_URL: postgres://')
    && compose.includes('hexcore-postgres-data')
    && compose.includes('${HEXCORE_APP_PORT:-4186}:4186')
    && compose.includes('${HEXCORE_API_PORT:-4196}:4196')
    && dockerignore.includes('node_modules')
    && dockerignore.includes('.env')
    && dockerignore.includes('*.dump')
    && dockerEnv.includes('HEXCORE_POSTGRES_PASSWORD=change-this-local-password')
    && multiplayerOpsDoc.includes('Docker 本机演示')
    && multiplayerOpsDoc.includes('docker compose up -d --build')
    && multiplayerOpsDoc.includes('HEXCORE_POSTGRES_PASSWORD'),
    'Docker 部署应提供应用镜像、PostgreSQL Compose 编排、健康检查和不提交正式密码的环境变量示例',
  );
}

async function run() {
  const tests = [
    testDefaultEmptySetup,
    testResetLocalStateRendersEmptySetup,
    testReloadDoesNotAutoStartShop,
    testBootRecoveryDoesNotClearSavedState,
    testCampLockedSetup,
    testScoreFallbackDirectTier,
    testCampTeamLimitGuard,
    testCampLockedShop,
    testAssignmentHardGuards,
    testCampChecklistAllowsDraftedPlayers,
    testPurchasedShopCardIsMarked,
    testDraftRequiresStartButtonAndOriginSageNotice,
    testUndoRestoresShopPermissions,
    testFinalFillSameCamp,
    testPlayersUiAndImport,
    testFullTenTeamGoldShopFlow,
    testRenderKeepsPageScroll,
    testTeamIssueDetectionAndRepair,
    testGoldModeAllowsManualMoveBackToPool,
    testDissolveTeamsKeepsCaptainsAndHexcores,
    testDissolveTeamsReleasesCaptainsAndHexcores,
    testSystemIntegrityCheck,
    testSystemIntegrityCheckMatchesCurrentRules,
    testNavigationResetsPageScroll,
    testTurnContextShowsTeamAndCaptainNames,
    testNewHexcores,
    testHexcoreFiveDrawOneFlow,
    testDraftOrderFollowsHexcoreDrawOrder,
    testHexcoreCategoryClassification,
    testDraftRosterBoard,
    testHexTargetPickerExplainsInvalidTargets,
    testHexcoreGlobalUniquePool,
    testUiNavigationAndSecurity,
    testMultiplayerCopyIsolation,
    testMultiplayerSharedRulePreflight,
    testMultiplayerApiServer,
    testMultiplayerSessionExpiry,
    testRuleTemplateSaveAndLoad,
    testEventClickLocatesTargets,
    testRecoverDraftState,
    testTournamentByeAndBracketLinks,
    testTournamentScheduleRandomizesEntrants,
    testTournamentManualByeAndReorder,
    testTournamentReportsIncompleteTeamsBeforeMissingCamps,
    testBandleDefenseScheduleAndScoring,
    testBandleDefenseFinalBattle,
    testBandleDefenseDayLayoutStyles,
    testPostTaskIncompleteRetryLimit,
    testPostTaskExtractsOpenTableNextAction,
    testPostTaskIgnoresCompletedAcceptanceLanguage,
    testHexcoreLibraryResponsiveStyles,
    testThemeSafeModalsAndScrollbars,
    testHexcorePngIconAssets,
    testMultiplayerCaptainUiReusesRefereeScreensWithScopedAccess,
    testMultiplayerViewerUiIsReadonlyCurrentCaptainPerspective,
    testMultiplayerJoinGateAndCors,
    testMultiplayerClientSubmitsAuthoritativeCommands,
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
