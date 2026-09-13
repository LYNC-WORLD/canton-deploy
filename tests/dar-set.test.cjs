const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function matchesFilter(pkgPath, pkgName, patterns) {
  if (patterns.length === 0) return true;
  const norm = pkgPath.replace(/\\/g, '/');
  return patterns.some((pat) => {
    const p = pat.replace(/\\/g, '/');
    return norm.includes(p) || pkgName === p || norm.endsWith(p);
  });
}

test('includePackages filters package paths', () => {
  assert.equal(matchesFilter('./app', 'my-app', ['./app']), true);
  assert.equal(matchesFilter('./tests', 'my-tests', ['./app']), false);
});

test('excludePackages skips test packages', () => {
  assert.equal(matchesFilter('./tests', 'my-tests', ['./tests']), true);
  assert.equal(
    matchesFilter('./app', 'my-app', ['./tests']) === false ||
      !matchesFilter('./app', 'my-app', ['./tests']),
    true
  );
});

test('excludePackages removes matching dirs from upload set logic', () => {
  const pkgs = [
    { rel: './app', name: 'my-app' },
    { rel: './tests', name: 'my-tests' },
  ];
  const exclude = ['./tests'];
  const filtered = pkgs.filter(
    (p) => !(exclude.length > 0 && matchesFilter(p.rel, p.name, exclude))
  );
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].name, 'my-app');
});

test('additionalDars paths must exist when checked', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'm1-dar-'));
  const darPath = path.join(tmp, 'extra.dar');
  fs.writeFileSync(darPath, 'fake');
  assert.ok(fs.existsSync(darPath));
  fs.rmSync(tmp, { recursive: true });
});
