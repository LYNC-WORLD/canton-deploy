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
  host: '192.168.50.10',
  adminPort: 5002,
  ledgerPort: 5011,
  httpPort: 8080,
  tokenFile: './.tokens/devnet.jwt',
} as const;

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

  const cmd = await input({
    message: `${label} tokenCommand (prints JWT to stdout):`,
    default: 'vault kv get -field=token secret/canton/devnet-jwt',
  });
  return `      tokenCommand: ${js(cmd.trim())},\n`;
}

async function promptLocalNet(): Promise<{
  host: string;
  adminPort: number;
  ledgerPort: number;
  httpPort: number;
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

  return {
    host,
    adminPort,
    ledgerPort,
    httpPort,
    tlsLine: tls.tlsLine,
    certLine: tls.certLine,
    tokenLines,
    parties: parseParties(partiesRaw),
    addUser,
  };
}

async function promptDevNet(): Promise<string> {
  console.log(chalk.gray('\n  — DevNet —'));
  console.log(
    chalk.gray(
      `  Defaults: ${DEVNET_DEFAULTS.host} · admin ${DEVNET_DEFAULTS.adminPort} · ledger ${DEVNET_DEFAULTS.ledgerPort} · http ${DEVNET_DEFAULTS.httpPort}\n` +
        `            no TLS · tokenFile ${DEVNET_DEFAULTS.tokenFile} · empty parties/users`
    )
  );

  const useDefaults = await confirm({
    message: 'Use DevNet defaults?',
    default: true,
  });

  let host = DEVNET_DEFAULTS.host;
  let adminPort = DEVNET_DEFAULTS.adminPort;
  let ledgerPort = DEVNET_DEFAULTS.ledgerPort;
  let httpPort = DEVNET_DEFAULTS.httpPort;
  let tlsLine = '      tls: false,';
  let certLine = '';
  let tokenLines = `      tokenFile: ${js(DEVNET_DEFAULTS.tokenFile)},\n`;

  if (!useDefaults) {
    host = await input({ message: 'DevNet host:', default: DEVNET_DEFAULTS.host });
    adminPort = await portInput('DevNet Admin API port:', DEVNET_DEFAULTS.adminPort);
    ledgerPort = await portInput('DevNet Ledger API port:', DEVNET_DEFAULTS.ledgerPort);
    httpPort = await portInput('DevNet JSON API port:', DEVNET_DEFAULTS.httpPort);
    const tls = await promptTls('DevNet');
    tokenLines = await promptTokenLines('DevNet', {
      allowLocalAuto: false,
      defaultFile: DEVNET_DEFAULTS.tokenFile,
    });
    tlsLine = tls.tlsLine;
    certLine = tls.certLine;
  }

  return `
    devnet: {
      host: ${js(host)},
      adminPort: ${adminPort},
      ledgerPort: ${ledgerPort},
      httpPort: ${httpPort},
${tlsLine}
${certLine}${tokenLines}      vetOnUpload: true,
      parties: [],
      users: [],
      additionalDars: [],
      excludePackages: [],
    },`;
}

export async function runInit(): Promise<void> {
  console.log(chalk.bold('\n  canton-deploy init'));
  console.log(chalk.gray('  LocalNet + DevNet profiles; DAR upload via Admin API.\n'));

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

  const local = await promptLocalNet();
  const usersBlock = local.addUser
    ? `      users: [{
        userId: "ledger-api-user",
        parties: [${local.parties.map((p) => js(p)).join(', ')}],
        rights: ["CanActAs", "CanReadAs"],
      }],`
    : '      users: [],';

  const devnetBlock = addDevnet ? await promptDevNet() : '';

  const content = `module.exports = {
  defaultNetwork: "localnet",

  networks: {
    localnet: {
      host: ${js(local.host)},
      adminPort: ${local.adminPort},
      ledgerPort: ${local.ledgerPort},
      httpPort: ${local.httpPort},
${local.tlsLine}
${local.certLine}${local.tokenLines}      vetOnUpload: true,
      parties: [${local.parties.map((p) => js(p)).join(', ')}],
${usersBlock}
      additionalDars: [],
      excludePackages: [],
    },${devnetBlock}
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
