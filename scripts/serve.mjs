import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const port = Number(option('--port', process.env.PORT || '5173'));
const host = option('--host', '0.0.0.0');
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)), option('--dir', '.'));
const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg',
  '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
};

const server = http.createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const segments = pathname.split('/').filter(Boolean);
    if (segments.some(segment => segment.startsWith('.'))) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    const requested = path.resolve(root, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname));
    if (requested !== root && !requested.startsWith(root + path.sep)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    const resolved = await realpath(requested);
    if (!resolved.startsWith(root + path.sep)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    const info = await stat(resolved);
    if (!info.isFile() || !mime[path.extname(resolved)]) {
      response.writeHead(404).end('Not found');
      return;
    }
    const headers = {
      'Content-Type': mime[path.extname(resolved)],
      'Content-Length': info.size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': resolved.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=3600' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    };
    // Audio players (especially Safari) request small byte ranges before playback.
    let start = 0;
    let end = info.size - 1;
    let status = 200;
    if (request.method === 'GET' && request.headers.range) {
      const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
      if (range && (range[1] || range[2])) {
        start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
        end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
      }
      if (!range || (!range[1] && !range[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) {
        response.writeHead(416, { 'Content-Range': `bytes */${info.size}` }).end();
        return;
      }
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
      headers['Content-Length'] = end - start + 1;
    }
    response.writeHead(status, headers);
    if (request.method === 'HEAD' || !info.size) response.end();
    else {
      const stream = createReadStream(resolved, { start, end });
      response.on('close', () => stream.destroy());
      stream.on('error', () => response.destroy()).pipe(response);
    }
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('没有找到这个页面');
  }
});
server.on('error', error => {
  console.error(`无法启动相册：${error.message}`);
  process.exitCode = 1;
});
server.listen(port, host, () => console.log(`相册已就绪 → http://localhost:${port}`));
