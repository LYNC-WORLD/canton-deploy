const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadSrc } = require('./load.cjs');

const { resolveVetOnUpload, findConfigPathUpwards, loadConfig } = loadSrc('src/config.ts');

const ENV_KEYS = [
  'CANTON_DEPLOY_CONFIG',
  'CANTON_DEPLOY_NETWORK',
  'CANTON_DEPLOY_HOST',
  'CANTON_DEPLOY_TOKEN',
  'CANTON_DEPLOY_ADMIN_PORT',
  'CANTON_DEPLOY_LEDGER_PORT',
  'CANTON_DEPLOY_HTTP_PORT',
  'CANTON_DEPLOY_UPLOAD_VIA',
];

function withEnv(fn) {
  const saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  const prevCwd = process.cwd();
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      process.chdir(prevCwd);
      for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    });
}

function writeConfig(dir, body) {
  const fp = path.join(dir, 'canton-deploy.config.js');
  fs.writeFileSync(fp, body);
  return fp;
}

test('resolveVetOnUpload respects --vet / --no-vet over config', () => {
  const network = { name: 'devnet', vetOnUpload: false };
  assert.equal(resolveVetOnUpload(network, { vet: true }), true);
  assert.equal(resolveVetOnUpload(network, { noVet: true }), false);
  assert.equal(resolveVetOnUpload(network, {}), false);
});

test('loadConfig defaults uploadVia to ledger', async () => {
  await withEnv(async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-upload-'));
    writeConfig(
      tmp,
      `module.exports = {
        defaultNetwork: 'devnet',
        networks: { devnet: { host: 'v.example.com', token: 't' } },
      };`
    );
    process.chdir(tmp);
    const cfg = await loadConfig({ network: 'devnet' });
    assert.equal(cfg.network.uploadVia, 'ledger');
  });
});

test('loadConfig respects CANTON_DEPLOY_UPLOAD_VIA and CLI override', async () => {
  await withEnv(async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-upload-'));
    writeConfig(
      tmp,
      `module.exports = {
        defaultNetwork: 'devnet',
        networks: { devnet: { host: 'v.example.com', token: 't', uploadVia: 'admin' } },
      };`
    );
    process.chdir(tmp);
    process.env.CANTON_DEPLOY_UPLOAD_VIA = 'ledger';
    const envCfg = await loadConfig({ network: 'devnet' });
    assert.equal(envCfg.network.uploadVia, 'ledger');
    const cliCfg = await loadConfig({ network: 'devnet', uploadVia: 'admin' });
    assert.equal(cliCfg.network.uploadVia, 'admin');
  });
});

test('loadConfig defaults vetOnUpload on for localnet and off for testnet/mainnet names', async () => {
  await withEnv(async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-cfg-'));
    writeConfig(
      tmp,
      `module.exports = {
        defaultNetwork: 'localnet',
        networks: {
          localnet: { host: 'localhost' },
          devnet: { host: 'validator.example.com', token: 't' },
          testnet: { host: 'testnet.example.com', token: 't' },
          mainnet: { host: 'mainnet.example.com', token: 't' },
        },
      };`
    );
    process.chdir(tmp);
    const local = await loadConfig({});
    assert.equal(local.network.vetOnUpload, true);
    const dev = await loadConfig({ network: 'devnet' });
    assert.equal(dev.network.vetOnUpload, false);
    const testnet = await loadConfig({ network: 'testnet' });
    assert.equal(testnet.network.vetOnUpload, false);
    const mainnet = await loadConfig({ network: 'mainnet' });
    assert.equal(mainnet.network.vetOnUpload, false);
  });
});

test('findConfigPathUpwards walks to nearest canton-deploy.config.js', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-walk-'));
  try {
    const nested = path.join(tmp, 'packages', 'app');
    fs.mkdirSync(nested, { recursive: true });
    const cfg = writeConfig(tmp, 'module.exports = {}\n');
    assert.equal(findConfigPathUpwards(nested), cfg);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('loadConfig precedence: CLI host over env over file', async () => {
  await withEnv(async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-prec-'));
    writeConfig(
      tmp,
      `module.exports = {
        defaultNetwork: 'devnet',
        networks: { devnet: { host: 'from-file', token: 'file-token', adminPort: 5002 } },
      };`
    );
    process.chdir(tmp);
    process.env.CANTON_DEPLOY_HOST = 'from-env';
    process.env.CANTON_DEPLOY_TOKEN = 'env-token';

    const fromEnv = await loadConfig({});
    assert.equal(fromEnv.network.host, 'from-env');
    assert.equal(fromEnv.network.token, 'env-token');

    const fromCli = await loadConfig({ host: 'from-cli', token: 'cli-token' });
    assert.equal(fromCli.network.host, 'from-cli');
    assert.equal(fromCli.network.token, 'cli-token');
  });
});

test('loadConfig parses oauth2 and tunnel.ssh forwards', async () => {
  await withEnv(async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-oauth-tunnel-'));
    writeConfig(
      tmp,
      `module.exports = {
        defaultNetwork: 'devnet',
        networks: {
          devnet: {
            host: '127.0.0.1',
            ledgerPort: 5001,
            httpPort: 7575,
            grpcAuthority: 'grpc-ledger-api.localhost',
            oauth2: {
              tokenUrl: 'https://tenant.auth0.com/oauth/token',
              clientId: 'cid',
              clientSecretEnv: 'DEVNET_OAUTH_CLIENT_SECRET',
              audience: 'https://ledger',
            },
            tunnel: {
              ssh: {
                host: 'remote.example.com',
                user: 'ubuntu',
                forwards: [
                  { localPort: 5001, remoteHost: '127.0.0.1', remotePort: 80 },
                  { localPort: 7575, remoteHost: '127.0.0.1', remotePort: 80 },
                ],
              },
            },
          },
        },
      };`
    );
    process.chdir(tmp);
    const cfg = await loadConfig({ network: 'devnet' });
    assert.equal(cfg.network.oauth2?.clientId, 'cid');
    assert.equal(cfg.network.tunnel?.ssh?.forwards.length, 2);
    assert.equal(cfg.network.tunnel?.ssh?.forwards[0].localPort, 5001);
  });
});
