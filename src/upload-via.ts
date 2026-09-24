import chalk from 'chalk';
import type { UploadVia } from './types.js';

function parseUploadVia(raw: string, source: string): UploadVia | undefined {
  const v = raw.trim().toLowerCase();
  if (v === 'admin' || v === 'ledger') return v;
  console.warn(
    chalk.yellow(`  Warning: ${source}="${raw}" is not admin|ledger — ignoring.`)
  );
  return undefined;
}

export function resolveUploadVia(
  cliValue: string | undefined,
  configValue: UploadVia | undefined
): UploadVia {
  if (cliValue !== undefined && cliValue !== '') {
    const parsed = parseUploadVia(cliValue, '--upload-via');
    if (!parsed) {
      console.error(chalk.red('  --upload-via must be admin or ledger'));
      process.exit(1);
    }
    return parsed;
  }

  const envRaw = process.env.CANTON_DEPLOY_UPLOAD_VIA?.trim();
  if (envRaw) {
    const parsed = parseUploadVia(envRaw, 'CANTON_DEPLOY_UPLOAD_VIA');
    if (parsed) return parsed;
  }

  if (configValue) return configValue;
  return 'ledger';
}
