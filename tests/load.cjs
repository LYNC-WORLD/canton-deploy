const path = require('path');
const esbuild = require('esbuild');

function loadSrc(rel) {
  const result = esbuild.buildSync({
    entryPoints: [path.join(__dirname, '..', rel)],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
  });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(
    mod,
    mod.exports,
    require
  );
  return mod.exports;
}

function withMockExit(fn) {
  const orig = process.exit;
  process.exit = (code) => {
    throw Object.assign(new Error(`process.exit(${code})`), { exitCode: code ?? 0 });
  };
  try {
    return { value: fn() };
  } catch (err) {
    if (typeof err.exitCode === 'number') return { exitCode: err.exitCode };
    throw err;
  } finally {
    process.exit = orig;
  }
}

module.exports = { loadSrc, withMockExit };
