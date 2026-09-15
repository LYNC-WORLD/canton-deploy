const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadSrc, withMockExit } = require('./load.cjs');

const {
  matchesFilter,
  discoverPackageDirs,
  normalizeCliDars,
  resolveAdditionalDarEntries,
  resolveFullDarSet,
} = loadSrc('src/dar-set.ts');

function writePkg(dir, name, version) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'daml.yaml'),
    `name: ${name}\nversion: ${version}\nsource: daml\n`
  );
  const dist = path.join(dir, '.daml', 'dist');
  fs.mkdirSync(dist, { recursive: true });
  const dar = path.join(dist, `${name}-${version}.dar`);
  fs.writeFileSync(dar, 'dar');
  return dar;
}

test('includePackages / excludePackages match path or package name', () => {
  assert.equal(matchesFilter('./app', 'my-app', ['./app']), true);
  assert.equal(matchesFilter('./tests', 'my-tests', ['./app']), false);
  assert.equal(matchesFilter('./tests', 'my-tests', ['./tests']), true);
  assert.equal(matchesFilter('./app', 'my-app', ['my-app']), true);
});

test('normalizeCliDars flattens a single path', () => {
  assert.equal(normalizeCliDars(undefined), undefined);
  assert.deepEqual(normalizeCliDars('a.dar'), ['a.dar']);
  assert.deepEqual(normalizeCliDars(['a.dar', 'b.dar']), ['a.dar', 'b.dar']);
});

test('discoverPackageDirs reads multi-package.yaml', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-mp-'));
  try {
    fs.writeFileSync(path.join(tmp, 'multi-package.yaml'), 'packages:\n  - ./app\n  - ./tests\n');
    const dirs = discoverPackageDirs(tmp);
    assert.deepEqual(dirs, [path.join(tmp, 'app'), path.join(tmp, 'tests')]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('resolveAdditionalDarEntries requires files to exist', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-add-'));
  const prev = process.cwd();
  try {
    const dar = path.join(tmp, 'extra.dar');
    fs.writeFileSync(dar, 'fake');
    process.chdir(tmp);
    const entries = resolveAdditionalDarEntries({ additionalDars: ['extra.dar'] }, ['extra.dar']);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].label, 'extra.dar');

    const missing = withMockExit(() =>
      resolveAdditionalDarEntries({ additionalDars: ['nope.dar'] }, undefined)
    );
    assert.equal(missing.exitCode, 1);
  } finally {
    process.chdir(prev);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('resolveFullDarSet puts additional DARs before project DARs and honors excludePackages', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-set-'));
  const prev = process.cwd();
  try {
    writePkg(path.join(tmp, 'app'), 'my-app', '0.1.0');
    writePkg(path.join(tmp, 'tests'), 'my-tests', '0.1.0');
    fs.writeFileSync(path.join(tmp, 'multi-package.yaml'), 'packages:\n  - ./app\n  - ./tests\n');
    const extra = path.join(tmp, 'vendor.dar');
    fs.writeFileSync(extra, 'extra');
    process.chdir(tmp);

    const set = resolveFullDarSet(
      {
        additionalDars: [extra],
        includePackages: [],
        excludePackages: ['./tests'],
      },
      {}
    );
    assert.equal(set[0].label, 'vendor.dar');
    assert.deepEqual(
      set.slice(1).map((e) => e.label),
      ['my-app-0.1.0']
    );
  } finally {
    process.chdir(prev);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
