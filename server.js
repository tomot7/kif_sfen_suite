const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT ? Number(process.env.PORT) : 4173;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.wasm': 'application/wasm',
  '.br': 'application/octet-stream',
  '.gz': 'application/octet-stream',
  '.txt': 'text/plain; charset=UTF-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function send(res, status, data, ext = '.txt') {
  res.writeHead(status, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'credentialless',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cache-Control': 'no-cache',
  });
  res.end(data);
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, 'Not Found');
    send(res, 200, data, path.extname(filePath));
  });
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let filePath = path.join(ROOT, urlPath);
  if (filePath.endsWith(path.sep)) filePath = path.join(filePath, 'index.html');

  fs.stat(filePath, (err, stats) => {
    if (!err && stats.isDirectory()) {
      serveFile(res, path.join(filePath, 'index.html'));
      return;
    }
    if (!err && stats.isFile()) {
      serveFile(res, filePath);
      return;
    }
    send(res, 404, 'Not Found');
  });
});

server.listen(PORT, () => {
  console.log(`Dev server running at http://localhost:${PORT}`);
});
