import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
export const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const dataDir = resolve(process.env.MINDMAP_DATA_DIR || resolve(rootDir, 'data'));
export function port(defaultPort: number) {
  const index = process.argv.indexOf('--port');
  const value = Number(index >= 0 ? process.argv[index + 1] : process.env.PORT || defaultPort);
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error('portは1〜65535で指定してください。');
  return value;
}
