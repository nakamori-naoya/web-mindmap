import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, statSync, createReadStream } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { MapStore, StoreError } from './store.ts';
import { rootDir, dataDir, port } from './config.ts';
import { handleApi, securityHeaders, validLocalRequest, apiError } from './api.ts';
import { acquireServerLock } from './lock.ts';

export async function start(development: boolean) {
  const serverPort = port(development ? 5173 : 4173);
  const releaseLock = acquireServerLock(dataDir);
  let store: MapStore;
  try { store = new MapStore(dataDir); } catch (error) { releaseLock(); throw error; }
  const vite = development ? await (await import('vite')).createServer({ root: rootDir, server: { middlewareMode: true, hmr: { port: serverPort + 1 } }, appType: 'spa' }) : undefined;
  const server = createServer(async (req, res) => {
    securityHeaders(res, development);
    try {
      validLocalRequest(req, serverPort);
      if (await handleApi(req, res, store)) return;
      if (vite) { vite.middlewares(req, res, () => { res.writeHead(404); res.end('Not found'); }); return; }
      serveStatic(req, res);
    } catch (error) { apiError(res, error); }
  });
  server.requestTimeout = 15_000; server.headersTimeout = 10_000;
  let closing = false;
  async function shutdown() {
    if (closing) return; closing = true;
    await new Promise<void>(resolve => server.close(() => resolve())); await vite?.close(); await store.close(); releaseLock();
  }
  server.on('error', async error => { console.error(error); await shutdown(); process.exitCode = 1; });
  process.once('SIGINT', () => { void shutdown(); }); process.once('SIGTERM', () => { void shutdown(); });
  server.listen(serverPort, process.env.MINDMAP_BIND_HOST === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1', () => console.log(`枝とことば: http://127.0.0.1:${serverPort}\nSQLite: ${store.databasePath}`));
  return { server, store, shutdown };
}
function serveStatic(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new StoreError(405, 'この操作は許可されていません。');
  const base = resolve(rootDir, 'dist');
  let pathname: string;
  try { pathname = decodeURIComponent(new URL(req.url || '/', 'http://127.0.0.1').pathname); }
  catch { throw new StoreError(400, 'URLが不正です。'); }
  let path = resolve(base, `.${pathname}`);
  if (path !== base && !path.startsWith(base + sep)) throw new StoreError(403, 'アクセスできません。');
  if (!existsSync(path) || statSync(path).isDirectory()) path = resolve(base, 'index.html');
  if (!existsSync(path)) throw new StoreError(503, '画面をビルドしてから起動してください。');
  const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };
  res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': extname(path) === '.html' ? 'no-cache' : 'public, max-age=3600' });
  if (req.method === 'HEAD') res.end(); else createReadStream(path).pipe(res);
}
