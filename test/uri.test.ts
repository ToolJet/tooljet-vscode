import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { buildOpenUri, parseInstance, parseOpenUri } from '../src/uri';

const APP = '421df0e7-861a-43fd-9b31-fa67f6649dfa';
const q = (params: Record<string, string>) => new URLSearchParams(params).toString();
const ok = (query: string, path = '/open') => {
  const r = parseOpenUri(path, query);
  assert.ok(r.ok, `expected ok for ${query}: ${!r.ok && r.error}`);
  return r.value;
};
const refused = (query: string, pattern?: RegExp, path = '/open', fragment = '') => {
  const r = parseOpenUri(path, query, fragment);
  assert.equal(r.ok, false, `expected refusal for ${path}?${query}#${fragment}`);
  if (pattern && !r.ok) assert.match(r.error, pattern);
};

test('accepts an https instance and an app id', () => {
  assert.deepEqual(ok(q({ instance: 'https://tooljet.example.com', app: APP })), { instance: 'https://tooljet.example.com', appId: APP });
});

test('normalises the instance to its origin and the app id to lower case', () => {
  const v = ok(q({ instance: 'https://TOOLJET.example.com:443/', app: APP.toUpperCase() }));
  assert.equal(v.instance, 'https://tooljet.example.com');
  assert.equal(v.appId, APP);
});

test('accepts http only for loopback hosts', () => {
  assert.equal(ok(q({ instance: 'http://localhost:3055', app: APP })).instance, 'http://localhost:3055');
  assert.equal(ok(q({ instance: 'http://127.0.0.1:8120', app: APP })).instance, 'http://127.0.0.1:8120');
  assert.equal(ok(q({ instance: 'http://[::1]:3000', app: APP })).instance, 'http://[::1]:3000');
  refused(q({ instance: 'http://tooljet.example.com', app: APP }), /https/);
  refused(q({ instance: 'http://localhost.evil.com', app: APP }), /https/);
  refused(q({ instance: 'http://127.0.0.1.nip.io', app: APP }), /https/);
  refused(q({ instance: 'http://10.0.0.5', app: APP }), /https/);
});

test('accepts a version and a folder name', () => {
  const v = ok(q({ instance: 'https://t.example.com', app: APP, version: 'v2 beta.1', folder: 'orders-desk' }));
  assert.equal(v.version, 'v2 beta.1');
  assert.equal(v.folder, 'orders-desk');
});

test('round-trips through buildOpenUri', () => {
  for (const scheme of ['vscode', 'cursor', 'windsurf'] as const) {
    const link = buildOpenUri(scheme, { instance: 'https://t.example.com', appId: APP, version: 'v1' });
    const url = new URL(link);
    assert.equal(url.protocol, `${scheme}:`);
    assert.equal(url.host, 'tooljet.tooljet');
    assert.deepEqual(ok(url.search.slice(1), url.pathname), { instance: 'https://t.example.com', appId: APP, version: 'v1' });
  }
});

test('refuses any link carrying a credential, whatever it is called', () => {
  for (const name of ['token', 'access_token', 'pat', 'PAT', 'apiKey', 'api_key', 'key', 'secret', 'password', 'auth', 'authorization', 'session', 'jwt', 'code', 'otp', 'credentials', 'cookie', 'sig']) {
    refused(`instance=https%3A%2F%2Ft.example.com&app=${APP}&${name}=abc`, /credential/);
  }
  // A token-shaped value under an allowed name is refused too.
  refused(q({ instance: 'https://t.example.com', app: APP, version: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig' }), /credential/);
  refused(q({ instance: 'https://t.example.com', app: APP, folder: 'Bearer abc' }), /credential|folder/);
});

test('refuses user info, paths, queries and fragments in the instance', () => {
  refused(q({ instance: 'https://user:pass@t.example.com', app: APP }), /user name or password/);
  refused(q({ instance: 'https://user@t.example.com', app: APP }), /user name or password/);
  refused(q({ instance: 'https://t.example.com/api', app: APP }), /origin only/);
  refused(q({ instance: 'https://t.example.com?x=1', app: APP }), /origin only/);
  refused(q({ instance: 'https://t.example.com#x', app: APP }), /origin only/);
  refused(q({ instance: 'https://t.example.com/?', app: APP }), /origin only/);
});

test('refuses other schemes', () => {
  for (const instance of ['javascript:alert(1)', 'file:///etc/passwd', 'ftp://t.example.com', 'data:text/html,x', 'vscode://x', '//t.example.com', 't.example.com', '']) {
    refused(q({ instance, app: APP }));
  }
});

test('refuses app ids that are not UUIDs', () => {
  for (const app of ['', '123', `${APP}x`, `${APP} `, '../../etc', `${APP};rm -rf ~`, '421df0e7861a43fd9b31fa67f6649dfa', '$(whoami)']) {
    refused(q({ instance: 'https://t.example.com', app }));
  }
});

test('refuses unknown, repeated or missing parameters', () => {
  refused(q({ instance: 'https://t.example.com', app: APP, cwd: '/tmp' }), /unknown parameter "cwd"/);
  refused(`instance=https%3A%2F%2Ft.example.com&app=${APP}&app=${APP}`, /repeats/);
  refused(`instance=https%3A%2F%2Fa.example.com&instance=https%3A%2F%2Fb.example.com&app=${APP}`, /repeats/);
  refused(q({ app: APP }), /no instance/);
  refused(q({ instance: 'https://t.example.com' }), /no app id/);
});

test('refuses other paths and fragments', () => {
  refused(q({ instance: 'https://t.example.com', app: APP }), /Unknown/, '/clone');
  refused(q({ instance: 'https://t.example.com', app: APP }), /Unknown/, '/open/');
  refused(q({ instance: 'https://t.example.com', app: APP }), /Unknown/, '');
  refused(q({ instance: 'https://t.example.com', app: APP }), /fragment/, '/open', 'token=abc');
});

test('refuses folder names that leave the parent folder or carry shell syntax', () => {
  for (const folder of ['..', '../x', 'a/b', 'a\\b', '/abs', '~', '.hidden', 'a..b', 'x;y', '$(id)', '`id`', 'a b', 'x'.repeat(65)]) {
    refused(q({ instance: 'https://t.example.com', app: APP, folder }));
  }
});

test('refuses version names with shell or path syntax', () => {
  for (const version of ['', ' v1', 'v1;rm', 'v1|x', 'v1&x', '$(id)', '../v1/..x/', 'v1\nx', 'x'.repeat(65)]) {
    refused(q({ instance: 'https://t.example.com', app: APP, version }));
  }
});

test('parseInstance is usable on its own', () => {
  assert.deepEqual(parseInstance('https://t.example.com'), { ok: true, origin: 'https://t.example.com' });
  assert.equal(parseInstance('nope').ok, false);
});

test('api: an optional server origin, checked like the instance, dropped when it is the instance', () => {
  const q = (extra: string) => `instance=http%3A%2F%2Flocalhost%3A8120&app=421df0e7-861a-43fd-9b31-fa67f6649dfa${extra}`;
  const ok = parseOpenUri('/open', q('&api=http%3A%2F%2Flocalhost%3A3055'));
  assert.deepEqual(ok.ok && ok.value, { instance: 'http://localhost:8120', api: 'http://localhost:3055', appId: '421df0e7-861a-43fd-9b31-fa67f6649dfa' });
  const same = parseOpenUri('/open', q('&api=http%3A%2F%2Flocalhost%3A8120%2F'));
  assert.equal(same.ok && same.value.api, undefined);
  for (const bad of ['http%3A%2F%2Fapi.example.com', 'https%3A%2F%2Fapi.example.com%2Fapi', 'javascript%3Aalert(1)']) {
    const r = parseOpenUri('/open', q(`&api=${bad}`));
    assert.equal(r.ok, false, bad);
  }
  assert.equal(parseOpenUri('/open', q('&api=https%3A%2F%2Fa.example.com&api=https%3A%2F%2Fb.example.com')).ok, false);
  assert.equal(
    buildOpenUri('vscode', { instance: 'http://localhost:8120', api: 'http://localhost:3055', appId: '421df0e7-861a-43fd-9b31-fa67f6649dfa' }),
    'vscode://tooljet.tooljet/open?instance=http%3A%2F%2Flocalhost%3A8120&app=421df0e7-861a-43fd-9b31-fa67f6649dfa&api=http%3A%2F%2Flocalhost%3A3055'
  );
});
