#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import chalk from 'chalk';

import { runDeploy } from './commands/deploy.js';
import { runParties, runAllocateParty } from './commands/parties.js';
import { runScript } from './commands/run.js';
import { runStatus } from './commands/status.js';
import { runContracts } from './commands/contracts.js';
import { runToken } from './commands/token.js';
import { runInit } from './commands/init.js';
import { runDars } from './commands/dars.js';
import { runPackages } from './commands/packages.js';
import { runVetDar } from './commands/vet-dar.js';
import { runVet } from './commands/vet.js';
import { runUsers, runCreateUser } from './commands/users.js';
import { formatGrpcError } from './grpc/format-error.js';
import { installLogFile, closeLogFile } from './utils/log-file.js';
import type { CliFlags } from './types.js';

const program = new Command();

function readCliVersion(): string {
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    const v = (JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string }).version;
    if (typeof v === 'string' && v.trim()) return v.trim();
  } catch {
  }
  return '0.1.0';
}

function collectDar(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

function sharedNetworkOptions(cmd: Command): Command {
  return cmd
    .option('--host <ip>', 'Validator host or IP address')
    .option('--admin-port <port>', 'Admin API gRPC port', parseInt)
    .option('--ledger-port <port>', 'Ledger API gRPC port', parseInt)
    .option('--http-port <port>', 'HTTP JSON API port', parseInt)
    .option('--grpc-authority <authority>', 'Override gRPC :authority for Ledger API')
    .option('--http-host <host>', 'HTTP Host header override for JSON API')
    .option('--token <jwt>', 'JWT bearer token')
    .option('--network <name>', 'Network name from canton-deploy.config.js')
    .option('--log-file <path>', 'Append command output to this file');
}

function networkFlags(opts: Record<string, unknown>): CliFlags {
  return {
    host: opts.host as string | undefined,
    adminPort: opts.adminPort as number | undefined,
    ledgerPort: opts.ledgerPort as number | undefined,
    httpPort: opts.httpPort as number | undefined,
    httpHost: opts.httpHost as string | undefined,
    grpcAuthority: opts.grpcAuthority as string | undefined,
    token: opts.token as string | undefined,
    network: opts.network as string | undefined,
    logFile: opts.logFile as string | undefined,
  };
}

function withLogFile(run: (...args: any[]) => Promise<void>): (...args: any[]) => Promise<void> {
  return async (...args: any[]) => {
    const opts = args[args.length - 1] as { logFile?: string };
    installLogFile(opts?.logFile);
    try {
      await run(...args);
    } catch (err) {
      handleError(err);
    } finally {
      closeLogFile();
    }
  };
}

program
  .name('canton-deploy')
  .description('Deploy Daml packages to Canton validators via Admin API (LocalNet/DevNet)')
  .version(readCliVersion());

sharedNetworkOptions(
  program
    .command('deploy')
    .description('Build (dpm) and upload DAR set via Admin API; optional parties, users, script')
    .option('--dar <path>', 'Additional DAR path (repeatable)', collectDar, [] as string[])
    .option('--skip-build', 'Use pre-built DAR artifacts only')
    .option('--vet', 'Vet packages during upload (override config)')
    .option('--no-vet', 'Upload only, do not vet')
    .option('--dry-run', 'Show resolved DAR set without uploading')
    .option('--script <Module:fn>', 'Run a Daml Script after deployment')
    .action(
      withLogFile(async (opts) => {
        await runDeploy({
          ...networkFlags(opts),
          dar: opts.dar?.length ? opts.dar : undefined,
          skipBuild: opts.skipBuild,
          vet: opts.vet,
          noVet: opts.noVet,
          dryRun: opts.dryRun,
          script: opts.script,
        });
      })
    )
);

sharedNetworkOptions(
  program
    .command('vet')
    .description('Vet the same DAR set as deploy (Admin API VetDar)')
    .option('--dar <path>', 'Additional DAR path (repeatable)', collectDar, [] as string[])
    .option('--skip-build', 'Skip dpm build before resolving DAR set')
    .option('--no-sync', 'Do not wait for vetting to be observed on the synchronizer')
    .action(
      withLogFile(async (opts) => {
        await runVet({
          ...networkFlags(opts),
          dar: opts.dar?.length ? opts.dar : undefined,
          skipBuild: opts.skipBuild,
          noSync: opts.noSync,
        });
      })
    )
);

sharedNetworkOptions(
  program
    .command('vet-dar <mainPackageId>')
    .description('Vet a single DAR by main package id (Admin API)')
    .option('--no-sync', 'Do not wait for vetting synchronizer observation')
    .action(
      withLogFile(async (mainPackageId: string, opts) => {
        await runVetDar(mainPackageId, { ...networkFlags(opts), noSync: Boolean(opts.noSync) });
      })
    )
);

sharedNetworkOptions(program.command('dars').description('List uploaded DARs (Admin API)')).action(
  withLogFile(async (opts) => {
    await runDars(networkFlags(opts));
  })
);

sharedNetworkOptions(
  program.command('status').description('Check Admin, Ledger, and JSON API connectivity')
).action(
  withLogFile(async (opts) => {
    await runStatus(networkFlags(opts));
  })
);

sharedNetworkOptions(
  program
    .command('parties')
    .description('List known parties (Ledger API)')
    .option('--filter-party <prefix>', 'Prefix filter')
    .option('--limit <n>', 'Max parties', (v) => parseInt(String(v), 10))
    .option('--page-token <token>', 'Pagination token')
    .option('--party <ids>', 'Comma-separated party ids to look up')
    .option('--local', 'Only show parties hosted on this participant (is_local)')
).action(
  withLogFile(async (opts) => {
    await runParties({
      ...networkFlags(opts),
      partiesFilterPrefix: opts.filterParty,
      partiesLimit: opts.limit,
      partiesPageToken: opts.pageToken,
      partiesLookup: opts.party,
      partiesLocalOnly: Boolean(opts.local),
    });
  })
);

sharedNetworkOptions(
  program.command('allocate-party <displayName>').description('Allocate a party (idempotent)')
).action(
  withLogFile(async (displayName: string, opts) => {
    await runAllocateParty(displayName, networkFlags(opts));
  })
);

sharedNetworkOptions(program.command('users').description('List participant users')).action(
  withLogFile(async (opts) => {
    await runUsers(networkFlags(opts));
  })
);

sharedNetworkOptions(
  program
    .command('create-user')
    .description('Create user from config users[] entry and grant rights')
    .requiredOption('--user-id <id>', 'userId from canton-deploy.config.js users[]')
).action(
  withLogFile(async (opts) => {
    await runCreateUser({ ...networkFlags(opts), userId: opts.userId });
  })
);

sharedNetworkOptions(
  program
    .command('run <Module:fn>')
    .description('Run a Daml Script via dpm script')
    .option('--dar <path>', 'DAR containing the script')
    .option('--input-file <path>', 'JSON input file for the script')
).action(
  withLogFile(async (scriptName: string, opts) => {
    await runScript({
      ...networkFlags(opts),
      scriptName,
      dar: opts.dar,
      scriptInputFile: opts.inputFile,
    });
  })
);

sharedNetworkOptions(
  program
    .command('contracts')
    .description('List active contracts (HTTP JSON API)')
    .option('--template <id>', 'Filter by template ID')
    .option('--party <partyId>', 'Filter by party')
).action(
  withLogFile(async (opts) => {
    await runContracts({
      ...networkFlags(opts),
      template: opts.template,
      party: opts.party,
    });
  })
);

sharedNetworkOptions(
  program
    .command('token')
    .description('Show or decode the resolved JWT')
    .option('--show', 'Print full token')
    .option('--decode', 'Decode JWT payload')
).action(
  withLogFile(async (opts) => {
    await runToken({ ...networkFlags(opts), show: opts.show, decode: opts.decode });
  })
);

sharedNetworkOptions(
  program.command('packages').description('List known packages (Ledger API)')
).action(
  withLogFile(async (opts) => {
    await runPackages(networkFlags(opts));
  })
);

program
  .command('init')
  .description('Create canton-deploy.config.js (LocalNet + optional DevNet)')
  .action(async () => {
    await runInit().catch(handleError);
  });

function handleError(err: unknown): void {
  console.error(chalk.red(`\n  Error: ${formatGrpcError(err)}\n`));
  process.exit(1);
}

program.parse(process.argv);
