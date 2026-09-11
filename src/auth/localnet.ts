import * as jwt from 'jsonwebtoken';

export const LOCALNET_DEFAULT_SECRET = 'unsafe';
export const LOCALNET_DEFAULT_AUDIENCE = 'https://canton.network.global';
export const LOCALNET_DEFAULT_USER_ID = 'ledger-api-user';
const TOKEN_TTL_SECONDS = 3600;

export interface LocalNetTokenOptions {
  userId?: string;
  audience?: string;
}

export function generateLocalNetToken(options: LocalNetTokenOptions = {}): string {
  const userId = options.userId ?? LOCALNET_DEFAULT_USER_ID;
  const audience = options.audience ?? LOCALNET_DEFAULT_AUDIENCE;
  const now = Math.floor(Date.now() / 1000);

  return jwt.sign(
    {
      sub: userId,
      aud: audience,
      iat: now,
      exp: now + TOKEN_TTL_SECONDS,
    },
    LOCALNET_DEFAULT_SECRET,
    { algorithm: 'HS256' }
  );
}
