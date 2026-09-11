import chalk from 'chalk';
import ora from 'ora';
import type { CliFlags } from '../types.js';
import { loadConfig } from '../config.js';
import { resolveToken } from '../auth/resolve.js';
import { AdminClient } from '../grpc/admin.js';
import { formatGrpcError } from '../grpc/format-error.js';

function padEnd(str: string, len: number): string {
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

export async function runDars(flags: CliFlags): Promise<void> {
  const config = await loadConfig(flags);
  const { network } = config;
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
      padEnd('MAIN_PACKAGE', col1) +
      padEnd('NAME', col2) +
      padEnd('VERSION', 12) +
      'DESCRIPTION';

    console.log('\n  ' + chalk.bold(header));
    console.log('  ' + chalk.gray('─'.repeat(header.length)));

    for (const d of dars) {
      console.log(
        `  ${chalk.cyan(padEnd(d.main, col1))}` +
          `${padEnd(d.name ?? '', col2)}` +
          `${padEnd(d.version ?? '', 12)}` +
          `${chalk.gray(d.description ?? '')}`
      );
    }
    console.log();
  } catch (err) {
    spinner.fail('Failed to list DARs');
    console.error(chalk.red(`  ${formatGrpcError(err)}`));
    process.exit(1);
  }
}

