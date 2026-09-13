#!/usr/bin/env node
/**
 * Static SPA server used only by tools/probe-library-views.mjs.
 * Serves a built Angular bundle (dist/.../browser) with index.html fallback so
 * client-side routes such as /library resolve. Never used by the app runtime.
 *
 * Usage: node tools/probe-server.mjs <root-dir> <port>
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? '.');
const port = Number(process.argv[3] ?? 4317);
/** Optional read-only passthrough for /api (a live Nostos backend origin). */
const apiOrigin = process.argv[4] ? process.argv[4].replace(/\/+$/, '') : '';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
};

async function send(res, filePath, status = 200) {
  const body = await readFile(filePath);
  res.writeHead(status, {
    'Content-Type': TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
    'Content-Length': body.length,
  });
  res.end(body);
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    let target = path.join(root, decodeURIComponent(url.pathname));
    if (!target.startsWith(root)) return res.writeHead(403).end();

    try {
      const info = await stat(target);
      if (info.isDirectory()) target = path.join(target, 'index.html');
      if ((await stat(target)).isFile()) return await send(res, target);
    } catch {
      /* fall through to the SPA shell */
    }

    // API calls: proxy to a live backend when one was given, otherwise answer
    // with an empty JSON payload so the shell still boots and paints its chrome.
    if (url.pathname.startsWith('/api/')) {
      if (apiOrigin) {
        try {
          const upstream = await fetch(`${apiOrigin}${url.pathname}${url.search}`, {
            headers: { Accept: req.headers.accept ?? 'application/json' },
          });
          const buf = Buffer.from(await upstream.arrayBuffer());
          res.writeHead(upstream.status, {
            'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
            'Cache-Control': 'no-store',
            'Content-Length': buf.length,
          });
          return res.end(buf);
        } catch {
          /* fall through to the empty payload */
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ items: [], totalCount: 0 }));
    }

    await send(res, path.join(root, 'index.html'));
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(String(error));
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`probe server: http://127.0.0.1:${port} -> ${root}`);
});
