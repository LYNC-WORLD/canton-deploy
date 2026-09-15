import chalk from 'chalk';
import ora from 'ora';
import type { CliFlags } from '../types.js';
import { loadConfig } from '../config.js';
import { resolveToken } from '../auth/resolve.js';
import { jsonApiDisplayUrl, jsonApiFetch } from '../json-api.js';

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

  console.log(chalk.bold('\n  canton-deploy contracts'));
  console.log(chalk.gray(`  Querying ${jsonApiDisplayUrl(network)}/v2/state/active-contracts`));
  if (network.httpHost && network.httpHost !== network.host) {
    console.log(
      chalk.gray(
        `  (TCP ${network.host}:${network.httpPort}, Host ${network.httpHost})\n`
      )
    );
  } else {
    console.log();
  }

  let activeAtOffset: number;
  try {
    const endRes = await jsonApiFetch(network, '/v2/state/ledger-end', {
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
    const res = await jsonApiFetch(network, '/v2/state/active-contracts', {
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
      if (res.status === 403) {
        console.error(
          chalk.yellow(
            '  Hint: JWT user needs CanReadAs for this party. Add users[] in config, then:\n' +
              `    canton-deploy create-user --user-id <jwt-sub> --network ${network.name}\n` +
              '  (or run deploy so onboarding grants rights)\n'
          )
        );
      }
      if (res.status === 400 && flags.template && !flags.template.startsWith('#')) {
        console.error(
          chalk.yellow(
            '  Hint: template id may need a package-name prefix, e.g. --template "#<package-name>:Module:Template"'
          )
        );
      }
      if (
        flags.template &&
        (text.includes('PACKAGE_NAMES_NOT_FOUND') || text.includes('package names do not match'))
      ) {
        console.error(
          chalk.yellow(
            '  Hint: # prefix is the package name from daml.yaml (#<package-name>:Module:Template), not the hex package id from deploy.'
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
          '  Try --template "#<package-name>:Module:Template" (package name from daml.yaml)'
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
