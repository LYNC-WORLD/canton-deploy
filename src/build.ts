import * as fs from 'fs';
import * as path from 'path';
import { execa } from 'execa';
import chalk from 'chalk';
import ora from 'ora';
import { findProjectRoot } from './dar-set.js';

export async function runDpmBuild(cwd: string = process.cwd()): Promise<void> {
  const root = findProjectRoot(cwd);
  const multi = fs.existsSync(path.join(root, 'multi-package.yaml'));
  const args = multi ? ['build', '--all'] : ['build'];

  const spinner = ora(`Running dpm ${args.join(' ')}...`).start();

  try {
    const proc = execa('dpm', args, {
      cwd: root,
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    proc.stdout?.on('data', (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) spinner.text = `Building: ${line.slice(0, 60)}`;
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) spinner.text = `Building: ${line.slice(0, 60)}`;
    });

    await proc;
    spinner.succeed('dpm build complete');
  } catch (err) {
    spinner.fail('dpm build failed');
    console.error(chalk.red((err as Error).message));
    console.error(chalk.gray('  Ensure DPM is installed and on PATH'));
    process.exit(1);
  }
}
