import { createDocument, validateDocument, DocumentError, MAX_DOCUMENT_BYTES, MAX_NODES, MAX_DEPTH, BRANCH_COLORS, type MindmapDocument, type MindmapNode, type ImageAssetMetadata, validateImageMetadata, getReferencedImageIds, MAX_IMAGE_ASSETS, MAX_MAP_IMAGE_BYTES } from '../domain/index';
import { layoutDocument } from '../layout/index';
export type PortableImageAsset = ImageAssetMetadata & { id: string; dataBase64: string };
export type PortableBackup = { format: 'mindmap-backup'; schemaVersion: 1; document: MindmapDocument; assets: PortableImageAsset[] };
export const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
export function exportJSON(document: MindmapDocument): string {
  validateDocument(document);
  if (getReferencedImageIds(document).length) throw new DocumentError('画像を含むマップは画像付きJSONバックアップで保存してください。');
  const copy = structuredClone(document); if (copy.imageAssets) copy.imageAssets = {};
  return JSON.stringify(copy);
}
function checkSize(text: string) { if (new TextEncoder().encode(text).byteLength > MAX_DOCUMENT_BYTES) throw new DocumentError('ファイルサイズは10MB以内にしてください。'); }
function rejectDuplicateKeys(text: string) {
  let position = 0;
  const whitespace = () => { while (/\s/.test(text[position] || '') && position < text.length) position++; };
  const string = () => {
    const begin = position++;
    while (position < text.length) { const character = text[position++]; if (character === '\\') { position++; continue; } if (character === '"') return JSON.parse(text.slice(begin, position)) as string; }
    throw new DocumentError('JSONの文字列が閉じられていません。');
  };
  const value = (depth: number): void => {
    if (depth > 210) throw new DocumentError('JSONの入れ子が深すぎます。');
    whitespace(); const character = text[position];
    if (character === '{') {
      position++; whitespace(); const keys = new Set<string>();
      if (text[position] === '}') { position++; return; }
      while (position < text.length) {
        whitespace(); if (text[position] !== '"') throw new DocumentError('JSONのプロパティ名が不正です。');
        const key = string(); if (keys.has(key)) throw new DocumentError(`JSONに重複する項目があります: ${key.slice(0, 80)}`); keys.add(key);
        whitespace(); if (text[position++] !== ':') throw new DocumentError('JSONの区切りが不正です。'); value(depth + 1); whitespace();
        const separator = text[position++]; if (separator === '}') return; if (separator !== ',') throw new DocumentError('JSONの区切りが不正です。');
      }
      throw new DocumentError('JSONのオブジェクトが閉じられていません。');
    }
    if (character === '[') {
      position++; whitespace(); if (text[position] === ']') { position++; return; }
      while (position < text.length) { value(depth + 1); whitespace(); const separator = text[position++]; if (separator === ']') return; if (separator !== ',') throw new DocumentError('JSONの配列が不正です。'); }
      throw new DocumentError('JSONの配列が閉じられていません。');
    }
    if (character === '"') { string(); return; }
    const start = position; while (position < text.length && !/[\s,\]}]/.test(text[position])) position++;
    if (start === position) throw new DocumentError('JSONの値が不正です。');
  };
  value(0); whitespace(); if (position !== text.length) throw new DocumentError('JSONの末尾に余分な内容があります。');
}
function backupDocument(document: MindmapDocument): MindmapDocument {
  const copy = structuredClone(document);
  if (copy.imageAssets) copy.imageAssets = Object.fromEntries(getReferencedImageIds(copy).map(id => [id, copy.imageAssets![id]]));
  return copy;
}
function checkedAssets(document: MindmapDocument, value: unknown, exact = false): PortableImageAsset[] {
  if (!Array.isArray(value) || value.length > MAX_IMAGE_ASSETS) throw new DocumentError('画像バックアップは200件以内にしてください。');
  const ids = new Set<string>(); let totalBytes = 0;
  for (const asset of value) {
    if (!asset || typeof asset !== 'object' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(asset.id) || ids.has(asset.id)) throw new DocumentError('画像IDが不正、または重複しています。');
    if (Object.keys(asset).some(key => !['id', 'mime', 'width', 'height', 'byteSize', 'dataBase64'].includes(key))) throw new DocumentError('画像バックアップに対応しない項目があります。');
    const metadata = { mime: asset.mime, width: asset.width, height: asset.height, byteSize: asset.byteSize };
    validateImageMetadata(metadata);
    if (typeof asset.dataBase64 !== 'string' || !asset.dataBase64.length || asset.dataBase64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(asset.dataBase64)) throw new DocumentError('画像のBase64データが不正です。');
    const padding = asset.dataBase64.endsWith('==') ? 2 : asset.dataBase64.endsWith('=') ? 1 : 0;
    const bytes = asset.dataBase64.length / 4 * 3 - padding;
    if (bytes !== asset.byteSize) throw new DocumentError('画像のデータ長と保存情報が一致しません。');
    const expected = document.imageAssets?.[asset.id];
    if (!expected || expected.mime !== metadata.mime || expected.width !== metadata.width || expected.height !== metadata.height || expected.byteSize !== metadata.byteSize) throw new DocumentError('画像の保存情報が文書と一致しません。');
    ids.add(asset.id); totalBytes += bytes;
  }
  if (totalBytes > MAX_MAP_IMAGE_BYTES) throw new DocumentError('画像の合計は64MiB以内にしてください。');
  const referenced = getReferencedImageIds(document);
  if (referenced.some(id => !ids.has(id))) throw new DocumentError('画像の実体が不足しています。画像付きバックアップを使ってください。');
  if (exact && (ids.size !== referenced.length || Object.keys(document.imageAssets || {}).some(id => !ids.has(id)))) throw new DocumentError('画像バックアップの参照と実体が一致しません。');
  return value as PortableImageAsset[];
}
export function exportBackupJSON(document: MindmapDocument, assets: PortableImageAsset[]): string {
  validateDocument(document);
  const copy = backupDocument(document);
  const referenced = new Set(getReferencedImageIds(copy));
  const selected = assets.filter(asset => referenced.has(asset.id));
  checkedAssets(copy, selected, true);
  const serialized = JSON.stringify({ format: 'mindmap-backup', schemaVersion: 1, document: copy, assets: selected } satisfies PortableBackup);
  if (new TextEncoder().encode(serialized).byteLength > MAX_BACKUP_BYTES) throw new DocumentError('画像付きバックアップは100MiB以内にしてください。');
  return serialized;
}
export function parseBackupJSON(text: string): { document: MindmapDocument; assets: PortableImageAsset[] } {
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) throw new DocumentError('画像付きバックアップは100MiB以内にしてください。');
  try {
    rejectDuplicateKeys(text);
    const value: unknown = JSON.parse(text);
    if (value && typeof value === 'object' && 'format' in value && value.format === 'mindmap-backup') {
      const backup = value as PortableBackup;
      if (backup.schemaVersion !== 1) throw new DocumentError('対応外の画像バックアップバージョンです。');
      validateDocument(backup.document);
      checkedAssets(backup.document, backup.assets, true);
      return structuredClone({ document: backup.document, assets: backup.assets });
    }
    const document = importJSON(text, { newIdentity: false });
    return { document, assets: [] };
  } catch (error) {
    if (error instanceof DocumentError) throw error;
    throw new DocumentError('JSONバックアップが破損しています。元のマップは変更されません。');
  }
}
function embeddedImages(document: MindmapDocument, assets: PortableImageAsset[] = []): Map<string, string> {
  checkedAssets(document, assets);
  return new Map(assets.map(asset => [asset.id, `data:image/webp;base64,${asset.dataBase64}`]));
}
export function importJSON(text: string, options: { newIdentity?: boolean } = {}): MindmapDocument {
  checkSize(text);
  try {
    rejectDuplicateKeys(text); const value: unknown = JSON.parse(text); validateDocument(value);
    if (getReferencedImageIds(value).length || Object.keys(value.imageAssets || {}).length) throw new DocumentError('画像の実体がない文書です。画像付きJSONバックアップを読み込んでください。');
    const document = structuredClone(value);
    if (options.newIdentity !== false) { const now = new Date().toISOString(); document.documentId = crypto.randomUUID(); document.revision = 0; document.createdAt = now; document.updatedAt = now; }
    return document;
  } catch (error) { if (error instanceof DocumentError) throw error; throw new DocumentError('JSONファイルが破損しています。元のマップは変更されません。'); }
}
export function importMarkdown(text: string, filename = 'インポートしたマップ'): MindmapDocument {
  checkSize(text); if (!text.trim()) throw new DocumentError('空のMarkdownファイルは読み込めません。');
  const document = createDocument(filename.replace(/\.(md|markdown)$/i, '') || 'インポートしたマップ');
  const headings: { level: number; id: string }[] = [];
  let bullets: { indent: number; id: string }[] = []; let lastId = document.rootId; let firstH1 = false; let fence: string | null = null;
  const appendNote = (line: string) => { const node = document.nodes[lastId]; node.note += (node.note ? '\n' : '') + line; };
  const append = (parentId: string, content: string) => {
    const id = crypto.randomUUID(); const parent = document.nodes[parentId];
    const node: MindmapNode = { id, parentId, childIds: [], text: content || 'トピック', note: '' };
    if (parentId === document.rootId) { node.side = parent.childIds.length % 2 ? 'left' : 'right'; node.style = { branchColor: BRANCH_COLORS[parent.childIds.length % BRANCH_COLORS.length] }; }
    parent.childIds.push(id); document.nodes[id] = node;
    if (Object.keys(document.nodes).length > MAX_NODES) throw new DocumentError(`トピック数は${MAX_NODES}件以内にしてください。`);
    lastId = id; return id;
  };
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) { appendNote(line); if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null; continue; }
    if (fenceMatch) { fence = fenceMatch[1]; appendNote(line); continue; }
    const heading = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length; bullets = [];
      if (level === 1 && !firstH1) { firstH1 = true; document.nodes[document.rootId].text = heading[2]; document.title = heading[2]; lastId = document.rootId; headings.length = 0; headings.push({ level: 1, id: document.rootId }); continue; }
      while (headings.length && headings[headings.length - 1].level >= level) headings.pop();
      const parentId = headings.length ? headings[headings.length - 1].id : document.rootId;
      const id = append(parentId, heading[2]); headings.push({ level, id }); continue;
    }
    const bullet = line.match(/^(\s*)(?:[-+*]|\d+[.)])\s+(.+)$/);
    if (bullet) {
      const indent = bullet[1].replace(/\t/g, '    ').length;
      while (bullets.length && bullets[bullets.length - 1].indent >= indent) bullets.pop();
      const parentId = bullets.length ? bullets[bullets.length - 1].id : headings.length ? headings[headings.length - 1].id : document.rootId;
      const id = append(parentId, bullet[2]); bullets.push({ indent, id }); if (bullets.length > MAX_DEPTH) throw new DocumentError(`階層は${MAX_DEPTH}以内にしてください。`); continue;
    }
    appendNote(line);
  }
  validateDocument(document); return document;
}
export const MARKDOWN_EXPORT_WARNING = 'Markdownでは枝色・文字サイズ・折り畳み・カメラ位置・リンク欄・添付画像を保持できません。完全なバックアップにはJSONを使ってください。';
export function exportMarkdown(document: MindmapDocument): string {
  const root = document.nodes[document.rootId]; const lines = [`# ${root.text.replace(/\n/g, ' ')}`, ''];
  if (root.note) lines.push(root.note, '');
  const visit = (id: string, depth: number) => {
    const node = document.nodes[id]; const indent = '  '.repeat(depth);
    lines.push(`${indent}- ${node.text.replace(/\n/g, ' ')}`);
    if (node.note) lines.push(...node.note.split('\n').map(line => `${indent}  ${line}`));
    for (const child of node.childIds) visit(child, depth + 1);
  };
  for (const id of root.childIds) visit(id, 0);
  return lines.join('\n') + '\n';
}
function escapeXML(text: string) { return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]!)); }
export type ExportTheme = 'dark' | 'light';
export function exportSVG(document: MindmapDocument, options: { theme?: ExportTheme; scale?: number; assets?: PortableImageAsset[] } = {}): string {
  validateDocument(document); const imageURLs = embeddedImages(document, options.assets); const layout = layoutDocument(document, { includeCollapsed: true }); const padding = 64;
  const background = options.theme === 'light' ? '#F3F6FA' : '#20252B'; const panel = options.theme === 'light' ? '#FFFFFF' : '#2B323A'; const foreground = options.theme === 'light' ? '#172331' : '#F2F5F8';
  const width = Math.ceil(layout.bounds.width + padding * 2); const height = Math.ceil(layout.bounds.height + padding * 2);
  const offsetX = padding - layout.bounds.x; const offsetY = padding - layout.bounds.y;
  const curves = layout.edges.map(edge => `<path d="${edge.path}" fill="none" stroke="${edge.color}" stroke-width="2.5"/>`).join('');
  const topics = layout.nodes.map(node => `<g transform="translate(${node.x},${node.y})"><rect width="${node.width}" height="${node.height}" rx="10" fill="${panel}" stroke="${node.color}" stroke-width="1.5"/><text fill="${foreground}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Noto Sans JP,sans-serif" font-size="${node.fontSize}">${node.lines.map((line, index) => `<tspan x="12" y="${8 + node.fontSize * 1.15 + index * node.fontSize * 1.5}">${escapeXML(line)}</tspan>`).join('')}</text>${node.images.map(image => `<image x="${image.x}" y="${image.y}" width="${image.width}" height="${image.height}" href="${imageURLs.get(image.id)}" preserveAspectRatio="xMidYMid meet"/>`).join('')}</g>`).join('');
  const scale = options.scale || 1;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale}" viewBox="0 0 ${width} ${height}"><title>${escapeXML(document.title)}</title><rect width="${width}" height="${height}" fill="${background}"/><g transform="translate(${offsetX},${offsetY})">${curves}${topics}</g></svg>`;
}
export function exportImageSize(document: MindmapDocument, scale = 1) {
  const { bounds } = layoutDocument(document, { includeCollapsed: true });
  const width = Math.ceil(bounds.width + 128); const height = Math.ceil(bounds.height + 128);
  const actualScale = Math.min(scale, 4096 / width, 4096 / height);
  return { width: Math.max(1, Math.floor(width * actualScale)), height: Math.max(1, Math.floor(height * actualScale)), reduced: actualScale < scale };
}
export async function exportPNG(document: MindmapDocument, scale = 1, theme: ExportTheme = 'dark', assets: PortableImageAsset[] = []): Promise<Blob> {
  if (typeof window === 'undefined') throw new DocumentError('PNG画像出力はブラウザから利用してください。');
  await globalThis.document.fonts?.ready;
  const svg = exportSVG(document, { theme, assets }); const size = exportImageSize(document, scale);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = globalThis.document.createElement('canvas'); canvas.width = size.width; canvas.height = size.height;
    const context = canvas.getContext('2d'); if (!context) throw new DocumentError('画像出力に必要な描画領域を作成できませんでした。');
    context.drawImage(image, 0, 0, size.width, size.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new DocumentError('PNGの生成に失敗しました。SVG出力を試してください。')), 'image/png'));
  } finally { URL.revokeObjectURL(url); }
}
export function downloadFile(content: Blob | string, filename: string, type = 'application/octet-stream') {
  const blob = typeof content === 'string' ? new Blob([content], { type }) : content;
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
