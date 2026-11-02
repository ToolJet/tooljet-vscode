import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { loginStateFor, readStoredLogins } from '../src/credentials';

const write = (content: unknown) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tj-creds-'));
  const file = path.join(dir, 'credentials.json');
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
};

const store = {
  default: 'w2',
  workspaces: {
    w1: { url: 'https://a.example.com/', apiToken: 'SECRET-A', email: 'a@example.com' },
    w2: { url: 'http://localhost:3055', apiToken: 'SECRET-B', email: 'b@example.com' },
  },
};

test('reports the default login and every stored instance, without tokens', () => {
  const logins = readStoredLogins(write(store));
  assert.deepEqual(logins, { defaultOrigin: 'http://localhost:3055', origins: ['https://a.example.com', 'http://localhost:3055'] });
  assert.ok(!JSON.stringify(logins).includes('SECRET'));
});

test('login state per instance', () => {
  const file = write(store);
  assert.equal(loginStateFor('http://localhost:3055', file), 'default');
  assert.equal(loginStateFor('https://a.example.com', file), 'stored');
  assert.equal(loginStateFor('https://b.example.com', file), 'none');
});

test('a missing or broken file means no login', () => {
  assert.equal(loginStateFor('https://a.example.com', path.join(os.tmpdir(), 'does-not-exist', 'credentials.json')), 'none');
  assert.equal(loginStateFor('https://a.example.com', write('{not json')), 'none');
  assert.equal(loginStateFor('https://a.example.com', write({ workspaces: { w: { url: 42 } }, default: 'w' })), 'none');
  assert.deepEqual(readStoredLogins(write('null')), { origins: [] });
});
