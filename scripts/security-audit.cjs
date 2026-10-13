// Preserve the high-severity audit gate. Only accept the exact locally patched advisory.
const fs = require('node:fs');
const { verify } = require('./patch-braces.cjs');
const { spawnSync } = require('node:child_process');
const cli = process.env.npm_execpath;
if (!cli) throw new Error('Run this audit through the package manager script');
const result = spawnSync(process.execPath, [cli, 'audit', '--json'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
if (result.error || result.signal || ![0, 1].includes(result.status)) throw new Error('Dependency audit failed: ' + result.stderr);
const report = JSON.parse(result.stdout);
if (report.error || (!report.advisories && !report.vulnerabilities)) throw new Error('Invalid or failed dependency audit');
const installed = verify();
const mitigated = advisory => installed > 0 && advisory.url === 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm';
const severe = severity => ['high', 'critical'].includes(severity);
let failures;
if (report.advisories) failures = Object.values(report.advisories).filter(a => severe(a.severity) && !mitigated(a));
else {
  // npm repeats advisories through string references to affected dependents.
  // Evaluate the actual advisory objects, without treating dependency cycles
  // as new vulnerabilities or masking any additional direct advisory.
  const advisories = Object.values(report.vulnerabilities).flatMap(value => value.via.filter(via => typeof via === 'object'));
  if (!advisories.length && Object.values(report.vulnerabilities).some(value => severe(value.severity))) throw new Error('Audit lacks source advisories');
  failures = advisories.filter(advisory => severe(advisory.severity) && !mitigated(advisory));
}
if (failures.length) { console.error(JSON.stringify(failures, null, 2)); process.exit(1); }
console.log('Dependency audit passed; verified local braces mitigation. All other high/critical advisories remain blocking.');
