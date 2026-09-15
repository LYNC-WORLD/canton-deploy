const test = require('node:test');
const assert = require('node:assert/strict');
const grpc = require('@grpc/grpc-js');
const { loadSrc } = require('./load.cjs');

const { formatGrpcError } = loadSrc('src/grpc/format-error.ts');
const { withRetry } = loadSrc('src/utils/retry.ts');
const { toLogicalSynchronizerId } = loadSrc('src/utils/synchronizer-id.ts');

test('toLogicalSynchronizerId strips physical serial suffix', () => {
  const logical =
    'global-domain::1220be58c29e65de40bf273be1dc2b266d43a9a002ea5b18955aeef7aac881bb471a';
  assert.equal(toLogicalSynchronizerId(`${logical}::35-3`), logical);
  assert.equal(toLogicalSynchronizerId(logical), logical);
});

test('formatGrpcError names auth and bad synchronizerId', () => {
  assert.match(
    formatGrpcError({ code: grpc.status.UNAUTHENTICATED, message: 'nope' }),
    /Authentication failed/
  );
  assert.match(
    formatGrpcError({ message: 'PROTO_DESERIALIZATION_FAILURE: synchronizer_id' }),
    /logical/
  );
});

test('withRetry retries UNAVAILABLE then succeeds', async () => {
  let n = 0;
  const out = await withRetry(
    async () => {
      n += 1;
      if (n < 2) {
        const err = new Error('down');
        err.code = grpc.status.UNAVAILABLE;
        throw err;
      }
      return 'ok';
    },
    { maxAttempts: 3, baseDelayMs: 1 }
  );
  assert.equal(out, 'ok');
  assert.equal(n, 2);
});

test('withRetry does not retry permanent errors', async () => {
  const err = new Error('denied');
  err.code = grpc.status.PERMISSION_DENIED;
  await assert.rejects(
    () => withRetry(async () => { throw err; }, { maxAttempts: 3, baseDelayMs: 1 }),
    /denied/
  );
});
