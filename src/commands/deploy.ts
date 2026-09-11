import * as fs from 'fs';
import * as path from 'path';
import * as grpc from '@grpc/grpc-js';
import chalk from 'chalk';
import ora from 'ora';
import type { CliFlags } from '../types.js';
import { loadConfig } from '../config.js';
import { resolveToken } from '../auth/resolve.js';
import { runDpmBuild, getDarPath } from '../build.js';
import { AdminClient } from '../grpc/admin.js';
import { formatGrpcError } from '../grpc/format-error.js';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export async function runDeploy(flags: CliFlags): Promise<void> {
  const start = Date.now();
  const config = await loadConfig(flags);
  const { network } = config;

  console.log(chalk.bold('\n  canton-deploy deploy'));
  console.log(
    chalk.gray(
      `  Upload: Admin API · host ${network.host} · admin ${network.adminPort}\n`
    )
  );

  const token = await resolveToken(network);

  let darPath: string;
  if (flags.dar) {
    darPath = path.resolve(flags.dar);
    if (!fs.existsSync(darPath)) {
      console.error(chalk.red(`DAR not found: ${darPath}`));
      process.exit(1);
    }
    console.log(chalk.gray(`  Using existing DAR: ${darPath}`));
  } else {
    await runDpmBuild();
    darPath = getDarPath();
    if (!fs.existsSync(darPath)) {
      console.error(chalk.red(`Expected DAR not found at: ${darPath}`));
      process.exit(1);
    }
  }

  const darSize = fs.statSync(darPath).size;
  console.log(chalk.gray(`  DAR: ${path.basename(darPath)} (${formatBytes(darSize)})`));

  if (flags.dryRun) {
    console.log(chalk.yellow('\n  --dry-run: skipping upload.\n'));
    return;
  }

  const darBuffer = fs.readFileSync(darPath);
  const darName = path.basename(darPath);
  const uploadTarget = `${network.host}:${network.adminPort}`;
  const uploadSpinner = ora(`Uploading ${darName} to ${uploadTarget}...`).start();

  let darIds: string[] = [];
  try {
    const adminClient = new AdminClient(network);
    const result = await adminClient.uploadDar(darBuffer, token, darName, {
      vetAllPackages: true,
      synchronizeVetting: true,
      synchronizerId: network.synchronizerId,
    });
    darIds = result.dar_ids ?? [];
    uploadSpinner.succeed(
      chalk.green(`DAR uploaded successfully`) +
      chalk.gray(` (${darIds.length} package id(s))`)
    );
  } catch (err) {
    uploadSpinner.fail('DAR upload failed');
    console.error(chalk.red(`  ${formatGrpcError(err)}`));
    if ((err as grpc.ServiceError).code === grpc.status.UNAUTHENTICATED) {
      console.error(chalk.gray('  Run: canton-deploy token --decode'));
    }
    process.exit(1);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(chalk.bold('\n  Deploy summary'));
  console.log(chalk.gray('  ─────────────────────────────────────'));
  console.log(`  ${chalk.gray('DAR:')}      ${darName}`);
  console.log(`  ${chalk.gray('Size:')}     ${formatBytes(darSize)}`);
  if (darIds.length > 0) {
    console.log(`  ${chalk.gray('Package:')} ${darIds[0]}`);
  }
  console.log(`  ${chalk.gray('Upload:')}   Admin API`);
  console.log(`  ${chalk.gray('Target:')}   ${uploadTarget}`);
  console.log(`  ${chalk.gray('Time:')}     ${elapsed}s`);
  console.log(chalk.green('\n  Deployment complete.\n'));
}
