import { cpus, totalmem, platform, release } from 'node:os';
import { performance } from 'node:perf_hooks';
import { createDocument, validateDocument, type MindmapDocument } from '../src/domain/index';
import { layoutDocument } from '../src/layout/index';
function fixture(count: number): MindmapDocument {
  const document = createDocument('性能検証'); const ids = [document.rootId];
  for (let index = 1; index < count; index++) {
    const id = crypto.randomUUID(); const parentId = ids[index === count - 1 ? index - 1 : Math.floor((index - 1) / 2)];
    document.nodes[id] = { id, parentId, childIds: [], text: '考える速さを妨げない日本語マインドマップの性能と重なりを確認する文章です。'.padEnd(40, '。').slice(0, 40), note: '', ...(parentId === document.rootId ? { side: index === 1 ? 'left' as const : 'right' as const } : {}) };
    document.nodes[parentId].childIds.push(id); ids.push(id);
  }
  validateDocument(document); return document;
}
const measurements = [1000, 5000].map(count => {
  const document = fixture(count); const original = JSON.stringify(document); const coldStart = performance.now(); layoutDocument(document); const cold = performance.now() - coldStart;
  const durations: number[] = [];
  for (let iteration = 0; iteration < 50; iteration++) { const start = performance.now(); const result = layoutDocument(document); durations.push(performance.now() - start); if (result.nodes.length !== count) throw new Error('ノード欠落'); }
  durations.sort((a, b) => a - b); if (JSON.stringify(document) !== original) throw new Error('文書変更');
  let maximumDepth = 0; const stack: [string, number][] = [[document.rootId, 0]];
  while (stack.length) { const [id, depth] = stack.pop()!; maximumDepth = Math.max(maximumDepth, depth); for (const child of document.nodes[id].childIds) stack.push([child, depth + 1]); }
  return { nodes: count, maximumDepth, averageCharacters: Object.values(document.nodes).reduce((sum, node) => sum + node.text.length, 0) / count, coldMs: Number(cold.toFixed(3)), p50Ms: Number(durations[24].toFixed(3)), p95Ms: Number(durations[47].toFixed(3)), trials: durations.length };
});
console.log(JSON.stringify({ measuredAt: new Date().toISOString(), runtime: process.version, platform: `${platform()} ${release()} ${process.arch}`, cpu: cpus()[0].model, memoryGB: Number((totalmem() / 1024 ** 3).toFixed(1)), scope: 'Node.js純粋配置関数。DOM表示・フォント計測・パン・ドラッグのフレーム時間を含まない。温測定は文字幅キャッシュあり。', measurements }, null, 2));
