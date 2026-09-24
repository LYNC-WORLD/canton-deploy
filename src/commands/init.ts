import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { input, confirm, select } from '@inquirer/prompts';

const LOCALNET_DEFAULTS = {
  host: 'localhost',
  adminPort: 5002,
  ledgerPort: 5001,
  httpPort: 7575,
  parties: 'Alice, Bob',
  addUser: true,
} as const;

const DEVNET_DEFAULTS = {
  host: 'validator.example.com',
  adminPort: 5002,
  ledgerPort: 5011,
  httpPort: 8080,
  tokenFile: './.tokens/devnet.jwt',
} as const;

const TESTNET_DEFAULTS = {
  host: 'testnet-validator.example.com',
  ledgerPort: 443,
  httpPort: 443,
  tokenFile: './.tokens/testnet.jwt',
} as const;

const MAINNET_DEFAULTS = {
  host: 'mainnet-validator.example.com',
  ledgerPort: 443,
  httpPort: 443,
  tokenCommand: 'vault read -field=token secret/canton/mainnet-jwt',
} as const;

async function promptUploadVia(label: string): Promise<'admin' | 'ledger'> {
  const choice = await select({
    message: `${label} default upload path:`,
    choices: [
      { name: 'ledger (Ledger/JSON API — managed validators)', value: 'ledger' as const },
      { name: 'admin (Admin API — operator tooling)', value: 'admin' as const },
    ],
    default: 'ledger',
  });
  return choice;
}

async function portInput(message: string, defaultPort: number): Promise<number> {
  const raw = await input({
    message,
    default: String(defaultPort),
    validate: (v) => {
      const n = parseInt(v, 10);
      return (!isNaN(n) && n > 0 && n < 65536) || 'Must be a valid port (1–65535)';
    },
  });
  return parseInt(raw, 10);
}

function js(value: string): string {
  return JSON.stringify(value);
}

function parseParties(raw: string): string[] {
  return raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
}

async function promptTls(label: string): Promise<{ tlsLine: string; certLine: string }> {
  const tls = await confirm({ message: `${label} enable TLS?`, default: false });
  if (!tls) return { tlsLine: '      tls: false,', certLine: '' };
  const cert = await input({
    message: `${label} TLS CA cert path (blank to omit):`,
    default: '',
  });
  const certLine = cert.trim() ? `      tlsCertFile: ${js(cert.trim())},\n` : '';
  return { tlsLine: '      tls: true,', certLine };
}

async function promptTokenLines(
  label: string,
  opts: { allowLocalAuto: boolean; defaultFile: string }
): Promise<string> {
  const choices = [
    ...(opts.allowLocalAuto
      ? [{ name: 'LocalNet auto (HMAC unsafe secret)', value: 'localnet' as const }]
      : []),
    { name: 'Inline JWT', value: 'token' as const },
    { name: 'Token file', value: 'tokenFile' as const },
    { name: 'Shell command', value: 'tokenCommand' as const },
    { name: 'OAuth2 client credentials (Auth0 M2M)', value: 'oauth2' as const },
  ];

  const choice = await select({
    message: `${label} token source:`,
    choices,
    default: opts.allowLocalAuto ? 'localnet' : 'tokenFile',
  });

  if (choice === 'localnet') return '';

  if (choice === 'token') {
    const token = await input({
      message: `${label} JWT (or leave blank and set later):`,
      default: '',
    });
    return token.trim()
      ? `      token: ${js(token.trim())},\n`
      : `      // token: process.env.DEVNET_JWT_TOKEN,\n`;
  }

  if (choice === 'tokenFile') {
    const file = await input({
      message: `${label} token file path:`,
      default: opts.defaultFile,
    });
    return `      tokenFile: ${js(file.trim() || opts.defaultFile)},\n`;
  }

  if (choice === 'oauth2') {
    return promptOAuth2Lines(label);
  }

  const cmd = await input({
    message: `${label} tokenCommand (prints JWT to stdout):`,
    default: 'vault kv get -field=token secret/canton/devnet-jwt',
  });
  return `      tokenCommand: ${js(cmd.trim())},\n`;
}

async function promptOAuth2Lines(label: string): Promise<string> {
  const tokenUrl = await input({
    message: `${label} OAuth2 token URL:`,
    default: 'https://YOUR_TENANT.auth0.com/oauth/token',
  });
  const clientId = await input({ message: `${label} OAuth2 client ID:`, default: '' });
  const clientSecretEnv = await input({
    message: `${label} env var for client secret (never commit the secret):`,
    default: 'DEVNET_OAUTH_CLIENT_SECRET',
  });
  const audience = await input({ message: `${label} OAuth2 audience:`, default: '' });
  return `      oauth2: {
        tokenUrl: ${js(tokenUrl.trim())},
        clientId: ${js(clientId.trim())},
        clientSecretEnv: ${js(clientSecretEnv.trim() || 'DEVNET_OAUTH_CLIENT_SECRET')},
        audience: ${js(audience.trim())},
      },\n`;
}

async function promptSshTunnelLines(label: string): Promise<string> {
  const host = await input({ message: `${label} SSH host:`, default: 'dev-server.example.com' });
  const user = await input({ message: `${label} SSH user:`, default: 'ubuntu' });
  const identityFile = await input({
    message: `${label} SSH identity file:`,
    default: '~/.ssh/id_ed25519',
  });
  return `      tunnel: {
        ssh: {
          host: ${js(host.trim())},
          user: ${js(user.trim())},
          identityFile: ${js(identityFile.trim() || '~/.ssh/id_ed25519')},
          forwards: [
            { localPort: 5001, remoteHost: '127.0.0.1', remotePort: 80 },
            { localPort: 7575, remoteHost: '127.0.0.1', remotePort: 80 },
            { localPort: 5002, remoteHost: '127.0.0.1', remotePort: 80 },
          ],
        },
      },\n`;
}

async function promptLocalNet(): Promise<{
  host: string;
  adminPort: number;
  ledgerPort: number;
  httpPort: number;
  uploadVia: 'admin' | 'ledger';
  tlsLine: string;
  certLine: string;
  tokenLines: string;
  parties: string[];
  addUser: boolean;
}> {
  console.log(chalk.gray('\n  — LocalNet —'));
  console.log(
    chalk.gray(
      `  Defaults: ${LOCALNET_DEFAULTS.host} · admin ${LOCALNET_DEFAULTS.adminPort} · ledger ${LOCALNET_DEFAULTS.ledgerPort} · http ${LOCALNET_DEFAULTS.httpPort}\n` +
        `            no TLS · LocalNet HMAC token · parties ${LOCALNET_DEFAULTS.parties} · user ledger-api-user`
    )
  );

  const useDefaults = await confirm({
    message: 'Use LocalNet defaults?',
    default: true,
  });

  if (useDefaults) {
    return {
      host: LOCALNET_DEFAULTS.host,
      adminPort: LOCALNET_DEFAULTS.adminPort,
      ledgerPort: LOCALNET_DEFAULTS.ledgerPort,
      httpPort: LOCALNET_DEFAULTS.httpPort,
      uploadVia: 'ledger',
      tlsLine: '      tls: false,',
      certLine: '',
      tokenLines: '',
      parties: parseParties(LOCALNET_DEFAULTS.parties),
      addUser: LOCALNET_DEFAULTS.addUser,
    };
  }

  const host = await input({ message: 'LocalNet host:', default: LOCALNET_DEFAULTS.host });
  const adminPort = await portInput('LocalNet Admin API port:', LOCALNET_DEFAULTS.adminPort);
  const ledgerPort = await portInput('LocalNet Ledger API port:', LOCALNET_DEFAULTS.ledgerPort);
  const httpPort = await portInput('LocalNet JSON API port:', LOCALNET_DEFAULTS.httpPort);
  const tls = await promptTls('LocalNet');
  const tokenLines = await promptTokenLines('LocalNet', {
    allowLocalAuto: true,
    defaultFile: './.tokens/localnet.jwt',
  });
  const partiesRaw = await input({
    message: 'LocalNet parties to auto-allocate on deploy (comma-separated, or blank):',
    default: LOCALNET_DEFAULTS.parties,
  });
  const addUser = await confirm({
    message: 'Add a default LocalNet user (ledger-api-user)?',
    default: true,
  });
  const uploadVia = await promptUploadVia('LocalNet');

  return {
    host,
    adminPort,
    ledgerPort,
    httpPort,
    uploadVia,
    tlsLine: tls.tlsLine,
    certLine: tls.certLine,
    tokenLines,
    parties: parseParties(partiesRaw),
    addUser,
  };
}

async function promptRemoteProfile(
  name: string,
  defaults: {
    host: string;
    adminPort?: number;
    ledgerPort: number;
    httpPort: number;
    tokenFile?: string;
    tokenCommand?: string;
    vetOnUpload: boolean;
    tlsDefault: boolean;
    httpTlsDefault: boolean;
  },
  opts?: { tunnelLines?: string; tokenLinesOverride?: string }
): Promise<string> {
  console.log(chalk.gray(`\n  — ${name} —`));
  const useDefaults = await confirm({
    message: `Use ${name} placeholder defaults?`,
    default: true,
  });

  let host = defaults.host;
  let adminPort = defaults.adminPort ?? 5002;
  let ledgerPort = defaults.ledgerPort;
  let httpPort = defaults.httpPort;
  let tlsLine = defaults.tlsDefault ? '      tls: true,' : '      tls: false,';
  let httpTlsLine = defaults.httpTlsDefault ? '      httpUseTls: true,' : '';
  let certLine = '';
  let tokenLines =
    opts?.tokenLinesOverride ??
    (defaults.tokenFile
      ? `      tokenFile: ${js(defaults.tokenFile)},\n`
      : defaults.tokenCommand
        ? `      tokenCommand: ${js(defaults.tokenCommand)},\n`
        : '');
  let grpcAuthorityLine = '';
  let synchronizerLine = '';
  const uploadVia = useDefaults ? 'ledger' : await promptUploadVia(name);

  if (!useDefaults) {
    host = await input({ message: `${name} host:`, default: defaults.host });
    if (defaults.adminPort !== undefined) {
      adminPort = await portInput(`${name} Admin API port:`, adminPort);
    }
    ledgerPort = await portInput(`${name} Ledger API port:`, ledgerPort);
    httpPort = await portInput(`${name} JSON API port:`, httpPort);
    const tls = await promptTls(name);
    tlsLine = tls.tlsLine;
    certLine = tls.certLine;
    httpTlsLine = (await confirm({ message: `${name} JSON API use HTTPS?`, default: defaults.httpTlsDefault }))
      ? '      httpUseTls: true,'
      : '';
    tokenLines = await promptTokenLines(name, {
      allowLocalAuto: false,
      defaultFile: defaults.tokenFile ?? './.tokens/jwt',
    });
    const grpcAuthority = await input({
      message: `${name} grpcAuthority (blank if same as host):`,
      default: '',
    });
    if (grpcAuthority.trim()) {
      grpcAuthorityLine = `      grpcAuthority: ${js(grpcAuthority.trim())},\n`;
    }
    const synchronizerId = await input({
      message: `${name} synchronizerId (blank if single-synchronizer):`,
      default: '',
    });
    if (synchronizerId.trim()) {
      synchronizerLine = `      synchronizerId: ${js(synchronizerId.trim())},\n`;
    }
  }

  const adminBlock =
    defaults.adminPort !== undefined
      ? `      adminPort: ${adminPort},\n`
      : '';

  return `
    ${name}: {
      host: ${js(host)},
${adminBlock}      ledgerPort: ${ledgerPort},
      httpPort: ${httpPort},
${tlsLine}
${httpTlsLine ? `${httpTlsLine}\n` : ''}${certLine}${grpcAuthorityLine}${synchronizerLine}${opts?.tunnelLines ?? ''}      uploadVia: "${uploadVia}",
${tokenLines}      vetOnUpload: ${defaults.vetOnUpload},
      parties: [],
      users: [],
      additionalDars: [],
      excludePackages: [],
    },`;
}

async function promptDevNet(): Promise<string> {
  const useOAuth = await confirm({
    message: 'Devnet: fetch JWT via OAuth2 client credentials (e.g. Auth0 M2M)?',
    default: false,
  });
  const oauthLines = useOAuth ? await promptOAuth2Lines('Devnet') : '';

  const useTunnel = await confirm({
    message: 'Devnet: SSH local port forward to remote validator (docker compose + nginx)?',
    default: false,
  });
  const tunnelLines = useTunnel ? await promptSshTunnelLines('Devnet') : '';

  if (useTunnel) {
    console.log(
      chalk.gray(
        '  Tip: set host to 127.0.0.1 and grpcAuthority/httpHost to splice nginx names\n' +
          '       (grpc-ledger-api.localhost, json-ledger-api.localhost).\n'
      )
    );
  }

  return promptRemoteProfile(
    'devnet',
    {
      host: useTunnel ? '127.0.0.1' : DEVNET_DEFAULTS.host,
      adminPort: DEVNET_DEFAULTS.adminPort,
      ledgerPort: useTunnel ? 5001 : DEVNET_DEFAULTS.ledgerPort,
      httpPort: useTunnel ? 7575 : DEVNET_DEFAULTS.httpPort,
      tokenFile: useOAuth ? undefined : DEVNET_DEFAULTS.tokenFile,
      vetOnUpload: true,
      tlsDefault: false,
      httpTlsDefault: false,
    },
    { tunnelLines, tokenLinesOverride: useOAuth ? oauthLines : undefined }
  );
}

export async function runInit(): Promise<void> {
  console.log(chalk.bold('\n  canton-deploy init'));
  console.log(chalk.gray('  Multi-network profiles; default upload path is ledger.\n'));

  const configPath = path.join(process.cwd(), 'canton-deploy.config.js');
  if (fs.existsSync(configPath)) {
    const overwrite = await confirm({
      message: 'canton-deploy.config.js already exists. Overwrite?',
      default: false,
    });
    if (!overwrite) {
      console.log(chalk.gray('\n  Aborted.\n'));
      return;
    }
  }

  const addDevnet = await confirm({
    message: 'Add a devnet profile in addition to localnet?',
    default: true,
  });
  const addTestnet = await confirm({
    message: 'Add a testnet profile?',
    default: false,
  });
  const addMainnet = await confirm({
    message: 'Add a mainnet profile?',
    default: false,
  });

  const local = await promptLocalNet();
  const usersBlock = local.addUser
    ? `      users: [{
        userId: "ledger-api-user",
        parties: [${local.parties.map((p) => js(p)).join(', ')}],
        rights: ["CanActAs", "CanReadAs"],
      }],`
    : '      users: [],';

  const devnetBlock = addDevnet ? await promptDevNet() : '';
  const testnetBlock = addTestnet
    ? await promptRemoteProfile('testnet', {
        host: TESTNET_DEFAULTS.host,
        ledgerPort: TESTNET_DEFAULTS.ledgerPort,
        httpPort: TESTNET_DEFAULTS.httpPort,
        tokenFile: TESTNET_DEFAULTS.tokenFile,
        vetOnUpload: false,
        tlsDefault: true,
        httpTlsDefault: true,
      })
    : '';
  const mainnetBlock = addMainnet
    ? await promptRemoteProfile('mainnet', {
        host: MAINNET_DEFAULTS.host,
        ledgerPort: MAINNET_DEFAULTS.ledgerPort,
        httpPort: MAINNET_DEFAULTS.httpPort,
        tokenCommand: MAINNET_DEFAULTS.tokenCommand,
        vetOnUpload: false,
        tlsDefault: true,
        httpTlsDefault: true,
      })
    : '';

  const content = `module.exports = {
  defaultNetwork: "localnet",

  networks: {
    localnet: {
      host: ${js(local.host)},
      adminPort: ${local.adminPort},
      ledgerPort: ${local.ledgerPort},
      httpPort: ${local.httpPort},
${local.tlsLine}
${local.certLine}${local.tokenLines}      uploadVia: "${local.uploadVia}",
      vetOnUpload: true,
      parties: [${local.parties.map((p) => js(p)).join(', ')}],
${usersBlock}
      additionalDars: [],
      excludePackages: [],
    },${devnetBlock}${testnetBlock}${mainnetBlock}
  },
};
`;

  fs.writeFileSync(configPath, content, 'utf8');

  console.log(chalk.green(`\n  Created: ${configPath}`));
  console.log(chalk.gray('\n  Next steps:'));
  console.log(chalk.gray('    dpm canton-deploy status --network localnet'));
  console.log(chalk.gray('    dpm canton-deploy deploy --network localnet'));
  if (addDevnet) {
    console.log(chalk.gray('    dpm canton-deploy deploy --network devnet\n'));
  } else {
    console.log();
  }
}
