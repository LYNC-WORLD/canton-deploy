import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import chalk from 'chalk';
import { execa } from 'execa';
import type { CliFlags, ResolvedNetwork } from '../types.js';
import { loadConfig } from '../config.js';
import { resolveToken, decodeJwtPayload } from '../auth/resolve.js';
import { resolveFullDarSet, normalizeCliDars } from '../dar-set.js';
import { nestedDpmExecaOptions } from '../utils/dpm-env.js';

function canTcpConnect(host: string, port: number, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function resolveScriptLedgerHost(
  network: ResolvedNetwork
): Promise<{ host: string; via: string }> {
  const authority = network.grpcAuthority?.trim();
  if (!authority || authority === network.host) {
    return { host: network.host, via: 'host' };
  }

  if (await canTcpConnect(authority, network.ledgerPort)) {
    return { host: authority, via: 'grpcAuthority' };
  }

  console.error(
    chalk.red(`\n  Cannot reach ${authority}:${network.ledgerPort} (grpcAuthority).\n`)
  );
  console.error(
    chalk.yellow(
      '  dpm script uses --ledger-host for both the TCP connection and gRPC :authority.\n' +
        `  Config: host=${network.host}  grpcAuthority=${authority}  port=${network.ledgerPort}\n\n` +
        `  ${authority} must resolve and accept connections on port ${network.ledgerPort},\n` +
        '  or set host and grpcAuthority to the same reachable name.\n'
    )
  );
  process.exit(1);
}

export async function runScript(flags: CliFlags & { scriptName?: string }): Promise<void> {
  const scriptName = flags.scriptName ?? flags.script;
  if (!scriptName) {
    console.error(chalk.red('Script name required (e.g. Setup:setup)'));
    process.exit(1);
  }

  const config = await loadConfig(flags);
  const { network } = config;
  const token = await resolveToken(network);

  let darPath = flags.dar as string | undefined;
  if (!darPath) {
    const set = resolveFullDarSet(network, { cliDars: normalizeCliDars(flags.dar) });
    darPath = set[set.length - 1]?.path;
  } else if (Array.isArray(darPath)) {
    darPath = darPath[darPath.length - 1];
  }

  if (!darPath || !fs.existsSync(darPath)) {
    console.error(chalk.red(`DAR not found: ${darPath ?? '(none)'}`));
    console.error(chalk.gray('  Run deploy first, or pass --dar <path>'));
    process.exit(1);
  }

  const { host: ledgerHost, via } = await resolveScriptLedgerHost(network);

  const tmpTokenFile = path.join(os.tmpdir(), `canton-deploy-token-${Date.now()}.jwt`);
  fs.writeFileSync(tmpTokenFile, token, { mode: 0o600 });

  const args = [
    'script',
    '--ledger-host', ledgerHost,
    '--ledger-port', String(network.ledgerPort),
    '--script-name', scriptName,
    '--dar', darPath,
    '--access-token-file', tmpTokenFile,
  ];

  const userId =
    network.scriptUserId?.trim() || decodeJwtPayload(token)?.sub?.trim() || undefined;
  if (userId) args.push('--user-id', userId);

  if (flags.scriptInputFile) {
    args.push('--input-file', path.resolve(flags.scriptInputFile));
  }

  if (network.tls) args.push('--tls');

  console.log(chalk.bold(`\n  canton-deploy run`));
  console.log(chalk.gray(`  Script: ${scriptName}`));
  console.log(
    chalk.gray(
      `  Host:   ${ledgerHost}:${network.ledgerPort}` +
        (via === 'grpcAuthority' ? ' (grpcAuthority)' : '')
    )
  );
  console.log(chalk.gray(`  DAR:    ${darPath}\n`));

  try {
    await execa('dpm', args, { stdio: 'inherit', ...nestedDpmExecaOptions() });
    console.log(chalk.green('\n  Script completed successfully.\n'));
  } catch (err) {
    console.error(chalk.red('\n  Script execution failed.'));
    console.error(chalk.gray(`  ${(err as Error).message}`));
    process.exit(1);
  } finally {
    try {
      fs.unlinkSync(tmpTokenFile);
    } catch {
      /* ignore */
    }
  }
}
