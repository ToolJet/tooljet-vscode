#!/usr/bin/env node
// A stand-in for the `tooljet` CLI in the integration test: logs each call and prints the CLI's real wording.
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_TOOLJET_LOG, JSON.stringify({ args, cwd: process.cwd() }) + '\n');
const key = args.join(' ');
const ok = (s) => `\x1b[1;32m✓\x1b[0m ${s}`;
const err = (s) => `\n\x1b[1;31m✗ Error\x1b[0m : ${s}\n`;
if (key === '--version') return console.log('@tooljet/cli/0.0.15-beta.1 fake');
if (key.endsWith('--help')) return console.log('USAGE');
if (key === 'app pull') return console.log(ok('Pulled "Demo": 0 queries (0 with row types), 1 pages'));
if (key === 'skill install') return console.log(ok('CLAUDE.md: created'));
if (key === 'app check') {
  process.stdout.write(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'check-fail.txt'), 'utf8'));
  process.exit(1);
}
if (key === 'app dev') {
  console.log(ok('Live preview of "Demo" is on (0 queries). Watching frontend/src ...\n'));
  setTimeout(() => console.log(`  ${ok(`[${new Date().toISOString()}] built in 120ms, uploaded (80 KB)`)}`), 300);
  process.on('SIGINT', () => process.exit(0));
  setInterval(() => {}, 1000);
  return;
}
console.log(err(`fake tooljet: unexpected ${key}`));
process.exit(1);
