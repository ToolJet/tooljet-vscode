import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ensureCli, openFromLink } from '../src/openFlow';
import { cliTarballUrl } from '../src/spawnSpec';
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
  assert.deepEqual(cli.work, [`app clone ${APP} orders`, 'app source-pull', 'app install']);
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

test("installs the CLI the instance serves (its server's, when the link names one), else npm's", async () => {
  const served = makeDeps({ logins: { default: API }, servesCli: [API] });
  served.cli.installed = false;
  served.cli.onInstall = () => (served.cli.installed = true);
  served.ui.answer('The ToolJet CLI is not installed', 'Install');
  assert.equal(await openFromLink({ instance: FRONTEND, api: API, appId: APP }, served.deps, HOME), 'cloned');
  assert.deepEqual(served.tarballChecks, [API]);
  assert.deepEqual(served.cli.installedFrom, [`${API}/api/code-mode/cli/tooljet-cli.tgz`]);
  const detail = served.ui.details[served.ui.asked.indexOf('The ToolJet CLI is not installed.')];
  assert.match(detail, /npm i -g http:\/\/localhost:3055\/api\/code-mode\/cli\/tooljet-cli\.tgz/);

  const unserved = makeDeps({ logins: { default: INSTANCE } });
  unserved.cli.installed = false;
  unserved.cli.onInstall = () => (unserved.cli.installed = true);
  assert.equal(await openFromLink(req, unserved.deps, HOME), 'cloned');
  assert.deepEqual(unserved.tarballChecks, [INSTANCE]);
  assert.deepEqual(unserved.cli.installedFrom, ['@tooljet/cli@latest']);

  // A good CLI needs no install, so the instance is not asked.
  const good = makeDeps({ logins: { default: INSTANCE }, servesCli: [INSTANCE] });
  assert.equal(await openFromLink(req, good.deps, HOME), 'cloned');
  assert.deepEqual(good.tarballChecks, []);
});

test('treats a CLI without the app commands as too old', async () => {
  const { deps, cli, ui } = makeDeps({ logins: { default: INSTANCE } });
  cli.reply('app clone --help', { code: 2, output: 'command app:clone not found' });
  ui.answer('Your ToolJet CLI is out of date', undefined);
  assert.equal(await openFromLink(req, deps, HOME), 'cancelled');
  assert.deepEqual(cli.work, []);
});

test('reports a CLI that installs but is not on the PATH', async () => {
  const { deps, cli, ui } = makeDeps({ logins: { default: INSTANCE } });
  cli.installed = false;
  assert.equal(await openFromLink(req, deps, HOME), 'cancelled');
  assert.ok(ui.asked.includes('The ToolJet CLI was installed but is not on the PATH the editor sees.'));
});

test('a too-old CLI can be updated, and when npm has no newer one, another CLI can be chosen', async () => {
  const { deps, cli, ui, cliPaths } = makeDeps({ logins: { default: INSTANCE } });
  // Only the CLI the user picks has the app commands.
  cli.reply('app clone --help', () => (deps.cli === cli ? { code: 2, output: 'command app:clone not found' } : { code: 0, output: '' }));
  ui.cliPath = '/src/ToolJet/cli/bin/run';
  ui.answer('Your ToolJet CLI is out of date', 'Update the CLI').answer('The ToolJet CLI from npm', 'Choose a CLI...');
  assert.equal(await openFromLink({ ...req, folder: 'o' }, deps, HOME), 'cloned');
  assert.equal(cli.installs, 1);
  assert.deepEqual(cliPaths, ['/src/ToolJet/cli/bin/run']);
  assert.ok(ui.asked.includes('The ToolJet CLI from npm does not have the Code mode commands yet.'));
});

test('the npm CLI from before Code mode: one click installs the CLI the server serves, and says it replaces the old one', async () => {
  const { deps, cli, ui } = makeDeps({ logins: { default: INSTANCE }, servesCli: [INSTANCE] });
  let upgraded = false;
  cli.reply('app clone --help', () => (upgraded ? { code: 0, output: '' } : { code: 2, output: 'command app:clone not found' }));
  const install = cli.installCli.bind(cli);
  cli.installCli = (spec: string) => ((upgraded = true), install(spec));
  ui.answer('Your ToolJet CLI is out of date', 'Update the CLI');
  assert.equal(await openFromLink({ ...req, folder: 'o' }, deps, HOME), 'cloned');
  assert.deepEqual(cli.installedFrom, [cliTarballUrl(INSTANCE)]);
  assert.ok(ui.details.some((d) => d.includes(`npm i -g ${cliTarballUrl(INSTANCE)}`) && d.includes('replaces the older tooljet')));
});

test('a project with no known server asks for one first: a CLI that old is not signed in anywhere', async () => {
  const project = { root: '/w/orders', app: { appId: 'a1' } } as any;
  const { deps, cli, ui } = makeDeps({ servesCli: [INSTANCE] });
  let upgraded = false;
  cli.reply('app clone --help', () => (upgraded ? { code: 0, output: '' } : { code: 2, output: 'command app:clone not found' }));
  const install = cli.installCli.bind(cli);
  cli.installCli = (spec: string) => ((upgraded = true), install(spec));
  ui.serverAddress = INSTANCE;
  assert.equal(await ensureCli(deps, project.root), true);
  assert.ok(ui.asked.every((m) => m === 'Your ToolJet CLI is out of date.'));
  assert.deepEqual(cli.installedFrom, [cliTarballUrl(INSTANCE)]);
});

test('a chosen CLI that is still too old is reported, and choosing can be given up', async () => {
  const { deps, cli, ui, cliPaths } = makeDeps({ logins: { default: INSTANCE } });
  cli.reply('app clone --help', { code: 2, output: 'command app:clone not found' });
  ui.cliPath = '/opt/old/tooljet';
  ui.answer('Your ToolJet CLI is out of date', 'Choose a CLI...').answer('That ToolJet CLI does not have', undefined);
  assert.equal(await openFromLink(req, deps, HOME), 'cancelled');
  assert.equal(cli.installs, 0);
  assert.deepEqual(cliPaths, ['/opt/old/tooljet']);
  assert.deepEqual(cli.work, []);
});

const API = 'http://localhost:3055';
const FRONTEND = 'http://localhost:8120';

test("signs in to the link's server origin when it names one, and links the folder to it", async () => {
  const { deps, cli, ui, store, logins } = makeDeps();
  cli.reply(`auth login --url ${API}`, () => {
    logins.default = API;
    return { code: 0, output: '' };
  });
  assert.equal(await openFromLink({ instance: FRONTEND, api: API, appId: APP, folder: 'o' }, deps, HOME), 'cloned');
  assert.equal(cli.work[0], `auth login --url ${API}`);
  assert.equal(store.linkList[0].instance, API);
  assert.ok(ui.asked.includes(`Sign in to ${API}?`));
});

test('when the page has no browser sign-in, asks for the server address and signs in there', async () => {
  const { deps, cli, ui, store, logins } = makeDeps();
  cli.reply(`auth login --url ${FRONTEND}`, {
    code: 1,
    output: '\x1b[1;31m✗ Error\x1b[0m : This ToolJet instance does not support browser sign-in yet (404).\n',
  });
  cli.reply(`auth login --url ${API}`, () => {
    logins.default = API;
    return { code: 0, output: '' };
  });
  ui.serverAddress = `${API}/`;
  assert.equal(await openFromLink({ instance: FRONTEND, appId: APP, folder: 'o' }, deps, HOME), 'cloned');
  assert.ok(ui.asked.includes(`${FRONTEND} has no browser sign-in.`));
  assert.deepEqual(cli.work.slice(0, 2), [`auth login --url ${FRONTEND}`, `auth login --url ${API}`]);
  assert.equal(store.linkList[0].instance, API);

  const refused = makeDeps();
  refused.cli.reply(`auth login --url ${FRONTEND}`, { code: 1, output: 'This ToolJet instance does not support browser sign-in yet.' });
  refused.ui.serverAddress = 'http://evil.example.com';
  assert.equal(await openFromLink({ instance: FRONTEND, appId: APP }, refused.deps, HOME), 'cancelled', 'plain http only for localhost');
});

test('checks out the requested version after cloning', async () => {
  const { deps, cli } = makeDeps({ logins: { default: INSTANCE } });
  await openFromLink({ ...req, version: 'v2', folder: 'o' }, deps, HOME);
  assert.deepEqual(cli.work, [`app clone ${APP} o`, 'app checkout v2', 'app source-pull', 'app install']);
  assert.equal(cli.find('app checkout')?.cwd, '/home/me/apps/o');
});

test('the first clone defaults to ~/ToolJet apps, and the full target path is shown', async () => {
  const { deps, ui } = makeDeps({ logins: { default: INSTANCE } });
  await openFromLink({ ...req, folder: 'orders' }, deps, HOME);
  assert.equal(ui.pickedDefault, '/home/me/ToolJet apps');
  assert.equal(ui.described, 'Clones into /home/me/apps/orders');
});

test('a parent folder inside a Git repository needs confirming; choosing another starts from the default', async () => {
  const { deps, ui, store } = makeDeps({ logins: { default: INSTANCE }, repos: ['/home/me/Projects/TJ-AI'] });
  ui.parent = '/home/me/Projects/TJ-AI';
  ui.parents = ['/home/me/ToolJet apps'];
  assert.equal(await openFromLink({ ...req, folder: 'o' }, deps, HOME), 'cloned');
  assert.ok(ui.asked.includes('/home/me/Projects/TJ-AI is inside a Git repository.'));
  assert.deepEqual(ui.pickedDefaults, ['/home/me/ToolJet apps', '/home/me/ToolJet apps']);
  assert.equal(store.parent, '/home/me/ToolJet apps');

  const confirmed = makeDeps({ logins: { default: INSTANCE }, repos: ['/home/me/Projects/TJ-AI'] });
  confirmed.ui.parent = '/home/me/Projects/TJ-AI/apps';
  confirmed.ui.answer('/home/me/Projects/TJ-AI/apps is inside', 'Clone there');
  assert.equal(await openFromLink({ ...req, folder: 'o' }, confirmed.deps, HOME), 'cloned');
  assert.equal(confirmed.cli.find('app clone')?.cwd, '/home/me/Projects/TJ-AI/apps');
});

const NOT_SAVED = "✓ Cloned \"Orders\" into o/ (3 queries, 2 routes)\nThis app's code isn't saved in ToolJet. Copy it from your repository into frontend/.\n";

test('pulls the code ToolJet stores; code the ToolJet editor owns gets a live preview even if the clone said otherwise', async () => {
  const { deps, cli, store, ui } = makeDeps({ logins: { default: INSTANCE } });
  cli.reply(`app clone ${APP} o`, { code: 0, output: NOT_SAVED });
  cli.reply('app source-pull', { code: 0, output: '✓ Pulled revision 4 (owner platform): 23 files written, 0 removed\n' });
  assert.equal(await openFromLink({ ...req, folder: 'o' }, deps, HOME), 'cloned');
  assert.equal(cli.find('app source-pull')?.cwd, '/home/me/apps/o');
  assert.equal(store.pending, '/home/me/apps/o');
  assert.deepEqual(ui.messages, []);
});

test('code a Git repository owns is pulled but gets no live preview', async () => {
  const { deps, cli, store, ui } = makeDeps({ logins: { default: INSTANCE } });
  cli.reply('app source-pull', { code: 0, output: '✓ Pulled revision 2 (owner repository): 9 files written, 0 removed\n' });
  assert.equal(await openFromLink({ ...req, folder: 'o' }, deps, HOME), 'cloned-no-dev');
  assert.equal(store.pending, undefined);
  assert.match(ui.messages[0].text, /kept in its Git repository/);
});

test('a CLI without source-pull falls back to what the clone said', async () => {
  const { deps, cli } = makeDeps({ logins: { default: INSTANCE } });
  cli.reply(`app clone ${APP} o`, { code: 0, output: NOT_SAVED });
  cli.reply('app source-pull --help', { code: 2, output: 'command app:source-pull not found' });
  assert.equal(await openFromLink({ ...req, folder: 'o' }, deps, HOME), 'cloned-no-dev');
  assert.ok(!cli.work.includes('app source-pull'));
});

for (const notice of [
  "This app's code isn't saved in ToolJet. Copy it from your repository into frontend/.",
  // The wording of CLIs before the terminology pass.
  'The app is already in Code mode: its source is not stored in ToolJet; bring it from your repository.',
]) {
  test(`does not start the live preview for an app whose code lives in a repository: ${notice.slice(0, 30)}`, async () => {
    const { deps, cli, ui, store, opened } = makeDeps({ logins: { default: INSTANCE } });
    cli.reply(`app clone ${APP} o`, { code: 0, output: `✓ Cloned "Orders" into o/ (3 queries, 2 routes)\n${notice}\n` });
    assert.equal(await openFromLink({ ...req, folder: 'o' }, deps, HOME), 'cloned-no-dev');
    assert.equal(store.pending, undefined);
    assert.deepEqual(opened, ['/home/me/apps/o']);
    assert.match(ui.messages.find((m) => m.level === 'warn')!.text, /code isn't saved in ToolJet.*Start live preview/);
  });
}

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
