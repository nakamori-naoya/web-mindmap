import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { MapStore } from '../server/store.ts';
import { handleApi, securityHeaders, validLocalRequest, apiError } from '../server/api.ts';
import { createDocument } from '../src/domain/index.ts';

test('HTTP APIのCRUDとOrigin/Host/破損文書/上限を実接続で検証する', async () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'mindmap-api-')); const store = new MapStore(resolve(dir, 'data'));
  let serverPort = 0;
  const server = createServer(async (req, res) => {
    securityHeaders(res);
    try { validLocalRequest(req, serverPort); if (!await handleApi(req, res, store)) { res.writeHead(404); res.end(); } }
    catch (error) { apiError(res, error); }
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  serverPort = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${serverPort}`;
  const headers = { Origin: base, 'Content-Type': 'application/json' };
  try {
    assert.equal((await fetch(`${base}/api/maps`, { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' }, body: '{}' })).status, 403);
    assert.equal((await fetch(`${base}/api/maps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    const rejectedHost = await new Promise<number>(r => { const req = request(`${base}/api/maps`, { headers: { Host: 'evil.example' } }, res => { res.resume(); r(res.statusCode!); }); req.end(); }); assert.equal(rejectedHost, 403);
    const doc = createDocument('HTTPテスト');
    const created = await fetch(`${base}/api/maps`, { method: 'POST', headers, body: JSON.stringify(doc) }); assert.equal(created.status, 201);
    assert.ok(created.headers.get('content-security-policy')?.includes("object-src 'none'"));
    assert.deepEqual(await (await fetch(`${base}/api/maps/${doc.documentId}`)).json(), doc);
    doc.title = '編集済み'; const saved = await fetch(`${base}/api/maps/${doc.documentId}`, { method: 'PUT', headers, body: JSON.stringify(doc) }); assert.equal(saved.status, 200);
    const malformed = await fetch(`${base}/api/maps/${doc.documentId}`, { method: 'PUT', headers, body: '{' }); assert.equal(malformed.status, 400);
    const unsupported = await fetch(`${base}/api/maps/${doc.documentId}`, { method: 'PUT', headers, body: JSON.stringify({ ...doc, schemaVersion: 99 }) }); assert.equal(unsupported.status, 422);
    const tooBig = await fetch(`${base}/api/maps/${doc.documentId}`, { method: 'PUT', headers, body: JSON.stringify({ ...doc, extra: 'x'.repeat(10 * 1024 * 1024) }) }); assert.equal(tooBig.status, 413);
    assert.equal((await fetch(`${base}/api/maps/${doc.documentId}`, { method: 'DELETE', headers })).status, 204);
    assert.equal((await fetch(`${base}/api/maps/${doc.documentId}`)).status, 404);
    assert.equal((await (await fetch(`${base}/api/maps?trash=1`)).json()).length, 1);
    assert.equal((await fetch(`${base}/api/maps/${doc.documentId}/restore`, { method: 'POST', headers })).status, 200);
    assert.equal((await fetch(`${base}/api/maps/${doc.documentId}/snapshots`)).status, 200);
  } finally { await new Promise<void>((r, e) => server.close(error => error ? e(error) : r())); await store.close(); rmSync(dir, { recursive: true, force: true }); }
});
