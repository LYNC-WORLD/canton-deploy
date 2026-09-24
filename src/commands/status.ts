import chalk from 'chalk';
import ora from 'ora';
import type { CliFlags, ResolvedNetwork } from '../types.js';
import { withNetworkSession } from '../network-session.js';
import { resolveToken } from '../auth/resolve.js';
import { AdminClient } from '../grpc/admin.js';
import { LedgerClient } from '../grpc/ledger.js';
import {
  jsonApiDisplayUrl,
  jsonApiFetch,
  jsonApiGetConnectedSynchronizers,
  type ConnectedSynchronizerInfo,
} from '../json-api.js';
import { formatGrpcError } from '../grpc/format-error.js';
import { toLogicalSynchronizerId } from '../utils/synchronizer-id.js';

function tick(ok: boolean): string {
  return ok ? chalk.green('✓') : chalk.red('✗');
}

function printSynchronizers(
  fromAdmin: Array<{ physical_synchronizer_id: string; health: string }> | undefined,
  fromJson: ConnectedSynchronizerInfo[] | undefined
): void {
  if (fromAdmin?.length) {
    console.log(`  ${chalk.gray('Synchronizers (Admin):')}`);
    for (const sync of fromAdmin) {
      const id = toLogicalSynchronizerId(sync.physical_synchronizer_id);
      const healthColor = sync.health === 'HEALTH_HEALTHY' ? chalk.green : chalk.yellow;
      console.log(`    ${healthColor('•')} ${id} (${sync.health})`);
    }
    return;
  }
  if (fromJson?.length) {
    console.log(`  ${chalk.gray('Synchronizers (JSON API):')}`);
    for (const sync of fromJson) {
      const id = toLogicalSynchronizerId(sync.synchronizerId);
      const alias = sync.synchronizerAlias ? chalk.gray(` alias ${sync.synchronizerAlias}`) : '';
      console.log(`    ${chalk.green('•')} ${id}${alias}`);
    }
    return;
  }
  console.log(`  ${chalk.gray('Synchronizers:')} (none reported)`);
}

async function executeStatus(network: ResolvedNetwork): Promise<void> {
  const adminRequired = network.uploadVia === 'admin';

  console.log(chalk.bold('\n  canton-deploy status'));
  console.log(
    chalk.gray(
      `  Checking ${network.host} (${network.name}, upload ${network.uploadVia})...\n`
    )
  );

  const token = await resolveToken(network);

  const adminClient = new AdminClient(network);
  const ledgerClient = new LedgerClient(network);

  const adminSpinner = ora(`Admin API (${network.host}:${network.adminPort})...`).start();
  let adminOk = false;
  let adminMs = 0;
  let adminSyncs: Array<{ physical_synchronizer_id: string; health: string }> | undefined;

  try {
    const t0 = Date.now();
    const status = await adminClient.getStatus(token);
    adminMs = Date.now() - t0;
    adminOk = true;
    adminSpinner.succeed(chalk.green(`Admin API reachable`) + chalk.gray(` (${adminMs}ms)`));
    adminSyncs = (
      status as { status?: { connected_synchronizers?: typeof adminSyncs } }
    ).status?.connected_synchronizers;
  } catch (err) {
    if (adminRequired) {
      adminSpinner.fail(chalk.red(`Admin API unreachable: ${formatGrpcError(err)}`));
    } else {
      adminSpinner.warn(
        chalk.yellow(`Admin API unreachable: ${formatGrpcError(err)}`) +
          chalk.gray(' (optional for ledger upload)')
      );
    }
  }

  const ledgerSpinner = ora(`Ledger API (${network.host}:${network.ledgerPort})...`).start();
  let ledgerVersion: string | null = null;
  let ledgerOk = false;
  let ledgerMs = 0;

  try {
    const t0 = Date.now();
    const ver = await ledgerClient.getVersion(token);
    ledgerMs = Date.now() - t0;
    ledgerVersion = ver.version ?? 'unknown';
    ledgerOk = true;
    ledgerSpinner.succeed(
      chalk.green(`Ledger API reachable`) +
        chalk.gray(` — version ${ledgerVersion} (${ledgerMs}ms)`)
    );
  } catch (err) {
    ledgerSpinner.fail(chalk.red(`Ledger API unreachable: ${formatGrpcError(err)}`));
  }

  const jsonSpinner = ora(`JSON API (${jsonApiDisplayUrl(network)})...`).start();
  let jsonOk = false;
  let jsonMs = 0;
  let jsonSyncs: ConnectedSynchronizerInfo[] | undefined;

  try {
    const t0 = Date.now();
    const res = await jsonApiFetch(network, '/v2/state/ledger-end', {
      headers: { Authorization: `Bearer ${token}` },
    });
    jsonMs = Date.now() - t0;
    if (res.ok) {
      jsonOk = true;
      jsonSpinner.succeed(chalk.green(`JSON API reachable`) + chalk.gray(` (${jsonMs}ms)`));
    } else {
      jsonSpinner.warn(chalk.yellow(`JSON API HTTP ${res.status}`));
    }
  } catch (err) {
    jsonSpinner.warn(chalk.yellow(`JSON API unreachable: ${(err as Error).message}`));
  }

  if (!adminSyncs?.length && jsonOk) {
    try {
      jsonSyncs = await jsonApiGetConnectedSynchronizers(network, token);
    } catch {}
  }

  console.log(chalk.bold('\n  Status summary'));
  console.log(chalk.gray('  ─────────────────────────────────────'));
  console.log(
    `  ${tick(adminOk)} Admin API   ${network.host}:${network.adminPort}   ${adminMs ? `${adminMs}ms` : ''}${!adminRequired && !adminOk ? chalk.gray(' (optional)') : ''}`
  );
  console.log(`  ${tick(ledgerOk)} Ledger API  ${network.host}:${network.ledgerPort}  ${ledgerMs ? `${ledgerMs}ms` : ''}`);
  console.log(
    `  ${tick(jsonOk)} JSON API    ${jsonApiDisplayUrl(network)}  ${jsonMs ? `${jsonMs}ms` : ''}${!jsonOk ? chalk.gray(' (optional)') : ''}`
  );

  if (ledgerVersion) {
    console.log(`  ${chalk.gray('Ledger version:')} ${ledgerVersion}`);
  }

  printSynchronizers(adminSyncs, jsonSyncs);

  console.log();
  const fatal = !ledgerOk || (adminRequired && !adminOk);
  if (fatal) process.exit(1);
}

export async function runStatus(flags: CliFlags): Promise<void> {
  return withNetworkSession(flags, executeStatus);
}
