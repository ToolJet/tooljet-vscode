import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { cliEnv, spawnSpec } from '../src/spawnSpec';
import { ago, describeStatus } from '../src/statusText';

test('spawns without a shell on macOS and Linux, passing arguments as they are', () => {
  for (const platform of ['darwin', 'linux'] as const) {
    assert.deepEqual(spawnSpec('tooljet', ['app', 'clone', 'id', 'my folder; rm -rf ~'], platform), {
      command: 'tooljet',
      args: ['app', 'clone', 'id', 'my folder; rm -rf ~'],
      shell: false,
    });
  }
});

test('on Windows quotes spaces and refuses shell metacharacters', () => {
  assert.deepEqual(spawnSpec('tooljet', ['app', 'clone', 'id', 'my app'], 'win32'), {
    command: 'tooljet',
    args: ['app', 'clone', 'id', '"my app"'],
    shell: true,
  });
  for (const bad of ['a&b', 'a|b', 'a"b', '%PATH%', 'a^b', 'a>b', 'a\nb', '!x!']) {
    assert.throws(() => spawnSpec('tooljet', ['app', bad], 'win32'));
  }
});

const project = { name: 'Orders', appId: 'abc', instance: 'http://localhost:3055', version: 'v2' };
const now = new Date('2026-11-02T10:10:00Z');

test('status text: app, instance and dev state', () => {
  assert.equal(describeStatus(project, undefined, now).text, '$(tools) Orders · localhost:3055');
  assert.equal(describeStatus(project, { state: 'starting', findings: [] }, now).text, '$(tools) Orders · localhost:3055 $(loading~spin)');
  assert.equal(
    describeStatus(project, { state: 'running', lastUpload: '2026-11-02T10:08:00Z', lastBuildMs: '300ms', findings: [] }, now).text,
    '$(tools) Orders · localhost:3055 $(pass) 2 min ago'
  );
  const err = describeStatus(project, { state: 'error', error: 'build failed: x', findings: [] }, now);
  assert.equal(err.isError, true);
  assert.match(err.tooltip, /Dev: build failed: x/);
  const warn = describeStatus(project, { state: 'running', lastUpload: '2026-11-02T10:09:50Z', lastBuildMs: '1s', findings: [{ severity: 'warning', file: 'f', line: 1, message: 'm', source: 's' }] }, now);
  assert.equal(warn.text, '$(tools) Orders · localhost:3055 $(pass) just now $(warning) 1');
  assert.match(warn.tooltip, /version v2/);
});

test('status text escapes names that come from the app', () => {
  const s = describeStatus({ ...project, name: '$(alert) [x](command:evil)' }, undefined, now);
  assert.ok(!s.text.includes('$(alert)'));
  assert.ok(!s.tooltip.includes('[x](command:evil)'));
});

test('ago', () => {
  assert.equal(ago('2026-11-02T10:09:40Z', now), 'just now');
  assert.equal(ago('2026-11-02T09:40:00Z', now), '30 min ago');
});

test('CLI runs never inherit an instance or token from the shell', () => {
  const env = cliEnv({ PATH: '/bin', HOME: '/h', TOOLJET_URL: 'http://localhost:3000', TOOLJET_PAT: 'x', TOOLJET_TOKEN: 'y', tooljet_pat: 'z', TOOLJET_APP_URL: 'http://localhost:8120' }, true);
  assert.deepEqual(env, { PATH: '/bin', HOME: '/h', TOOLJET_APP_URL: 'http://localhost:8120', FORCE_COLOR: '1' });
});
