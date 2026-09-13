import chalk from 'chalk';
import ora from 'ora';
import type { CliFlags } from '../types.js';
import { loadConfig } from '../config.js';
import { resolveToken } from '../auth/resolve.js';
import { PackageManagementGrpcClient } from '../grpc/package-management.js';
import { formatGrpcError } from '../grpc/format-error.js';

function padEnd(str: string, len: number): string {
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

export async function runPackages(flags: CliFlags): Promise<void> {
  const config = await loadConfig(flags);
  const { network } = config;
  const token = await resolveToken(network);

  const client = new PackageManagementGrpcClient(network);

  console.log(chalk.bold('\n  canton-deploy packages'));
  console.log(chalk.gray(`  Ledger API: ${network.host}:${network.ledgerPort}${network.grpcAuthority ? ` (authority: ${network.grpcAuthority})` : ''}\n`));

  const spinner = ora('Listing known packages...').start();
  try {
    const pkgs = await client.listKnownPackages(token);
    spinner.succeed(`Found ${pkgs.length} package(s)`);

    if (pkgs.length === 0) {
      console.log(chalk.gray('\n  No packages found.\n'));
      return;
    }

    pkgs.sort((a, b) => (a.name ?? a.package_id).localeCompare(b.name ?? b.package_id));

    const col1 = Math.max(12, ...pkgs.map((p) => (p.name ?? '').length)) + 2;
    const col2 = Math.max(8, ...pkgs.map((p) => (p.version ?? '').length)) + 2;
    const col3 = 66;

    const header = padEnd('NAME', col1) + padEnd('VERSION', col2) + 'PACKAGE_ID';
    console.log('\n  ' + chalk.bold(header));
    console.log('  ' + chalk.gray('─'.repeat(header.length)));
    for (const p of pkgs) {
      const name = p.name ?? '';
      const version = p.version ?? '';
      const id = p.package_id ?? '';
      console.log(
        `  ${padEnd(name, col1)}` +
          `${padEnd(version, col2)}` +
          `${chalk.cyan(id.slice(0, col3))}`
      );
    }
    console.log();
  } catch (err) {
    spinner.fail('Failed to list known packages');
    console.error(chalk.red(`  ${formatGrpcError(err)}`));
    process.exit(1);
  }
}

