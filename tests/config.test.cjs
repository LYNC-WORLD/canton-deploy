const test = require('node:test');
const assert = require('node:assert/strict');
const { z } = require('zod');

const UserSchema = z.object({
  userId: z.string(),
  parties: z.array(z.string()).default([]),
  rights: z.array(z.enum(['CanActAs', 'CanReadAs'])).default(['CanActAs', 'CanReadAs']),
});

const NetworkSchema = z.object({
  host: z.string(),
  vetOnUpload: z.boolean().optional(),
  additionalDars: z.array(z.string()).default([]),
  includePackages: z.array(z.string()).default([]),
  excludePackages: z.array(z.string()).default([]),
  parties: z.array(z.string()).default([]),
  users: z.array(UserSchema).default([]),
});

test('network schema accepts per-network parties and users', () => {
  const parsed = NetworkSchema.parse({
    host: 'localhost',
    parties: ['Alice'],
    users: [{ userId: 'u1', parties: ['Alice'], rights: ['CanActAs'] }],
    vetOnUpload: true,
    additionalDars: ['./vendor/x.dar'],
  });
  assert.equal(parsed.parties[0], 'Alice');
  assert.equal(parsed.users[0].userId, 'u1');
});

test('network schema has no uploadVia field', () => {
  assert.equal(NetworkSchema.shape.uploadVia, undefined);
});
