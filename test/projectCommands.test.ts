import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { DevStatus } from '../src/cliOutput';
import * as project from '../src/projectCommands';
import { makeDeps } from './fakes';

const APP = '421df0e7-861a-43fd-9b31-fa67f6649dfa';
const INSTANCE = 'http://localhost:3055';
const ROOT = '/code/orders';

const setup = (logins: { default?: string; stored?: string[] } = { default: INSTANCE }) => {
  const env = makeDeps({ logins });
  env.files.set(ROOT, { appId: APP, name: 'Orders', version: { name: 'v2' } });
  env.store.linkList = [{ appId: APP, instance: INSTANCE, folder: ROOT }];
  const p = project.findProject(['/elsewhere', ROOT], env.deps)!;
  return { ...env, p };
};

test('finds the app project and the instance it was opened from', () => {
  const { p, deps } = setup();
  assert.equal(p.root, ROOT);
  assert.equal(p.instance, INSTANCE);
  assert.equal(project.instanceOf(p, deps), INSTANCE);
});

test('a folder without an appId is not a project; an unlinked one uses the default login', () => {
  const env = makeDeps({ logins: { default: 'https://x.example.com' } });
  env.files.set('/a', { name: 'No id' });
  assert.equal(project.findProject(['/a'], env.deps), undefined);
  env.files.set('/b', { appId: APP });
  const p = project.findProject(['/b'], env.deps)!;
  assert.equal(p.instance, undefined);
  assert.equal(project.instanceOf(p, env.deps), 'https://x.example.com');
});

test('check runs `tooljet app check` in the project and returns its findings', async () => {
  const { p, deps, cli, ui } = setup();
  cli.reply(`app check --instance ${INSTANCE}`, {
    code: 1,
    output:
      'warning App.tsx:3  Buttons need text (jsx-a11y/control-has-associated-label)\n\n\x1b[1;31m✗ Error\x1b[0m : src/App.tsx:9  query "x" does not exist in the app\n\n1 problem\n',
  });
  const result = await project.check(p, deps);
  assert.deepEqual(cli.work, [`app check --instance ${INSTANCE}`]);
  assert.equal(cli.find('app check')?.cwd, ROOT);
  assert.deepEqual(
    result!.findings.map((f) => [f.severity, f.file, f.line]),
    [
      ['warning', 'frontend/src/App.tsx', 3],
      ['error', 'frontend/src/App.tsx', 9],
    ]
  );
  assert.match(ui.messages[0].text, /1 problem/);
});

test("project commands name the linked instance, so the CLI's default login elsewhere does not matter", async () => {
  const { p, deps, cli, logins } = setup({ default: 'https://other.example.com', stored: [INSTANCE] });
  await project.pull(p, deps);
  assert.deepEqual(cli.work, [`app pull --instance ${INSTANCE}`]);
  assert.equal(logins.default, 'https://other.example.com');
});

test('an unlinked folder names no instance: the CLI uses its own record for it, else its default login', async () => {
  const env = makeDeps({ logins: { default: INSTANCE } });
  env.files.set('/b', { appId: APP });
  const p = project.findProject(['/b'], env.deps)!;
  await project.pull(p, env.deps);
  assert.deepEqual(env.cli.work, ['app pull']);
});

test('project commands sign in to the linked instance when the CLI has no login there, keeping the default', async () => {
  const { p, deps, cli, logins } = setup({ default: 'https://other.example.com' });
  cli.reply(`auth login --url ${INSTANCE}`, () => (logins.stored.push(INSTANCE), { code: 0, output: '' }));
  await project.pull(p, deps);
  assert.deepEqual(cli.work, [`auth login --url ${INSTANCE}`, `app pull --instance ${INSTANCE}`]);
  assert.equal(logins.default, 'https://other.example.com');
});

test('project commands do not run against another instance when sign-in is declined', async () => {
  const { p, deps, cli, ui } = setup({ default: 'https://other.example.com' });
  ui.answer('Sign in', undefined);
  assert.equal(await project.pull(p, deps), false);
  assert.equal(await project.check(p, deps), undefined);
  assert.deepEqual(cli.work, []);
});

test('publish asks for a version number and a confirmation, then runs in a visible terminal', async () => {
  const ok = setup();
  ok.ui.version = '1.4.0';
  assert.equal(await project.publish(ok.p, ok.deps), true);
  assert.deepEqual(ok.cli.work, [`app publish -v 1.4.0 --instance ${INSTANCE}`]);
  assert.equal(ok.cli.find('app publish')?.visible, true);
  assert.ok(ok.ui.asked.includes('Publish Orders 1.4.0?'));

  const bad = setup();
  bad.ui.version = '1.4; rm -rf ~';
  assert.equal(await project.publish(bad.p, bad.deps), false);
  assert.deepEqual(bad.cli.work, []);

  const declined = setup();
  declined.ui.answer('Publish', undefined);
  assert.equal(await project.publish(declined.p, declined.deps), false);
  assert.deepEqual(declined.cli.work, []);
});

test('install agent instructions runs `tooljet skill install`', async () => {
  const { p, deps, cli, ui } = setup();
  assert.equal(await project.installAgentInstructions(p, deps), true);
  assert.deepEqual(cli.work, ['skill install']);
  assert.match(ui.messages[0].text, /CLAUDE\.md, AGENTS\.md/);
});

test('start dev runs `tooljet app dev` visibly and reports its status as it goes', async () => {
  const { p, deps, cli } = setup();
  let finish!: (r: { code: number; output: string }) => void;
  cli.streams.set(`app dev --instance ${INSTANCE}`, {
    chunks: [
      '\x1b[1;32m✓\x1b[0m Live preview of "Orders" is on (2 queries). Watching frontend/src ...\n',
      '  \x1b[1;33m⚠ Warning\x1b[0m : src/App.tsx:4 link to "/x" matches no route in app.json\n',
      '  \x1b[1;32m✓\x1b[0m [2026-11-02T09:30:00.000Z] built in 300ms, uploaded (120 KB)\n',
    ],
    result: new Promise((resolve) => (finish = resolve)),
  });
  const statuses: DevStatus[] = [];
  const handle = await project.startDev(p, deps, (s) => statuses.push(s));
  assert.ok(handle);
  assert.equal(cli.find('app dev')?.visible, true);
  assert.equal(statuses[0].state, 'starting');
  assert.equal(handle!.parser.status.state, 'running');
  assert.equal(handle!.parser.status.lastUpload, '2026-11-02T09:30:00.000Z');
  assert.equal(handle!.parser.status.findings[0].file, 'frontend/src/App.tsx');
  finish({ code: 0, output: '' });
  await handle!.running.done;
  await new Promise((r) => setImmediate(r));
  assert.equal(statuses[statuses.length - 1].state, 'stopped');
});
