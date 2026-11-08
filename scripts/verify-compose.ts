import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createDocument } from '../src/domain/index.ts';
import { rootDir } from '../server/config.ts';
import assert from 'node:assert/strict';
const context = execFileSync('/usr/local/bin/docker', ['context', 'show'], { encoding: 'utf8' }).trim();
const contextDetails = JSON.parse(execFileSync('/usr/local/bin/docker', ['context', 'inspect', context], { encoding: 'utf8' }));
if (process.env.DOCKER_HOST || !String(contextDetails[0]?.Endpoints?.docker?.Host).startsWith('unix://')) throw new Error('ローカルUnixソケットのDocker contextだけを検証できます。');
const dir = mkdtempSync(resolve(tmpdir(), 'mindmap-compose-'));
const composeFile = resolve(dir, 'compose.json');
const project = `web-mindmap-acceptance-${process.pid}`;
const serverPort = 4174;
mkdirSync(resolve(dir, 'data')); mkdirSync(resolve(dir, 'backup'));
writeFileSync(composeFile, JSON.stringify({ services: { app: { image: 'web-mindmap-app:latest', init: true, ports: [`127.0.0.1:${serverPort}:${serverPort}`], environment: { PORT: String(serverPort), MINDMAP_BIND_HOST: '0.0.0.0', MINDMAP_DATA_DIR: '/app/data' }, volumes: [`${dir}/data:/app/data`, `${dir}/backup:/app/backup`], stop_grace_period: '20s' } } }));
const docker = (args: string[]) => execFileSync('/usr/local/bin/docker', ['compose', '-p', project, '-f', composeFile, ...args], { encoding: 'utf8', timeout: 60000 });
const base = `http://127.0.0.1:${serverPort}`;
async function ready() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('コンテナ起動待ちがタイムアウトしました。');
}
async function api(path: string, method = 'GET', doc?: unknown) {
  const response = await fetch(`${base}/api/maps${path}`, { method, headers: { Origin: base, 'Content-Type': 'application/json' }, body: doc === undefined ? undefined : JSON.stringify(doc) });
  assert.ok(response.ok, `${method} ${path}: ${response.status}`);
  return response.status === 204 ? undefined : response.json();
}
const steps: string[] = []; const started = performance.now();
try {
  docker(['up', '-d']); await ready(); steps.push('Composeで専用ポート・永続bind mountへ起動');
  const doc = createDocument('Compose永続化試験'); doc.nodes[doc.rootId].note = '復元する日本語メモ';
  const other = createDocument('別マップ'); await api('', 'POST', doc); await api('', 'POST', other);
  docker(['restart', 'app']); await ready(); assert.deepEqual(await api(`/${doc.documentId}`), doc); assert.equal((await api('')).length, 2); steps.push('2マップ保存→コンテナ再起動→同一内容を再読込');
  docker(['kill', '-s', 'SIGKILL', 'app']); docker(['start', 'app']); await ready(); assert.deepEqual(await api(`/${doc.documentId}`), doc); steps.push('SIGKILLで異常終了→同じコンテナを再起動→保存内容を再読込');
  docker(['exec', '-T', 'app', 'npm', 'run', 'backup', '--', '/app/backup/acceptance.sqlite']); steps.push('稼働中SQLiteのバックアップAPIでコピー作成');
  const modified = structuredClone(doc); modified.title = 'バックアップ後の変更'; modified.revision++; await api(`/${doc.documentId}`, 'PUT', modified);
  docker(['stop', 'app']);
  docker(['run', '--rm', '--no-deps', 'app', 'npm', 'run', 'restore', '--', '/app/backup/acceptance.sqlite', '--confirm']); steps.push('正常停止→現状退避→バックアップ復元→整合性検査');
  docker(['up', '-d']); await ready(); assert.deepEqual(await api(`/${doc.documentId}`), doc); assert.deepEqual(await api(`/${other.documentId}`), other); steps.push('復元後再起動→全マップ・日本語メモを比較して一致');
  writeFileSync(resolve(rootDir, 'docs/compose-verification.json'), JSON.stringify({ checkedAt: new Date().toISOString(), image: 'web-mindmap-app:latest', localDockerContext: context, hostBinding: `127.0.0.1:${serverPort}`, elapsedMs: Math.round(performance.now() - started), steps, result: 'passed' }, null, 2) + '\n');
  console.log('Composeの永続化・再起動・実リストア試験に成功しました。');
} catch (error) { console.error(docker(['logs', '--no-color', 'app'])); throw error; } finally { try { docker(['down']); } finally { rmSync(dir, { recursive: true, force: true }); } }
