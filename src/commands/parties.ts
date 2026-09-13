import chalk from 'chalk';
import ora from 'ora';
import type { CliFlags } from '../types.js';
import { loadConfig } from '../config.js';
import { resolveToken } from '../auth/resolve.js';
import { LedgerClient } from '../grpc/ledger.js';
import { formatGrpcError } from '../grpc/format-error.js';
import { displayNameToHint } from '../utils/party-hint.js';

function padEnd(str: string, len: number): string {
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

function printPartyTable(parties: { party: string; is_local: boolean }[]): void {
  if (parties.length === 0) {
    console.log(chalk.gray('  No parties found on this node.'));
    return;
  }

  console.log();
  const col1 = Math.max(10, ...parties.map((p) => p.party.length)) + 2;
  const header = padEnd('PARTY ID', col1) + padEnd('LOCAL', 8);
  console.log(chalk.bold('  ' + header));
  console.log(chalk.gray('  ' + '─'.repeat(header.length)));

  for (const p of parties) {
    const local = p.is_local ? chalk.green('yes') : chalk.gray('no');
    console.log(`  ${chalk.cyan(padEnd(p.party, col1))}${local}`);
  }
  console.log();
}

export async function runParties(flags: CliFlags): Promise<void> {
  const config = await loadConfig(flags);
  const { network } = config;
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
      spinner.succeed(`Resolved ${parties.length} of ${lookupIds.length} id(s)`);
    } catch (err) {
      spinner.fail('Failed to get parties');
      console.error(chalk.red(`  ${formatGrpcError(err)}`));
      process.exit(1);
    }
    const missing = lookupIds.filter((id) => !parties.some((p) => p.party === id));
    printPartyTable(parties);
    if (missing.length > 0) {
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

  const spinner = ora('Fetching parties...').start();
  let parties: { party: string; is_local: boolean }[] = [];
  let truncated = false;
  let nextPageToken = '';
  try {
    const result = await client.listKnownParties(token, {
      filterParty: flags.partiesFilterPrefix,
      pageToken: flags.partiesPageToken,
      maxParties,
    });
    parties = result.parties;
    truncated = result.truncated;
    nextPageToken = result.nextPageToken;
    spinner.succeed(`Found ${parties.length} party(ies)`);
  } catch (err) {
    spinner.fail('Failed to list parties');
    console.error(chalk.red(`  ${formatGrpcError(err)}`));
    process.exit(1);
  }

  printPartyTable(parties);

  if (truncated && nextPageToken) {
    console.log(
      chalk.yellow(
        '  More parties exist. Re-run with:\n' +
          `    --page-token ${JSON.stringify(nextPageToken)}` +
          (maxParties ? ` --limit ${maxParties}` : '') +
          '\n'
      )
    );
  }
}

export async function runAllocateParty(displayName: string, flags: CliFlags): Promise<void> {
  const config = await loadConfig(flags);
  const { network } = config;
  const token = await resolveToken(network);
  const client = new LedgerClient(network);
  const hint = displayNameToHint(displayName);

  const spinner = ora(`Checking party "${displayName}" (hint: ${hint})...`).start();

  try {
    const existing = await client.listKnownParties(token, { filterParty: hint });
    const match = existing.parties.find((p) => p.party.startsWith(hint + '::') || p.party === hint);

    if (match) {
      spinner.succeed(chalk.green('Party already exists'));
      console.log(`\n  ${chalk.gray('Party ID:')} ${chalk.cyan(match.party)}`);
      console.log(`  ${chalk.gray('Local:')}    ${match.is_local ? chalk.green('yes') : chalk.gray('no')}\n`);
      return;
    }

    spinner.text = `Allocating party "${displayName}"...`;
    const details = await client.allocateParty(hint, token);
    spinner.succeed(chalk.green('Party allocated'));
    console.log(`\n  ${chalk.gray('Party ID:')} ${chalk.cyan(details.party)}`);
    console.log(`  ${chalk.gray('Local:')}    ${details.is_local ? chalk.green('yes') : chalk.gray('no')}\n`);
  } catch (err) {
    spinner.fail('Party allocation failed');
    console.error(chalk.red(`  ${formatGrpcError(err)}`));
    process.exit(1);
  }
}
