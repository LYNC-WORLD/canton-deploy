import * as fs from 'fs';
import * as path from 'path';
import * as grpc from '@grpc/grpc-js';
import chalk from 'chalk';
import ora from 'ora';
import type { CliFlags } from '../types.js';
import { loadConfig, resolveVetOnUpload } from '../config.js';
import { resolveToken } from '../auth/resolve.js';
import { runDpmBuild } from '../build.js';
import { normalizeCliDars, resolveFullDarSet } from '../dar-set.js';
import { AdminClient } from '../grpc/admin.js';
import { formatGrpcError } from '../grpc/format-error.js';
import { runPreflight } from '../preflight.js';
import { ensureParties, ensureUsers } from '../onboarding.js';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export async function runDeploy(flags: CliFlags): Promise<void> {
  const start = Date.now();
  const config = await loadConfig(flags);
  const { network } = config;
  const vetOnUpload = resolveVetOnUpload(network, flags);
  const cliDars = normalizeCliDars(flags.dar);

  console.log(chalk.bold('\n  canton-deploy deploy'));
  console.log(
    chalk.gray(
      `  Upload: Admin API · host ${network.host} · admin ${network.adminPort} · vet on upload: ${vetOnUpload ? 'yes' : 'no'}\n`
    )
  );

  const token = await resolveToken(network);

  if (!flags.dryRun) {
    await runPreflight(network, token);
  }

  if (!flags.skipBuild) {
    await runDpmBuild();
  }

  const darSet = resolveFullDarSet(network, { cliDars });
  if (darSet.length === 0) {
    console.error(chalk.red('No DARs to upload. Configure project packages or --dar / additionalDars.'));
    process.exit(1);
  }

  console.log(chalk.gray(`  DAR set (${darSet.length}):`));
  for (const d of darSet) {
    const size = formatBytes(fs.statSync(d.path).size);
    console.log(chalk.gray(`    · ${d.label} (${size})`));
  }

  if (flags.dryRun) {
    console.log(chalk.yellow('\n  --dry-run: skipping upload and onboarding.\n'));
    return;
  }

  const adminClient = new AdminClient(network);
  const uploadTarget = `${network.host}:${network.adminPort}`;
  const allPackageIds: string[] = [];

  for (const entry of darSet) {
    const darBuffer = fs.readFileSync(entry.path);
    const darName = path.basename(entry.path);
    const uploadSpinner = ora(`Uploading ${darName} to ${uploadTarget}...`).start();

    try {
      const result = await adminClient.uploadDar(darBuffer, token, darName, {
        vetAllPackages: vetOnUpload,
        synchronizeVetting: vetOnUpload,
        synchronizerId: network.synchronizerId,
      });
      const ids = result.dar_ids ?? [];
      allPackageIds.push(...ids);
      uploadSpinner.succeed(
        chalk.green(`Uploaded ${darName}`) + chalk.gray(` (${ids.length} package id(s))`)
      );
    } catch (err) {
      uploadSpinner.fail(`Upload failed: ${darName}`);
      console.error(chalk.red(`  ${formatGrpcError(err)}`));
      if ((err as grpc.ServiceError).code === grpc.status.UNAUTHENTICATED) {
        console.error(chalk.gray('  Run: canton-deploy token --decode'));
      }
      process.exit(1);
    }
  }

  const partyNames = [
    ...network.parties,
    ...network.users.flatMap((u) => u.parties),
  ].filter((name, i, arr) => arr.indexOf(name) === i);
  const partyMap = await ensureParties(network, token, partyNames);
  await ensureUsers(network, token, partyMap);

  if (flags.script) {
    console.log(chalk.gray(`\n  Running script: ${flags.script}`));
    const { runScript } = await import('./run.js');
    const primaryDar = darSet[darSet.length - 1]?.path;
    await runScript({ ...flags, dar: primaryDar });
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(chalk.bold('\n  Deploy summary'));
  console.log(chalk.gray('  ─────────────────────────────────────'));
  console.log(`  ${chalk.gray('DARs:')}     ${darSet.length}`);
  console.log(`  ${chalk.gray('Upload:')}   Admin API`);
  console.log(`  ${chalk.gray('Target:')}   ${uploadTarget}`);
  console.log(`  ${chalk.gray('Vetted:')}   ${vetOnUpload ? 'yes' : 'no (upload-only)'}`);
  if (allPackageIds.length > 0) {
    console.log(`  ${chalk.gray('Package:')}  ${allPackageIds[0]}`);
  }
  console.log(`  ${chalk.gray('Time:')}     ${elapsed}s`);
  console.log(chalk.green('\n  Deployment complete.\n'));
}
