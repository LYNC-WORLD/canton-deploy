import chalk from 'chalk';
import { formatGrpcError } from '../grpc/format-error.js';

export function failSpinner(
  spinner: { fail(text?: string): unknown },
  text: string,
  err: unknown
): never {
  spinner.fail(text);
  console.error(chalk.red(`  ${formatGrpcError(err)}`));
  process.exit(1);
}
