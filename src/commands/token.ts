import chalk from 'chalk';
import type { CliFlags, ResolvedNetwork } from '../types.js';
import { withNetworkSession } from '../network-session.js';
import { resolveToken, decodeJwtPayload, tokenSourceKind } from '../auth/resolve.js';

async function executeToken(network: ResolvedNetwork, flags: CliFlags): Promise<void> {
  const token = await resolveToken(network);
  const source = tokenSourceKind(network);

  if (flags.show) {
    console.log(token);
    return;
  }

  if (flags.decode) {
    const payload = decodeJwtPayload(token);
    if (!payload) {
      console.error(chalk.red('Could not decode token — not a valid JWT.'));
      process.exit(1);
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const expSec = payload.exp;
    let expiryStr = chalk.gray('(no expiry)');
    if (expSec) {
      const remaining = expSec - nowSec;
      if (remaining < 0) {
        expiryStr = chalk.red(`EXPIRED ${Math.abs(Math.ceil(remaining / 60))} min ago`);
      } else if (remaining < 300) {
        expiryStr = chalk.yellow(`expires in ${Math.ceil(remaining / 60)} min`);
      } else {
        const mins = Math.floor(remaining / 60);
        const hrs = Math.floor(mins / 60);
        expiryStr =
          hrs > 0
            ? chalk.green(`expires in ${hrs}h ${mins % 60}m`)
            : chalk.green(`expires in ${mins}m`);
      }
    }

    console.log(chalk.bold('\n  JWT Token Payload'));
    console.log(chalk.gray('  ─────────────────────────────────────'));
    console.log(`  ${chalk.gray('network:')} ${network.name}`);
    console.log(`  ${chalk.gray('source:')} ${source}`);
    console.log(`  ${chalk.gray('sub:')} ${payload.sub ?? '(none)'}`);
    console.log(
      `  ${chalk.gray('aud:')} ${Array.isArray(payload.aud) ? payload.aud.join(', ') : (payload.aud ?? '(none)')}`
    );
    if (expSec) {
      console.log(`  ${chalk.gray('exp:')} ${new Date(expSec * 1000).toISOString()} — ${expiryStr}`);
    }
    console.log(`  ${chalk.gray('ledger:')}  ${network.host}:${network.ledgerPort}`);
    console.log(`  ${chalk.gray('admin:')}   ${network.host}:${network.adminPort}\n`);
    return;
  }

  const masked =
    token.length > 24 ? `${token.slice(0, 20)}...${token.slice(-4)}` : `${token.slice(0, 10)}...`;

  console.log(chalk.bold('\n  Resolved token'));
  console.log(chalk.gray('  ─────────────────────────────────────'));
  console.log(`  ${chalk.gray('source:')} ${source}`);
  console.log(`  ${chalk.cyan(masked)}`);
  console.log(chalk.gray('\n  Use --decode to inspect payload, --show to print full token.\n'));
}

export async function runToken(flags: CliFlags): Promise<void> {
  return withNetworkSession(flags, (network) => executeToken(network, flags));
}
