import chalk from 'chalk';
import ora from 'ora';
import type { CliFlags, ResolvedNetwork } from '../types.js';
import { withNetworkSession } from '../network-session.js';
import { resolveToken } from '../auth/resolve.js';
import { AdminClient } from '../grpc/admin.js';
import { failSpinner } from '../utils/cli.js';

async function executeDars(network: ResolvedNetwork): Promise<void> {
  const token = await resolveToken(network);
  const client = new AdminClient(network);

  console.log(chalk.bold('\n  canton-deploy dars'));
  console.log(chalk.gray(`  Admin API: ${network.host}:${network.adminPort}\n`));

  const spinner = ora('Listing DARs...').start();
  try {
    const dars = await client.listDars(token);
    spinner.succeed(`Found ${dars.length} DAR(s)`);

    if (dars.length === 0) {
      console.log(chalk.gray('\n  No DARs uploaded on this participant.\n'));
      return;
    }

    const col1 = Math.max(14, ...dars.map((d) => d.main.length)) + 2;
    const col2 = Math.max(10, ...dars.map((d) => (d.name ?? '').length)) + 2;

    const header =
      'MAIN_PACKAGE'.padEnd(col1) +
      'NAME'.padEnd(col2) +
      'VERSION'.padEnd(12) +
      'DESCRIPTION';

    console.log('\n  ' + chalk.bold(header));
    console.log('  ' + chalk.gray('─'.repeat(header.length)));

    for (const d of dars) {
      console.log(
        `  ${chalk.cyan(d.main.padEnd(col1))}` +
          `${(d.name ?? '').padEnd(col2)}` +
          `${(d.version ?? '').padEnd(12)}` +
          `${chalk.gray(d.description ?? '')}`
      );
    }
    console.log();
  } catch (err) {
    failSpinner(spinner, 'Failed to list DARs', err);
  }
}

export async function runDars(flags: CliFlags): Promise<void> {
  return withNetworkSession(flags, executeDars);
}
