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

  return '3.5.1-rc5';
}

function findCantonProtoRoot(): string {
  const explicitPath = process.env.CANTON_PROTO_PATH;
  if (explicitPath) {
    if (fs.existsSync(explicitPath)) return explicitPath;
    throw new Error(
      `CANTON_PROTO_PATH="${explicitPath}" does not exist.\nCheck the path and try again.`
    );
  }

  const version = resolveCantonVersion();
  const dirName = `canton-open-source-${version}`;

  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, dirName, 'protobuf');
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }

  throw new Error(
    `Could not locate ${dirName}/protobuf/\n\n` +
    `  Canton SDK version resolved as: ${version}\n` +
    `  (from daml.yaml sdk-version, CANTON_SDK_VERSION env, or auto-detection)\n\n` +
    `  DPM users: install the canton-deploy component (protos are bundled; do not download manually).\n\n` +
    `  Maintainers — Option A: extract the protobuf bundle next to your project:\n` +
    `    curl -L https://github.com/digital-asset/canton/releases/download/v${version}/canton-open-source-${version}-protobuf.tar.gz | tar xz\n\n` +
    `  Option B — Set CANTON_PROTO_PATH to an existing protobuf/ directory:\n` +
    `    export CANTON_PROTO_PATH=/path/to/canton-open-source-${version}/protobuf\n\n` +
    `  Option C — Override the SDK version:\n` +
    `    export CANTON_SDK_VERSION=<your-node-version>\n` +
    `    then use Option A or B.\n`
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
