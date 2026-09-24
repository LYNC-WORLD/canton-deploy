const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSrc, withMockExit } = require('./load.cjs');

async function withMockExitAsync(fn) {
  const orig = process.exit;
  process.exit = (code) => {
    throw Object.assign(new Error(`process.exit(${code})`), { exitCode: code ?? 0 });
  };
  try {
    await fn();
    return { exitCode: 0 };
  } catch (err) {
    if (typeof err.exitCode === 'number') return { exitCode: err.exitCode };
    throw err;
  } finally {
    process.exit = orig;
  }
}

const oauth2 = loadSrc('src/auth/oauth2.ts');

test('resolveOAuth2ClientSecret reads env and rejects missing', () => {
  const { resolveOAuth2ClientSecret } = oauth2;
  const key = 'CANTON_DEPLOY_TEST_OAUTH_SECRET';
  const prev = process.env[key];
  process.env[key] = 'secret-value';
  try {
    assert.equal(
      resolveOAuth2ClientSecret({ clientSecretEnv: key, tokenUrl: 'u', clientId: 'c', audience: 'a' }),
      'secret-value'
    );
    delete process.env[key];
    const missing = withMockExit(() =>
      resolveOAuth2ClientSecret({ clientSecretEnv: key, tokenUrl: 'u', clientId: 'c', audience: 'a' })
    );
    assert.equal(missing.exitCode, 1);
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
});

test('fetchOAuth2Token uses client_credentials and caches by exp', async () => {
  const { fetchOAuth2Token, clearOAuth2TokenCacheForTests } = oauth2;
  clearOAuth2TokenCacheForTests();

  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = require('jsonwebtoken').sign({ sub: 'm2m', exp }, 'test-secret');

  let fetchCalls = 0;
  const originalFetch = global.fetch;
  global.fetch = async (_url, init) => {
    fetchCalls += 1;
    const body = init.body;
    assert.match(body, /grant_type=client_credentials/);
    assert.match(body, /client_id=cli-id/);
    assert.match(body, /client_secret=from-env/);
    assert.match(body, /audience=my-aud/);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ access_token: token }),
    };
  };

  const envKey = 'CANTON_DEPLOY_TEST_OAUTH_FETCH';
  process.env[envKey] = 'from-env';
  const cfg = {
    tokenUrl: 'https://tenant.auth0.com/oauth/token',
    clientId: 'cli-id',
    clientSecretEnv: envKey,
    audience: 'my-aud',
  };

  try {
    const t1 = await fetchOAuth2Token('devnet', cfg);
    assert.equal(t1, token);
    const t2 = await fetchOAuth2Token('devnet', cfg);
    assert.equal(t2, token);
    assert.equal(fetchCalls, 1);
  } finally {
    global.fetch = originalFetch;
    clearOAuth2TokenCacheForTests();
    delete process.env[envKey];
  }
});

test('fetchOAuth2Token surfaces HTTP errors', async () => {
  const { fetchOAuth2Token, clearOAuth2TokenCacheForTests } = oauth2;
  clearOAuth2TokenCacheForTests();

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 401,
    text: async () => '{"error":"access_denied"}',
  });

  const envKey = 'CANTON_DEPLOY_TEST_OAUTH_ERR';
  process.env[envKey] = 's';
  try {
    const r = await withMockExitAsync(() =>
      fetchOAuth2Token('devnet', {
        tokenUrl: 'https://x/oauth/token',
        clientId: 'c',
        clientSecretEnv: envKey,
        audience: 'a',
      })
    );
    assert.equal(r.exitCode, 1);
  } finally {
    global.fetch = originalFetch;
    delete process.env[envKey];
  }
});
