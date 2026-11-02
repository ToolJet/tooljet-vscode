#!/usr/bin/env node
/*
  Checks a built .vsix: what it contains, and the manifest fields both the VS Code Marketplace and Open VSX (which
  Cursor and Windsurf install from) need. Open VSX takes the same .vsix that `vsce package` builds; publishing there
  is `npx ovsx publish <file>` with a namespace matching the publisher. Nothing here publishes.
*/
const { execFileSync } = require('child_process');
const path = require('path');

const file = process.argv[2];
if (!file) throw new Error('usage: check-vsix.js <file.vsix>');
const list = execFileSync('unzip', ['-Z1', file], { encoding: 'utf8' }).split('\n').filter(Boolean);
const pkg = JSON.parse(execFileSync('unzip', ['-p', file, 'extension/package.json'], { encoding: 'utf8' }));
const manifest = execFileSync('unzip', ['-p', file, 'extension.vsixmanifest'], { encoding: 'utf8' });

const problems = [];
const need = (cond, message) => cond || problems.push(message);

need(list.includes('extension.vsixmanifest'), 'no extension.vsixmanifest');
need(list.includes('[Content_Types].xml'), 'no [Content_Types].xml');
need(list.includes(`extension/${pkg.main.replace(/^\.\//, '')}`), `main ${pkg.main} is not in the package`);
need(list.some((f) => /^extension\/license/i.test(f)), 'no LICENSE (Open VSX warns, the Marketplace asks)');
need(list.includes('extension/media/icon.png'), 'no icon');
for (const f of list) {
  need(!/^extension\/(src|test|node_modules|scripts)\//.test(f) && !/\.(ts|map)$/.test(f) && !/out\/test\//.test(f), `should not ship ${f}`);
}
need(pkg.publisher === 'tooljet' && pkg.name === 'tooljet', 'id must be tooljet.tooljet');
need(/^\^?\d+\.\d+\.\d+$/.test(pkg.engines?.vscode ?? ''), 'engines.vscode must be a plain range');
need(pkg.license, 'no license field');
need(pkg.repository?.url, 'no repository (Open VSX shows it)');
need(/^\d+\.\d+\.\d+$/.test(pkg.version), 'version must be x.y.z (Open VSX rejects other forms)');
need(manifest.includes('Id="tooljet"') && manifest.includes('Publisher="tooljet"'), 'manifest identity is not tooljet.tooljet');
need(!pkg.dependencies || Object.keys(pkg.dependencies).length === 0, 'runtime dependencies would need bundling');

const size = require('fs').statSync(file).size;
console.log(`${path.basename(file)}: ${list.length} files, ${(size / 1024).toFixed(1)} KB, ${pkg.publisher}.${pkg.name}@${pkg.version}, vscode ${pkg.engines.vscode}`);
for (const f of list) console.log(`  ${f}`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log('OK for the VS Code Marketplace and Open VSX (same file).');
