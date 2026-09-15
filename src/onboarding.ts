import chalk from 'chalk';
import ora from 'ora';
import type { ResolvedNetwork } from './types.js';
import { LedgerClient } from './grpc/ledger.js';
import { UserManagementGrpcClient } from './grpc/user-management.js';
import { displayNameToHint } from './utils/party-hint.js';
import { failSpinner } from './utils/cli.js';

export async function resolveParty(
  client: LedgerClient,
  token: string,
  displayName: string
): Promise<{ partyId: string; isLocal: boolean; created: boolean }> {
  if (displayName.includes('::')) {
    const parties = await client.getParties(token, [displayName]);
    const match = parties.find((p) => p.party === displayName);
    if (!match) {
      throw new Error(`Party id not known on this participant: ${displayName}`);
    }
    return { partyId: match.party, isLocal: match.is_local, created: false };
  }

  const hint = displayNameToHint(displayName);
  const existing = await client.listKnownParties(token, { filterParty: hint, maxParties: 20 });
  const match = existing.parties.find((p) => p.party.startsWith(hint + '::') || p.party === hint);
  if (match) return { partyId: match.party, isLocal: match.is_local, created: false };
  const details = await client.allocateParty(hint, token);
  return { partyId: details.party, isLocal: details.is_local, created: true };
}

export async function ensureParties(
  network: ResolvedNetwork,
  token: string,
  displayNames: string[]
): Promise<Map<string, string>> {
  const client = new LedgerClient(network);
  const displayToParty = new Map<string, string>();

  for (const displayName of displayNames) {
    const spinner = ora(`Party: ${displayName}`).start();
    try {
      const { partyId, created } = await resolveParty(client, token, displayName);
      spinner.succeed(
        chalk.green(created ? `Party allocated: ` : `Party exists: `) + chalk.cyan(partyId)
      );
      displayToParty.set(displayName, partyId);
    } catch (err) {
      failSpinner(spinner, `Party "${displayName}" allocation failed`, err);
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
      const action = await client.ensureUserWithRights(token, spec.userId, partyIds, spec.rights);
      spinner.succeed(
        chalk.green(action === 'created' ? `User created: ` : `User exists, rights granted: `) +
          chalk.cyan(spec.userId)
      );
    } catch (err) {
      failSpinner(spinner, `User "${spec.userId}" setup failed`, err);
    }
  }
}
