const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');
const cli = path.join(root, 'dist', 'index.cjs');

function helpText() {
  return execFileSync('node', [cli, '--help'], { encoding: 'utf8' });
}

test('CLI lists commit-1 commands', () => {
  const help = helpText();
  const required = ['deploy', 'vet-dar', 'dars', 'status', 'token', 'init'];
  for (const cmd of required) {
    assert.match(help, new RegExp(`\\b${cmd}\\b`), `missing command: ${cmd}`);
  }
});

test('CLI excludes non-proposal commands', () => {
  const help = helpText();
  assert.doesNotMatch(help, /\bcall\b/);
  assert.doesNotMatch(help, /upload-via/i);
});
