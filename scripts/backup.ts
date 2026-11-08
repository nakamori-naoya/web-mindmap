import { DatabaseSync, backup } from 'node:sqlite';
import { resolve, dirname } from 'node:path';
import { mkdirSync, renameSync, rmSync } from 'node:fs';
import { dataDir } from '../server/config.ts';
import { sealBackup } from '../server/store.ts';
const destination = resolve(process.argv[2] || resolve(dataDir, '..', 'backup', `manual-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`));
const temp = `${destination}.tmp-${process.pid}`;
mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(resolve(dataDir, 'mindmaps.sqlite'), { readOnly: true });
try { await backup(db, temp); sealBackup(temp); renameSync(temp, destination); console.log(`バックアップを保存しました: ${destination}`); }
finally { db.close(); rmSync(temp, { force: true }); }
