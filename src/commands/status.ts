import chalk from 'chalk';
import ora from 'ora';
import type { CliFlags } from '../types.js';
import { loadConfig } from '../config.js';
import { resolveToken } from '../auth/resolve.js';
import { AdminClient } from '../grpc/admin.js';
import { LedgerClient } from '../grpc/ledger.js';
import { jsonApiBaseUrl } from '../json-api.js';
import { formatGrpcError } from '../grpc/format-error.js';

function tick(ok: boolean): string {
  return ok ? chalk.green('✓') : chalk.red('✗');
}

export async function runStatus(flags: CliFlags): Promise<void> {
  const config = await loadConfig(flags);
  const { network } = config;

  console.log(chalk.bold('\n  canton-deploy status'));
  console.log(chalk.gray(`  Checking ${network.host} (${network.name})...\n`));

  const token = await resolveToken(network);

  const adminClient = new AdminClient(network);
  const ledgerClient = new LedgerClient(network);

  const adminSpinner = ora(`Admin API (${network.host}:${network.adminPort})...`).start();
  let adminStatus: unknown = null;
  let adminOk = false;
  let adminMs = 0;

  try {
    const t0 = Date.now();
    adminStatus = await adminClient.getStatus(token);
    adminMs = Date.now() - t0;
    adminOk = true;
    adminSpinner.succeed(chalk.green(`Admin API reachable`) + chalk.gray(` (${adminMs}ms)`));
  } catch (err) {
    adminSpinner.fail(chalk.red(`Admin API unreachable: ${formatGrpcError(err)}`));
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

  const jsonSpinner = ora(`JSON API (${jsonApiBaseUrl(network)})...`).start();
  let jsonOk = false;
  let jsonMs = 0;

  try {
    const t0 = Date.now();
    const res = await fetch(`${jsonApiBaseUrl(network)}/v2/state/ledger-end`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    jsonMs = Date.now() - t0;
    if (res.ok) {
      jsonOk = true;
      jsonSpinner.succeed(chalk.green(`JSON API reachable`) + chalk.gray(` (${jsonMs}ms)`));
    } else {
      jsonSpinner.fail(chalk.red(`JSON API HTTP ${res.status}`));
    }
  } catch (err) {
    jsonSpinner.fail(chalk.red(`JSON API unreachable: ${(err as Error).message}`));
  }

  console.log(chalk.bold('\n  Status summary'));
  console.log(chalk.gray('  ─────────────────────────────────────'));
  console.log(`  ${tick(adminOk)} Admin API   ${network.host}:${network.adminPort}   ${adminMs ? `${adminMs}ms` : ''}`);
  console.log(`  ${tick(ledgerOk)} Ledger API  ${network.host}:${network.ledgerPort}  ${ledgerMs ? `${ledgerMs}ms` : ''}`);
  console.log(`  ${tick(jsonOk)} JSON API    ${jsonApiBaseUrl(network)}  ${jsonMs ? `${jsonMs}ms` : ''}`);

  if (ledgerVersion) {
    console.log(`  ${chalk.gray('Ledger version:')} ${ledgerVersion}`);
  }

  if (adminStatus) {
    const s = adminStatus as {
      status?: {
        connected_synchronizers?: Array<{ physical_synchronizer_id: string; health: string }>;
        active?: boolean;
      };
    };
    const st = s.status;
    if (st?.connected_synchronizers?.length) {
      console.log(`  ${chalk.gray('Synchronizers:')}`);
      for (const sync of st.connected_synchronizers) {
        const healthColor = sync.health === 'HEALTH_HEALTHY' ? chalk.green : chalk.yellow;
        console.log(`    ${healthColor('•')} ${sync.physical_synchronizer_id} (${sync.health})`);
      }
    }
  }

  console.log();
  if (!adminOk || !ledgerOk || !jsonOk) process.exit(1);
}
