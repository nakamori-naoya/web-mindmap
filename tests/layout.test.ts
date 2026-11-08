import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, addNode, executeCommand, validateDocument, type MindmapDocument } from '../src/domain/index';
import { layoutDocument, fitCamera, screenToWorld, worldToScreen, zoomCamera } from '../src/layout/index';
function fixture(count: number): MindmapDocument {
  const document = createDocument('性能検証'); const parents = [document.rootId];
  for (let index = 1; index < count; index++) {
    const id = crypto.randomUUID();
    // 二分木で1000件は深さ10、5000件は深さ13。
    const parentId = parents[index === count - 1 ? index - 1 : Math.floor((index - 1) / 2)];
    document.nodes[id] = { id, parentId, childIds: [], text: '考える速さを妨げない日本語マインドマップの性能と重なりを確認する文章です。'.slice(0, 40), note: '', ...(parentId === document.rootId ? { side: index === 1 ? 'right' as const : 'left' as const } : {}) };
    document.nodes[parentId].childIds.push(id); parents.push(id);
  }
  validateDocument(document); return document;
}
function assertNoOverlap(document: MindmapDocument) {
  const { nodes } = layoutDocument(document);
  const sorted = [...nodes].sort((a, b) => a.x - b.x);
  for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length && sorted[j].x < sorted[i].x + sorted[i].width; j++) {
    const a = sorted[i]; const b = sorted[j]; assert.ok(a.y + a.height <= b.y || b.y + b.height <= a.y, `重なり: ${a.id}, ${b.id}`);
  }
}
test('1000ノード/深さ10/40文字で重ならず決定的に配置する', () => { const document = fixture(1000); assertNoOverlap(document); assert.deepEqual(layoutDocument(document), layoutDocument(document)); });
test('5000ノードのストレス配置でデータを維持する', () => { const document = fixture(5000); const before = JSON.stringify(document); assertNoOverlap(document); assert.equal(layoutDocument(document).nodes.length, 5000); assert.equal(JSON.stringify(document), before); });
test('折り畳みは描画だけ隠し、全体出力には隠れたノードも含む', () => {
  let document = createDocument(); const a = addNode(document, document.rootId); const b = addNode(a.document, a.nodeId, '複数行\n二行目');
  document = executeCommand(b.document, { type: 'ToggleCollapse', id: a.nodeId });
  const layout = layoutDocument(document); assert.equal(layout.nodes.length, 2); assert.equal(layout.nodes.find(node => node.id === a.nodeId)!.hiddenCount, 1);
  const complete = layoutDocument(document, { includeCollapsed: true }); assert.equal(complete.nodes.length, 3); assert.equal(complete.nodes.find(node => node.id === b.nodeId)!.lines.length, 2);
});
test('ズーム後も座標を往復できポインター位置を保持する', () => {
  const camera = { x: 180, y: -40, zoom: 1.6 }; const point = { x: 200, y: 300 };
  const world = screenToWorld(point, camera); assert.deepEqual(worldToScreen(world, camera), point);
  const next = zoomCamera(camera, 2.4, point); const after = screenToWorld(point, next);
  assert.ok(Math.abs(world.x - after.x) < 1e-8 && Math.abs(world.y - after.y) < 1e-8);
  const fitted = fitCamera({ x: -200, y: -100, width: 600, height: 200 }, 1000, 600); assert.ok(fitted.zoom >= .1 && fitted.zoom <= 3);
});
