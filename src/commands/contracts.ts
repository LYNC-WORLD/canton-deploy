import chalk from 'chalk';
import ora from 'ora';
import type { CliFlags } from '../types.js';
import { loadConfig } from '../config.js';
import { resolveToken } from '../auth/resolve.js';
import { jsonApiBaseUrl } from '../json-api.js';

interface ActiveContract {
  contractEntry?: {
    JsActiveContract?: {
      createdEvent?: {
        contractId?: string;
        templateId?: string;
        createArgument?: Record<string, unknown>;
        createArguments?: Record<string, unknown>;
      };
    };
  };
}

export async function runContracts(flags: CliFlags): Promise<void> {
  const config = await loadConfig(flags);
  const { network } = config;
  const token = await resolveToken(network);

  const baseUrl = jsonApiBaseUrl(network);

  console.log(chalk.bold('\n  canton-deploy contracts'));
  console.log(chalk.gray(`  Querying ${baseUrl}/v2/state/active-contracts`));
  if (network.httpHost && network.httpHost !== network.host) {
    console.log(
      chalk.gray(
        `  (nginx vhost ${network.httpHost} — ensure it resolves, e.g. /etc/hosts: 127.0.0.1 ${network.httpHost})\n`
      )
    );
  } else {
    console.log();
  }

  let activeAtOffset: number;
  try {
    const endRes = await fetch(`${baseUrl}/v2/state/ledger-end`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!endRes.ok) {
      console.error(chalk.red(`  Failed to read ledger-end: HTTP ${endRes.status}`));
      process.exit(1);
    }
    const endJson = (await endRes.json()) as { offset?: number | string };
    const raw = endJson.offset;
    if (raw === undefined || raw === null) {
      console.error(chalk.red('  ledger-end response missing offset'));
      process.exit(1);
    }
    activeAtOffset = typeof raw === 'string' ? parseInt(raw, 10) : raw;
    if (Number.isNaN(activeAtOffset)) {
      console.error(chalk.red(`  Invalid ledger-end offset: ${String(raw)}`));
      process.exit(1);
    }
  } catch (err) {
    console.error(chalk.red(`  Failed to fetch ledger-end: ${(err as Error).message}`));
    process.exit(1);
  }

  type IdentifierFilter =
    | { TemplateFilter: { value: { templateId: string; includeCreatedEventBlob: boolean } } }
    | { WildcardFilter: { value: { includeCreatedEventBlob: boolean } } };

  const templateFilter = (templateId: string): IdentifierFilter => ({
    TemplateFilter: { value: { templateId, includeCreatedEventBlob: false } },
  });

  const wildcardFilter = (): IdentifierFilter => ({
    WildcardFilter: { value: { includeCreatedEventBlob: false } },
  });

  type EventFormat = {
    filtersByParty: Record<string, { cumulative: Array<{ identifierFilter: IdentifierFilter }> }>;
    verbose: boolean;
    filtersForAnyParty?: { cumulative: Array<{ identifierFilter: IdentifierFilter }> };
  };

  let eventFormat: EventFormat;

  if (flags.party && flags.template) {
    eventFormat = {
      filtersByParty: {
        [flags.party]: {
          cumulative: [{ identifierFilter: templateFilter(flags.template) }],
        },
      },
      verbose: false,
    };
  } else if (flags.party) {
    eventFormat = {
      filtersByParty: {
        [flags.party]: {
          cumulative: [{ identifierFilter: wildcardFilter() }],
        },
      },
      verbose: false,
    };
  } else if (flags.template) {
    eventFormat = {
      filtersByParty: {},
      filtersForAnyParty: {
        cumulative: [{ identifierFilter: templateFilter(flags.template) }],
      },
      verbose: false,
    };
  } else {
    eventFormat = {
      filtersByParty: {},
      filtersForAnyParty: {
        cumulative: [{ identifierFilter: wildcardFilter() }],
      },
      verbose: false,
    };
  }

  const filterBody = {
    eventFormat,
    verbose: false,
    activeAtOffset,
  };

  const spinner = ora('Fetching active contracts...').start();

  let contracts: ActiveContract[] = [];
  try {
    const res = await fetch(`${baseUrl}/v2/state/active-contracts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(filterBody),
    });

    if (!res.ok) {
      const text = await res.text();
      spinner.fail(`HTTP ${res.status}: ${res.statusText}`);
      console.error(chalk.red(`  ${text}`));
      if (res.status === 400 && flags.template && !flags.template.startsWith('#')) {
        console.error(
          chalk.yellow(
            '  Hint: template id may need package prefix, e.g. --template "#intro-contracts:Token:Token"'
          )
        );
      }
      process.exit(1);
    }

    contracts = (await res.json()) as ActiveContract[];
    spinner.succeed(`Found ${contracts.length} active contract(s)`);
  } catch (err) {
    spinner.fail('Failed to fetch contracts');
    console.error(chalk.red(`  ${(err as Error).message}`));
    console.error(chalk.gray(`  Is the HTTP JSON API running on port ${network.httpPort}?`));
    process.exit(1);
  }

  if (contracts.length === 0) {
    console.log(chalk.gray('  No active contracts found.'));
    if (flags.template) console.log(chalk.gray(`  Template filter: ${flags.template}`));
    if (flags.party) console.log(chalk.gray(`  Party filter:    ${flags.party}`));
    if (flags.template && !flags.template.startsWith('#')) {
      console.log(
        chalk.gray(
          '  Try full template id: --template "#intro-contracts:Token:Token" (package name from daml.yaml)'
        )
      );
    }
    console.log();
    return;
  }

  console.log();
  for (const c of contracts) {
    const evt = c.contractEntry?.JsActiveContract?.createdEvent;
    if (!evt) continue;

    const args = evt.createArgument ?? evt.createArguments;
    console.log(chalk.bold(`  Contract: ${chalk.cyan(evt.contractId ?? '?')}`));
    console.log(`    ${chalk.gray('Template:')} ${evt.templateId ?? '?'}`);
    if (args) {
      for (const [k, v] of Object.entries(args)) {
        console.log(`    ${chalk.gray(k + ':')} ${JSON.stringify(v)}`);
      }
    }
    console.log();
  }
}
