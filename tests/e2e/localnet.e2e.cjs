const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '../..');
const FIXTURE_SRC = path.join(__dirname, 'fixture');
const SANDBOX_ARGS = ['sandbox', '--ledger-api-port', '5001', '--admin-api-port', '5002', '--json-api-port', '7575'];
const SANDBOX_START_MS = 180_000;

const COMMANDS = [
  'deploy',
  'vet',
  'vet-dar',
  'dars',
  'status',
  'parties',
  'allocate-party',
  'users',
  'create-user',
  'run',
  'contracts',
  'token',
  'packages',
  'init',
];

function canTcpConnect(host, port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function sandboxUp() {
  const ports = [5001, 5002, 7575];
  const checks = await Promise.all(ports.map((p) => canTcpConnect('127.0.0.1', p)));
  return checks.every(Boolean);
}

function scrubEnv() {
  const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' };
  for (const key of Object.keys(env)) {
    if (key.startsWith('CANTON_DEPLOY_')) delete env[key];
  }
  delete env.DPM_RESOLUTION_FILE;
  delete env.DPM_INSECURE_REGISTRY;
  return env;
}

function runDpm(cwd, cdArgs, opts = {}) {
  const timeout = opts.timeout ?? 180_000;
  const result = spawnSync('dpm', ['canton-deploy', ...cdArgs], {
    cwd,
    env: { ...scrubEnv(), ...opts.env },
    encoding: 'utf8',
    timeout,
    maxBuffer: 20 * 1024 * 1024,
  });
  const out = `${result.stdout || ''}${result.stderr || ''}`;
  if (result.error || result.status === null) {
    assert.fail(`dpm canton-deploy ${cdArgs.join(' ')} did not exit (${result.error?.code ?? result.signal}):\n${out.slice(-2000)}`);
  }
  return { code: result.status, out };
}

function runDpmInstall(cwd) {
  const result = spawnSync('dpm', ['install', 'package'], {
    cwd,
    env: scrubEnv(),
    encoding: 'utf8',
    timeout: 300_000,
    maxBuffer: 20 * 1024 * 1024,
  });
  const out = `${result.stdout || ''}${result.stderr || ''}`;
  if ((result.status ?? 1) !== 0) {
    throw new Error(`dpm install package failed:\n${out}`);
  }
}

function startSandbox(cwd) {
  const child = spawn('dpm', SANDBOX_ARGS, { cwd, env: scrubEnv(), detached: true });
  let out = '';
  const kill = (signal) => {
    try {
      process.kill(-child.pid, signal);
    } catch {}
  };
  const stop = async () => {
    kill('SIGTERM');
    for (let i = 0; i < 60 && (await canTcpConnect('127.0.0.1', 5001)); i++) {
      await new Promise((r) => setTimeout(r, 500));
    }
    kill('SIGKILL');
  };
  process.once('exit', () => kill('SIGKILL'));
  process.once('SIGINT', () => {
    kill('SIGKILL');
    process.exit(130);
  });

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      kill('SIGKILL');
      reject(new Error(`dpm sandbox not ready after ${SANDBOX_START_MS} ms:\n${out.slice(-3000)}`));
    }, SANDBOX_START_MS);
    const onData = (buf) => {
      out += buf;
      if (/sandbox is ready/i.test(out)) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`dpm sandbox exited (${code}) before ready:\n${out.slice(-3000)}`));
    });
  });
  return { ready, stop };
}

function copyFixture(workDir, runId) {
  fs.cpSync(FIXTURE_SRC, workDir, { recursive: true });
  const damlYamlPath = path.join(workDir, 'daml.yaml');
  let yaml = fs.readFileSync(damlYamlPath, 'utf8');
  yaml = yaml.replace(/__REPO__/g, REPO_ROOT);
  fs.writeFileSync(damlYamlPath, yaml);

  const issuerHint = `E2eIssuer${runId}`;
  const ownerHint = `E2eOwner${runId}`;
  const config = `module.exports = {
  defaultNetwork: 'localnet',
  networks: {
    localnet: {
      host: 'localhost',
      adminPort: 5002,
      ledgerPort: 5001,
      httpPort: 7575,
      uploadVia: 'admin',
      vetOnUpload: true,
      parties: [${JSON.stringify(issuerHint)}, ${JSON.stringify(ownerHint)}],
      users: [{
        userId: 'ledger-api-user',
        parties: [${JSON.stringify(issuerHint)}, ${JSON.stringify(ownerHint)}],
        rights: ['CanActAs', 'CanReadAs'],
      }],
      additionalDars: [],
      excludePackages: [],
    },
  },
};
`;
  fs.writeFileSync(path.join(workDir, 'canton-deploy.config.js'), config);
  return { issuerHint, ownerHint };
}

function parsePartyId(out) {
  const m = out.match(/Party ID:\s*(\S+)/);
  assert.ok(m, `expected Party ID in output:\n${out.slice(-2000)}`);
  return m[1];
}

function parseFixturePackageId(darsOut) {
  const m = darsOut.match(/([0-9a-f]{64})\s+e2e-fixture\s/);
  assert.ok(m, `e2e-fixture row not found in dars:\n${darsOut.slice(-3000)}`);
  return m[1];
}

describe('localnet e2e', () => {
  const runId = Date.now().toString(36);
  const issuerHint = `E2eIssuer${runId}`;
  const ownerHint = `E2eOwner${runId}`;
  let workDir;
  let sandbox = null;
  let mainPackageId;
  let issuerId;
  let ownerId;

  const cd = (args, opts) => runDpm(workDir, [...args, '--network', 'localnet'], opts);
  const ok = (res) => {
    assert.equal(res.code, 0, res.out);
    return res.out;
  };

  let failed = false;
  const step = (name, fn) =>
    it(name, async (t) => {
      if (failed) return t.skip('earlier step failed');
      try {
        await fn();
      } catch (err) {
        failed = true;
        throw err;
      }
    });

  before(
    async () => {
      workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-e2e-'));
      copyFixture(workDir, runId);
      runDpmInstall(workDir);
      if (!(await sandboxUp())) {
        sandbox = startSandbox(workDir);
        await sandbox.ready;
      }
    },
    { timeout: 600_000 }
  );

  after(async () => {
    await sandbox?.stop();
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
  });

  step('--help lists every command', () => {
    const out = ok(runDpm(workDir, ['--help'], { timeout: 30_000 }));
    for (const cmd of COMMANDS) {
      assert.match(out, new RegExp(`^\\s+${cmd}\\b`, 'm'), `help missing ${cmd}`);
    }
  });

  step('status', () => {
    const out = ok(cd(['status']));
    assert.match(out, /✓ Ledger API/);
    assert.match(out, /Synchronizers \((Admin|JSON API)\):\n\s+• \S+/);
  });

  step('token --decode', () => {
    const out = ok(cd(['token', '--decode']));
    assert.match(out, /source:\s*localnet/);
    assert.match(out, /sub:\s*ledger-api-user/);
  });

  step('deploy --dry-run', () => {
    const out = ok(cd(['deploy', '--dry-run']));
    assert.match(out, /e2e-fixture-0\.0\.1/);
    assert.match(out, /--dry-run: skipping upload/);
    assert.doesNotMatch(out, /Uploaded /);
  });

  step('deploy --upload-via admin --vet', () => {
    assert.match(ok(cd(['deploy', '--upload-via', 'admin', '--vet', '--skip-build'])), /Deployment complete/);
  });

  step('dars', () => {
    mainPackageId = parseFixturePackageId(ok(cd(['dars'])));
  });

  step('packages', () => {
    assert.ok(ok(cd(['packages'])).includes(mainPackageId));
  });

  step('vet --skip-build', () => {
    ok(cd(['vet', '--skip-build']));
  });

  step('vet-dar <id>', () => {
    ok(cd(['vet-dar', mainPackageId]));
  });

  step('vet-dar <id> --no-sync', () => {
    ok(cd(['vet-dar', mainPackageId, '--no-sync']));
  });

  step('deploy --upload-via ledger --skip-build --vet', () => {
    ok(cd(['deploy', '--upload-via', 'ledger', '--skip-build', '--vet']));
  });

  step('allocate-party is idempotent for config parties', () => {
    const first = ok(cd(['allocate-party', issuerHint]));
    issuerId = parsePartyId(first);
    assert.match(first, /Local:\s*yes/);
    assert.equal(parsePartyId(ok(cd(['allocate-party', issuerHint]))), issuerId);
    const owner = ok(cd(['allocate-party', ownerHint]));
    ownerId = parsePartyId(owner);
    assert.match(owner, /Local:\s*yes/);
  });

  step('allocate-party creates a new party', () => {
    const freshHint = `E2eFresh${runId}`;
    const first = ok(cd(['allocate-party', freshHint]));
    assert.match(first, /Party allocated/);
    const second = ok(cd(['allocate-party', freshHint]));
    assert.match(second, /Party already exists/);
    assert.equal(parsePartyId(second), parsePartyId(first));
  });

  step('parties --local', () => {
    assert.ok(ok(cd(['parties', '--local', '--filter-party', issuerHint])).includes(issuerId));
  });

  step('parties --filter-party E2e', () => {
    const out = ok(cd(['parties', '--filter-party', 'E2e']));
    assert.ok(out.includes(issuerId) && out.includes(ownerId), out);
    assert.doesNotMatch(out, /^\s+sandbox::/m, 'filter did not exclude non-E2e parties');
  });

  step('parties --party <id>', () => {
    assert.ok(ok(cd(['parties', '--party', issuerId])).includes(issuerId));
  });

  step('create-user', () => {
    ok(cd(['create-user', '--user-id', 'ledger-api-user']));
  });

  step('users', () => {
    assert.match(ok(cd(['users'])), /ledger-api-user/);
  });

  step('run Setup:setup --input-file', () => {
    fs.writeFileSync(
      path.join(workDir, 'parties.input.json'),
      JSON.stringify({ issuer: issuerId, owner: ownerId }) + '\n'
    );
    assert.match(ok(cd(['run', 'Setup:setup', '--input-file', 'parties.input.json'])), /completed successfully/i);
  });

  step('deploy --script Setup:setup --input-file', () => {
    ok(cd(['deploy', '--skip-build', '--script', 'Setup:setup', '--input-file', 'parties.input.json']));
  });

  step('contracts --party --template', () => {
    const out = ok(cd(['contracts', '--party', issuerId, '--template', '#e2e-fixture:Main:Note']));
    const found = out.match(/Found (\d+) active contract/);
    assert.ok(found && Number(found[1]) >= 2, out);
  });

  step('contracts --party', () => {
    ok(cd(['contracts', '--party', issuerId]));
  });

  step('status --log-file', () => {
    const logPath = path.join(workDir, 'e2e-status.log');
    ok(cd(['status', '--log-file', logPath]));
    assert.ok(fs.existsSync(logPath), 'log file missing');
    assert.match(fs.readFileSync(logPath, 'utf8'), /Status summary/);
  });

  describe('rejects bad input', () => {
    it('status --ledger-port 1', () => {
      const res = cd(['status', '--ledger-port', '1'], {
        timeout: 30_000,
        env: { CANTON_DEPLOY_GRPC_CONNECT_MS: '2000' },
      });
      assert.equal(res.code, 1, res.out);
      assert.match(res.out, /✗ Ledger API\s+localhost:1\b/);
    });

    it('token --decode --token not-a-jwt', () => {
      const res = cd(['token', '--decode', '--token', 'not-a-jwt'], { timeout: 30_000 });
      assert.equal(res.code, 1, res.out);
      assert.match(res.out, /not a valid JWT/);
    });

    it('deploy --upload-via json', () => {
      const res = cd(['deploy', '--upload-via', 'json'], { timeout: 15_000 });
      assert.equal(res.code, 1, res.out);
      assert.match(res.out, /--upload-via must be admin or ledger/);
    });

    it('create-user --user-id nobody', () => {
      const res = cd(['create-user', '--user-id', 'nobody']);
      assert.equal(res.code, 1, res.out);
      assert.match(res.out, /User "nobody" not found in canton-deploy\.config\.js/);
    });

    step('contracts --template <hex package id>', () => {
      const res = cd(['contracts', '--party', issuerId, '--template', mainPackageId]);
      assert.equal(res.code, 1, res.out);
      assert.match(res.out, /#<package-name>:Module:Template/);
    });
  });
});

