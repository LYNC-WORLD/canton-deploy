import type { CliFlags, ResolvedNetwork } from './types.js';
import { loadConfig } from './config.js';
import { startSshTunnel } from './tunnel.js';

export async function withNetworkSession<T>(
  flags: CliFlags,
  fn: (network: ResolvedNetwork) => Promise<T>
): Promise<T> {
  const { network } = await loadConfig(flags);
  const tunnel = network.tunnel?.ssh ? await startSshTunnel(network.tunnel.ssh) : null;
  const cleanup = tunnel?.cleanup ?? (() => {});
  try {
    return await fn(network);
  } finally {
    cleanup();
  }
}
