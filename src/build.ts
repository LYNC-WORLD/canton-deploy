import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { execa } from 'execa';
import chalk from 'chalk';
import ora from 'ora';

interface DamlYaml {
  name: string;
  version: string;
}

export function getDarPath(darOverride?: string): string {
  if (darOverride) return path.resolve(darOverride);

  const damlYamlPath = path.join(process.cwd(), 'daml.yaml');
  if (!fs.existsSync(damlYamlPath)) {
    console.error(chalk.red('No daml.yaml found in current directory.'));
    console.error(chalk.gray('  Run from your Daml project root, or pass --dar <path>'));
    process.exit(1);
  }

  const raw = yaml.load(fs.readFileSync(damlYamlPath, 'utf8')) as DamlYaml;
  if (!raw?.name || !raw?.version) {
    console.error(chalk.red('daml.yaml must have "name" and "version" fields.'));
    process.exit(1);
  }

  const candidates = [
    path.join(process.cwd(), '.dpm', 'dist', `${raw.name}-${raw.version}.dar`),
    path.join(process.cwd(), '.daml', 'dist', `${raw.name}-${raw.version}.dar`),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  return candidates[0];
}

export async function runDpmBuild(): Promise<void> {
  const spinner = ora('Running dpm build...').start();

  try {
    const proc = execa('dpm', ['build'], {
      cwd: process.cwd(),
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
