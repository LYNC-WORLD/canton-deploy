import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import chalk from 'chalk';
import { execa } from 'execa';
import type { CliFlags } from '../types.js';
import { loadConfig } from '../config.js';
import { resolveToken } from '../auth/resolve.js';
import { resolveFullDarSet, normalizeCliDars } from '../dar-set.js';

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

  const tmpTokenFile = path.join(os.tmpdir(), `canton-deploy-token-${Date.now()}.jwt`);
  fs.writeFileSync(tmpTokenFile, token, { mode: 0o600 });

  const ledgerHost = network.grpcAuthority ?? network.host;

  const args = [
    'script',
    '--ledger-host', ledgerHost,
    '--ledger-port', String(network.ledgerPort),
    '--script-name', scriptName,
    '--dar', darPath,
    '--access-token-file', tmpTokenFile,
  ];

  if (network.scriptUserId) {
    args.push('--user-id', network.scriptUserId);
  }

  if (flags.scriptInputFile) {
    args.push('--input-file', path.resolve(flags.scriptInputFile));
  }

  if (network.tls) args.push('--tls');

  console.log(chalk.bold(`\n  canton-deploy run`));
  console.log(chalk.gray(`  Script: ${scriptName}`));
  console.log(chalk.gray(`  Host:   ${ledgerHost}:${network.ledgerPort}`));
  console.log(chalk.gray(`  DAR:    ${darPath}\n`));

  try {
    await execa('dpm', args, { stdio: 'inherit' });
    console.log(chalk.green('\n  Script completed successfully.\n'));
  } catch (err) {
    console.error(chalk.red('\n  Script execution failed.'));
    console.error(chalk.gray(`  ${(err as Error).message}`));
    process.exit(1);
  } finally {
    try { fs.unlinkSync(tmpTokenFile); } catch { }
  }
}
