import * as fs from 'fs';
import { execaCommand } from 'execa';
import chalk from 'chalk';
import * as jwt from 'jsonwebtoken';
import type { ResolvedNetwork } from '../types.js';
import { generateLocalNetToken } from './localnet.js';

interface JwtPayload {
  sub?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
}

export function decodeJwtPayload(token: string): JwtPayload | null {
  const payload = jwt.decode(token);
  if (!payload || typeof payload === 'string') return null;
  return payload as JwtPayload;
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

export function tokenSourceKind(
  network: Pick<ResolvedNetwork, 'name' | 'token' | 'tokenCommand' | 'tokenFile'>
): 'token' | 'tokenCommand' | 'tokenFile' | 'localnet' | 'none' {
  if (network.token) return 'token';
  if (network.tokenCommand) return 'tokenCommand';
  if (network.tokenFile) return 'tokenFile';
  if (network.name === 'localnet') return 'localnet';
  return 'none';
}

export async function resolveToken(network: ResolvedNetwork): Promise<string> {
  const kind = tokenSourceKind(network);

  if (kind === 'token') {
    checkTokenExpiry(network.token!);
    return network.token!;
  }

  if (kind === 'tokenCommand') {
    try {
      const { stdout } = await execaCommand(network.tokenCommand!, { shell: true });
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

  if (kind === 'tokenFile') {
    try {
      const token = fs.readFileSync(network.tokenFile!, 'utf8').trim();
      if (!token) throw new Error('tokenFile is empty');
      checkTokenExpiry(token);
      return token;
    } catch (err) {
      console.error(chalk.red(`Cannot read tokenFile: ${network.tokenFile}`));
      console.error(chalk.red((err as Error).message));
      process.exit(1);
    }
  }

  if (kind === 'localnet') {
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
