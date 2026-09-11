#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import chalk from 'chalk';

import { runDeploy } from './commands/deploy.js';
import { runStatus } from './commands/status.js';
import { runToken } from './commands/token.js';
import { runInit } from './commands/init.js';
import { runDars } from './commands/dars.js';
import { runVetDar } from './commands/vet-dar.js';
import { formatGrpcError } from './grpc/format-error.js';

const program = new Command();

function readCliVersion(): string {
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    const v = (JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string }).version;
    if (typeof v === 'string' && v.trim()) return v.trim();
  } catch {
    /* bundled layout */
  }
  return '0.1.0';
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
    .option('--network <name>', 'Network name from canton-deploy.config.js');
}

program
  .name('canton-deploy')
  .description('Deploy Daml packages to Canton validators via Admin API')
  .version(readCliVersion());

sharedNetworkOptions(
  program
    .command('deploy')
    .description('Build (dpm) and upload DAR via Admin API')
    .option('--dar <path>', 'Path to pre-built DAR (skip dpm build)')
    .option('--dry-run', 'Show resolved DAR without uploading')
    .action(async (opts) => {
      await runDeploy({
        host: opts.host,
        adminPort: opts.adminPort,
        ledgerPort: opts.ledgerPort,
        httpPort: opts.httpPort,
        httpHost: opts.httpHost,
        grpcAuthority: opts.grpcAuthority,
        token: opts.token,
        network: opts.network,
        dar: opts.dar,
        dryRun: opts.dryRun,
      });
    })
);

sharedNetworkOptions(
  program
    .command('vet-dar <mainPackageId>')
    .description('Vet a single DAR by main package id (Admin API)')
    .option('--no-sync', 'Do not wait for vetting synchronizer observation')
    .action(async (mainPackageId: string, opts) => {
      await runVetDar(mainPackageId, {
        host: opts.host,
        adminPort: opts.adminPort,
        token: opts.token,
        network: opts.network,
        noSync: Boolean(opts.noSync),
      });
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
  program.command('status').description('Check Admin and Ledger API connectivity')
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

program
  .command('init')
  .description('Create canton-deploy.config.js (LocalNet profile)')
  .action(async () => {
    await runInit().catch(handleError);
  });

function handleError(err: unknown): void {
  console.error(chalk.red(`\n  Error: ${formatGrpcError(err)}\n`));
  process.exit(1);
}

program.parse(process.argv);
