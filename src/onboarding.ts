import chalk from 'chalk';
import ora from 'ora';
import type { ResolvedNetwork } from './types.js';
import { LedgerClient } from './grpc/ledger.js';
import { UserManagementGrpcClient } from './grpc/user-management.js';
import { displayNameToHint } from './utils/party-hint.js';
import { formatGrpcError } from './grpc/format-error.js';

export async function ensureParties(
  network: ResolvedNetwork,
  token: string,
  displayNames: string[]
): Promise<Map<string, string>> {
  const client = new LedgerClient(network);
  const hintToParty = new Map<string, string>();
  const displayToParty = new Map<string, string>();

  if (displayNames.length === 0) return displayToParty;

  const existing = await client.listKnownParties(token);
  for (const p of existing.parties) {
    hintToParty.set(p.party.split('::')[0] ?? p.party, p.party);
  }

  for (const displayName of displayNames) {
    const hint = displayNameToHint(displayName);
    const spinner = ora(`Party: ${displayName}`).start();

    const existingParty = hintToParty.get(hint);
    if (existingParty) {
      spinner.succeed(chalk.green(`Party exists: `) + chalk.cyan(existingParty));
      displayToParty.set(displayName, existingParty);
      continue;
    }

    try {
      const details = await client.allocateParty(hint, token);
      spinner.succeed(chalk.green(`Party allocated: `) + chalk.cyan(details.party));
      displayToParty.set(displayName, details.party);
      hintToParty.set(hint, details.party);
    } catch (err) {
      spinner.fail(`Party "${displayName}" allocation failed`);
      console.error(chalk.red(`  ${formatGrpcError(err)}`));
      process.exit(1);
    }
  }

  return displayToParty;
}

export async function ensureUsers(
  network: ResolvedNetwork,
  token: string,
  partyMap: Map<string, string>
): Promise<void> {
  if (network.users.length === 0) return;

  const client = new UserManagementGrpcClient(network);

  for (const spec of network.users) {
    const spinner = ora(`User: ${spec.userId}`).start();
    const partyIds = spec.parties.map((p) => partyMap.get(p) ?? p);

    try {
      const existing = await client.getUser(token, spec.userId);
      if (existing) {
        await client.grantRights(token, spec.userId, partyIds, spec.rights);
        spinner.succeed(chalk.green(`User exists, rights granted: `) + chalk.cyan(spec.userId));
      } else {
        await client.createUserWithRights(token, spec.userId, partyIds, spec.rights);
        spinner.succeed(chalk.green(`User created: `) + chalk.cyan(spec.userId));
      }
    } catch (err) {
      spinner.fail(`User "${spec.userId}" setup failed`);
      console.error(chalk.red(`  ${formatGrpcError(err)}`));
      process.exit(1);
    }
  }
}
