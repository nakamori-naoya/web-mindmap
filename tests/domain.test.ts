import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, addNode, executeCommand, validateDocument, copySubtrees, pasteSubtrees, getDescendantIds, DocumentHistory, getTopLevelSelection } from '../src/domain/index';
test('追加・深い枝の移動は子孫を保持し、一回のUndoで完全に戻せる', () => {
  let document = createDocument('Redis'); const root = document.rootId;
  const a = addNode(document, root, 'レプリケーション'); document = a.document;
  const b = addNode(document, root, '障害対応'); document = b.document;
  const c = addNode(document, a.nodeId, '昇格'); document = c.document;
  const d = addNode(document, c.nodeId, '確認'); document = d.document;
  const before = document; const history = new DocumentHistory(); history.record(before);
  document = executeCommand(document, { type: 'MoveSubtree', id: c.nodeId, parentId: b.nodeId });
  assert.equal(document.nodes[d.nodeId].parentId, c.nodeId); assert.equal(document.nodes[c.nodeId].parentId, b.nodeId);
  document = history.undo(document); assert.deepEqual(document.nodes, before.nodes); assert.deepEqual(document.viewState, before.viewState);
  document = history.redo(document); assert.equal(document.nodes[c.nodeId].parentId, b.nodeId);
});
test('自分・子孫・中心の移動を拒否して元文書を変更しない', () => {
  const document = createDocument(); const a = addNode(document, document.rootId); const b = addNode(a.document, a.nodeId);
  const before = JSON.stringify(b.document);
  assert.throws(() => executeCommand(b.document, { type: 'MoveSubtree', id: a.nodeId, parentId: b.nodeId }));
  assert.throws(() => executeCommand(b.document, { type: 'MoveSubtree', id: a.nodeId, parentId: a.nodeId }));
  assert.throws(() => executeCommand(b.document, { type: 'MoveSubtree', id: document.rootId, parentId: b.nodeId }));
  assert.equal(JSON.stringify(b.document), before);
});
test('コピーは最上位選択だけを保持し、全IDとメモ・書式を複製する', () => {
  let document = createDocument(); const a = addNode(document, document.rootId, '主枝'); document = a.document;
  const b = addNode(document, a.nodeId, '子'); document = b.document;
  document = executeCommand(document, { type: 'SetNote', id: b.nodeId, note: 'メモ\n二行' });
  document = executeCommand(document, { type: 'SetStyle', ids: [b.nodeId], style: { fontSize: 20, branchColor: '#ABCDEF' } });
  document = executeCommand(document, { type: 'ToggleCollapse', id: a.nodeId });
  assert.deepEqual(getTopLevelSelection(document, [a.nodeId, b.nodeId]), [a.nodeId]);
  const copied = copySubtrees(document, [a.nodeId, b.nodeId]); const pasted = pasteSubtrees(document, document.rootId, copied);
  assert.equal(pasted.nodeIds.length, 1); assert.notEqual(pasted.nodeIds[0], a.nodeId);
  const child = pasted.document.nodes[pasted.document.nodes[pasted.nodeIds[0]].childIds[0]];
  assert.equal(child.note, 'メモ\n二行'); assert.equal(child.style?.fontSize, 20); assert.equal(child.style?.branchColor, '#ABCDEF');
  assert.ok(pasted.document.viewState.collapsedNodeIds.includes(pasted.nodeIds[0])); validateDocument(pasted.document);
});
test('削除は子孫と折り畳み参照を一緒に取り除き中心は削除不可', () => {
  const initial = createDocument(); const a = addNode(initial, initial.rootId); const b = addNode(a.document, a.nodeId);
  let document = executeCommand(b.document, { type: 'ToggleCollapse', id: a.nodeId });
  document = executeCommand(document, { type: 'DeleteSubtree', ids: [a.nodeId, b.nodeId] });
  assert.equal(Object.keys(document.nodes).length, 1); assert.deepEqual(document.viewState.collapsedNodeIds, []);
  assert.throws(() => executeCommand(document, { type: 'DeleteSubtree', ids: [document.rootId] }));
});
test('破損した親子・到達不能・不正リンク・未知版・不正表示状態を拒否する', () => {
  const initial = createDocument(); const a = addNode(initial, initial.rootId);
  for (const mutate of [
    (document: any) => document.nodes[a.nodeId].parentId = a.nodeId,
    (document: any) => document.nodes[document.rootId].childIds.push(a.nodeId),
    (document: any) => document.nodes[document.rootId].childIds = [],
    (document: any) => document.nodes[a.nodeId].link = 'javascript:alert(1)',
    (document: any) => document.schemaVersion = 99,
    (document: any) => document.viewState.camera.zoom = Infinity,
    (document: any) => document.nodes[a.nodeId].style = { branchColor: 'red"/>' },
  ]) { const document = structuredClone(a.document); mutate(document); assert.throws(() => validateDocument(document)); }
});
test('空本文は既定名で確定し本文上限を守る', () => {
  let document = createDocument('Redis'); document = executeCommand(document, { type: 'EditText', id: document.rootId, text: '' }); assert.equal(document.title, '中心トピック');
  const a = addNode(document, document.rootId); document = executeCommand(a.document, { type: 'EditText', id: a.nodeId, text: ' ' }); assert.equal(document.nodes[a.nodeId].text, 'トピック');
  assert.throws(() => executeCommand(document, { type: 'EditText', id: a.nodeId, text: 'あ'.repeat(2001) }));
});
test('固定乱数の追加・移動・削除500回で木構造を保つ', () => {
  let document = createDocument(); let state = 1492;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  for (let iteration = 0; iteration < 500; iteration++) {
    const ids = Object.keys(document.nodes); const selected = ids[Math.floor(random() * ids.length)]; const action = random();
    if (action < .6 || ids.length < 3) document = addNode(document, selected, `考え${iteration}`).document;
    else if (action < .8 && selected !== document.rootId) document = executeCommand(document, { type: 'DeleteSubtree', ids: [selected] });
    else if (selected !== document.rootId) {
      const invalid = new Set([selected, ...getDescendantIds(document, selected)]); const parents = ids.filter(id => !invalid.has(id));
      document = executeCommand(document, { type: 'MoveSubtree', id: selected, parentId: parents[Math.floor(random() * parents.length)] });
    }
    validateDocument(document);
  }
});
