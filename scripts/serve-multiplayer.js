const fs = require('fs');
const http = require('http');
const path = require('path');

const root = path.resolve(__dirname, '..');
const localAppRoot = path.resolve(root, 'apps', 'multiplayer');
const defaultExternalAppRoot = path.resolve('E:\\only_why\\HEXCORE2.0\\multiplayer');
const configuredAppRoot = process.env.MULTIPLAYER_APP_ROOT
  ? path.resolve(process.env.MULTIPLAYER_APP_ROOT)
  : defaultExternalAppRoot;
const appRoot = fs.existsSync(configuredAppRoot) ? configuredAppRoot : localAppRoot;
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4186);

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function resolveRequestPath(url) {
  try {
    const parsed = new URL(url, `http://${host}:${port}`);
    const pathname = decodeURIComponent(parsed.pathname);
    const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
    const normalizedRelativePath = relativePath.replace(/\\/g, '/');
    const filePath = path.resolve(appRoot, normalizedRelativePath);
    const relativeToApp = path.relative(appRoot, filePath);
    if (relativeToApp.startsWith('..') || path.isAbsolute(relativeToApp)) return null;
    const relativeForPolicy = relativeToApp.replace(/\\/g, '/');
    const allowed = relativeForPolicy === 'index.html'
      || relativeForPolicy.startsWith('src/')
      || relativeForPolicy.startsWith('assets/');
    if (!allowed) return null;
    return filePath;
  } catch (error) {
    return null;
  }
}

function createServer() {
  return http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(res, 405, 'method not allowed');
      return;
    }

    const filePath = resolveRequestPath(req.url);
    if (!filePath) {
      send(res, 403, 'forbidden');
      return;
    }

    fs.readFile(filePath, (error, buffer) => {
      if (error) {
        send(res, 404, 'not found');
        return;
      }

      res.writeHead(200, {
        'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      res.end(buffer);
    });
  });
}

if (require.main === module) {
  const server = createServer();
  server.listen(port, host, () => {
    console.log(`HEXCORE 2.0 多人端副本已启动：http://${host}:${port}/`);
  });
}

module.exports = {
  appRoot,
  createServer,
  resolveRequestPath,
  root,
};
