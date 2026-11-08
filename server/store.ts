import { DatabaseSync, backup } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { parseBackupJSON } from '../src/io/index.ts';
import { normalizeImage, verifyPortableImage, imageHash, MAX_MAP_IMAGES, MAX_MAP_IMAGE_BYTES, type ImageMetadata, type StoredImage } from './images.ts';
import { mkdirSync, readdirSync, renameSync, rmSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { validateDocument, type MindmapDocument } from '../src/domain/index.ts';

export class StoreError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export type MapSummary = { id: string; title: string; updatedAt: string; deletedAt: string | null };
const MAX_BYTES = 10 * 1024 * 1024;
export function checkedDocument(value: unknown): MindmapDocument {
  if (Buffer.byteLength(JSON.stringify(value) ?? '') > MAX_BYTES) throw new StoreError(413, '文書は10MB以内にしてください。');
  try { validateDocument(value); } catch (error) { throw new StoreError(422, error instanceof Error ? error.message : '文書形式が不正です。'); }
  return value;
}
export class MapStore {
  readonly db: DatabaseSync;
  readonly databasePath: string;
  readonly backupDir: string;
  private backupQueue: Promise<void> = Promise.resolve();
  constructor(public readonly dataDir: string) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.databasePath = resolve(dataDir, 'mindmaps.sqlite');
    this.backupDir = resolve(dataDir, '..', 'backup');
    this.db = new DatabaseSync(this.databasePath);
    const migrationTable = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
    if (migrationTable) {
      const latest = this.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get();
      if (latest && Number(latest.version) > 2) { this.db.close(); throw new Error('対応外の新しいDBバージョンです。元のDBは変更しません。'); }
    }
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
    try {
      this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS maps(id TEXT PRIMARY KEY,title TEXT NOT NULL,document_json TEXT NOT NULL CHECK(json_valid(document_json)),schema_version INTEGER NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT);
      CREATE TABLE IF NOT EXISTS snapshots(id TEXT PRIMARY KEY,map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,document_json TEXT NOT NULL CHECK(json_valid(document_json)),created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS snapshots_map ON snapshots(map_id,created_at);
      INSERT OR IGNORE INTO schema_migrations VALUES(1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
      CREATE TABLE IF NOT EXISTS image_assets(
        id TEXT PRIMARY KEY,
        map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
        mime TEXT NOT NULL CHECK(mime='image/webp'),
        width INTEGER NOT NULL CHECK(width BETWEEN 1 AND 2048),
        height INTEGER NOT NULL CHECK(height BETWEEN 1 AND 2048),
        byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 1 AND 8388608),
        sha256 TEXT NOT NULL,
        data BLOB NOT NULL CHECK(length(data)=byte_size),
        created_at TEXT NOT NULL,
        UNIQUE(map_id,sha256)
      );
      CREATE INDEX IF NOT EXISTS image_assets_map ON image_assets(map_id);
      INSERT OR IGNORE INTO schema_migrations VALUES(2,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
      COMMIT;`);
      this.checkIntegrity();
    } catch (error) { this.db.close(); throw error; }
  }
  checkIntegrity() {
    const result = this.db.prepare('PRAGMA integrity_check').get() as Record<string, unknown>;
    if (result.integrity_check !== 'ok') throw new Error('SQLiteの整合性検査に失敗しました。元データを保護してバックアップから復元してください。');
    if (this.db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('SQLiteの外部キー整合性に問題があります。');
    verifyStoredImages(this.db);
  }
  list(trash = false): MapSummary[] {
    return this.db.prepare(`SELECT id,title,updated_at AS updatedAt,deleted_at AS deletedAt FROM maps WHERE deleted_at IS ${trash ? 'NOT ' : ''}NULL ORDER BY updated_at DESC`).all() as MapSummary[];
  }
  get(id: string, allowTrash = false): MindmapDocument {
    const row = this.db.prepare('SELECT document_json,deleted_at FROM maps WHERE id=?').get(id);
    if (!row || (!allowTrash && row.deleted_at !== null)) throw new StoreError(404, 'マップが見つかりません。');
    const document = checkedDocument(JSON.parse(String(row.document_json)));
    verifyDocumentImages(this.db, document);
    return document;
  }
  async create(value: unknown): Promise<MindmapDocument> {
    const doc = checkedDocument(value);
    if (this.db.prepare('SELECT 1 FROM maps WHERE id=?').get(doc.documentId)) throw new StoreError(409, '同じIDのマップが存在します。新しいIDで読み込んでください。');
    this.transaction(() => { verifyDocumentImages(this.db, doc); this.db.prepare('INSERT INTO maps VALUES(?,?,?,?,?,NULL)').run(doc.documentId, doc.title, JSON.stringify(doc), doc.schemaVersion, doc.updatedAt); });
    await this.dailyBackup();
    return doc;
  }
  async save(id: string, value: unknown): Promise<MindmapDocument> {
    const doc = checkedDocument(value);
    if (doc.documentId !== id) throw new StoreError(422, 'URLと文書のIDが一致しません。');
    this.transaction(() => {
      verifyDocumentImages(this.db, doc);
      const previous = this.db.prepare('SELECT document_json,deleted_at FROM maps WHERE id=?').get(id);
      if (!previous || previous.deleted_at !== null) throw new StoreError(404, '保存先のマップが見つかりません。');
      if (previous.document_json !== JSON.stringify(doc)) {
        this.db.prepare('INSERT INTO snapshots VALUES(?,?,?,?)').run(randomUUID(), id, String(previous.document_json), new Date().toISOString());
        this.db.prepare('DELETE FROM snapshots WHERE map_id=? AND id NOT IN (SELECT id FROM snapshots WHERE map_id=? ORDER BY created_at DESC,rowid DESC LIMIT 5)').run(id, id);
      }
      this.db.prepare('UPDATE maps SET title=?,document_json=?,schema_version=?,updated_at=? WHERE id=?').run(doc.title, JSON.stringify(doc), doc.schemaVersion, doc.updatedAt, id);
    });
    await this.dailyBackup();
    return doc;
  }
  trash(id: string) {
    this.get(id);
    this.db.prepare('UPDATE maps SET deleted_at=? WHERE id=?').run(new Date().toISOString(), id);
  }
  restoreMap(id: string): MindmapDocument {
    const row = this.db.prepare('SELECT deleted_at FROM maps WHERE id=?').get(id);
    if (!row || !row.deleted_at) throw new StoreError(404, 'ゴミ箱にマップが見つかりません。');
    if (Date.now() - Date.parse(String(row.deleted_at)) > 30 * 86400000) throw new StoreError(410, '30日の復元期限を過ぎています。JSON出力またはバックアップで保全してください。');
    this.db.prepare('UPDATE maps SET deleted_at=NULL WHERE id=?').run(id);
    return this.get(id);
  }
  permanentDelete(id: string, confirmation: unknown) {
    const row = this.db.prepare('SELECT title,deleted_at FROM maps WHERE id=?').get(id);
    if (!row || !row.deleted_at) throw new StoreError(404, 'ゴミ箱にマップが見つかりません。');
    if (confirmation !== row.title) throw new StoreError(422, '完全削除にはマップ名の入力が必要です。');
    this.db.prepare('DELETE FROM maps WHERE id=?').run(id);
  }
  snapshots(id: string) {
    this.get(id, true);
    return this.db.prepare('SELECT id,created_at AS createdAt FROM snapshots WHERE map_id=? ORDER BY created_at DESC,rowid DESC').all(id);
  }
  snapshot(id: string, snapshotId: string): MindmapDocument {
    const row = this.db.prepare('SELECT document_json FROM snapshots WHERE id=? AND map_id=?').get(snapshotId, id);
    if (!row) throw new StoreError(404, '復旧候補が見つかりません。');
    const document = checkedDocument(JSON.parse(String(row.document_json)));
    verifyDocumentImages(this.db, document);
    return document;
  }
  async restoreSnapshot(id: string, snapshotId: string) { return this.save(id, this.snapshot(id, snapshotId)); }
  imageMetadata(mapId: string) {
    this.get(mapId, true);
    return this.db.prepare('SELECT id,mime,width,height,byte_size AS byteSize FROM image_assets WHERE map_id=? ORDER BY created_at,rowid').all(mapId);
  }
  image(mapId: string, imageId: string) {
    this.get(mapId, true);
    const row = this.db.prepare('SELECT id,mime,width,height,byte_size AS byteSize,data FROM image_assets WHERE id=? AND map_id=?').get(imageId, mapId);
    if (!row) throw new StoreError(404, '画像が見つかりません。');
    return row;
  }
  async uploadImage(mapId: string, data: Buffer, contentType: string) {
    this.get(mapId);
    const image = await normalizeImage(data, contentType);
    let result: Record<string, unknown> | undefined;
    this.transaction(() => {
      this.get(mapId);
      const duplicate = this.db.prepare('SELECT id,mime,width,height,byte_size AS byteSize FROM image_assets WHERE map_id=? AND sha256=?').get(mapId, image.sha256);
      if (duplicate) { result = duplicate; return; }
      const usage = this.db.prepare('SELECT COUNT(*) AS count,COALESCE(SUM(byte_size),0) AS bytes FROM image_assets WHERE map_id=?').get(mapId)!;
      if (Number(usage.count) >= MAX_MAP_IMAGES || Number(usage.bytes) + image.byteSize > MAX_MAP_IMAGE_BYTES) throw new StoreError(413, 'このマップの画像保存上限（200枚・合計64MiB）に達しました。現在の内容をJSONで書き出し、新規読み込みすると使用中の画像だけを引き継げます。');
      const id = randomUUID(); this.insertImage(mapId, id, image);
      result = { id, mime: image.mime, width: image.width, height: image.height, byteSize: image.byteSize };
    });
    await this.dailyBackup();
    return result!;
  }
  private insertImage(mapId: string, id: string, image: StoredImage) {
    this.db.prepare('INSERT INTO image_assets VALUES(?,?,?,?,?,?,?,?,?)').run(id, mapId, image.mime, image.width, image.height, image.byteSize, image.sha256, image.data, new Date().toISOString());
  }
  exportBackup(mapId: string) {
    const document = structuredClone(this.get(mapId, true));
    const ids = referencedImages(document);
    const assets = ids.map(id => {
      const row = this.image(mapId, id);
      return { id, mime: row.mime, width: row.width, height: row.height, byteSize: row.byteSize, dataBase64: Buffer.from(row.data as Uint8Array).toString('base64') };
    });
    const metadata = documentImages(document);
    if (ids.length) document.imageAssets = Object.fromEntries(ids.map(id => [id, metadata[id]]));
    else delete document.imageAssets;
    return { format: 'mindmap-backup', schemaVersion: 1, document, assets };
  }
  async importBackup(text: string) {
    let bundle: ReturnType<typeof parseBackupJSON>;
    try { bundle = parseBackupJSON(text); }
    catch (error) { throw new StoreError(422, error instanceof Error ? error.message : 'バックアップ形式が不正です。'); }
    if (bundle.assets.length > MAX_MAP_IMAGES || bundle.assets.reduce((sum, asset) => sum + asset.byteSize, 0) > MAX_MAP_IMAGE_BYTES) throw new StoreError(413, 'バックアップの画像は200枚・合計64MiB以内にしてください。');
    const images: { previousId: string; id: string; image: StoredImage }[] = [];
    const hashes = new Set<string>();
    for (const asset of bundle.assets) {
      const image = await verifyPortableImage(Buffer.from(asset.dataBase64, 'base64'), asset);
      if (hashes.has(image.sha256)) throw new StoreError(422, 'バックアップに同じ画像の重複があります。');
      hashes.add(image.sha256); images.push({ previousId: asset.id, id: randomUUID(), image });
    }
    const document = structuredClone(bundle.document);
    const nodeIds = new Map(Object.keys(document.nodes).map(id => [id, randomUUID()]));
    const imageIds = new Map(images.map(image => [image.previousId, image.id]));
    const now = new Date().toISOString();
    document.documentId = randomUUID(); document.rootId = nodeIds.get(document.rootId)!;
    document.revision = 0; document.createdAt = now; document.updatedAt = now;
    document.nodes = Object.fromEntries(Object.values(document.nodes).map(node => {
      const next = { ...node, id: nodeIds.get(node.id)!, parentId: node.parentId ? nodeIds.get(node.parentId)! : null, childIds: node.childIds.map(id => nodeIds.get(id)!) };
      if (next.images) next.images = next.images.map((id: string) => imageIds.get(id)!);
      return [next.id, next];
    }));
    document.viewState.collapsedNodeIds = document.viewState.collapsedNodeIds.map(id => nodeIds.get(id)!);
    if (images.length) document.imageAssets = Object.fromEntries(images.map(({ id, image }) => [id, { mime: image.mime, width: image.width, height: image.height, byteSize: image.byteSize }]));
    else delete document.imageAssets;
    checkedDocument(document);
    this.transaction(() => {
      this.db.prepare('INSERT INTO maps VALUES(?,?,?,?,?,NULL)').run(document.documentId, document.title, JSON.stringify(document), document.schemaVersion, document.updatedAt);
      for (const { id, image } of images) this.insertImage(document.documentId, id, image);
      verifyDocumentImages(this.db, document);
    });
    await this.dailyBackup();
    return document;
  }
  private transaction(action: () => unknown) {
    this.db.exec('BEGIN IMMEDIATE');
    try { action(); this.db.exec('COMMIT'); } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  async backupTo(destination: string) {
    const work = this.backupQueue.catch(() => {}).then(async () => {
      mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
      const temp = `${destination}.${randomUUID()}.tmp`;
      try { await backup(this.db, temp); sealBackup(temp); renameSync(temp, destination); }
      finally { rmSync(temp, { force: true }); }
    });
    this.backupQueue = work;
    return work;
  }
  async dailyBackup() {
    // 日付は利用端末のタイムゾーンに合わせる。初回保存後の整合したDBを保全する。
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const destination = resolve(this.backupDir, `mindmaps-${date}.sqlite`);
    if (!existsSync(destination)) await this.backupTo(destination);
    const files = readdirSync(this.backupDir).filter(name => /^mindmaps-\d{4}-\d{2}-\d{2}\.sqlite$/.test(name)).sort().reverse();
    for (const name of files.slice(7)) { for (const suffix of ['', '-wal', '-shm']) rmSync(resolve(this.backupDir, name + suffix), { force: true }); }
  }
  async close() { await this.backupQueue.catch(() => {}); this.db.close(); }
}
export function verifyBackup(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const row = db.prepare('PRAGMA integrity_check').get() as Record<string, unknown>;
    if (row.integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('バックアップの整合性検査に失敗しました。');
    const columns = db.prepare('PRAGMA table_info(maps)').all();
    if (!columns.some(c => c.name === 'document_json')) throw new Error('マインドマップDBではありません。');
    verifyStoredImages(db);
  } finally { db.close(); }
}

export function sealBackup(path: string) {
  const db = new DatabaseSync(path);
  try { db.exec('PRAGMA journal_mode=DELETE'); } finally { db.close(); }
  verifyBackup(path);
}

function documentImages(document: MindmapDocument): Record<string, ImageMetadata> { return document.imageAssets || {}; }
function referencedImages(document: MindmapDocument): string[] {
  return [...new Set(Object.values(document.nodes).flatMap(node => node.images || []))];
}
function verifyDocumentImages(db: DatabaseSync, document: MindmapDocument) {
  const metadata = documentImages(document);
  const ids = Object.keys(metadata);
  if (!ids.length && !referencedImages(document).length) return;
  const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='image_assets'").get();
  if (!exists) throw new StoreError(422, '文書が参照する画像が保存されていません。');
  for (const id of ids) {
    const expected = metadata[id];
    const row = db.prepare('SELECT mime,width,height,byte_size AS byteSize FROM image_assets WHERE id=? AND map_id=?').get(id, document.documentId);
    if (!row || row.mime !== expected.mime || Number(row.width) !== expected.width || Number(row.height) !== expected.height || Number(row.byteSize) !== expected.byteSize) throw new StoreError(422, '画像の参照または寸法が保存内容と一致しません。画像付きJSONから読み込んでください。');
  }
  for (const id of referencedImages(document)) if (!metadata[id]) throw new StoreError(422, '文書が参照する画像情報がありません。');
}

function verifyStoredImages(db: DatabaseSync) {
  for (const row of db.prepare('SELECT document_json FROM maps UNION ALL SELECT document_json FROM snapshots').all()) verifyDocumentImages(db, checkedDocument(JSON.parse(String(row.document_json))));
  if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='image_assets'").get()) {
    for (const row of db.prepare('SELECT * FROM image_assets').all()) {
      const data = row.data as Uint8Array;
      if (data.byteLength !== Number(row.byte_size) || imageHash(data) !== row.sha256) throw new Error('保存された画像に破損があります。元のDBを保護してバックアップから復元してください。');
    }
  }
}
