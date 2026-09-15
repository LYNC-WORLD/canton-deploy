const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { loadSrc } = require('./load.cjs');

const auth = loadSrc('src/auth/resolve.ts');
const { generateLocalNetToken, LOCALNET_DEFAULT_USER_ID, LOCALNET_DEFAULT_SECRET } =
  loadSrc('src/auth/localnet.ts');

test('tokenSourceKind order is token, tokenCommand, tokenFile, then localnet', () => {
  const { tokenSourceKind } = auth;
  assert.equal(
    tokenSourceKind({ name: 'devnet', token: 'eyJ', tokenCommand: 'echo x', tokenFile: 'f' }),
    'token'
  );
  assert.equal(
    tokenSourceKind({ name: 'devnet', tokenCommand: 'echo jwt', tokenFile: './.tokens/devnet.jwt' }),
    'tokenCommand'
  );
  assert.equal(tokenSourceKind({ name: 'devnet', tokenFile: './.tokens/devnet.jwt' }), 'tokenFile');
  assert.equal(tokenSourceKind({ name: 'localnet' }), 'localnet');
  assert.equal(tokenSourceKind({ name: 'devnet' }), 'none');
});

test('LocalNet token is HMAC-signed with sub ledger-api-user', () => {
  const token = generateLocalNetToken();
  const payload = jwt.verify(token, LOCALNET_DEFAULT_SECRET, { algorithms: ['HS256'] });
  assert.equal(payload.sub, LOCALNET_DEFAULT_USER_ID);
  assert.equal(auth.decodeJwtPayload(token).sub, LOCALNET_DEFAULT_USER_ID);
});
