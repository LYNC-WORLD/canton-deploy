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

test('CLI has no upload-via or call command', () => {
  assert.doesNotMatch(src, /upload-via/i);
  assert.doesNotMatch(src, /command\('call'/);
});
