const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.ts'), 'utf8');

test('CLI registers every command', () => {
  const required = [
    'deploy',
    'vet',
    'vet-dar',
    'dars',
    'status',
    'parties',
    'allocate-party',
    'users',
    'create-user',
    'run',
    'contracts',
    'token',
    'packages',
    'init',
  ];
  for (const cmd of required) {
    assert.match(src, new RegExp(`command\\('${cmd}(?: |')`), `missing command: ${cmd}`);
  }
});

test('deploy registers --upload-via', () => {
  assert.match(src, /--upload-via/);
});

test('deploy registers --input-file for --script', () => {
  const deployBlock = src.slice(src.indexOf(".command('deploy')"), src.indexOf(".command('vet')"));
  assert.match(deployBlock, /--input-file <path>/);
  assert.match(deployBlock, /scriptInputFile:\s*opts\.inputFile/);
});

test('CLI has no call command', () => {
  assert.doesNotMatch(src, /command\('call'/);
});
