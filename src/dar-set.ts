import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import chalk from 'chalk';
import type { DarEntry, ResolvedNetwork } from './types.js';

interface DamlYaml {
  name: string;
  version: string;
}

interface MultiPackageYaml {
  packages?: string[];
}

function readDamlYaml(pkgDir: string): DamlYaml {
  const p = path.join(pkgDir, 'daml.yaml');
  if (!fs.existsSync(p)) {
    throw new Error(`No daml.yaml in ${pkgDir}`);
  }
  const raw = yaml.load(fs.readFileSync(p, 'utf8')) as DamlYaml;
  if (!raw?.name || !raw?.version) {
    throw new Error(`daml.yaml in ${pkgDir} must have name and version`);
  }
  return raw;
}

function resolveDarOutputPath(pkgDir: string, meta: DamlYaml): string | null {
  const candidates = [
    path.join(pkgDir, '.dpm', 'dist', `${meta.name}-${meta.version}.dar`),
    path.join(pkgDir, '.daml', 'dist', `${meta.name}-${meta.version}.dar`),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export function findProjectRoot(startDir: string): string {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 20; i++) {
    if (fs.existsSync(path.join(dir, 'multi-package.yaml'))) return dir;
    if (fs.existsSync(path.join(dir, 'daml.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(startDir);
}

function matchesFilter(
  pkgPath: string,
  pkgName: string,
  patterns: string[]
): boolean {
  if (patterns.length === 0) return true;
  const norm = pkgPath.replace(/\\/g, '/');
  return patterns.some((pat) => {
    const p = pat.replace(/\\/g, '/');
    return norm.includes(p) || pkgName === p || norm.endsWith(p);
  });
}

export function discoverPackageDirs(projectRoot: string): string[] {
  const multiPath = path.join(projectRoot, 'multi-package.yaml');
  if (fs.existsSync(multiPath)) {
    const mp = yaml.load(fs.readFileSync(multiPath, 'utf8')) as MultiPackageYaml;
    const pkgs = mp.packages ?? [];
    if (pkgs.length === 0) {
      console.error(chalk.red('multi-package.yaml has no packages'));
      process.exit(1);
    }
    return pkgs.map((p) => path.resolve(projectRoot, p));
  }
  return [projectRoot];
}

export function resolveProjectDarEntries(network: ResolvedNetwork): DarEntry[] {
  const root = findProjectRoot(process.cwd());
  const pkgDirs = discoverPackageDirs(root);
  const entries: DarEntry[] = [];

  for (const pkgDir of pkgDirs) {
    const meta = readDamlYaml(pkgDir);
    const rel = path.relative(root, pkgDir).replace(/\\/g, '/') || '.';

    if (
      network.excludePackages.length > 0 &&
      matchesFilter(rel, meta.name, network.excludePackages)
    ) {
      continue;
    }
    if (
      network.includePackages.length > 0 &&
      !matchesFilter(rel, meta.name, network.includePackages)
    ) {
      continue;
    }

    const darPath = resolveDarOutputPath(pkgDir, meta);
    if (!darPath) {
      console.error(
        chalk.red(`Expected DAR not found for ${meta.name}-${meta.version} in ${pkgDir}`)
      );
      console.error(chalk.gray('  Run dpm build first, or use --skip-build with existing artifacts'));
      process.exit(1);
    }

    entries.push({
      path: darPath,
      label: `${meta.name}-${meta.version}`,
      packageRoot: pkgDir,
    });
  }

  return entries;
}

export function resolveAdditionalDarEntries(
  network: ResolvedNetwork,
  cliDars: string[] | undefined
): DarEntry[] {
  const paths = [...network.additionalDars];
  if (cliDars) {
    for (const d of cliDars) paths.push(d);
  }

  const entries: DarEntry[] = [];
  for (const p of paths) {
    const abs = path.resolve(p);
    if (!fs.existsSync(abs)) {
      console.error(chalk.red(`Additional DAR not found: ${abs}`));
      process.exit(1);
    }
    entries.push({ path: abs, label: path.basename(abs) });
  }
  return entries;
}

export function resolveFullDarSet(
  network: ResolvedNetwork,
  options: { cliDars?: string[] }
): DarEntry[] {
  const additional = resolveAdditionalDarEntries(network, options.cliDars);
  const project = resolveProjectDarEntries(network);
  return [...additional, ...project];
}

export function normalizeCliDars(dar?: string | string[]): string[] | undefined {
  if (!dar) return undefined;
  if (Array.isArray(dar)) return dar;
  return [dar];
}
