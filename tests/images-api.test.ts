import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { DatabaseSync } from 'node:sqlite';
import { MapStore, verifyBackup } from '../server/store.ts';
import { handleApi, securityHeaders, validLocalRequest, apiError } from '../server/api.ts';
import { createDocument, executeCommand, validateDocument } from '../src/domain/index.ts';
import { deflateSync } from 'node:zlib';
import { rootDir } from '../server/config.ts';

async function fixture(run: (context: { store: MapStore; base: string; dir: string; dataDir: string }) => Promise<void>) {
  const dir = mkdtempSync(resolve(tmpdir(), 'mindmap-images-'));
  const dataDir = resolve(dir, 'data');
  const store = new MapStore(dataDir);
  let port = 0;
  const server = createServer(async (req, res) => {
    securityHeaders(res);
    try { validLocalRequest(req, port); if (!await handleApi(req, res, store)) { res.writeHead(404); res.end(); } }
    catch (error) { apiError(res, error); }
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  port = (server.address() as { port: number }).port;
  try { await run({ store, base: `http://127.0.0.1:${port}`, dir, dataDir }); }
  finally { await new Promise<void>(r => server.close(() => r())); if (store.db.isOpen) await store.close(); rmSync(dir, { recursive: true, force: true }); }
}
const source = () => sharp({ create: { width: 80, height: 50, channels: 4, background: '#69b4ff' } }).png().toBuffer();
const jsonHeaders = (base: string) => ({ Origin: base, 'Content-Type': 'application/json' });
async function create(base: string, title: string) {
  const document = createDocument(title);
  assert.equal((await fetch(`${base}/api/maps`, { method: 'POST', headers: jsonHeaders(base), body: JSON.stringify(document) })).status, 201);
  return document;
}
async function upload(base: string, mapId: string, data: Buffer, mime = 'image/png') {
  return fetch(`${base}/api/maps/${mapId}/images`, { method: 'POST', headers: { Origin: base, 'Content-Type': mime }, body: new Uint8Array(data) });
}
function attach(document: any, asset: any) {
  document.schemaVersion = 2;
  const { id, ...metadata } = asset;
  document.imageAssets = { [id]: metadata };
  document.nodes[document.rootId].images = [id];
}

test('画像実体をSQLiteへ取り込み、元パスなしで参照・削除Undo・snapshot・map所有を守る', async () => fixture(async ({ store, base }) => {
  const document = await create(base, '画像のあるマップ');
  const image = await source();
  const response = await upload(base, document.documentId, image);
  assert.equal(response.status, 201);
  const asset: any = await response.json();
  assert.deepEqual(Object.keys(asset).sort(), ['byteSize', 'height', 'id', 'mime', 'width']);
  assert.equal(asset.mime, 'image/webp'); assert.equal(asset.width, 80); assert.equal(asset.height, 50);
  const duplicate: any = await (await upload(base, document.documentId, image)).json(); assert.equal(duplicate.id, asset.id);
  attach(document, asset);
  assert.equal((await fetch(`${base}/api/maps/${document.documentId}`, { method: 'PUT', headers: jsonHeaders(base), body: JSON.stringify(document) })).status, 200);
  const binary = await fetch(`${base}/api/maps/${document.documentId}/images/${asset.id}`);
  assert.equal(binary.status, 200); assert.equal(binary.headers.get('content-type'), 'image/webp'); assert.equal(binary.headers.get('cache-control'), 'no-store');
  const stored = Buffer.from(await binary.arrayBuffer()); assert.equal(stored.length, asset.byteSize);
  const other = await create(base, '他のマップ');
  assert.equal((await fetch(`${base}/api/maps/${other.documentId}/images/${asset.id}`)).status, 404);
  const missing = structuredClone(document) as any; missing.nodes[missing.rootId].images = [crypto.randomUUID()];
  assert.equal((await fetch(`${base}/api/maps/${document.documentId}`, { method: 'PUT', headers: jsonHeaders(base), body: JSON.stringify(missing) })).status, 422);
  const removed = executeCommand(document, { type: 'DetachImage', id: document.rootId, assetId: asset.id });
  assert.equal((await fetch(`${base}/api/maps/${document.documentId}`, { method: 'PUT', headers: jsonHeaders(base), body: JSON.stringify(removed) })).status, 200);
  assert.equal((await fetch(`${base}/api/maps/${document.documentId}/images/${asset.id}`)).status, 200);
  const emptyBackup: any = store.exportBackup(document.documentId);
  assert.equal(emptyBackup.assets.length, 0); assert.equal(emptyBackup.document.imageAssets, undefined);
  assert.equal((await fetch(`${base}/api/maps/import`, { method: 'POST', headers: jsonHeaders(base), body: JSON.stringify(emptyBackup) })).status, 201);
  assert.equal((await fetch(`${base}/api/maps/${document.documentId}`, { method: 'PUT', headers: jsonHeaders(base), body: JSON.stringify(document) })).status, 200);
  const snapshots: any[] = await (await fetch(`${base}/api/maps/${document.documentId}/snapshots`)).json();
  const withImage = snapshots.find(s => store.snapshot(document.documentId, s.id).nodes[document.rootId].images?.includes(asset.id));
  assert.ok(withImage); await store.restoreSnapshot(document.documentId, withImage.id);
  assert.deepEqual(store.get(document.documentId), document);
  store.trash(document.documentId); assert.equal((await fetch(`${base}/api/maps/${document.documentId}/images/${asset.id}`)).status, 200);
  store.restoreMap(document.documentId); assert.deepEqual(store.get(document.documentId), document);
  store.trash(document.documentId); store.permanentDelete(document.documentId, document.title);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM image_assets WHERE map_id=?').get(document.documentId)?.count, 0);
}));

test('偽装・SVG・アニメーション・巨大寸法・巨大本文・他originを画像として保存しない', async () => fixture(async ({ store, base }) => {
  const document = await create(base, '入力の拒否');
  assert.equal((await upload(base, document.documentId, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml')).status, 415);
  assert.equal((await upload(base, document.documentId, Buffer.from('not-an-image'))).status, 422);
  const disguisedSVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><image href="file:///synthetic/not-opened.png"/></svg>');
  assert.equal((await upload(base, document.documentId, disguisedSVG, 'image/png')).status, 422);
  assert.equal((await upload(base, document.documentId, await source(), 'image/jpeg')).status, 415);
  const pixels = Buffer.concat([Buffer.from([255,0,0,255,255,0,0,255,255,0,0,255,255,0,0,255]), Buffer.from([0,0,255,255,0,0,255,255,0,0,255,255,0,0,255,255])]);
  const animated = await sharp(pixels, { raw: { width: 2, height: 4, channels: 4, pageHeight: 2 } }).webp({ loop: 0, delay: [100, 100], lossless: true }).toBuffer();
  assert.equal((await upload(base, document.documentId, animated, 'image/webp')).status, 415);
  assert.equal((await fetch(`${base}/api/maps/${document.documentId}/images/%2e%2e%2fetc%2fpasswd`)).status, 404);
  assert.equal((await fetch(`${base}/api/maps/${document.documentId}/images`, { method: 'POST', headers: jsonHeaders(base), body: JSON.stringify({ path: '/private/tmp/synthetic-do-not-open.png' }) })).status, 415);
  const huge = await sharp({ create: { width: 6000, height: 5000, channels: 3, background: 'white' } }).png().toBuffer();
  assert.equal((await upload(base, document.documentId, huge)).status, 413);
  assert.equal((await upload(base, document.documentId, Buffer.alloc(10 * 1024 * 1024 + 1))).status, 413);
  assert.equal((await fetch(`${base}/api/maps/${document.documentId}/images`, { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'image/png' }, body: new Uint8Array(await source()) })).status, 403);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM image_assets').get()?.count, 0);
}));

test('画像付きJSONbundleをID再生成で新規取込みし、破損や画像欠落はatomicに拒否する', async () => fixture(async ({ store, base }) => {
  const document = await create(base, 'JSON往復');
  const response = await upload(base, document.documentId, await source()); assert.equal(response.status, 201);
  const asset: any = await response.json(); attach(document, asset); await store.save(document.documentId, document);
  const exported = await fetch(`${base}/api/maps/${document.documentId}/backup`); assert.equal(exported.status, 200);
  const bundle: any = await exported.json(); assert.equal(bundle.format, 'mindmap-backup'); assert.equal(bundle.assets.length, 1);
  const imported = await fetch(`${base}/api/maps/import`, { method: 'POST', headers: jsonHeaders(base), body: JSON.stringify(bundle) }); assert.equal(imported.status, 201);
  const fresh: any = await imported.json(); assert.notEqual(fresh.documentId, document.documentId); assert.notEqual(fresh.rootId, document.rootId);
  assert.notEqual(fresh.nodes[fresh.rootId].images[0], asset.id); assert.equal(fresh.nodes[fresh.rootId].text, document.nodes[document.rootId].text);
  const freshImage = await fetch(`${base}/api/maps/${fresh.documentId}/images/${fresh.nodes[fresh.rootId].images[0]}`); assert.equal(freshImage.status, 200);
  const before = store.list().length;
  for (const damage of [(b: any) => b.assets = [], (b: any) => b.assets[0].dataBase64 = 'corrupted', (b: any) => b.assets[0].width++]) {
    const bad = structuredClone(bundle); damage(bad);
    assert.equal((await fetch(`${base}/api/maps/import`, { method: 'POST', headers: jsonHeaders(base), body: JSON.stringify(bad) })).status, 422);
    assert.equal(store.list().length, before);
  }
}));

test('SQLiteバックアップの実リストアで画像BLOBと画像参照を一緒に復元する', async () => fixture(async ({ store, base, dir, dataDir }) => {
  const document = await create(base, '画像復元');
  const response = await upload(base, document.documentId, await source()); assert.equal(response.status, 201);
  const asset: any = await response.json(); attach(document, asset); await store.save(document.documentId, document);
  const original: any = store.db.prepare('SELECT data FROM image_assets WHERE id=?').get(asset.id);
  const destination = resolve(dir, 'images.sqlite'); await store.backupTo(destination); verifyBackup(destination); await store.close();
  execFileSync(process.execPath, [resolve(rootDir, 'node_modules/tsx/dist/cli.mjs'), resolve(rootDir, 'scripts/restore.ts'), destination, '--confirm'], { env: { ...process.env, MINDMAP_DATA_DIR: dataDir }, stdio: 'pipe' });
  const restored = new MapStore(dataDir);
  try { assert.deepEqual(restored.get(document.documentId), document); assert.deepEqual(restored.db.prepare('SELECT data FROM image_assets WHERE id=?').get(asset.id)?.data, original.data); }
  finally { await restored.close(); }
}));

test('画像の正規化で原本metadataを除去し、長辺縮小・保存済み破損検知を行う', async () => fixture(async ({ store, base, dir }) => {
  const document = await create(base, '正規化');
  const input = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: '#2468ac' } }).withExif({ IFD0: { Copyright: 'SYNTHETIC-METADATA-NOT-PRESERVED' } }).jpeg().toBuffer();
  const result = await upload(base, document.documentId, input, 'image/jpeg'); assert.equal(result.status, 201);
  const asset: any = await result.json(); assert.equal(asset.width, 2048); assert.equal(asset.height, 1024);
  const binary = Buffer.from(await (await fetch(`${base}/api/maps/${document.documentId}/images/${asset.id}`)).arrayBuffer());
  const metadata = await sharp(binary).metadata(); assert.equal(metadata.exif, undefined); assert.equal(metadata.xmp, undefined); assert.equal(metadata.icc, undefined);
  attach(document, asset); await store.save(document.documentId, document);
  const backup = resolve(dir, 'valid-images.sqlite'); await store.backupTo(backup); verifyBackup(backup);
  store.db.prepare('UPDATE image_assets SET data=? WHERE id=?').run(Buffer.alloc(binary.length, 0), asset.id);
  assert.throws(() => store.checkIntegrity(), /画像に破損/);
}));

test('未使用画像も保持上限へ計上し、上限後の同画像再利用は許可する', async () => fixture(async ({ store, base }) => {
  const document = await create(base, '上限'); let first: Buffer | undefined; let firstId = '';
  for (let index = 0; index < 200; index++) {
    const input = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: index, g: 40, b: 80 } } }).png().toBuffer();
    const response = await upload(base, document.documentId, input); assert.equal(response.status, 201);
    if (!first) { first = input; firstId = (await response.json() as any).id; }
  }
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM image_assets').get()?.count, 200);
  const extra = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffff00' } }).png().toBuffer();
  assert.equal((await upload(base, document.documentId, extra)).status, 413);
  const same = await upload(base, document.documentId, first!); assert.equal(same.status, 201); assert.equal((await same.json() as any).id, firstId);
}));

test('既存schema1のDBと画像なしバックアップを読み、画像用テーブルだけを追加する', async () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'mindmap-image-migration-'));
  const dataDir = resolve(dir, 'data');
  const { mkdirSync } = await import('node:fs'); mkdirSync(dataDir);
  const path = resolve(dataDir, 'mindmaps.sqlite');
  const legacy = new DatabaseSync(path);
  const document = createDocument('既存の学習マップ');
  legacy.exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT); INSERT INTO schema_migrations VALUES(1,'2026-11-01'); CREATE TABLE maps(id TEXT PRIMARY KEY,title TEXT,document_json TEXT,schema_version INTEGER,updated_at TEXT,deleted_at TEXT); CREATE TABLE snapshots(id TEXT PRIMARY KEY,map_id TEXT REFERENCES maps(id),document_json TEXT,created_at TEXT);`);
  legacy.prepare('INSERT INTO maps VALUES(?,?,?,?,?,NULL)').run(document.documentId, document.title, JSON.stringify(document), 1, document.updatedAt); legacy.close();
  verifyBackup(path);
  const migrated = new MapStore(dataDir);
  try {
    assert.deepEqual(migrated.get(document.documentId), document);
    assert.equal(migrated.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version, 2);
    assert.equal(migrated.db.prepare('SELECT COUNT(*) AS count FROM image_assets').get()?.count, 0);
  } finally { await migrated.close(); rmSync(dir, { recursive: true, force: true }); }
});

function pngChunk(type: string, data: Buffer) {
  const name = Buffer.from(type), length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([name, data])) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, name, data, checksum]);
}
function syntheticAPNG() {
  const width = 8, height = 4;
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const animation = Buffer.alloc(8); animation.writeUInt32BE(2);
  const frameControl = (sequence: number) => { const data = Buffer.alloc(26); data.writeUInt32BE(sequence); data.writeUInt32BE(width, 4); data.writeUInt32BE(height, 8); data.writeUInt16BE(1, 20); data.writeUInt16BE(10, 22); return data; };
  const framePixels = (blue: boolean) => {
    const data = Buffer.alloc((width * 4 + 1) * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const offset = y * (width * 4 + 1) + 1 + x * 4; data[offset + (blue ? 2 : 0)] = 255; data[offset + 3] = 255; }
    return deflateSync(data);
  };
  const sequence = Buffer.alloc(4); sequence.writeUInt32BE(2);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), pngChunk('IHDR', ihdr), pngChunk('acTL', animation), pngChunk('fcTL', frameControl(0)), pngChunk('IDAT', framePixels(false)), pngChunk('fcTL', frameControl(1)), pngChunk('fdAT', Buffer.concat([sequence, framePixels(true)])), pngChunk('IEND', Buffer.alloc(0))]);
}

test('APNGは2枚目を捨てて取り込まず、通常PNGの付随テキストはアニメーション扱いしない', async () => fixture(async ({ store, base }) => {
  const document = await create(base, 'PNGの静止画境界');
  assert.equal((await upload(base, document.documentId, syntheticAPNG())).status, 415);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM image_assets').get()?.count, 0);
  const png = await source();
  const staticPNG = Buffer.concat([png.subarray(0, -12), pngChunk('tEXt', Buffer.from('Comment\0acTL fcTL fdAT are plain text')), png.subarray(-12)]);
  assert.equal((await upload(base, document.documentId, staticPNG)).status, 201);
}));

test('schema2の画像ゼロ文書は空images配列とmetadata省略でも検証・JSON往復できる', async () => fixture(async ({ base }) => {
  const document = createDocument('画像を外した文書'); document.schemaVersion = 2; document.nodes[document.rootId].images = [];
  validateDocument(document);
  const bundle = { format: 'mindmap-backup', schemaVersion: 1, document, assets: [] };
  const result = await fetch(`${base}/api/maps/import`, { method: 'POST', headers: jsonHeaders(base), body: JSON.stringify(bundle) });
  assert.equal(result.status, 201);
  const imported: any = await result.json(); assert.equal(imported.schemaVersion, 2); assert.equal(imported.imageAssets, undefined); assert.deepEqual(imported.nodes[imported.rootId].images, []);
}));
