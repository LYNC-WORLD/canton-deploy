import { execaCommand } from 'execa';
import chalk from 'chalk';
import type { ResolvedNetwork } from '../types.js';
import { generateLocalNetToken } from './localnet.js';

interface JwtPayload {
  sub?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
}

export function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(payload) as JwtPayload;
  } catch {
    return null;
  }
}

export function checkTokenExpiry(token: string): void {
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return;

  const nowSec = Math.floor(Date.now() / 1000);
  const remainingSec = payload.exp - nowSec;

  if (remainingSec < 0) {
    console.warn(chalk.red('  Token has already expired. Requests will fail with 401.'));
  } else if (remainingSec < 300) {
    const mins = Math.ceil(remainingSec / 60);
    console.warn(chalk.yellow(`  Warning: token expires in ${mins} minute(s). Consider refreshing.`));
  }
}

function isLocalNetNetwork(network: ResolvedNetwork): boolean {
  if (network.name === 'localnet') return true;
  return network.host === 'localhost' || network.host === '127.0.0.1';
}

export async function resolveToken(network: ResolvedNetwork): Promise<string> {
  if (network.token) {
    checkTokenExpiry(network.token);
    return network.token;
  }

  if (network.tokenCommand) {
    try {
      const { stdout } = await execaCommand(network.tokenCommand, { shell: true });
      const token = stdout.trim();
      if (!token) throw new Error('tokenCommand produced empty output');
      checkTokenExpiry(token);
      return token;
    } catch (err) {
      console.error(chalk.red(`Failed to run tokenCommand: ${network.tokenCommand}`));
      console.error(chalk.red((err as Error).message));
      process.exit(1);
    }
  }

  if (isLocalNetNetwork(network)) {
    return generateLocalNetToken({
      userId: network.jwtUserId,
      audience: network.jwtAudience,
    });
  }

  console.error(chalk.red(`No token configured for network "${network.name}".`));
  console.error(chalk.gray('  Set token, tokenFile, or tokenCommand in canton-deploy.config.js'));
  console.error(chalk.gray('  Or pass --token <jwt> on the command line'));
  process.exit(1);
}
