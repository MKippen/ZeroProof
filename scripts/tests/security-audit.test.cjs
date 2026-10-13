const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zeroproof-audit-'));
const cli = path.join(directory, 'audit.cjs');
const audit = path.resolve(__dirname, '..', 'security-audit.cjs');
const advisory = { severity: 'high', url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm' };
function run(report) {
  fs.writeFileSync(cli, 'console.log(' + JSON.stringify(JSON.stringify(report)) + '); process.exit(1);');
  return spawnSync(process.execPath, [audit], { env: { ...process.env, npm_execpath: cli }, encoding: 'utf8' });
}
test('accepts the verified braces patch in pnpm reports', () => {
  assert.equal(run({ advisories: { 1: advisory } }).status, 0);
});
test('accepts npm dependency cycles only when source advisories are mitigated', () => {
  assert.equal(run({ vulnerabilities: { braces: { severity: 'high', via: [advisory] }, jest: { severity: 'high', via: ['jest-config', 'braces'] }, 'jest-config': { severity: 'high', via: ['jest'] } } }).status, 0);
});
for (const severity of ['high', 'critical']) test('blocks unrelated ' + severity + ' advisories from either manager', () => {
  const other = { severity, url: 'https://github.com/advisories/GHSA-new-advisory' };
  assert.equal(run({ advisories: { 1: advisory, 2: other } }).status, 1);
  assert.equal(run({ vulnerabilities: { braces: { severity: 'high', via: [advisory, other] } } }).status, 1);
});
test('blocks failed or malformed audit responses', () => {
  assert.equal(run({ error: { message: 'registry unavailable' } }).status, 1);
  assert.equal(run({}).status, 1);
  assert.equal(run({ vulnerabilities: { missing: { severity: 'high', via: ['unknown'] } } }).status, 1);
});
test.after(() => {
  assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
  fs.rmSync(directory, { recursive: true, force: true });
});
