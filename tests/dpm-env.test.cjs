const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSrc } = require('./load.cjs');

const { nestedDpmExecaOptions } = loadSrc('src/utils/dpm-env.ts');

test('nestedDpmExecaOptions drops DPM_RESOLUTION_FILE and disables extendEnv', () => {
  const prev = process.env.DPM_RESOLUTION_FILE;
  process.env.DPM_RESOLUTION_FILE = '/tmp/parent-resolution.yaml';
  process.env.CANTON_DEPLOY_HOST = 'localhost';
  try {
    const opts = nestedDpmExecaOptions();
    assert.equal(opts.env.DPM_RESOLUTION_FILE, undefined);
    assert.equal(opts.env.CANTON_DEPLOY_HOST, 'localhost');
    assert.equal(opts.extendEnv, false);
  } finally {
    if (prev === undefined) delete process.env.DPM_RESOLUTION_FILE;
    else process.env.DPM_RESOLUTION_FILE = prev;
  }
});
