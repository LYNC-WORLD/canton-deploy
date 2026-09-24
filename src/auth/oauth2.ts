import chalk from 'chalk';
import jwt from 'jsonwebtoken';
import type { OAuth2Config } from '../types.js';

const cache = new Map<string, { token: string; exp?: number }>();

function cacheKey(networkName: string, cfg: OAuth2Config): string {
  return `${networkName}:${cfg.tokenUrl}:${cfg.clientId}:${cfg.audience}`;
}

export function resolveOAuth2ClientSecret(cfg: OAuth2Config): string {
  const secret = process.env[cfg.clientSecretEnv]?.trim();
  if (!secret) {
    console.error(
      chalk.red(`OAuth2: environment variable "${cfg.clientSecretEnv}" is not set or empty.`)
    );
    process.exit(1);
  }
  return secret;
}

export async function fetchOAuth2Token(networkName: string, cfg: OAuth2Config): Promise<string> {
  const key = cacheKey(networkName, cfg);
  const cached = cache.get(key);
  const nowSec = Math.floor(Date.now() / 1000);
  if (cached && (cached.exp === undefined || cached.exp - nowSec > 300)) {
    return cached.token;
  }

  const clientSecret = resolveOAuth2ClientSecret(cfg);
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: cfg.clientId,
    client_secret: clientSecret,
    audience: cfg.audience,
  });
  if (cfg.scope?.trim()) {
    body.set('scope', cfg.scope.trim());
  }

  let res: Response;
  try {
    res = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch (err) {
    console.error(chalk.red(`OAuth2 token request failed: ${(err as Error).message}`));
    process.exit(1);
  }

  const text = await res.text();
  if (!res.ok) {
    console.error(chalk.red(`OAuth2 token request HTTP ${res.status}: ${text.slice(0, 300)}`));
    process.exit(1);
  }

  let data: { access_token?: string; error?: string; error_description?: string };
  try {
    data = JSON.parse(text) as typeof data;
  } catch {
    console.error(chalk.red('OAuth2 token response is not valid JSON.'));
    process.exit(1);
  }

  if (data.error || !data.access_token?.trim()) {
    console.error(
      chalk.red(
        `OAuth2 error: ${data.error ?? 'missing access_token'}${data.error_description ? ` — ${data.error_description}` : ''}`
      )
    );
    process.exit(1);
  }

  const token = data.access_token.trim();
  const exp = (jwt.decode(token) as jwt.JwtPayload | null)?.exp;
  cache.set(key, { token, exp });

  return token;
}

export function clearOAuth2TokenCacheForTests(): void {
  cache.clear();
}
