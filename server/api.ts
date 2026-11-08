import type { IncomingMessage, ServerResponse } from 'node:http';
import { MapStore, StoreError } from './store.ts';
import { ImageError, MAX_IMAGE_UPLOAD_BYTES, MAX_BACKUP_BYTES } from './images.ts';
const MAX_BYTES = 10 * 1024 * 1024;
async function readBytes(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const length = Number(req.headers['content-length']);
  if (Number.isFinite(length) && length > maxBytes) throw new StoreError(413, 'ファイルが取り込み上限を超えています。');
  return new Promise<Buffer>((resolve, reject) => {
    const parts: Buffer[] = []; let bytes = 0; let failed = false;
    req.on('data', (part: Buffer) => {
      if (failed) return;
      bytes += part.length;
      if (bytes > maxBytes) { failed = true; parts.length = 0; reject(new StoreError(413, 'ファイルが取り込み上限を超えています。')); }
      else parts.push(part);
    });
    req.on('end', () => { if (!failed) resolve(Buffer.concat(parts)); });
    req.on('error', () => { if (!failed) { failed = true; reject(new StoreError(400, '読み込み中に通信が切れました。')); } });
    req.on('aborted', () => { if (!failed) { failed = true; reject(new StoreError(400, '読み込みが中断されました。')); } });
  });
}
async function readJSONText(req: IncomingMessage, maxBytes = MAX_BYTES): Promise<string> {
  if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new StoreError(415, 'Content-Typeはapplication/jsonを指定してください。');
  return (await readBytes(req, maxBytes)).toString('utf8');
}
export async function readBody(req: IncomingMessage): Promise<unknown> {
  const text = await readJSONText(req);
  try { return JSON.parse(text); } catch { throw new StoreError(400, 'JSONが壊れています。'); }
}
export function json(res: ServerResponse, status: number, value?: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(value === undefined ? undefined : JSON.stringify(value));
}
export function securityHeaders(res: ServerResponse, development = false) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'${development ? " 'unsafe-inline'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'${development ? ' ws://127.0.0.1:* ws://localhost:*' : ''}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
}
export function validLocalRequest(req: IncomingMessage, expectedPort: number) {
  const allowed = [`127.0.0.1:${expectedPort}`, `localhost:${expectedPort}`];
  const host = req.headers.host;
  if (!host || !allowed.includes(host)) throw new StoreError(403, 'ローカルの正しい接続先から開いてください。');
  const origin = req.headers.origin;
  if (origin && origin !== `http://${host}`) throw new StoreError(403, '同一オリジン以外のリクエストを拒否しました。');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method || '') && origin !== `http://${host}`) throw new StoreError(403, '更新には同一オリジンのOriginが必要です。');
  if (req.headers['sec-fetch-site'] === 'cross-site') throw new StoreError(403, '外部サイトからのリクエストを拒否しました。');
}
export async function handleApi(req: IncomingMessage, res: ServerResponse, store: MapStore): Promise<boolean> {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (!url.pathname.startsWith('/api/')) return false;
  try {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[1] === 'health' && req.method === 'GET') { json(res, 200, { ok: true }); return true; }
    if (parts[1] !== 'maps') throw new StoreError(404, 'APIが見つかりません。');
    const id = parts[2]; const action = parts[3]; const snapshotId = parts[4];
    if (parts.length > 6 || parts.some(part => !part || part.includes('\\') || part === '.' || part === '..')) throw new StoreError(404, 'APIが見つかりません。');
    if (id === 'import' && !action && req.method === 'POST') json(res, 201, await store.importBackup(await readJSONText(req, MAX_BACKUP_BYTES)));
    else if (id && action === 'images' && !parts[4] && req.method === 'POST') {
      const contentType = req.headers['content-type'] || '';
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(contentType.split(';')[0].trim().toLowerCase())) throw new ImageError(415, '画像はPNG・JPEG・WebPの静止画を選んでください。');
      json(res, 201, await store.uploadImage(id, await readBytes(req, MAX_IMAGE_UPLOAD_BYTES), contentType));
    }
    else if (id && action === 'images' && !parts[4] && req.method === 'GET') json(res, 200, store.imageMetadata(id));
    else if (id && action === 'images' && parts[4] && !parts[5] && req.method === 'GET') {
      const image = store.image(id, parts[4]);
      res.writeHead(200, { 'Content-Type': 'image/webp', 'Content-Length': Number(image.byteSize), 'Cache-Control': 'no-store', 'Content-Disposition': `inline; filename="${image.id}.webp"` });
      res.end(image.data as Uint8Array);
    }
    else if (id && action === 'backup' && !parts[4] && req.method === 'GET') json(res, 200, store.exportBackup(id));
    else if (!id && req.method === 'GET') json(res, 200, store.list(url.searchParams.get('trash') === '1'));
    else if (!id && req.method === 'POST') json(res, 201, await store.create(await readBody(req)));
    else if (id && !action && req.method === 'GET') json(res, 200, store.get(id, url.searchParams.get('trash') === '1'));
    else if (id && !action && req.method === 'PUT') json(res, 200, await store.save(id, await readBody(req)));
    else if (id && !action && req.method === 'DELETE') { store.trash(id); json(res, 204); }
    else if (id && action === 'restore' && req.method === 'POST') json(res, 200, store.restoreMap(id));
    else if (id && action === 'permanent' && req.method === 'DELETE') {
      const body = await readBody(req) as { confirmation?: unknown }; store.permanentDelete(id, body?.confirmation); json(res, 204);
    }
    else if (id && action === 'snapshots' && !snapshotId && req.method === 'GET') json(res, 200, store.snapshots(id));
    else if (id && action === 'snapshots' && snapshotId && !parts[5] && req.method === 'GET') json(res, 200, store.snapshot(id, snapshotId));
    else if (id && action === 'snapshots' && snapshotId && parts[5] === 'restore' && req.method === 'POST') json(res, 200, await store.restoreSnapshot(id, snapshotId));
    else throw new StoreError(404, '操作が見つかりません。');
  } catch (error) { apiError(res, error); }
  return true;
}
export function apiError(res: ServerResponse, error: unknown) {
  if (res.headersSent || res.destroyed) return;
  if (error instanceof StoreError || error instanceof ImageError) json(res, error.status, { error: error.message });
  else { console.error(error); json(res, 503, { error: '保存または読み込みに失敗しました。未保存の内容をJSONで退避してから再試行してください。' }); }
}
