import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const componentRoot = path.join(__dirname, '..');
const entry = path.join(componentRoot, 'src', 'index.ts');
const cantonOpenSourceVersion =
  process.env.CANTON_OPEN_SOURCE_VERSION?.trim() || '3.5.17';
const protoCandidates = [
  path.join(componentRoot, `canton-open-source-${cantonOpenSourceVersion}`, 'protobuf'),
  path.join(componentRoot, '..', `canton-open-source-${cantonOpenSourceVersion}`, 'protobuf'),
  path.join(componentRoot, 'share', 'protobuf'),
];
const protoSrc = protoCandidates.find((p) => fs.existsSync(p));
const protoDest = path.join(componentRoot, 'share', 'protobuf');
const outFile = path.join(componentRoot, 'dist', 'index.cjs');

if (!fs.existsSync(entry)) {
  console.error(`Missing entry: ${entry}`);
  process.exit(1);
}

if (!protoSrc) {
  console.error(`Missing protobuf source (tried: ${protoCandidates.join(', ')})`);
  console.error(
    `  Run:\n    bash scripts/fetch-canton-protobuf.sh ${cantonOpenSourceVersion}\n` +
      '  Or set CANTON_OPEN_SOURCE_VERSION to match your extracted tarball.'
  );
  process.exit(1);
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.rmSync(protoDest, { recursive: true, force: true });
fs.cpSync(protoSrc, protoDest, { recursive: true });
console.log(`Copied protobufs → ${protoDest}`);

await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  target: 'node18',
  outfile: outFile,
  format: 'cjs',
  minify: false,
  sourcemap: true,
  logLevel: 'info',
});

fs.chmodSync(outFile, 0o755);
console.log(`Bundle complete → ${outFile}`);
