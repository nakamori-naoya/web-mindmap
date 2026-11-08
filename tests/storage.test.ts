import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { MapStore, StoreError, verifyBackup } from '../server/store.ts';
import { createDocument } from '../src/domain/index.ts';
import { rootDir } from '../server/config.ts';
import { acquireServerLock } from '../server/lock.ts';

test('保存・5世代復旧・ゴミ箱・再起動で文書を保持する', async () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'mindmap-storage-')); let store = new MapStore(resolve(dir, 'data'));
  try {
    const doc = createDocument('Redis'); doc.nodes[doc.rootId].note = '日本語のメモ';
    const childId = crypto.randomUUID(); doc.nodes[childId] = { id: childId, parentId: doc.rootId, childIds: [], text: '折り畳みの配下', note: '残る内容', side: 'right' }; doc.nodes[doc.rootId].childIds = [childId]; doc.viewState.collapsedNodeIds = [doc.rootId];
    await store.create(doc); assert.deepEqual(store.get(doc.documentId), doc);
    assert.equal(readdirSync(resolve(dir, 'backup')).filter(name => name.endsWith('.sqlite')).length, 1);
    const duplicate = structuredClone(doc); await assert.rejects(store.create(duplicate), (e: unknown) => e instanceof StoreError && e.status === 409);
    for (let i = 1; i <= 7; i++) { doc.revision = i; doc.title = `版${i}`; doc.nodes[doc.rootId].text = doc.title; await store.save(doc.documentId, doc); }
    assert.equal(store.snapshots(doc.documentId).length, 5);
    const snapshot = store.snapshots(doc.documentId)[0];
    const before = store.snapshot(doc.documentId, String(snapshot.id));
    await store.restoreSnapshot(doc.documentId, String(snapshot.id));
    assert.deepEqual(store.get(doc.documentId), before);
    store.trash(doc.documentId); assert.equal(store.list().length, 0); assert.equal(store.list(true).length, 1);
    assert.throws(() => store.get(doc.documentId), /見つかりません/);
    store.restoreMap(doc.documentId); assert.deepEqual(store.get(doc.documentId), before);
    await store.close(); store = new MapStore(resolve(dir, 'data')); assert.deepEqual(store.get(doc.documentId), before);
    store.trash(doc.documentId); assert.throws(() => store.permanentDelete(doc.documentId, '誤った名前'), /マップ名/);
    store.permanentDelete(doc.documentId, before.title); assert.equal(store.list(true).length, 0);
  } finally { await store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('不正な保存は現在版と復旧候補を変更しない', async () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'mindmap-invalid-')); const store = new MapStore(resolve(dir, 'data'));
  try {
    const doc = createDocument('元の内容'); await store.create(doc);
    for (const change of [(d: any) => d.schemaVersion = 99, (d: any) => d.nodes[d.rootId].childIds = [d.rootId], (d: any) => d.nodes[d.rootId].link = 'javascript:alert(1)']) {
      const bad = structuredClone(doc); change(bad); await assert.rejects(store.save(doc.documentId, bad));
      assert.deepEqual(store.get(doc.documentId), doc); assert.equal(store.snapshots(doc.documentId).length, 0);
    }
    await assert.rejects(store.save(crypto.randomUUID(), doc));
  } finally { await store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('SQLiteバックアップからCLIで全マップ・メモ・書式を復元する', async () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'mindmap-restore-')); const dataDir = resolve(dir, 'data');
  let store = new MapStore(dataDir); const destination = resolve(dir, 'manual.sqlite');
  const one = createDocument('復元対象'); one.nodes[one.rootId].note = '消してはいけないメモ'; one.nodes[one.rootId].style = { fontSize: 22, branchColor: '#69B4FF' };
  for (const text of ['順序を守る一番目', '順序を守る二番目']) { const id = crypto.randomUUID(); one.nodes[id] = { id, parentId: one.rootId, childIds: [], text, note: '配下のメモ', side: 'right' }; one.nodes[one.rootId].childIds.push(id); }
  const originalOne = structuredClone(one); const two = createDocument('二つ目');
  try {
    await store.create(one); await store.create(two); await store.backupTo(destination); verifyBackup(destination);
    one.title = '後から変更'; await store.save(one.documentId, one); await store.close();
    const output = execFileSync(process.execPath, [resolve(rootDir, 'node_modules/tsx/dist/cli.mjs'), resolve(rootDir, 'scripts/restore.ts'), destination, '--confirm'], { env: { ...process.env, MINDMAP_DATA_DIR: dataDir }, encoding: 'utf8' });
    assert.match(output, /復元しました/); store = new MapStore(dataDir);
    assert.equal(store.get(one.documentId).title, '復元対象'); assert.equal(store.get(one.documentId).nodes[one.rootId].note, '消してはいけないメモ');
    assert.deepEqual(store.get(one.documentId), originalOne); assert.deepEqual(store.get(two.documentId), two); assert.equal(store.list().length, 2);
    assert.ok(readdirSync(dataDir).some(name => name.startsWith('before-restore-')));
  } finally { if (store.db.isOpen) await store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('バックアップ保存先障害を成功扱いせず、コミットされた文書は残す', async () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'mindmap-backup-failure-')); const store = new MapStore(resolve(dir, 'data'));
  try {
    writeFileSync(resolve(dir, 'backup'), 'directoryを作れない状態');
    const doc = createDocument('保護する内容'); await assert.rejects(store.create(doc));
    assert.deepEqual(store.get(doc.documentId), doc);
  } finally { await store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('確認を保留した30日超のマップを復元でき、日次バックアップを7日分に保つ', async () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'mindmap-retention-')); const store = new MapStore(resolve(dir, 'data'));
  try {
    const doc = createDocument('期限の検証'); await store.create(doc);
    const backupDir = resolve(dir, 'backup');
    for (let i = 1; i <= 9; i++) writeFileSync(resolve(backupDir, `mindmaps-2000-01-${String(i).padStart(2, '0')}.sqlite`), '古いバックアップ');
    doc.revision++; await store.save(doc.documentId, doc);
    assert.equal(readdirSync(backupDir).filter(name => name.endsWith('.sqlite')).length, 7);
    store.trash(doc.documentId);
    store.db.prepare('UPDATE maps SET deleted_at=? WHERE id=?').run(new Date(Date.now() - 31 * 86400000).toISOString(), doc.documentId);
    assert.equal(store.list(true).length, 1);
    assert.deepEqual(store.restoreMap(doc.documentId), doc); assert.equal(store.list(true).length, 0);
  } finally { await store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('復元CLIはサーバー排他があると別プロセスからでも拒否する', async () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'mindmap-lock-')); const dataDir = resolve(dir, 'data'); const store = new MapStore(dataDir); const releaseLock = acquireServerLock(dataDir);
  try {
    const doc = createDocument('起動中'); await store.create(doc); const source = resolve(dir, 'manual.sqlite'); await store.backupTo(source);
    assert.throws(() => execFileSync(process.execPath, [resolve(rootDir, 'node_modules/tsx/dist/cli.mjs'), resolve(rootDir, 'scripts/restore.ts'), source, '--confirm'], { env: { ...process.env, MINDMAP_DATA_DIR: dataDir }, stdio: 'pipe' }), /Command failed/);
    assert.deepEqual(store.get(doc.documentId), doc);
  } finally { releaseLock(); await store.close(); rmSync(dir, { recursive: true, force: true }); }
});
