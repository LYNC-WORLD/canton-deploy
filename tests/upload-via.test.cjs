const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSrc, withMockExit } = require('./load.cjs');

const { resolveUploadVia } = loadSrc('src/upload-via.ts');
const { isLedgerUploadFallbackError } = loadSrc('src/upload.ts');

const ENV_KEYS = ['CANTON_DEPLOY_UPLOAD_VIA'];

function withEnv(fn) {
  const saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    });
}

test('resolveUploadVia precedence: CLI over env over config over ledger default', async () => {
  await withEnv(async () => {
    process.env.CANTON_DEPLOY_UPLOAD_VIA = 'admin';
    assert.equal(resolveUploadVia('ledger', 'admin'), 'ledger');
    assert.equal(resolveUploadVia(undefined, undefined), 'admin');
    delete process.env.CANTON_DEPLOY_UPLOAD_VIA;
    assert.equal(resolveUploadVia(undefined, 'admin'), 'admin');
    assert.equal(resolveUploadVia(undefined, undefined), 'ledger');
  });
});

test('invalid --upload-via exits', async () => {
  await withEnv(async () => {
    const r = withMockExit(() => resolveUploadVia('json', undefined));
    assert.equal(r.exitCode, 1);
  });
});

test('isLedgerUploadFallbackError detects transport codes only', () => {
  assert.equal(isLedgerUploadFallbackError({ code: 14 }), true);
  assert.equal(isLedgerUploadFallbackError({ code: 12 }), true);
  assert.equal(isLedgerUploadFallbackError({ code: 16 }), false);
  assert.equal(isLedgerUploadFallbackError(new Error('connect ECONNREFUSED')), true);
});
