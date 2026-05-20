const fs = require('fs');
const http = require('http');
const path = require('path');

const root = path.resolve(__dirname, '..');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4176);

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
    const filePath = path.resolve(root, relativePath);
    const relativeToRoot = path.relative(root, filePath);
    if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) return null;
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
    console.log(`HEXCORE 2.0 已启动：http://${host}:${port}/`);
  });
}

module.exports = {
  createServer,
  resolveRequestPath,
  root,
};
