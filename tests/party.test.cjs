const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSrc } = require('./load.cjs');

const { displayNameToHint } = loadSrc('src/utils/party-hint.ts');
const { resolveParty } = loadSrc('src/onboarding.ts');

test('displayNameToHint lowercases and strips punctuation', () => {
  assert.equal(displayNameToHint('Alice'), 'alice');
  assert.equal(displayNameToHint('Alice Bob'), 'alice_bob');
});

test('resolveParty treats hint::fingerprint as an existing party id', async () => {
  const id = 'cdtest::12207f6cd9b3f81672103b40534d727295e916011af1b8ba84bf4fdb805f1ee522b0';
  const client = {
    getParties: async (_token, ids) => {
      assert.deepEqual(ids, [id]);
      return [{ party: id, is_local: true }];
    },
    listKnownParties: async () => {
      throw new Error('must not list by hint when a full party id is given');
    },
    allocateParty: async () => {
      throw new Error('must not allocate when a full party id is given');
    },
  };
  const got = await resolveParty(client, 'token', id);
  assert.equal(got.partyId, id);
  assert.equal(got.created, false);
  assert.equal(got.isLocal, true);
});

test('resolveParty allocates when the hint is new', async () => {
  const client = {
    listKnownParties: async () => ({ parties: [] }),
    allocateParty: async (hint) => {
      assert.equal(hint, 'alice');
      return { party: 'alice::abc', is_local: true };
    },
  };
  const got = await resolveParty(client, 'token', 'Alice');
  assert.equal(got.partyId, 'alice::abc');
  assert.equal(got.created, true);
});
