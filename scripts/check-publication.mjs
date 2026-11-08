import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';

// Inspect only Git candidates/index/ref blobs; never read ignored local secrets or databases.
const args = process.argv.slice(2);
const staged = args.includes('--staged');
const refIndex = args.indexOf('--ref');
const ref = refIndex < 0 ? undefined : args[refIndex + 1];
if (refIndex >= 0 && !ref) throw new Error('--ref requires a Git revision');
const git = (...args) => execFileSync('git', args, { maxBuffer: 32 * 1024 * 1024 });
const root = git('rev-parse', '--show-toplevel').toString().trim();
process.chdir(root);
const list = ref
  ? git('ls-tree', '-r', '--name-only', '-z', ref)
  : staged ? git('ls-files', '-z') : git('ls-files', '--cached', '--others', '--exclude-standard', '-z');
const files = [...new Set(list.toString().split('\0').filter(Boolean))];
const forbiddenPath = /(?:^|\/)docs\/ux-evaluation(?:\/|$)|(?:^|\/)(?:data|backup|backups|dist|node_modules|test-results|playwright-report|\.git|\.aws|\.ssh|\.codex|\.claude)(?:\/|$)|(?:^|\/)\.env[^/]*$|\.(?:sqlite[^/]*|db(?:-[^/]*)?|pem|key|p12|pfx|keystore|log)$|(?:^|\/)(?:id_rsa|id_ed25519|credentials|\.npmrc|\.netrc|\.DS_Store)$/i;
const privatePath = /(?:\/Users|\/home)\/[a-zA-Z0-9._-]+\//;
const privateKey = /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/;
let failures = 0;
for (const file of files) {
  const reasons = [];
  if (forbiddenPath.test(file)) reasons.push('private/runtime file');
  let content;
  try { content = ref ? git('show', `${ref}:${file}`) : staged ? git('show', `:${file}`) : lstatSync(file).isSymbolicLink() ? Buffer.from(readlinkSync(file)) : readFileSync(file); }
  catch { if (!ref && !staged) continue; throw new Error(`Cannot inspect Git blob: ${file}`); }
  if (content.length > 5 * 1024 * 1024) reasons.push('file exceeds publication size limit (5 MiB)');
  const text = content.toString('utf8');
  if (privatePath.test(text)) reasons.push('personal absolute path');
  if (privateKey.test(text)) reasons.push('private key material');
  if (reasons.length) { failures++; console.error(`${file}: ${reasons.join(', ')}`); }
}
if (failures) { console.error(`Publication check blocked ${failures} file(s). Values are not printed.`); process.exitCode = 1; }
else console.log(`Publication check passed (${files.length} Git candidate files).`);
