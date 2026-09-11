const test = require('node:test');
const assert = require('node:assert/strict');
const { z } = require('zod');

const NetworkSchema = z.object({
  host: z.string(),
  adminPort: z.number().int().positive().optional(),
  ledgerPort: z.number().int().positive().optional(),
  httpPort: z.number().int().positive().optional(),
});

test('network schema accepts localnet profile', () => {
  const parsed = NetworkSchema.parse({
    host: 'localhost',
    adminPort: 5002,
    ledgerPort: 5001,
    httpPort: 7575,
  });
  assert.equal(parsed.host, 'localhost');
  assert.equal(parsed.adminPort, 5002);
});

test('network schema has no uploadVia field', () => {
  assert.equal(NetworkSchema.shape.uploadVia, undefined);
});
