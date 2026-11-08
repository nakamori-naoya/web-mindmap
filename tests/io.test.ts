import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, addNode, executeCommand, MAX_DOCUMENT_BYTES } from '../src/domain/index';
import { exportJSON, importJSON, importMarkdown, exportMarkdown, exportSVG, exportImageSize } from '../src/io/index';
test('JSON往復で本文・順序・メモ・書式・表示状態を保持し新規IDにする', () => {
  const initial = createDocument('Redis'); const a = addNode(initial, initial.rootId, '複製');
  let document = executeCommand(a.document, { type: 'SetNote', id: a.nodeId, note: 'ノート\nを保持' });
  document = executeCommand(document, { type: 'SetStyle', ids: [a.nodeId], style: { branchColor: '#F175A6', fontSize: 24 } });
  const restored = importJSON(exportJSON(document)); assert.notEqual(restored.documentId, document.documentId); assert.deepEqual(restored.nodes, document.nodes); assert.deepEqual(restored.viewState, document.viewState);
  assert.deepEqual(importJSON(exportJSON(document), { newIdentity: false }), document);
});
test('JSON破損・重複キー・巨大ファイルを拒否する', () => {
  const document = createDocument(); const json = exportJSON(document);
  assert.throws(() => importJSON('{"a":1,"a":2}'), /重複/);
  assert.throws(() => importJSON(json.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1')), /重複/);
  assert.throws(() => importJSON(json.slice(0, -4)));
  assert.throws(() => importJSON(' '.repeat(MAX_DOCUMENT_BYTES + 1)), /10MB/);
});
test('Markdownは最初のH1、飛び見出し、複数H1、箇条書き、段落、コードを保持する', () => {
  const document = importMarkdown('# 主題\n説明\n### 飛び\n- 項目\n  - 内側\nメモ\n```html\n<h1>実行しない</h1>\n# 見出しではない\n```\n# 二つ目\n本文\n', '入力.md');
  const root = document.nodes[document.rootId]; assert.equal(root.text, '主題'); assert.ok(root.note.includes('説明')); assert.equal(root.childIds.length, 2);
  const heading = document.nodes[root.childIds[0]]; assert.equal(heading.text, '飛び');
  const child = document.nodes[document.nodes[heading.childIds[0]].childIds[0]]; assert.equal(child.text, '内側'); assert.ok(child.note.includes('```html\n<h1>実行しない</h1>\n# 見出しではない\n```'));
  assert.equal(document.nodes[root.childIds[1]].text, '二つ目'); assert.ok(exportMarkdown(document).includes('  - 内側'));
  assert.throws(() => importMarkdown(' \n ')); assert.equal(importMarkdown('- A', 'ファイル.md').title, 'ファイル');
});
test('SVGは画面外・折り畳み子孫と日本語を含みHTMLを実行しない自己完結形式', () => {
  const initial = createDocument('日本語<&'); const a = addNode(initial, initial.rootId, '子<script>alert(1)</script>'); const b = addNode(a.document, a.nodeId, '隠れた枝');
  const document = executeCommand(b.document, { type: 'ToggleCollapse', id: a.nodeId }); const svg = exportSVG(document);
  assert.ok(svg.includes('隠れた枝')); assert.ok(svg.includes('日本語&lt;&amp;')); assert.ok(svg.includes('&lt;script&gt;')); assert.ok(!svg.includes('<script>')); assert.ok(!svg.includes('foreignObject')); assert.ok(!svg.includes('http://') || svg.includes('xmlns="http://www.w3.org/2000/svg"'));
  const size = exportImageSize(document, 2); assert.ok(size.width <= 4096 && size.height <= 4096);
});
