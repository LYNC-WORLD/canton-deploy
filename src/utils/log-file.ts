import * as fs from 'fs';

let logStream: fs.WriteStream | null = null;
const originals = {
  log: console.log.bind(console),
  error: console.error.bind(console),
  warn: console.warn.bind(console),
};

function tee(level: 'log' | 'error' | 'warn', args: unknown[]): void {
  originals[level](...args);
  if (!logStream) return;
  const line = args
    .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ');
  logStream.write(`[${level}] ${line}\n`);
}

export function installLogFile(path: string | undefined): void {
  if (!path) return;
  logStream = fs.createWriteStream(path, { flags: 'a' });
  console.log = (...args: unknown[]) => tee('log', args);
  console.error = (...args: unknown[]) => tee('error', args);
  console.warn = (...args: unknown[]) => tee('warn', args);
}

export function closeLogFile(): void {
  if (logStream) {
    logStream.end();
    logStream = null;
  }
  console.log = originals.log;
  console.error = originals.error;
  console.warn = originals.warn;
}
