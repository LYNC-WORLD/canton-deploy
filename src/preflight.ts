import chalk from 'chalk';
import ora from 'ora';
import type { ResolvedNetwork } from './types.js';
import { AdminClient } from './grpc/admin.js';
import { LedgerClient } from './grpc/ledger.js';
import { jsonApiDisplayUrl, jsonApiFetch } from './json-api.js';
import { formatGrpcError } from './grpc/format-error.js';
import { withRetry } from './utils/retry.js';

export async function runPreflight(network: ResolvedNetwork, token: string): Promise<void> {
  const spinner = ora('Preflight connectivity check...').start();
  const errors: string[] = [];
  const warnings: string[] = [];
  const adminRequired = network.uploadVia === 'admin';

  try {
    await withRetry(() => new AdminClient(network).getStatus(token));
  } catch (err) {
    const msg = `Admin API: ${formatGrpcError(err)}`;
    if (adminRequired) errors.push(msg);
    else warnings.push(`${msg} (not required for ledger upload)`);
  }

  try {
    await withRetry(() => new LedgerClient(network).getVersion(token));
  } catch (err) {
    errors.push(`Ledger API: ${formatGrpcError(err)}`);
  }

  try {
    const res = await withRetry(() =>
      jsonApiFetch(network, '/v2/state/ledger-end', {
        headers: { Authorization: `Bearer ${token}` },
      })
    );
    if (!res.ok) {
      warnings.push(
        `JSON API: HTTP ${res.status} ${res.statusText} (${jsonApiDisplayUrl(network)})`
      );
    }
  } catch (err) {
    warnings.push(`JSON API: ${(err as Error).message}`);
  }

  if (errors.length > 0) {
    spinner.fail('Preflight check failed');
    for (const e of errors) {
      console.error(chalk.red(`  ${e}`));
    }
    process.exit(1);
  }

  if (warnings.length > 0) {
    spinner.warn('Preflight OK for deploy (Ledger reachable)');
    for (const w of warnings) {
      console.warn(chalk.yellow(`  ${w}`));
    }
    console.warn(
      chalk.gray(
        '  Upload can proceed. Fix optional endpoints for `dars`, `vet`, or full `status`.\n'
      )
    );
    return;
  }

  spinner.succeed('Preflight OK (Admin, Ledger, JSON API)');
}
