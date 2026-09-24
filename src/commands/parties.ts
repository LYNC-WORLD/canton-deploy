import chalk from 'chalk';
import ora from 'ora';
import type { CliFlags, ResolvedNetwork } from '../types.js';
import { withNetworkSession } from '../network-session.js';
import { resolveToken } from '../auth/resolve.js';
import { LedgerClient } from '../grpc/ledger.js';
import { displayNameToHint } from '../utils/party-hint.js';
import { resolveParty } from '../onboarding.js';
import { failSpinner } from '../utils/cli.js';

function printPartyTable(parties: { party: string; is_local: boolean }[]): void {
  if (parties.length === 0) {
    console.log(chalk.gray('  No matching parties found.'));
    return;
  }

  console.log();
  const col1 = Math.max(10, ...parties.map((p) => p.party.length)) + 2;
  const header = 'PARTY ID'.padEnd(col1) + 'LOCAL'.padEnd(8);
  console.log(chalk.bold('  ' + header));
  console.log(chalk.gray('  ' + '─'.repeat(header.length)));

  for (const p of parties) {
    const local = p.is_local ? chalk.green('yes') : chalk.gray('no');
    console.log(`  ${chalk.cyan(p.party.padEnd(col1))}${local}`);
  }
  console.log();
}

async function executeParties(network: ResolvedNetwork, flags: CliFlags): Promise<void> {
  const token = await resolveToken(network);
  const client = new LedgerClient(network);

  const lookupIds =
    flags.partiesLookup
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean) ?? [];

  if (lookupIds.length > 0) {
    const spinner = ora(`Looking up ${lookupIds.length} party id(s)...`).start();
    let parties;
    try {
      parties = await client.getParties(token, lookupIds);
      if (flags.partiesLocalOnly) {
        parties = parties.filter((p) => p.is_local);
      }
      spinner.succeed(`Resolved ${parties.length} of ${lookupIds.length} id(s)`);
    } catch (err) {
      failSpinner(spinner, 'Failed to get parties', err);
    }
    const missing = lookupIds.filter((id) => !parties.some((p) => p.party === id));
    printPartyTable(parties);
    if (missing.length > 0 && !flags.partiesLocalOnly) {
      console.log(chalk.yellow(`  Not known on this participant: ${missing.join(', ')}\n`));
    }
    return;
  }

  const lim = flags.partiesLimit;
  if (lim !== undefined && (lim < 0 || !Number.isFinite(lim))) {
    console.error(chalk.red('\n  Error: --limit must be a non-negative integer.\n'));
    process.exit(1);
  }
  const maxParties = lim !== undefined && lim > 0 ? lim : undefined;

  const spinner = ora(
    flags.partiesLocalOnly ? 'Fetching local parties...' : 'Fetching parties...'
  ).start();
  let parties: { party: string; is_local: boolean }[] = [];
  let truncated = false;
  let nextPageToken = '';
  let examined = 0;
  try {
    const result = await client.listKnownParties(token, {
      filterParty: flags.partiesFilterPrefix,
      pageToken: flags.partiesPageToken,
      maxParties,
      localOnly: flags.partiesLocalOnly,
    });
    parties = result.parties;
    truncated = result.truncated;
    nextPageToken = result.nextPageToken;
    examined = result.examined ?? parties.length;
    spinner.succeed(
      flags.partiesLocalOnly
        ? `Found ${parties.length} local party(ies) (scanned ${examined})`
        : `Found ${parties.length} party(ies)`
    );
  } catch (err) {
    failSpinner(spinner, 'Failed to list parties', err);
  }

  printPartyTable(parties);

  if (truncated) {
    const moreHint = nextPageToken
      ? chalk.gray(`  Continue with: --page-token ${JSON.stringify(nextPageToken)}\n`)
      : '';
    console.log(
      chalk.yellow(
        '  Results truncated' +
          (maxParties ? ` (--limit ${maxParties})` : '') +
          (flags.partiesLocalOnly ? ' (--local scan cap)' : '') +
          '\n'
      ) + moreHint
    );
  }
}

async function executeAllocateParty(
  network: ResolvedNetwork,
  displayName: string
): Promise<void> {
  const token = await resolveToken(network);
  const client = new LedgerClient(network);
  const hint = displayNameToHint(displayName);

  const spinner = ora(`Checking party "${displayName}" (hint: ${hint})...`).start();

  try {
    const { partyId, isLocal, created } = await resolveParty(client, token, displayName);
    spinner.succeed(chalk.green(created ? 'Party allocated' : 'Party already exists'));
    console.log(`\n  ${chalk.gray('Party ID:')} ${chalk.cyan(partyId)}`);
    console.log(`  ${chalk.gray('Local:')}    ${isLocal ? chalk.green('yes') : chalk.gray('no')}\n`);
  } catch (err) {
    failSpinner(spinner, 'Party allocation failed', err);
  }
}

export async function runParties(flags: CliFlags): Promise<void> {
  return withNetworkSession(flags, (network) => executeParties(network, flags));
}

export async function runAllocateParty(displayName: string, flags: CliFlags): Promise<void> {
  return withNetworkSession(flags, (network) => executeAllocateParty(network, displayName));
}
