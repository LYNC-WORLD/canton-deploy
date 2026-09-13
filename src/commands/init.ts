import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { input, confirm } from '@inquirer/prompts';

function portInput(message: string, hint: string): Promise<string> {
  return input({
    message: `${message} ${chalk.gray(`(default: ${hint})`)}`,
    validate: (v) => {
      if (!v) return true;
      const n = parseInt(v, 10);
      return (!isNaN(n) && n > 0 && n < 65536) || 'Must be a valid port (1–65535)';
    },
  });
}

export async function runInit(): Promise<void> {
  console.log(chalk.bold('\n  canton-deploy init'));
  console.log(chalk.gray('  LocalNet + DevNet profiles; Admin API upload.\n'));

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

  const localnetHost = await input({ message: 'LocalNet host:', default: 'localhost' });
  const localnetAdmin = await portInput('LocalNet Admin API port:', '5002');
  const localnetLedger = await portInput('LocalNet Ledger API port:', '5001');
  const localnetHttp = await portInput('LocalNet JSON API port:', '7575');

  const localnetParties = await input({
    message: 'LocalNet parties to auto-allocate on deploy (comma-separated, or blank):',
    default: 'Alice, Bob',
  });

  const localnetUsers = await confirm({
    message: 'Add a default LocalNet user (ledger-api-user)?',
    default: true,
  });

  let devnetBlock = '';
  if (addDevnet) {
    const devHost = await input({ message: 'DevNet host:', default: '192.168.50.10' });
    const devAdmin = await portInput('DevNet Admin API port:', '5002');
    const devLedger = await portInput('DevNet Ledger API port:', '5011');
    const devHttp = await portInput('DevNet JSON API port:', '8080');
    const tokenFile = await input({
      message: 'DevNet token file path:',
      default: './.tokens/devnet.jwt',
    });

    devnetBlock = `
    devnet: {
      host: "${devHost}",
      adminPort: ${devAdmin || 5002},
      ledgerPort: ${devLedger || 5011},
      httpPort: ${devHttp || 8080},
      vetOnUpload: true,
      tokenFile: "${tokenFile}",
      parties: [],
      users: [],
      additionalDars: [],
      excludePackages: [],
    },`;
  }

  const localPartiesArr = localnetParties
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  const usersBlock = localnetUsers
    ? `      users: [{
        userId: "ledger-api-user",
        parties: [${localPartiesArr.map((p) => `"${p}"`).join(', ')}],
        rights: ["CanActAs", "CanReadAs"],
      }],`
    : '      users: [],';

  const content = `module.exports = {
  defaultNetwork: "localnet",

  networks: {
    localnet: {
      host: "${localnetHost}",
      adminPort: ${localnetAdmin || 5002},
      ledgerPort: ${localnetLedger || 5001},
      httpPort: ${localnetHttp || 7575},
      vetOnUpload: true,
      parties: [${localPartiesArr.map((p) => `"${p}"`).join(', ')}],
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
  console.log(chalk.gray('    canton-deploy status --network localnet'));
  console.log(chalk.gray('    canton-deploy deploy --network localnet'));
  console.log(chalk.gray('    canton-deploy deploy --network devnet --token <jwt>\n'));
}
