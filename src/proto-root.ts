import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';

function resolveCantonVersion(): string {
  const envVersion = process.env.CANTON_SDK_VERSION;
  if (envVersion) return envVersion;

  const damlYamlPath = path.join(process.cwd(), 'daml.yaml');
  if (fs.existsSync(damlYamlPath)) {
    try {
      const raw = yaml.load(fs.readFileSync(damlYamlPath, 'utf8')) as Record<string, unknown>;
      const v = raw?.['sdk-version'];
      if (typeof v === 'string' && v.trim()) return v.trim();
    } catch {
    }
  }

  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    try {
      const entries = fs.readdirSync(dir).filter((e) => e.startsWith('canton-open-source-'));
      if (entries.length > 0) {
        const ver = entries[0].replace('canton-open-source-', '');
        return ver;
      }
    } catch { }
    dir = path.dirname(dir);
  }

  return '3.5.17';
}

function isProtoTree(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, 'admin-api')) && fs.existsSync(path.join(dir, 'ledger-api'))
  );
}

function findCantonProtoRoot(): string {
  const explicitPath = process.env.CANTON_PROTO_PATH;
  if (explicitPath) {
    if (fs.existsSync(explicitPath)) return explicitPath;
    throw new Error(
      `CANTON_PROTO_PATH="${explicitPath}" does not exist.\nCheck the path and try again.`
    );
  }

  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const bundled = path.join(dir, 'share', 'protobuf');
    if (isProtoTree(bundled)) return bundled;
    dir = path.dirname(dir);
  }

  const version = resolveCantonVersion();
  const dirName = `canton-open-source-${version}`;

  dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, dirName, 'protobuf');
    if (isProtoTree(candidate)) return candidate;
    dir = path.dirname(dir);
  }

  throw new Error(
    `Could not locate Canton protobufs (tried share/protobuf and ${dirName}/protobuf).\n\n` +
    `  Set CANTON_PROTO_PATH to a directory containing admin-api/ and ledger-api/,\n` +
    `  or run: bash scripts/fetch-canton-protobuf.sh ${version}\n`
  );
}

let _protoRoot: string | undefined;

export function getProtoRoot(): string {
  if (!_protoRoot) _protoRoot = findCantonProtoRoot();
  return _protoRoot;
}

export function adminProtoPath(relative: string): string {
  return path.join(getProtoRoot(), 'admin-api', relative);
}

export function ledgerProtoPath(relative: string): string {
  return path.join(getProtoRoot(), 'ledger-api', relative);
}
