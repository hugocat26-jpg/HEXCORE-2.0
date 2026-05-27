const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const host = process.env.HOST || '127.0.0.1';
const appPort = String(process.env.MULTIPLAYER_APP_PORT || '4186');
const apiPort = String(process.env.MULTIPLAYER_API_PORT || '4196');

const children = [];

function start(label, script, extraEnv) {
  const child = spawn(process.execPath, [path.join(root, script)], {
    cwd: root,
    env: {
      ...process.env,
      HOST: host,
      ...extraEnv,
    },
    stdio: 'inherit',
    windowsHide: true,
  });
  children.push(child);
  child.on('exit', code => {
    if (code === 0 || process.exitCode) return;
    console.error(`${label} 已退出，退出码：${code}`);
    shutdown(1);
  });
  return child;
}

function shutdown(code = 0) {
  process.exitCode = code;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

start('多人端页面服务', 'scripts/serve-multiplayer.js', { MULTIPLAYER_APP_PORT: appPort, PORT: appPort });
start('多人端 API 服务', 'apps/server/server.js', { MULTIPLAYER_API_PORT: apiPort });

console.log(`HEXCORE 多人端页面：http://${host}:${appPort}/`);
console.log(`HEXCORE 多人端 API：http://${host}:${apiPort}/health`);
