import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// 文書DBと分けて、サーバーと復元処理の同時実行だけを防ぐ。
// 排他はOSが持つため、SIGKILLやPIDの再利用後も起動記録が残らない。
export function acquireServerLock(dataDir: string): () => void {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(resolve(dataDir, 'server-lock.sqlite'));
  try {
    db.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE; CREATE TABLE IF NOT EXISTS server_lock(id INTEGER PRIMARY KEY)');
  } catch {
    db.close();
    throw new Error('同じ保存先のサーバーまたは復元処理が実行中です。停止してから実行してください。');
  }
  let released = false;
  return () => { if (!released) { released = true; db.close(); } };
}
