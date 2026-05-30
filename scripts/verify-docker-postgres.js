const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { COMMAND_TYPES } = require('../packages/shared');

const root = path.resolve(__dirname, '..');
const args = new Set(process.argv.slice(2));
const keepRunning = args.has('--keep-running');
const skipRestore = args.has('--skip-restore');
const noBuild = args.has('--no-build');

function log(message) {
  console.log(`[M13 Docker 验收] ${message}`);
}

function fail(message) {
  throw new Error(message);
}

function randomSecret() {
  return crypto.randomBytes(32).toString('base64url');
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const result = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if (!match) continue;
    result[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return result;
}

function writeUtf8NoBom(filePath, content) {
  fs.writeFileSync(filePath, content, { encoding: 'utf8' });
}

function replaceOrAppendEnvValue(content, key, value) {
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  if (pattern.test(content)) return content.replace(pattern, `${key}=${value}`);
  return `${content.trimEnd()}\n${key}=${value}\n`;
}

function ensureEnvFile() {
  const envPath = path.join(root, '.env');
  const examplePath = path.join(root, '.env.example');
  if (!fs.existsSync(envPath)) {
    if (!fs.existsSync(examplePath)) fail('缺少 .env.example，无法生成 Docker 验收环境。');
    let content = fs.readFileSync(examplePath, 'utf8');
    content = replaceOrAppendEnvValue(content, 'HEXCORE_POSTGRES_PASSWORD', randomSecret());
    content = replaceOrAppendEnvValue(content, 'HEXCORE_ROOM_CODE_SECRET', randomSecret());
    writeUtf8NoBom(envPath, content);
    log('已从 .env.example 生成本机 .env，本机密钥未输出。');
  }
  let env = readEnvFile(envPath);
  if (!env.HEXCORE_POSTGRES_PASSWORD || env.HEXCORE_POSTGRES_PASSWORD === 'change-this-local-password') {
    fail('.env 中的 HEXCORE_POSTGRES_PASSWORD 仍为空或默认值，请先设置随机强密码。');
  }
  if (!env.HEXCORE_ROOM_CODE_SECRET || env.HEXCORE_ROOM_CODE_SECRET === 'change-this-local-room-code-secret') {
    const content = replaceOrAppendEnvValue(fs.readFileSync(envPath, 'utf8'), 'HEXCORE_ROOM_CODE_SECRET', randomSecret());
    writeUtf8NoBom(envPath, content);
    env = readEnvFile(envPath);
    log('已为本机 .env 补充随机房间码加密密钥。');
  }
  return env;
}

function run(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: root,
      env: { ...process.env, ...(options.env || {}) },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', code => {
      const out = Buffer.concat(stdout);
      const err = Buffer.concat(stderr);
      if (code !== 0) {
        const error = new Error(`${command} ${commandArgs.join(' ')} 执行失败，退出码：${code}\n${err.toString('utf8')}`);
        error.stdout = out;
        error.stderr = err;
        reject(error);
        return;
      }
      resolve({ stdout: out, stderr: err });
    });
    if (options.input) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

async function docker(commandArgs, options = {}) {
  log(`docker ${commandArgs.join(' ')}`);
  return run('docker', commandArgs, options);
}

function apiBase(env) {
  return `http://127.0.0.1:${env.HEXCORE_API_PORT || '4196'}`;
}

function appBase(env) {
  return `http://127.0.0.1:${env.HEXCORE_APP_PORT || '4186'}`;
}

async function requestJson(env, method, pathname, body, headers = {}) {
  const response = await fetch(`${apiBase(env)}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: typeof body === 'undefined' ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch (error) {
    fail(`${method} ${pathname} 返回非 JSON：${text.slice(0, 200)}`);
  }
  return { status: response.status, body: payload, text };
}

async function waitHealth(env, expectedStorage = 'postgres') {
  const deadline = Date.now() + 120000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const health = await requestJson(env, 'GET', '/health');
      const healthText = JSON.stringify(health.body);
      if (health.status === 200 && health.body.ok && health.body.runtime && health.body.runtime.storage === expectedStorage) {
        if (healthText.includes('postgres://') || healthText.includes(env.HEXCORE_POSTGRES_PASSWORD)) {
          fail('/health 泄漏了连接串或数据库密码。');
        }
        return health.body;
      }
      lastError = new Error(`health storage=${health.body.runtime && health.body.runtime.storage}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw lastError || new Error('等待 /health 超时。');
}

function createSseClient(env, pathname) {
  const http = require('http');
  const url = new URL(`${apiBase(env)}${pathname}`);
  let buffer = '';
  const waiters = [];
  const req = http.request(url, { method: 'GET', headers: { Accept: 'text/event-stream' } });
  req.on('response', res => {
    res.setEncoding('utf8');
    res.on('data', chunk => {
      buffer += chunk;
      for (const waiter of [...waiters]) {
        if (buffer.includes(waiter.pattern)) {
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.resolve(buffer);
        }
      }
    });
  });
  req.on('error', error => {
    for (const waiter of waiters.splice(0)) waiter.reject(error);
  });
  req.end();
  return {
    waitFor(pattern, timeoutMs = 30000) {
      if (buffer.includes(pattern)) return Promise.resolve(buffer);
      return new Promise((resolve, reject) => {
        const waiter = { pattern, resolve, reject };
        waiters.push(waiter);
        setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error(`SSE 等待 ${pattern} 超时。当前内容：${buffer.slice(0, 400)}`));
        }, timeoutMs);
      });
    },
    close() {
      req.destroy();
    },
  };
}

function buildPlayers() {
  return Array.from({ length: 36 }, (_, index) => ({
    id: `m13-player-${index + 1}`,
    name: `M13验收选手${index + 1}`,
    gameId: `M13_${index + 1}`,
    camp: index % 3 === 0 ? '' : (index % 3 === 1 ? 'local' : 'outsider'),
    tier: (index % 5) + 1,
    score: 80 + index,
    status: 'available',
    heroes: ['奥恩', '蔚', '发条'],
  }));
}

function buildTeams(suffix) {
  return Array.from({ length: 12 }, (_, index) => ({
    teamId: `team-${index + 1}`,
    name: `M13验收${index + 1}队`,
    camp: '',
    code: `m13-cap-${index + 1}-${suffix}`,
    economy: { gold: 12 },
  }));
}

async function createRoom(env, suffix) {
  const tournamentId = `m13-e2e-${suffix}`;
  const created = await requestJson(env, 'POST', '/api/tournaments', {
    id: tournamentId,
    name: 'M13 Docker PostgreSQL 验收',
    actorId: 'm13-referee',
    settings: {
      teamCount: 12,
      totalTeams: 12,
      playersPerTeam: 5,
      campMode: 'no_camp',
      pairingMode: 'random',
      initialGold: 12,
      refreshCosts: [1, 2, 3, 4],
    },
    teams: buildTeams(suffix),
    players: buildPlayers(),
    viewerCode: `m13-view-${suffix}`,
  });
  if (created.status !== 201) fail(`创建 12 队无阵营房间失败：${created.text}`);
  const snapshot = created.body.tournament.snapshot;
  if (!snapshot || snapshot.teams.length !== 12 || snapshot.settings.campMode !== 'no_camp') {
    fail('创建房间后服务端快照未保持 12 队无阵营规则。');
  }
  return { tournamentId, created };
}

async function joinRoom(env, tournamentId, code, displayName) {
  const joined = await requestJson(env, 'POST', `/api/tournaments/${encodeURIComponent(tournamentId)}/join`, {
    code,
    displayName,
  });
  if (joined.status !== 200 || !joined.body.session || !joined.body.session.sessionToken) {
    fail(`加入房间失败：${joined.text}`);
  }
  return joined.body.session;
}

async function submitCommand(env, tournamentId, sessionToken, command) {
  const response = await requestJson(env, 'POST', `/api/tournaments/${encodeURIComponent(tournamentId)}/commands`, {
    sessionToken,
    command,
  });
  if (response.status !== 200) fail(`提交 command 失败：${response.text}`);
  return response.body;
}

async function verifyCoreFlow(env) {
  const suffix = crypto.randomBytes(5).toString('hex');
  const { tournamentId, created } = await createRoom(env, suffix);
  const captainCode = created.body.room.captainCodes[0].code;
  const captainTeamId = created.body.room.captainCodes[0].teamId;
  const referee = await joinRoom(env, tournamentId, created.body.room.refereeCode, 'M13裁判');
  const captain = await joinRoom(env, tournamentId, captainCode, 'M13队长');
  const viewer = await joinRoom(env, tournamentId, created.body.room.viewerCode, 'M13观众');
  if (captain.teamId !== captainTeamId) fail('队长 session 未绑定目标队伍。');

  const streamToken = await requestJson(env, 'POST', `/api/tournaments/${encodeURIComponent(tournamentId)}/stream-token`, {
    sessionToken: captain.sessionToken,
  });
  if (streamToken.status !== 200 || !String(streamToken.body.streamToken || '').startsWith('stream_')) {
    fail('未能换取队长 SSE 短期凭据。');
  }
  const sse = createSseClient(env, `/api/tournaments/${encodeURIComponent(tournamentId)}/events?view=captain&streamToken=${encodeURIComponent(streamToken.body.streamToken)}`);
  await sse.waitFor('event: snapshot');

  const opened = await submitCommand(env, tournamentId, captain.sessionToken, {
    commandId: `m13-open-${suffix}`,
    type: COMMAND_TYPES.OPEN_SHOP,
    baseVersion: 1,
    payload: { teamId: captainTeamId, round: 1 },
  });
  await sse.waitFor('event: ShopOpened');
  const cards = opened.tournament.snapshot.currentShop.cards;
  if (!Array.isArray(cards) || cards.length !== 5) fail('服务端开店后未生成 5 张商店卡。');

  const purchased = await submitCommand(env, tournamentId, captain.sessionToken, {
    commandId: `m13-purchase-${suffix}`,
    type: COMMAND_TYPES.PURCHASE_SHOP_CARD,
    baseVersion: opened.tournament.stateVersion,
    payload: { teamId: captainTeamId, slotId: cards[0].slotId },
  });
  if (!purchased.tournament.snapshot.teams[0].team.includes(cards[0].playerId)) {
    fail('购买后选手未进入队伍。');
  }

  const skipped = await submitCommand(env, tournamentId, captain.sessionToken, {
    commandId: `m13-skip-${suffix}`,
    type: COMMAND_TYPES.SKIP_TURN,
    baseVersion: purchased.tournament.stateVersion,
    payload: { teamId: captainTeamId, round: 1 },
  });
  if (!skipped.event || skipped.event.type !== 'TurnSkipped') fail('跳过操作未生成 TurnSkipped 事件。');
  sse.close();

  const viewerProjection = await requestJson(env, 'GET', `/api/tournaments/${encodeURIComponent(tournamentId)}/projection?view=viewer&sessionToken=${encodeURIComponent(viewer.sessionToken)}`);
  if (viewerProjection.status !== 200 || viewerProjection.text.includes(referee.sessionToken) || viewerProjection.text.includes(captain.sessionToken)) {
    fail('观众投影异常或泄漏 sessionToken。');
  }

  return { tournamentId, refereeToken: referee.sessionToken, stateVersion: skipped.tournament.stateVersion };
}

async function verifyRestartRecovery(env, context) {
  await docker(['compose', 'restart', 'hexcore']);
  await waitHealth(env);
  const projection = await requestJson(env, 'GET', `/api/tournaments/${encodeURIComponent(context.tournamentId)}/projection?view=referee&sessionToken=${encodeURIComponent(context.refereeToken)}`);
  if (projection.status !== 200 || projection.body.tournament.stateVersion < context.stateVersion) {
    fail('容器重启后未恢复房间、session 或赛事状态。');
  }
}

async function backupPostgres(targetPath) {
  const result = await docker([
    'compose',
    'exec',
    '-T',
    'postgres',
    'sh',
    '-c',
    'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-acl',
  ]);
  if (!result.stdout.length) fail('PostgreSQL 备份结果为空。');
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, result.stdout);
}

async function restorePostgres(sourcePath) {
  const dump = fs.readFileSync(sourcePath);
  await docker(['compose', 'stop', 'hexcore']);
  await docker([
    'compose',
    'exec',
    '-T',
    'postgres',
    'sh',
    '-c',
    'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore --clean --if-exists -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl',
  ], { input: dump });
  await docker(['compose', 'up', '-d', 'hexcore']);
}

async function verifyBackupRestore(env, context) {
  if (skipRestore) {
    log('已按参数跳过备份/恢复验收。');
    return;
  }
  const backupPath = path.join(root, 'tmp', `m13-postgres-${Date.now()}.dump`);
  await backupPostgres(backupPath);
  log(`PostgreSQL 备份已生成：${backupPath}`);

  const markerId = `m13-after-backup-${Date.now()}`;
  const marker = await requestJson(env, 'POST', '/api/tournaments', {
    id: markerId,
    name: 'M13 恢复校验临时房间',
    actorId: 'm13-marker',
    settings: { teamCount: 6, campMode: 'no_camp' },
  });
  if (marker.status !== 201) fail(`创建恢复校验临时房间失败：${marker.text}`);

  await restorePostgres(backupPath);
  await waitHealth(env);
  const rooms = await requestJson(env, 'GET', '/api/tournaments');
  const roomIds = Array.isArray(rooms.body.rooms) ? rooms.body.rooms.map(room => room.tournamentId) : [];
  if (!roomIds.includes(context.tournamentId)) fail('恢复后原验收房间不存在。');
  if (roomIds.includes(markerId)) fail('恢复后备份之后创建的临时房间仍然存在，说明恢复未生效。');
}

async function main() {
  const env = ensureEnvFile();
  log(`页面地址：${appBase(env)}`);
  log(`API 地址：${apiBase(env)}`);

  await docker(['--version']);
  await docker(['compose', 'version']);
  await docker(['compose', 'config']);
  await docker(['compose', 'up', '-d', ...(noBuild ? [] : ['--build'])]);
  await docker(['compose', 'ps']);
  const health = await waitHealth(env);
  log(`健康检查通过，storage=${health.runtime.storage}。`);

  const context = await verifyCoreFlow(env);
  log('创建房间、三端加入、开店、购买、跳过和 SSE 同步通过。');
  await verifyRestartRecovery(env, context);
  log('容器重启恢复通过。');
  await verifyBackupRestore(env, context);
  log('PostgreSQL 备份/恢复通过。');

  if (!keepRunning) {
    log('验收完成，保留容器运行。需要停止时执行 docker compose down。');
  }
  log('M13 Docker PostgreSQL 自动验收通过。');
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
