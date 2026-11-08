export type Side = 'left' | 'right';
export type ImageAssetMetadata = { mime: 'image/webp'; width: number; height: number; byteSize: number };
export type NodeStyle = { branchColor?: string; fontSize?: number };
export type MindmapNode = {
  id: string; parentId: string | null; childIds: string[]; text: string; note: string;
  side?: Side; style?: NodeStyle; link?: string; images?: string[];
};
export type Camera = { x: number; y: number; zoom: number };
export type MindmapDocument = {
  format: 'mindmap-document'; schemaVersion: 1 | 2; documentId: string; title: string;
  revision: number; rootId: string; layout: 'mindmap' | 'logic';
  nodes: Record<string, MindmapNode>;
  imageAssets?: Record<string, ImageAssetMetadata>;
  viewState: { collapsedNodeIds: string[]; camera: Camera };
  createdAt: string; updatedAt: string;
};
export const BRANCH_COLORS = ['#F175A6', '#69B4FF', '#79D4A1', '#F2B56B', '#BEA2FF', '#66CED1'];
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_NODES = 10000;
export const MAX_DEPTH = 100;
export const MAX_IMAGE_ASSETS = 200;
export const MAX_NODE_IMAGES = 8;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_MAP_IMAGE_BYTES = 64 * 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class DocumentError extends Error { constructor(message: string) { super(message); this.name = 'DocumentError'; } }
function requireValue(condition: unknown, message: string): asserts condition { if (!condition) throw new DocumentError(message); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function validDate(value: unknown) { return typeof value === 'string' && value.length < 40 && Number.isFinite(Date.parse(value)); }
export function isSafeLink(value: string): boolean {
  if (!value) return true;
  try { const parsed = new URL(value); return ['http:', 'https:'].includes(parsed.protocol); } catch { return false; }
}
export function validateImageMetadata(value: unknown): asserts value is ImageAssetMetadata {
  requireValue(record(value) && value.mime === 'image/webp', '画像の保存形式が不正です。');
  requireValue(Number.isInteger(value.width) && (value.width as number) > 0 && (value.width as number) <= 2048 && Number.isInteger(value.height) && (value.height as number) > 0 && (value.height as number) <= 2048, '画像の寸法は1〜2048pxにしてください。');
  requireValue(Number.isInteger(value.byteSize) && (value.byteSize as number) > 0 && (value.byteSize as number) <= MAX_IMAGE_BYTES, '画像サイズは8MiB以内にしてください。');
  requireValue(Object.keys(value).every(key => ['mime', 'width', 'height', 'byteSize'].includes(key)), '画像の情報に対応しない項目があります。元ファイルのパスや名前は保存できません。');
}
function sameImageMetadata(a: ImageAssetMetadata, b: ImageAssetMetadata) {
  return a.mime === b.mime && a.width === b.width && a.height === b.height && a.byteSize === b.byteSize;
}
export function getReferencedImageIds(document: MindmapDocument): string[] {
  return [...new Set(Object.values(document.nodes).flatMap(node => node.images || []))];
}
export function validateDocument(value: unknown): asserts value is MindmapDocument {
  requireValue(record(value), 'マップ文書はオブジェクトである必要があります。');
  requireValue(value.format === 'mindmap-document', '対応するマインドマップ形式ではありません。');
  requireValue(value.schemaVersion === 1 || value.schemaVersion === 2, '対応外のバージョンです。元のファイルは変更されません。');
  requireValue(typeof value.documentId === 'string' && uuid.test(value.documentId), '文書IDはUUIDである必要があります。');
  requireValue(typeof value.rootId === 'string' && uuid.test(value.rootId), '中心トピックのIDが不正です。');
  requireValue(typeof value.title === 'string' && value.title.trim().length > 0 && value.title.length <= 2000, 'マップ名は1〜2000文字にしてください。');
  requireValue(Number.isSafeInteger(value.revision) && (value.revision as number) >= 0, '更新世代が不正です。');
  requireValue(value.layout === 'mindmap' || value.layout === 'logic', 'レイアウトが不正です。');
  requireValue(validDate(value.createdAt) && validDate(value.updatedAt), '保存日時が不正です。');
  requireValue(record(value.nodes), 'トピック一覧が不正です。');
  if (value.imageAssets !== undefined) {
    requireValue(value.schemaVersion === 2 && record(value.imageAssets), '画像のある文書はバージョン2で保存してください。');
    const assets = Object.entries(value.imageAssets);
    requireValue(assets.length <= MAX_IMAGE_ASSETS, '画像は1マップ200件以内にしてください。');
    let bytes = 0;
    for (const [id, metadata] of assets) {
      requireValue(uuid.test(id), '画像IDはUUIDである必要があります。');
      validateImageMetadata(metadata); bytes += metadata.byteSize;
    }
    requireValue(bytes <= MAX_MAP_IMAGE_BYTES, 'マップの画像合計は64MiB以内にしてください。');
  }
  const nodes = value.nodes;
  const entries = Object.entries(nodes);
  requireValue(entries.length > 0 && entries.length <= MAX_NODES, `トピック数は1〜${MAX_NODES}件にしてください。`);
  requireValue(Object.hasOwn(nodes, value.rootId), '中心トピックが存在しません。');
  for (const [id, raw] of entries) {
    requireValue(uuid.test(id) && record(raw) && raw.id === id, 'トピックIDが不正、または辞書のキーと一致しません。');
    requireValue(raw.parentId === null || typeof raw.parentId === 'string' && uuid.test(raw.parentId), '親トピックのIDが不正です。');
    requireValue(Array.isArray(raw.childIds) && raw.childIds.every(child => typeof child === 'string' && uuid.test(child)), '子トピックのIDが不正です。');
    requireValue(new Set(raw.childIds).size === raw.childIds.length, '子トピックが重複しています。');
    requireValue(typeof raw.text === 'string' && raw.text.length <= 2000, 'トピック本文は2000文字以内にしてください。長文はメモへ入力できます。');
    requireValue(typeof raw.note === 'string' && raw.note.length <= MAX_DOCUMENT_BYTES, 'メモが不正です。');
    requireValue(raw.side === undefined || raw.side === 'left' || raw.side === 'right', '枝の方向が不正です。');
    requireValue(raw.link === undefined || typeof raw.link === 'string' && raw.link.length <= 8192 && isSafeLink(raw.link), 'リンクはhttpまたはhttpsのURLにしてください。');
    if (raw.images !== undefined) {
      requireValue(value.schemaVersion === 2 && Array.isArray(raw.images) && raw.images.length <= MAX_NODE_IMAGES && raw.images.every(id => typeof id === 'string' && uuid.test(id)), 'ノード画像はUUIDで参照し、8件以内にしてください。');
      requireValue(new Set(raw.images).size === raw.images.length, '同じ画像がノードに重複しています。');
      requireValue(raw.images.length === 0 || record(value.imageAssets) && raw.images.every(id => Object.hasOwn(value.imageAssets as object, id)), '参照する画像情報がありません。');
    }
    if (raw.style !== undefined) {
      requireValue(record(raw.style), '書式が不正です。');
      requireValue(raw.style.branchColor === undefined || typeof raw.style.branchColor === 'string' && /^#[0-9a-f]{6}$/i.test(raw.style.branchColor), '枝の色が不正です。');
      requireValue(raw.style.fontSize === undefined || typeof raw.style.fontSize === 'number' && Number.isFinite(raw.style.fontSize) && raw.style.fontSize >= 12 && raw.style.fontSize <= 40, '文字サイズは12〜40pxにしてください。');
    }
  }
  const typedNodes = nodes as Record<string, MindmapNode>;
  requireValue(typedNodes[value.rootId].parentId === null, '中心トピックに親は指定できません。');
  requireValue(typedNodes[value.rootId].text.trim().length > 0, '中心トピックは空にできません。');
  const visited = new Set<string>();
  const stack: [string, number][] = [[value.rootId, 0]];
  while (stack.length) {
    const [id, depth] = stack.pop()!;
    requireValue(depth <= MAX_DEPTH, `階層の深さは${MAX_DEPTH}以内にしてください。`);
    requireValue(!visited.has(id), '循環、または複数の親を持つトピックがあります。');
    visited.add(id);
    const node = typedNodes[id];
    requireValue(node, '参照先のトピックがありません。');
    for (const childId of node.childIds) {
      const child = typedNodes[childId];
      requireValue(child && child.parentId === id, '親子の参照が一致しません。');
      stack.push([childId, depth + 1]);
    }
  }
  requireValue(visited.size === entries.length, '中心から到達できないトピックがあります。');
  requireValue(record(value.viewState) && Array.isArray(value.viewState.collapsedNodeIds), '表示状態が不正です。');
  requireValue(value.viewState.collapsedNodeIds.every(id => typeof id === 'string' && Object.hasOwn(nodes, id)), '折り畳み対象が存在しません。');
  requireValue(new Set(value.viewState.collapsedNodeIds).size === value.viewState.collapsedNodeIds.length, '折り畳み対象が重複しています。');
  const camera = value.viewState.camera;
  requireValue(record(camera) && typeof camera.x === 'number' && Number.isFinite(camera.x) && typeof camera.y === 'number' && Number.isFinite(camera.y) && typeof camera.zoom === 'number' && camera.zoom >= .1 && camera.zoom <= 3, 'カメラ位置または倍率が不正です。');
  requireValue(new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_DOCUMENT_BYTES, '文書サイズは10MB以内にしてください。');
}
export function createDocument(title = '中心トピック'): MindmapDocument {
  const rootId = crypto.randomUUID(); const now = new Date().toISOString();
  const text = title.trim().slice(0, 2000) || '中心トピック';
  return { format: 'mindmap-document', schemaVersion: 1, documentId: crypto.randomUUID(), title: text, revision: 0, rootId, layout: 'mindmap', nodes: { [rootId]: { id: rootId, parentId: null, childIds: [], text, note: '' } }, viewState: { collapsedNodeIds: [], camera: { x: 0, y: 0, zoom: 1 } }, createdAt: now, updatedAt: now };
}
export function getDescendantIds(document: MindmapDocument, id: string): string[] {
  requireValue(document.nodes[id], 'トピックが見つかりません。');
  const result: string[] = []; const pending = [...document.nodes[id].childIds].reverse();
  while (pending.length) { const child = pending.pop()!; result.push(child); pending.push(...[...document.nodes[child].childIds].reverse()); }
  return result;
}
export function getTopLevelSelection(document: MindmapDocument, ids: string[]): string[] {
  const selected = new Set(ids.filter(id => !!document.nodes[id]));
  return [...selected].filter(id => { let parent = document.nodes[id].parentId; while (parent) { if (selected.has(parent)) return false; parent = document.nodes[parent].parentId; } return true; });
}
function visibleHeight(document: MindmapDocument, id: string): number {
  const node = document.nodes[id];
  const imageHeight = (node.images || []).reduce((sum, assetId) => { const image = document.imageAssets![assetId]; return sum + Math.min(180, image.height, image.height * 296 / image.width) + 8; }, 0);
  const own = Math.max(40, node.text.split('\n').length * 24 + 16) + imageHeight;
  if (!node.childIds.length || document.viewState.collapsedNodeIds.includes(id)) return own;
  return Math.max(own, node.childIds.reduce((sum, child) => sum + visibleHeight(document, child), 0) + (node.childIds.length - 1) * 24);
}
function chooseSide(document: MindmapDocument): Side {
  const heights = { left: 0, right: 0 };
  for (const id of document.nodes[document.rootId].childIds) heights[document.nodes[id].side || 'right'] += visibleHeight(document, id) + 24;
  return heights.right <= heights.left ? 'right' : 'left';
}
export type Command =
  | { type: 'AddNode'; parentId: string; id?: string; text?: string; beforeId?: string; side?: Side }
  | { type: 'EditText'; id: string; text: string }
  | { type: 'MoveSubtree'; id: string; parentId: string; beforeId?: string; side?: Side }
  | { type: 'DeleteSubtree'; ids: string[] }
  | { type: 'SetStyle'; ids: string[]; style: NodeStyle }
  | { type: 'SetNote'; id: string; note: string }
  | { type: 'SetLink'; id: string; link: string }
  | { type: 'SetSide'; id: string; side: Side }
  | { type: 'SetTitle'; title: string }
  | { type: 'SetLayout'; layout: MindmapDocument['layout'] }
  | { type: 'ToggleCollapse'; id: string }
  | { type: 'SetCamera'; camera: Camera }
  | { type: 'AttachImage'; id: string; assetId: string; metadata: ImageAssetMetadata }
  | { type: 'DetachImage'; id: string; assetId: string };
function nodeOf(document: MindmapDocument, id: string): MindmapNode { const node = document.nodes[id]; requireValue(node, 'トピックが見つかりません。'); return node; }
function insertChild(parent: MindmapNode, id: string, beforeId?: string) {
  const index = beforeId === undefined ? parent.childIds.length : parent.childIds.indexOf(beforeId);
  requireValue(index >= 0, '挿入先の兄弟トピックが見つかりません。'); parent.childIds.splice(index, 0, id);
}
function finish(document: MindmapDocument): MindmapDocument { document.revision++; document.updatedAt = new Date().toISOString(); validateDocument(document); return document; }
export function executeCommand(current: MindmapDocument, command: Command): MindmapDocument {
  const document = structuredClone(current);
  switch (command.type) {
    case 'AddNode': {
      const parent = nodeOf(document, command.parentId); const id = command.id || crypto.randomUUID();
      requireValue(!document.nodes[id], '同じIDのトピックが既に存在します。');
      const side = parent.id === document.rootId ? command.side || chooseSide(document) : undefined;
      const style = parent.id === document.rootId ? { branchColor: BRANCH_COLORS[parent.childIds.length % BRANCH_COLORS.length] } : undefined;
      document.nodes[id] = { id, parentId: parent.id, childIds: [], text: command.text ?? 'トピック', note: '', ...(side ? { side } : {}), ...(style ? { style } : {}) };
      insertChild(parent, id, command.beforeId);
      document.viewState.collapsedNodeIds = document.viewState.collapsedNodeIds.filter(value => value !== parent.id); break;
    }
    case 'EditText': { const node = nodeOf(document, command.id); node.text = command.text.trim() ? command.text : command.id === document.rootId ? '中心トピック' : 'トピック'; if (command.id === document.rootId) document.title = node.text; break; }
    case 'MoveSubtree': {
      requireValue(command.id !== document.rootId, '中心トピックは移動できません。');
      const node = nodeOf(document, command.id); const parent = nodeOf(document, command.parentId);
      requireValue(node.id !== parent.id && !getDescendantIds(document, node.id).includes(parent.id), '自分自身や子孫へは移動できません。');
      if (command.beforeId === node.id && node.parentId === parent.id) return current;
      nodeOf(document, node.parentId!).childIds = nodeOf(document, node.parentId!).childIds.filter(id => id !== node.id);
      if (parent.id === document.rootId) node.side = command.side || node.side || chooseSide(document); else delete node.side;
      node.parentId = parent.id; insertChild(parent, node.id, command.beforeId); break;
    }
    case 'DeleteSubtree': {
      for (const id of getTopLevelSelection(document, command.ids)) {
        requireValue(id !== document.rootId, '中心トピックは削除できません。');
        const node = nodeOf(document, id); const removed = [id, ...getDescendantIds(document, id)];
        nodeOf(document, node.parentId!).childIds = nodeOf(document, node.parentId!).childIds.filter(value => value !== id);
        for (const removedId of removed) delete document.nodes[removedId];
      }
      document.viewState.collapsedNodeIds = document.viewState.collapsedNodeIds.filter(id => !!document.nodes[id]); break;
    }
    case 'SetStyle': for (const id of command.ids) { const node = nodeOf(document, id); node.style = { ...node.style, ...command.style }; } break;
    case 'SetNote': nodeOf(document, command.id).note = command.note; break;
    case 'SetLink': nodeOf(document, command.id).link = command.link; break;
    case 'SetSide': { const node = nodeOf(document, command.id); requireValue(node.parentId === document.rootId, '枝の方向は主トピックで変更してください。'); node.side = command.side; break; }
    case 'SetTitle': document.title = command.title.trim() || '無題のマップ'; break;
    case 'SetLayout': document.layout = command.layout; break;
    case 'ToggleCollapse': {
      nodeOf(document, command.id); const collapsed = document.viewState.collapsedNodeIds;
      document.viewState.collapsedNodeIds = collapsed.includes(command.id) ? collapsed.filter(id => id !== command.id) : [...collapsed, command.id]; break;
    }
    case 'SetCamera': document.viewState.camera = command.camera; break;
    case 'AttachImage': {
      const node = nodeOf(document, command.id); validateImageMetadata(command.metadata);
      requireValue(uuid.test(command.assetId), '画像IDが不正です。');
      const existing = document.imageAssets?.[command.assetId];
      requireValue(!existing || sameImageMetadata(existing, command.metadata), '同じ画像IDの情報が一致しません。');
      document.schemaVersion = 2;
      document.imageAssets = { ...document.imageAssets, [command.assetId]: structuredClone(command.metadata) };
      node.images = [...new Set([...(node.images || []), command.assetId])]; break;
    }
    case 'DetachImage': {
      const node = nodeOf(document, command.id); if (!node.images?.includes(command.assetId)) return current; node.images = node.images.filter(id => id !== command.assetId); break;
    }
  }
  return finish(document);
}
export function addNode(document: MindmapDocument, parentId: string, text = 'トピック', beforeId?: string): { document: MindmapDocument; nodeId: string } {
  const nodeId = crypto.randomUUID(); return { document: executeCommand(document, { type: 'AddNode', parentId, id: nodeId, text, beforeId }), nodeId };
}
export type CopiedSubtrees = { format: 'mindmap-subtrees'; roots: string[]; nodes: Record<string, MindmapNode>; collapsedNodeIds: string[]; sourceDocumentId?: string; imageAssets?: Record<string, ImageAssetMetadata> };
export function copySubtrees(document: MindmapDocument, ids: string[]): CopiedSubtrees {
  const roots = getTopLevelSelection(document, ids); const nodes: Record<string, MindmapNode> = {};
  for (const root of roots) for (const id of [root, ...getDescendantIds(document, root)]) nodes[id] = structuredClone(document.nodes[id]);
  const imageIds = [...new Set(Object.values(nodes).flatMap(node => node.images || []))];
  return { format: 'mindmap-subtrees', roots, nodes, collapsedNodeIds: document.viewState.collapsedNodeIds.filter(id => !!nodes[id]), ...(imageIds.length ? { sourceDocumentId: document.documentId, imageAssets: Object.fromEntries(imageIds.map(id => [id, structuredClone(document.imageAssets![id])])) } : {}) };
}
export function pasteSubtrees(current: MindmapDocument, parentId: string, copied: CopiedSubtrees): { document: MindmapDocument; nodeIds: string[] } {
  requireValue(record(copied) && copied.format === 'mindmap-subtrees' && Array.isArray(copied.roots) && record(copied.nodes) && copied.roots.length > 0, '貼り付けるトピックがありません。');
  // コピーした枝も通常の文書として検査し、クリップボードの外部入力を信頼しない。
  const probe = createDocument();
  const root = probe.nodes[probe.rootId];
  root.childIds = [...copied.roots];
  const copiedNodes = structuredClone(copied.nodes);
  for (const id of copied.roots) { requireValue(copiedNodes[id], 'コピーした枝の中心がありません。'); copiedNodes[id].parentId = root.id; }
  probe.nodes = { ...copiedNodes, [root.id]: root };
  const imageIds = [...new Set(Object.values(copiedNodes).flatMap(node => node.images || []))];
  if (imageIds.length) {
    requireValue(copied.sourceDocumentId === current.documentId, '別マップの画像は取り込んでから貼り付けてください。');
    probe.schemaVersion = 2; probe.imageAssets = structuredClone(copied.imageAssets || {});
  }
  probe.viewState.collapsedNodeIds = copied.collapsedNodeIds || [];
  validateDocument(probe);
  const document = structuredClone(current);
  if (imageIds.length) {
    document.schemaVersion = 2;
    for (const id of imageIds) {
      const existing = document.imageAssets?.[id]; const metadata = copied.imageAssets![id];
      requireValue(!existing || sameImageMetadata(existing, metadata), '貼り付ける画像情報が一致しません。');
      document.imageAssets = { ...document.imageAssets, [id]: structuredClone(metadata) };
    }
  }
  const parent = nodeOf(document, parentId); const ids = new Map(Object.keys(copied.nodes).map(id => [id, crypto.randomUUID()]));
  for (const old of Object.values(copied.nodes)) {
    const id = ids.get(old.id)!; const isRoot = copied.roots.includes(old.id);
    const node = { ...structuredClone(old), id, parentId: isRoot ? parentId : ids.get(old.parentId!)!, childIds: old.childIds.map(child => ids.get(child)!) };
    if (isRoot && parentId === document.rootId) node.side = chooseSide(document); else delete node.side;
    document.nodes[id] = node;
    if (isRoot) parent.childIds.push(id);
  }
  document.viewState.collapsedNodeIds.push(...(copied.collapsedNodeIds || []).map(id => ids.get(id)!));
  document.viewState.collapsedNodeIds = document.viewState.collapsedNodeIds.filter(id => id !== parentId);
  return { document: finish(document), nodeIds: copied.roots.map(id => ids.get(id)!) };
}
export class DocumentHistory {
  private past: { document: MindmapDocument; bytes: number }[] = [];
  private future: { document: MindmapDocument; bytes: number }[] = [];
  private bytes = 0;
  get canUndo() { return this.past.length > 0; } get canRedo() { return this.future.length > 0; }
  private entry(document: MindmapDocument) { return { document, bytes: new TextEncoder().encode(JSON.stringify(document)).byteLength }; }
  record(before: MindmapDocument) {
    this.bytes -= this.future.reduce((sum, entry) => sum + entry.bytes, 0); this.future = [];
    const entry = this.entry(before); this.past.push(entry); this.bytes += entry.bytes;
    while (this.past.length && (this.past.length > 100 || this.bytes > 50 * 1024 * 1024)) this.bytes -= this.past.shift()!.bytes;
  }
  undo(current: MindmapDocument) {
    const previous = this.past.pop(); if (!previous) return current;
    const entry = this.entry(current); this.future.push(entry); this.bytes += entry.bytes - previous.bytes;
    return { ...structuredClone(previous.document), revision: current.revision + 1, updatedAt: new Date().toISOString() };
  }
  redo(current: MindmapDocument) {
    const next = this.future.pop(); if (!next) return current;
    const entry = this.entry(current); this.past.push(entry); this.bytes += entry.bytes - next.bytes;
    return { ...structuredClone(next.document), revision: current.revision + 1, updatedAt: new Date().toISOString() };
  }
  discardLast() { const entry = this.past.pop(); if (entry) this.bytes -= entry.bytes; this.bytes -= this.future.reduce((sum, item) => sum + item.bytes, 0); this.future = []; }
  clear() { this.past = []; this.future = []; this.bytes = 0; }
}
