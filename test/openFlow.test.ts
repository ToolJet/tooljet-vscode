import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { openFromLink } from '../src/openFlow';
import { makeDeps } from './fakes';

const APP = '421df0e7-861a-43fd-9b31-fa67f6649dfa';
const INSTANCE = 'https://tooljet.example.com';
const req = { instance: INSTANCE, appId: APP };
const HOME = '/home/me';

test('the happy path: confirm, clone, install, link, open; dev starts in the new window', async () => {
  const { deps, cli, ui, store, opened } = makeDeps({ logins: { default: INSTANCE } });
  const outcome = await openFromLink({ ...req, folder: 'orders' }, deps, HOME);
  assert.equal(outcome, 'cloned');
  assert.equal(ui.asked[0], `Open a ToolJet app from ${INSTANCE}?`);
  assert.deepEqual(cli.work, [`app clone ${APP} orders`, 'app install']);
  assert.equal(cli.find('app clone')?.cwd, '/home/me/apps');
  assert.equal(cli.find('app install')?.cwd, '/home/me/apps/orders');
  assert.deepEqual(opened, ['/home/me/apps/orders']);
  assert.equal(store.pending, '/home/me/apps/orders');
  assert.deepEqual(store.linkList, [{ appId: APP, instance: INSTANCE, folder: '/home/me/apps/orders' }]);
  assert.equal(store.parent, '/home/me/apps', 'remembers the parent folder');
  assert.deepEqual(ui.messages, []);
});

test('nothing runs and nothing is contacted when the user does not confirm the instance', async () => {
  const { deps, cli, opened } = makeDeps();
  deps.ui = Object.assign(deps.ui, {});
  (deps.ui as any).answer('Open a ToolJet app', undefined);
  assert.equal(await openFromLink(req, deps, HOME), 'cancelled');
  assert.deepEqual(cli.calls, []);
  assert.deepEqual(opened, []);
});

test('signs in with tooljet auth login --url when there is no login for the instance', async () => {
  const { deps, cli, ui, logins } = makeDeps();
  cli.reply(`auth login --url ${INSTANCE}`, () => {
    logins.default = INSTANCE;
    return { code: 0, output: '✓ Signed in as dev@example.com.' };
  });
  assert.equal(await openFromLink(req, deps, HOME), 'cloned');
  assert.ok(ui.asked.includes(`Sign in to ${INSTANCE}?`));
  assert.deepEqual(cli.work.slice(0, 2), [`auth login --url ${INSTANCE}`, `app clone ${APP} tooljet-app-421df0e7`]);
  assert.equal(cli.find('auth')?.visible, true, 'sign-in runs in a visible terminal');
});

test('signs in again when the default login is another instance, since app commands use the default', async () => {
  const { deps, cli, logins } = makeDeps({ logins: { default: 'https://other.example.com', stored: [INSTANCE] } });
  cli.reply(`auth login --url ${INSTANCE}`, () => {
    logins.default = INSTANCE;
    return { code: 0, output: '' };
  });
  await openFromLink(req, deps, HOME);
  assert.equal(cli.work[0], `auth login --url ${INSTANCE}`);
});

test('stops when sign-in is declined or fails', async () => {
  const declined = makeDeps();
  declined.ui.answer('Sign in', undefined);
  assert.equal(await openFromLink(req, declined.deps, HOME), 'cancelled');
  assert.deepEqual(declined.cli.work, []);

  const failed = makeDeps();
  failed.cli.reply(`auth login --url ${INSTANCE}`, { code: 1, output: '\n\x1b[1;31m✗ Error\x1b[0m : The sign-in code expired.\n' });
  assert.equal(await openFromLink(req, failed.deps, HOME), 'cancelled');
  assert.deepEqual(failed.cli.work, [`auth login --url ${INSTANCE}`]);
  assert.match(failed.ui.messages[0].text, /The sign-in code expired/);
});

test('offers to install a missing CLI and installs it only on consent', async () => {
  const declined = makeDeps({ logins: { default: INSTANCE } });
  declined.cli.installed = false;
  declined.ui.answer('The ToolJet CLI is not installed', undefined);
  assert.equal(await openFromLink(req, declined.deps, HOME), 'cancelled');
  assert.equal(declined.cli.installs, 0);

  const accepted = makeDeps({ logins: { default: INSTANCE } });
  accepted.cli.installed = false;
  accepted.cli.onInstall = () => (accepted.cli.installed = true);
  assert.equal(await openFromLink(req, accepted.deps, HOME), 'cloned');
  assert.equal(accepted.cli.installs, 1);
  assert.ok(accepted.ui.asked.includes('The ToolJet CLI is not installed.'));
});

test('treats a CLI without the app commands as too old', async () => {
  const { deps, cli, ui } = makeDeps({ logins: { default: INSTANCE } });
  cli.reply('app clone --help', { code: 2, output: 'command app:clone not found' });
  ui.answer('This ToolJet CLI is too old', undefined);
  assert.equal(await openFromLink(req, deps, HOME), 'cancelled');
  assert.deepEqual(cli.work, []);
});

test('reports a CLI that installs but is not on the PATH', async () => {
  const { deps, cli, ui } = makeDeps({ logins: { default: INSTANCE } });
  cli.installed = false;
  assert.equal(await openFromLink(req, deps, HOME), 'cancelled');
  assert.match(ui.messages[0].text, /not on the PATH/);
});

test('checks out the requested version after cloning', async () => {
  const { deps, cli } = makeDeps({ logins: { default: INSTANCE } });
  await openFromLink({ ...req, version: 'v2', folder: 'o' }, deps, HOME);
  assert.deepEqual(cli.work, [`app clone ${APP} o`, 'app checkout v2', 'app install']);
  assert.equal(cli.find('app checkout')?.cwd, '/home/me/apps/o');
});

test('does not start dev for an app whose Code mode source lives in a repository', async () => {
  const { deps, cli, ui, store, opened } = makeDeps({ logins: { default: INSTANCE } });
  cli.reply(`app clone ${APP} o`, {
    code: 0,
    output: '✓ Cloned "Orders" into o/ (3 queries, 2 routes)\nThe app is already in Code mode: its source is not stored in ToolJet; bring it from your repository.\n',
  });
  assert.equal(await openFromLink({ ...req, folder: 'o' }, deps, HOME), 'cloned-no-dev');
  assert.equal(store.pending, undefined);
  assert.deepEqual(opened, ['/home/me/apps/o']);
  assert.match(ui.messages.find((m) => m.level === 'warn')!.text, /source is not stored in ToolJet/);
});

test('a failed clone stops before opening anything', async () => {
  const { deps, cli, ui, opened, store } = makeDeps({ logins: { default: INSTANCE } });
  cli.reply(`app clone ${APP} o`, { code: 1, output: '\n\x1b[1;31m✗ Error\x1b[0m : App not found (HTTP 404)\n' });
  assert.equal(await openFromLink({ ...req, folder: 'o' }, deps, HOME), 'failed');
  assert.deepEqual(opened, []);
  assert.deepEqual(store.linkList, []);
  assert.equal(ui.messages[0].text, 'Cloning the app failed: App not found (HTTP 404)');
});

test('a failed install warns and still opens the folder', async () => {
  const { deps, cli, ui, opened } = makeDeps({ logins: { default: INSTANCE } });
  cli.reply('app install', { code: 1, output: '✗ Error : npm ERR! network' });
  assert.equal(await openFromLink({ ...req, folder: 'o' }, deps, HOME), 'cloned');
  assert.equal(opened.length, 1);
  assert.equal(ui.messages[0].level, 'warn');
});

test('opens the folder already linked to this app instead of cloning again', async () => {
  const { deps, cli, store, files, opened } = makeDeps({ logins: { default: INSTANCE } });
  store.linkList = [{ appId: APP, instance: INSTANCE, folder: '/code/orders' }];
  files.set('/code/orders', { appId: APP, name: 'Orders' });
  assert.equal(await openFromLink(req, deps, HOME), 'opened-existing');
  assert.deepEqual(cli.work, []);
  assert.deepEqual(opened, ['/code/orders']);
  assert.equal(store.pending, '/code/orders');
});

test('ignores a link record whose folder no longer holds the app', async () => {
  const { deps, store, ui } = makeDeps({ logins: { default: INSTANCE } });
  store.linkList = [{ appId: APP, instance: INSTANCE, folder: '/code/gone' }];
  assert.equal(await openFromLink(req, deps, HOME), 'cloned');
  assert.ok(!ui.asked.includes('This app is already cloned.'));
});

test('the folder name must be plain and must not overwrite a folder with content', async () => {
  const { deps, ui, files, dirs } = makeDeps({ logins: { default: INSTANCE } });
  dirs.add('/home/me/apps/taken');
  files.set('/home/me/apps/taken/app.json', {});
  dirs.add('/home/me/apps/empty');
  await openFromLink(req, deps, HOME);
  const validate = ui.folderValidator!;
  assert.equal(validate('ok-name_1.x'), undefined);
  assert.equal(validate('empty'), undefined);
  assert.match(validate('taken')!, /already exists/);
  for (const bad of ['../up', 'a/b', '', '.git', 'a b', '..']) assert.ok(validate(bad), `${bad} should be refused`);
});

test('cancelling the folder picker or the name stops before cloning', async () => {
  const noParent = makeDeps({ logins: { default: INSTANCE } });
  noParent.ui.parent = undefined;
  assert.equal(await openFromLink(req, noParent.deps, HOME), 'cancelled');
  assert.deepEqual(noParent.cli.work, []);

  const badName = makeDeps({ logins: { default: INSTANCE } });
  badName.ui.folderName = '../escape';
  assert.equal(await openFromLink(req, badName.deps, HOME), 'cancelled');
  assert.deepEqual(badName.cli.work, []);
});

test('offers the last parent folder as the default', async () => {
  const { deps, ui, store } = makeDeps({ logins: { default: INSTANCE } });
  store.parent = '/home/me/previous';
  await openFromLink(req, deps, HOME);
  assert.equal(ui.pickedDefault, '/home/me/previous');
});

test('no CLI call ever carries a token argument', async () => {
  const { deps, cli, logins } = makeDeps();
  cli.reply(`auth login --url ${INSTANCE}`, () => ((logins.default = INSTANCE), { code: 0, output: '' }));
  await openFromLink({ ...req, version: 'v1' }, deps, HOME);
  for (const c of cli.calls) assert.ok(!c.args.some((a) => /token|pat/i.test(a)), c.args.join(' '));
});

test('probes the CLI once per runner', async () => {
  const { deps, cli } = makeDeps({ logins: { default: INSTANCE } });
  await openFromLink({ ...req, folder: 'a' }, deps, HOME);
  await openFromLink({ ...req, folder: 'b' }, deps, HOME);
  assert.equal(cli.calls.filter((c) => c.args[0] === '--version').length, 1);
});
