const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');
const cli = path.join(root, 'dist', 'index.cjs');

function helpText() {
  return execFileSync('node', [cli, '--help'], { encoding: 'utf8' });
}

test('CLI lists required commands', () => {
  const help = helpText();
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
    assert.match(help, new RegExp(`\\b${cmd}\\b`), `missing command: ${cmd}`);
  }
});

test('CLI excludes non-proposal commands', () => {
  const help = helpText();
  assert.doesNotMatch(help, /\bcall\b/);
  assert.doesNotMatch(help, /upload-via/i);
});
