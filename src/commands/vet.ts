import * as fs from 'fs';
import chalk from 'chalk';
import ora from 'ora';
import type { CliFlags, ResolvedNetwork } from '../types.js';
import { withNetworkSession } from '../network-session.js';
import { resolveToken } from '../auth/resolve.js';
import { runDpmBuild } from '../build.js';
import { normalizeCliDars, resolveFullDarSet } from '../dar-set.js';
import { AdminClient, type DarInfo } from '../grpc/admin.js';
import { failSpinner } from '../utils/cli.js';

function matchDarToEntry(dars: DarInfo[], label: string): DarInfo | undefined {
  const base = label.replace(/\.dar$/i, '');
  return dars.find(
    (d) =>
      d.name === base ||
      `${d.name}-${d.version}` === base ||
      d.description === label ||
      d.description?.includes(base)
  );
}

async function executeVet(network: ResolvedNetwork, flags: CliFlags): Promise<void> {
  const token = await resolveToken(network);
  const cliDars = normalizeCliDars(flags.dar);

  console.log(chalk.bold('\n  canton-deploy vet'));
  console.log(
    chalk.gray(
      `  Admin API: ${network.host}:${network.adminPort} (requires Admin; or use deploy --upload-via ledger --vet)\n`
    )
  );

  if (!flags.skipBuild) {
    await runDpmBuild();
  }

  const darSet = resolveFullDarSet(network, { cliDars });
  if (darSet.length === 0) {
    console.error(chalk.red('No DARs to vet. Configure project packages or additionalDars.'));
    process.exit(1);
  }

  const adminClient = new AdminClient(network);
  const listed = await adminClient.listDars(token);

  for (const entry of darSet) {
    const spinner = ora(`Vetting ${entry.label}...`).start();
    let mainId: string | undefined;

    const match = matchDarToEntry(listed, entry.label);
    if (match) {
      mainId = match.main;
    } else {
      const uploadResult = await adminClient.uploadDar(
        fs.readFileSync(entry.path),
        token,
        entry.label,
        { vetAllPackages: false, synchronizeVetting: false, synchronizerId: network.synchronizerId }
      );
      mainId = uploadResult.dar_ids?.[0];
      if (!mainId) {
        const refreshed = await adminClient.listDars(token);
        const m2 = matchDarToEntry(refreshed, entry.label);
        mainId = m2?.main;
      }
    }

    if (!mainId) {
      spinner.fail(`Could not resolve main package id for ${entry.label}`);
      process.exit(1);
    }

    try {
      await adminClient.vetDar(mainId, token, {
        synchronize: !flags.noSync,
        synchronizerId: network.synchronizerId,
      });
      spinner.succeed(chalk.green(`Vetted ${entry.label}`) + chalk.gray(` (${mainId.slice(0, 16)}…)`));
    } catch (err) {
      failSpinner(spinner, `Vet failed: ${entry.label}`, err);
    }
  }

  console.log(chalk.green('\n  Vetting complete.\n'));
}

export async function runVet(flags: CliFlags): Promise<void> {
  return withNetworkSession(flags, (network) => executeVet(network, flags));
}
