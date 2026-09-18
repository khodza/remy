#!/usr/bin/env node
// Copies the HTTP contract into the sibling frontend repo as a generated
// file. `--check` exits 1 when the frontend copy is missing or out of date.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'src/contract/remy-contract.ts');
const target = resolve(
  process.env.REMY_WEBAPP_DIR ?? resolve(root, '../remy-webapp'),
  'src/shared/api/contract.gen.ts',
);

const body = readFileSync(source, 'utf8');
const hash = createHash('sha256').update(body).digest('hex');
const banner =
  `// GENERATED FILE — DO NOT EDIT.\n` +
  `// Source: remy/src/contract/remy-contract.ts (backend repo).\n` +
  `// Regenerate from the backend repo with: npm run contract:sync\n` +
  `// contract-sha256: ${hash}\n\n`;
const output = banner + body;

if (process.argv.includes('--check')) {
  if (!existsSync(target)) {
    console.error(`✗ ${target} is missing. Run: npm run contract:sync`);
    process.exit(1);
  }
  if (readFileSync(target, 'utf8') !== output) {
    console.error('✗ Frontend contract copy is out of date. Run: npm run contract:sync');
    process.exit(1);
  }
  console.log(`✓ Frontend contract copy is up to date (${hash.slice(0, 12)})`);
  process.exit(0);
}

if (!existsSync(dirname(target))) mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, output);
console.log(`✓ Wrote ${target} (${hash.slice(0, 12)})`);
