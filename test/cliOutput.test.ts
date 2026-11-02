import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

import { DevOutputParser, DevStatus, parseCheckOutput, stripAnsi } from '../src/cliOutput';

// Both fixtures are real output: check-fail.txt from `tooljet app check --offline` on a scaffolded project with
// two broken references and an <img> without alt; dev-ts-errors.txt is dev's error line followed by TypeScript's
// formatDiagnosticsWithColorAndContext, as dev prints it.
const fixture = (name: string) => fs.readFileSync(path.join(__dirname, '..', '..', 'test', 'fixtures', name), 'utf8');

test('parses real check output into findings relative to the project root', () => {
  const r = parseCheckOutput(fixture('check-fail.txt'), 1);
  assert.equal(r.passed, false);
  assert.deepEqual(r.generalErrors, []);
  assert.deepEqual(
    r.findings.map((f) => [f.severity, f.file, f.line, f.message, f.code]),
    [
      ['warning', 'frontend/src/App/index.tsx', 29, 'img elements must have an alt prop, either with meaningful text, or an empty string for decorative images.', 'jsx-a11y/alt-text'],
      ['error', 'frontend/src/App/index.tsx', 29, 'query "listOrders" does not exist in the app (pull lists 0 queries)', undefined],
      ['error', 'frontend/src/App/index.tsx', 29, 'link to "/nowhere" matches no route in app.json', undefined],
    ]
  );
});

test('check errors that name no file are general errors', () => {
  const r = parseCheckOutput('\n\x1b[1;31m✗ Error\x1b[0m : app.json has no appId: create the app or clone one, or pass --offline.\n', 1);
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.generalErrors, ['app.json has no appId: create the app or clone one, or pass --offline.']);
});

test('a passing check has no findings', () => {
  const r = parseCheckOutput('\x1b[1;32m✓\x1b[0m No problems: 3 queries, 2 routes, 1 pages checked\n', 0);
  assert.equal(r.passed, true);
  assert.deepEqual(r.findings, []);
});

test('stripAnsi removes colour codes', () => {
  assert.equal(stripAnsi('\x1b[1;31m✗ Error\x1b[0m : x'), '✗ Error : x');
});

const devLines = {
  ready: '\x1b[1;32m✓\x1b[0m Dev track for "Orders Desk" (4 queries typed). Watching frontend/src ...\n\n',
  linked: '  \x1b[1;32m✓\x1b[0m Linked the app\'s code (2 route pages created). Open: http://localhost:8120/final/apps/abc/home\n',
  uploaded: (iso: string) => `  \x1b[1;32m✓\x1b[0m [${iso}] built in 412ms, uploaded (183 KB)\n`,
  warning: '  \x1b[1;33m⚠ Warning\x1b[0m : src/pages/Orders.tsx:14 query "listOrderz" does not exist in the app\n',
  buildFailed: '  \n\x1b[1;31m✗ Error\x1b[0m : build failed: Could not resolve "./Nope"\n\n',
};

test('follows dev through ready, link, warnings and uploads, in any chunking', () => {
  const all = devLines.ready + devLines.linked + devLines.warning + devLines.uploaded('2026-11-02T10:00:00.000Z');
  for (const size of [1, 7, all.length]) {
    const seen: DevStatus[] = [];
    const p = new DevOutputParser((s) => seen.push(s));
    for (let i = 0; i < all.length; i += size) p.feed(all.slice(i, i + size));
    assert.equal(p.status.state, 'running');
    assert.equal(p.status.lastUpload, '2026-11-02T10:00:00.000Z');
    assert.equal(p.status.lastBuildMs, '412ms');
    assert.equal(p.status.editorUrl, 'http://localhost:8120/final/apps/abc/home');
    assert.deepEqual(
      p.status.findings.map((f) => [f.severity, f.file, f.line, f.message]),
      [['warning', 'frontend/src/pages/Orders.tsx', 14, 'query "listOrderz" does not exist in the app']]
    );
    assert.ok(seen.some((s) => s.state === 'running' && !s.lastUpload), 'reports running before the first upload');
  }
});

test('a clean rebuild clears the previous warnings', () => {
  const p = new DevOutputParser();
  p.feed(devLines.ready + devLines.warning + devLines.uploaded('2026-11-02T10:00:00.000Z'));
  assert.equal(p.status.findings.length, 1);
  p.feed(devLines.uploaded('2026-11-02T10:01:00.000Z'));
  assert.equal(p.status.findings.length, 0);
  assert.equal(p.status.lastUpload, '2026-11-02T10:01:00.000Z');
});

test('a failed build is an error until the next upload', () => {
  const p = new DevOutputParser();
  p.feed(devLines.ready + devLines.uploaded('2026-11-02T10:00:00.000Z') + devLines.buildFailed);
  assert.equal(p.status.state, 'error');
  assert.equal(p.status.error, 'build failed: Could not resolve "./Nope"');
  assert.equal(p.status.lastUpload, '2026-11-02T10:00:00.000Z', 'keeps the last good upload');
  p.feed(devLines.uploaded('2026-11-02T10:02:00.000Z'));
  assert.equal(p.status.state, 'running');
  assert.equal(p.status.error, undefined);
});

test('TypeScript errors (real tsc format) become findings with line and column', () => {
  const p = new DevOutputParser();
  p.feed(devLines.ready + fixture('dev-ts-errors.txt'));
  assert.equal(p.status.state, 'error');
  assert.equal(p.status.error, '2 TypeScript error(s); not uploaded');
  assert.deepEqual(
    p.status.findings.map((f) => [f.severity, f.file, f.line, f.column, f.code, f.message]),
    [
      ['error', 'frontend/src/App.tsx', 1, 7, 'TS2322', "Type 'string' is not assignable to type 'number'."],
      ['error', 'frontend/src/App.tsx', 2, 35, 'TS2339', "Property 'nope' does not exist on type 'string'."],
    ]
  );
  p.feed(devLines.uploaded('2026-11-02T10:03:00.000Z'));
  assert.deepEqual(p.status.findings, []);
});

test('exit codes end the dev status', () => {
  const stopped = new DevOutputParser();
  stopped.feed(devLines.ready);
  stopped.exited(0);
  assert.equal(stopped.status.state, 'stopped');

  const failed = new DevOutputParser();
  failed.feed('\n\x1b[1;31m✗ Error\x1b[0m : The ToolJet token was rejected: check it is a current personal access token for this instance.\n');
  failed.exited(1);
  assert.equal(failed.status.state, 'error');
  assert.match(failed.status.error ?? '', /token was rejected/);

  const crashed = new DevOutputParser();
  crashed.exited(137);
  assert.equal(crashed.status.state, 'error');
  assert.match(crashed.status.error ?? '', /code 137/);
});
