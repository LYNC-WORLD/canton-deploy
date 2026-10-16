const test = require('node:test');
const assert = require('node:assert/strict');
const grpc = require('@grpc/grpc-js');
const { loadSrc } = require('./load.cjs');

const { formatGrpcError } = loadSrc('src/grpc/format-error.ts');
const { withRetry } = loadSrc('src/utils/retry.ts');
const {
  toLogicalSynchronizerId,
  logicalSynchronizerId,
  multiSyncMissingId,
  connectedIdsFromAdminStatus,
} = loadSrc('src/utils/synchronizer-id.ts');

test('toLogicalSynchronizerId strips physical serial suffix', () => {
  const logical =
    'global-domain::1220be58c29e65de40bf273be1dc2b266d43a9a002ea5b18955aeef7aac881bb471a';
  assert.equal(toLogicalSynchronizerId(`${logical}::35-3`), logical);
  assert.equal(toLogicalSynchronizerId(logical), logical);
});

test('logicalSynchronizerId drops a blank and a physical suffix', () => {
  const logical =
    'private-sync::122032922613929d67857e621fb13e3da49ec13883e24908404520319eee6d31fb4d';
  assert.equal(logicalSynchronizerId(undefined), undefined);
  assert.equal(logicalSynchronizerId('  '), undefined);
  assert.equal(logicalSynchronizerId(`${logical}::35-0`), logical);
});

test('multiSyncMissingId only when two synchronizers and no config id', () => {
  const ids = ['global-domain::1220aaa', 'private-sync::1220bbb'];
  assert.equal(multiSyncMissingId(ids, undefined), true);
  assert.equal(multiSyncMissingId(ids, '  '), true);
  assert.equal(multiSyncMissingId(ids, ids[1]), false);
  assert.equal(multiSyncMissingId([ids[0]], undefined), false);
  assert.equal(multiSyncMissingId([], undefined), false);
});

test('connectedIdsFromAdminStatus reads physical ids', () => {
  const status = {
    status: {
      connected_synchronizers: [
        { physical_synchronizer_id: 'global-domain::1220aaa::35-3', health: 'HEALTH_HEALTHY' },
        { physical_synchronizer_id: 'private-sync::1220bbb::35-0', health: 'HEALTH_HEALTHY' },
        { physical_synchronizer_id: '' },
      ],
    },
  };
  assert.deepEqual(connectedIdsFromAdminStatus(status), [
    'global-domain::1220aaa::35-3',
    'private-sync::1220bbb::35-0',
  ]);
  assert.deepEqual(connectedIdsFromAdminStatus({}), []);
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
  assert.match(
    formatGrpcError({ message: 'PARTY_ALLOCATION_CANNOT_DETERMINE_SYNCHRONIZER' }),
    /synchronizerId/
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
