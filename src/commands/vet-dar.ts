import chalk from 'chalk';
import ora from 'ora';
import type { CliFlags } from '../types.js';
import { loadConfig } from '../config.js';
import { resolveToken } from '../auth/resolve.js';
import { AdminClient } from '../grpc/admin.js';
import { formatGrpcError } from '../grpc/format-error.js';

export async function runVetDar(
  mainPackageId: string,
  flags: CliFlags & { noSync?: boolean }
): Promise<void> {
  const config = await loadConfig(flags);
  const { network } = config;
  const token = await resolveToken(network);
  const client = new AdminClient(network);

  console.log(chalk.bold('\n  canton-deploy vet-dar'));
  console.log(chalk.gray(`  Admin API: ${network.host}:${network.adminPort}`));
  console.log(chalk.gray(`  Package:   ${mainPackageId}\n`));

  const spinner = ora('Vetting DAR (main package)...').start();
  try {
    await client.vetDar(mainPackageId, token, {
      synchronize: !flags.noSync,
      synchronizerId: network.synchronizerId,
    });
    spinner.succeed(chalk.green('VetDar completed'));
    console.log();
  } catch (err) {
    spinner.fail('VetDar failed');
    console.error(chalk.red(`  ${formatGrpcError(err)}`));
    process.exit(1);
  }
}
