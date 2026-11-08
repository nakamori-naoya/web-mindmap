import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { rootDir } from '../server/config.ts';
const lock = JSON.parse(readFileSync(resolve(rootDir, 'package-lock.json'), 'utf8'));
const rows = Object.entries(lock.packages as Record<string, { version?: string; license?: string }>).filter(([path]) => path).map(([path, value]) => {
  let metadata: Record<string, unknown> = {};
  try { metadata = JSON.parse(readFileSync(resolve(rootDir, path, 'package.json'), 'utf8')); } catch {}
  const repository = metadata.repository as { url?: string } | string | undefined;
  return { name: metadata.name || path.split('node_modules/').at(-1), version: value.version, license: metadata.license || value.license || 'UNKNOWN', repository: typeof repository === 'string' ? repository : repository?.url || null };
});
const destination = resolve(rootDir, 'docs/dependency-licenses.json');
writeFileSync(destination, JSON.stringify({ generatedAt: new Date().toISOString(), packages: rows }, null, 2) + '\n');
console.log(destination);
