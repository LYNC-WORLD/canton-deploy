import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { execa } from 'execa';
import chalk from 'chalk';
import type { Subprocess } from 'execa';
import type { SshTunnelConfig } from './types.js';

function expandHome(p: string): string {
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

export function canTcpConnect(host: string, port: number, timeoutMs = 500): Promise<boolean> {
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

async function waitForForwards(forwards: SshTunnelConfig['forwards'], timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const checks = await Promise.all(
      forwards.map((f) => canTcpConnect('127.0.0.1', f.localPort))
    );
    if (checks.every(Boolean)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  const ports = forwards.map((f) => f.localPort).join(', ');
  throw new Error(`SSH tunnel did not bind local port(s) ${ports} within ${timeoutMs / 1000}s`);
}

let signalHandlersInstalled = false;
const activeCleanups = new Set<() => void>();

function installSignalHandlers(): void {
  if (signalHandlersInstalled) return;
  signalHandlersInstalled = true;
  const shutdown = () => {
    for (const fn of activeCleanups) {
      try {
        fn();
      } catch {}
    }
    activeCleanups.clear();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

export async function startSshTunnel(cfg: SshTunnelConfig): Promise<{ cleanup: () => void }> {
  const args = ['-N', '-o', 'ExitOnForwardFailure=yes'];
  if (cfg.port !== undefined) {
    args.push('-p', String(cfg.port));
  }
  if (cfg.identityFile?.trim()) {
    args.push('-i', expandHome(cfg.identityFile.trim()));
  }
  for (const f of cfg.forwards) {
    args.push('-L', `${f.localPort}:${f.remoteHost}:${f.remotePort}`);
  }
  args.push(`${cfg.user}@${cfg.host}`);

  let subprocess: Subprocess;
  try {
    subprocess = execa('ssh', args, { stdio: 'ignore', reject: false });
  } catch (err) {
    console.error(chalk.red('Failed to start ssh. Is OpenSSH installed and on PATH?'));
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }

  const cleanup = (): void => {
    activeCleanups.delete(cleanup);
    subprocess.kill('SIGTERM');
  };

  installSignalHandlers();
  activeCleanups.add(cleanup);

  try {
    await waitForForwards(cfg.forwards);
  } catch (err) {
    cleanup();
    console.error(chalk.red((err as Error).message));
    console.error(
      chalk.gray(
        '  Check SSH access, that local ports are free, and remoteHost:remotePort on the server.'
      )
    );
    process.exit(1);
  }

  return { cleanup };
}
