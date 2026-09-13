import type { ResolvedNetwork } from './types.js';

export function jsonApiBaseUrl(network: ResolvedNetwork): string {
  const scheme = network.httpUseTls ? 'https' : 'http';
  const host = network.httpHost ?? network.host;
  return `${scheme}://${host}:${network.httpPort}`;
}
