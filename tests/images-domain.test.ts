import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, executeCommand, validateDocument, DocumentHistory, copySubtrees, pasteSubtrees } from '../src/domain/index.ts';
import { layoutDocument } from '../src/layout/index.ts';
import { exportSVG, exportJSON, exportBackupJSON, parseBackupJSON } from '../src/io/index.ts';
const metadata = { mime: 'image/webp' as const, width: 400, height: 200, byteSize: 4 };
function pictured() {
 const before = createDocument('画像のあるマップ');
 const assetId = crypto.randomUUID();
 const document = executeCommand(before, { type: 'AttachImage', id: before.rootId, assetId, metadata });
 return { before, document, assetId };
}
test('画像添付はv2へ進み、除去・Undo・同一マップ複製で実体IDを保つ', () => {
 const { before, document, assetId } = pictured();
 assert.equal(before.schemaVersion, 1); assert.equal(document.schemaVersion, 2);
 validateDocument(document); assert.deepEqual(document.nodes[document.rootId].images, [assetId]);
 const history = new DocumentHistory(); history.record(document);
 const removed = executeCommand(document, { type: 'DetachImage', id: document.rootId, assetId });
 assert.deepEqual(removed.nodes[removed.rootId].images, []);
 assert.deepEqual(history.undo(removed).nodes[document.rootId].images, [assetId]);
 const copied = copySubtrees(document, [document.rootId]);
 const pasted = pasteSubtrees(document, document.rootId, copied);
 assert.deepEqual(pasted.document.nodes[pasted.nodeIds[0]].images, [assetId]);
 const target = createDocument(); assert.throws(() => pasteSubtrees(target, target.rootId, copied), /別マップ/);
});
test('画像参照・metadata・版の矛盾と外部パスを拒否する', () => {
 const { document, assetId } = pictured();
 for (const mutate of [
  (d: any) => { d.schemaVersion = 1; },
  (d: any) => { delete d.imageAssets[assetId]; },
  (d: any) => { d.nodes[d.rootId].images = ['file:///tmp/private.png']; },
  (d: any) => { d.imageAssets[assetId].width = 999999; },
  (d: any) => { d.imageAssets[assetId].mime = 'image/svg+xml'; },
 ]) { const invalid = structuredClone(document); mutate(invalid); assert.throws(() => validateDocument(invalid)); }
});
test('画像領域の高さを配置に含め、縦横比と枝の非重複を保つ', () => {
 let { document, assetId } = pictured();
 for (let i = 0; i < 3; i++) document = executeCommand(document, { type: 'AddNode', parentId: document.rootId, text: `枝${i}` });
 const first = document.nodes[document.rootId].childIds[0];
 document = executeCommand(document, { type: 'AttachImage', id: first, assetId, metadata });
 const layout = layoutDocument(document); const node = layout.nodes.find(n => n.id === first)!;
 assert.equal(node.images.length, 1); assert.equal(node.images[0].width / node.images[0].height, 2);
 assert.ok(node.height >= node.textHeight + node.images[0].height);
 for (const other of layout.nodes.filter(n => n.id !== first)) assert.ok(node.x + node.width <= other.x || other.x + other.width <= node.x || node.y + node.height <= other.y || other.y + other.height <= node.y);
});
test('画像付きJSONは携帯用bundleで往復し、欠落・重複・不正base64を拒否する', () => {
 const { document, assetId } = pictured();
 const assets = [{ id: assetId, ...metadata, dataBase64: 'UklGRg==' }];
 assert.throws(() => exportJSON(document), /画像/);
 const serialized = exportBackupJSON(document, assets);
 const parsed = parseBackupJSON(serialized);
 assert.deepEqual(parsed.document, document); assert.deepEqual(parsed.assets, assets);
 assert.throws(() => exportBackupJSON(document, []), /画像/);
 assert.throws(() => parseBackupJSON(serialized.replace('UklGRg==', 'http://evil.invalid/x')));
 assert.throws(() => exportBackupJSON(document, [...assets, ...assets]));
 assert.deepEqual(parseBackupJSON(exportJSON(createDocument())).assets, []);
});
test('SVGはdata URIで画像を自己完結させ、payload不足で出力を中止する', () => {
 const { document, assetId } = pictured();
 const svg = exportSVG(document, { assets: [{ id: assetId, ...metadata, dataBase64: 'UklGRg==' }] });
 assert.match(svg, /<image /); assert.match(svg, /href="data:image\/webp;base64,UklGRg=="/);
 assert.doesNotMatch(svg, /foreignObject|file:\/\/|https?:\/\/evil/);
 assert.throws(() => exportSVG(document), /画像/);
});

test('除去済み画像のmetadataは画像なしJSONへ持ち出さず、legacy文書の無操作を保つ', () => {
 const legacy = createDocument(); assert.equal(executeCommand(legacy, { type: 'DetachImage', id: legacy.rootId, assetId: crypto.randomUUID() }), legacy);
 const { document, assetId } = pictured();
 const detached = executeCommand(document, { type: 'DetachImage', id: document.rootId, assetId });
 assert.deepEqual(JSON.parse(exportJSON(detached)).imageAssets, {});
 const serialized = exportBackupJSON(detached, []); assert.deepEqual(parseBackupJSON(serialized).assets, []);
});

test('新しい主枝の左右選択は画像の表示高さも考慮する', () => {
 let doc = createDocument(); const right = crypto.randomUUID(); const left = crypto.randomUUID();
 doc = executeCommand(doc, { type: 'AddNode', parentId: doc.rootId, id: right, side: 'right' });
 doc = executeCommand(doc, { type: 'AddNode', parentId: doc.rootId, id: left, side: 'left' });
 for (let i = 0; i < 3; i++) doc = executeCommand(doc, { type: 'AddNode', parentId: left });
 doc = executeCommand(doc, { type: 'AttachImage', id: right, assetId: crypto.randomUUID(), metadata: { ...metadata, width: 200, height: 400 } });
 const next = crypto.randomUUID(); doc = executeCommand(doc, { type: 'AddNode', parentId: doc.rootId, id: next });
 assert.equal(doc.nodes[next].side, 'left');
});
