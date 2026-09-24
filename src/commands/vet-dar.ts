import chalk from 'chalk';
import ora from 'ora';
import type { CliFlags, ResolvedNetwork } from '../types.js';
import { withNetworkSession } from '../network-session.js';
import { resolveToken } from '../auth/resolve.js';
import { AdminClient } from '../grpc/admin.js';
import { failSpinner } from '../utils/cli.js';

async function executeVetDar(
  network: ResolvedNetwork,
  mainPackageId: string,
  flags: CliFlags & { noSync?: boolean }
): Promise<void> {
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
    failSpinner(spinner, 'VetDar failed', err);
  }
}

export async function runVetDar(
  mainPackageId: string,
  flags: CliFlags & { noSync?: boolean }
): Promise<void> {
  return withNetworkSession(flags, (network) => executeVetDar(network, mainPackageId, flags));
}
