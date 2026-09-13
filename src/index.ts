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
    .action(async (opts) => {
      installLogFile(opts.logFile);
      try {
        await runDeploy({
          host: opts.host,
          adminPort: opts.adminPort,
          ledgerPort: opts.ledgerPort,
          httpPort: opts.httpPort,
          httpHost: opts.httpHost,
          grpcAuthority: opts.grpcAuthority,
          token: opts.token,
          network: opts.network,
          dar: opts.dar?.length ? opts.dar : undefined,
          skipBuild: opts.skipBuild,
          vet: opts.vet,
          noVet: opts.noVet,
          dryRun: opts.dryRun,
          script: opts.script,
          logFile: opts.logFile,
        });
      } finally {
        closeLogFile();
      }
    })
);

sharedNetworkOptions(
  program
    .command('vet')
    .description('Vet the same DAR set as deploy (Admin API VetDar)')
    .option('--dar <path>', 'Additional DAR path (repeatable)', collectDar, [] as string[])
    .option('--skip-build', 'Skip dpm build before resolving DAR set')
    .option('--no-sync', 'Do not wait for vetting to be observed on the synchronizer')
    .action(async (opts) => {
      installLogFile(opts.logFile);
      try {
        await runVet({
          host: opts.host,
          adminPort: opts.adminPort,
          token: opts.token,
          network: opts.network,
          dar: opts.dar?.length ? opts.dar : undefined,
          skipBuild: opts.skipBuild,
          noSync: opts.noSync,
        });
      } finally {
        closeLogFile();
      }
    })
);

sharedNetworkOptions(
  program
    .command('vet-dar <mainPackageId>')
    .description('Vet a single DAR by main package id (Admin API)')
    .option('--no-sync', 'Do not wait for vetting synchronizer observation')
    .action(async (mainPackageId: string, opts) => {
      installLogFile(opts.logFile);
      try {
        await runVetDar(mainPackageId, {
          host: opts.host,
          adminPort: opts.adminPort,
          token: opts.token,
          network: opts.network,
          noSync: Boolean(opts.noSync),
        });
      } finally {
        closeLogFile();
      }
    })
);

sharedNetworkOptions(program.command('dars').description('List uploaded DARs (Admin API)')).action(
  async (opts) => {
    await runDars({
      host: opts.host,
      adminPort: opts.adminPort,
      token: opts.token,
      network: opts.network,
    }).catch(handleError);
  }
);

sharedNetworkOptions(
  program.command('status').description('Check Admin, Ledger, and JSON API connectivity')
).action(async (opts) => {
  await runStatus({
    host: opts.host,
    adminPort: opts.adminPort,
    ledgerPort: opts.ledgerPort,
    httpPort: opts.httpPort,
    httpHost: opts.httpHost,
    token: opts.token,
    network: opts.network,
  }).catch(handleError);
});

sharedNetworkOptions(
  program
    .command('parties')
    .description('List known parties (Ledger API)')
    .option('--filter-party <prefix>', 'Prefix filter')
    .option('--limit <n>', 'Max parties', (v) => parseInt(String(v), 10))
    .option('--page-token <token>', 'Pagination token')
    .option('--party <ids>', 'Comma-separated party ids to look up')
).action(async (opts) => {
  await runParties({
    host: opts.host,
    ledgerPort: opts.ledgerPort,
    token: opts.token,
    network: opts.network,
    partiesFilterPrefix: opts.filterParty,
    partiesLimit: opts.limit,
    partiesPageToken: opts.pageToken,
    partiesLookup: opts.party,
  }).catch(handleError);
});

sharedNetworkOptions(
  program.command('allocate-party <displayName>').description('Allocate a party (idempotent)')
).action(async (displayName: string, opts) => {
  await runAllocateParty(displayName, {
    host: opts.host,
    ledgerPort: opts.ledgerPort,
    token: opts.token,
    network: opts.network,
  }).catch(handleError);
});

sharedNetworkOptions(program.command('users').description('List participant users')).action(
  async (opts) => {
    await runUsers({
      host: opts.host,
      ledgerPort: opts.ledgerPort,
      token: opts.token,
      network: opts.network,
    }).catch(handleError);
  }
);

sharedNetworkOptions(
  program
    .command('create-user')
    .description('Create user from config users[] entry and grant rights')
    .requiredOption('--user-id <id>', 'userId from canton-deploy.config.js users[]')
).action(async (opts) => {
  await runCreateUser({
    host: opts.host,
    ledgerPort: opts.ledgerPort,
    token: opts.token,
    network: opts.network,
    userId: opts.userId,
  }).catch(handleError);
});

sharedNetworkOptions(
  program
    .command('run <Module:fn>')
    .description('Run a Daml Script via dpm script')
    .option('--dar <path>', 'DAR containing the script')
    .option('--input-file <path>', 'JSON input file for the script')
).action(async (scriptName: string, opts) => {
  installLogFile(opts.logFile);
  try {
    await runScript({
      scriptName,
      host: opts.host,
      ledgerPort: opts.ledgerPort,
      token: opts.token,
      network: opts.network,
      dar: opts.dar,
      scriptInputFile: opts.inputFile,
    });
  } finally {
    closeLogFile();
  }
});

sharedNetworkOptions(
  program
    .command('contracts')
    .description('List active contracts (HTTP JSON API)')
    .option('--template <id>', 'Filter by template ID')
    .option('--party <partyId>', 'Filter by party')
).action(async (opts) => {
  await runContracts({
    host: opts.host,
    httpPort: opts.httpPort,
    httpHost: opts.httpHost,
    template: opts.template,
    party: opts.party,
    token: opts.token,
    network: opts.network,
  }).catch(handleError);
});

sharedNetworkOptions(
  program
    .command('token')
    .description('Show or decode the resolved JWT')
    .option('--show', 'Print full token')
    .option('--decode', 'Decode JWT payload')
).action(async (opts) => {
  await runToken({
    show: opts.show,
    decode: opts.decode,
    token: opts.token,
    network: opts.network,
    host: opts.host,
  }).catch(handleError);
});

sharedNetworkOptions(
  program.command('packages').description('List known packages (Ledger API)')
).action(async (opts) => {
  await runPackages({
    host: opts.host,
    ledgerPort: opts.ledgerPort,
    grpcAuthority: opts.grpcAuthority,
    token: opts.token,
    network: opts.network,
  }).catch(handleError);
});

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
