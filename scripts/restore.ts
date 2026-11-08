import { DatabaseSync, backup } from 'node:sqlite';
import { resolve } from 'node:path';
import { existsSync, renameSync, rmSync, mkdirSync } from 'node:fs';
import { dataDir } from '../server/config.ts';
import { verifyBackup, sealBackup } from '../server/store.ts';
import { acquireServerLock } from '../server/lock.ts';
const sourceArg = process.argv[2];
if (!sourceArg || process.argv[3] !== '--confirm') throw new Error('復元元の絶対パスと --confirm を指定してください。サーバーを先に停止してください。');
const source = resolve(sourceArg); const destination = resolve(dataDir, 'mindmaps.sqlite');
if (source === destination) throw new Error('復元元と復元先が同じです。');
const releaseLock = acquireServerLock(dataDir);
try {
verifyBackup(source); mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const staged = resolve(dataDir, `restore-${stamp}.tmp`);
const sourceDB = new DatabaseSync(source, { readOnly: true });
try { await backup(sourceDB, staged); } finally { sourceDB.close(); }
sealBackup(staged);
if (existsSync(destination)) {
  const existing = new DatabaseSync(destination);
  try { await backup(existing, resolve(dataDir, `before-restore-${stamp}.sqlite`)); existing.exec('PRAGMA wal_checkpoint(TRUNCATE)'); }
  finally { existing.close(); }
}
rmSync(`${destination}-wal`, { force: true }); rmSync(`${destination}-shm`, { force: true });
renameSync(staged, destination); verifyBackup(destination);
console.log(`現状DBを退避し、整合性検査済みのバックアップを復元しました: ${destination}`);

} finally { releaseLock(); }
