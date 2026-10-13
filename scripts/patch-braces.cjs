// Local mitigation for GHSA-vfj7-8cjw-p6xm until an upstream release exists.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const edits = require('./braces-patch.json');
const root = path.resolve(__dirname, '..');
const guard = "module.exports = ast => { const pending = [[ast, 0]]; while (pending.length) { const [node, depth] = pending.pop(); if (depth >= 128) throw new SyntaxError('Brace nesting exceeds safe depth'); if (node && Array.isArray(node.nodes)) for (const child of node.nodes) pending.push([child, depth + 1]); } };\n";
const hash = source => crypto.createHash('sha256').update(source.replaceAll('\r\n', '\n')).digest('hex');
function installations() {
  const found = new Set();
  const visited = new Set();
  function scanModules(directory) {
    if (!fs.existsSync(directory)) return;
    const real = fs.realpathSync(directory);
    if (visited.has(real)) return;
    visited.add(real);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.name === '.pnpm') {
        for (const store of fs.readdirSync(target)) scanModules(path.join(target, store, 'node_modules'));
      } else if (entry.name.startsWith('@')) {
        for (const scoped of fs.readdirSync(target)) scanPackage(path.join(target, scoped));
      } else if (!entry.name.startsWith('.')) scanPackage(target);
    }
  }
  function scanPackage(directory) {
    const manifest = path.join(directory, 'package.json');
    if (!fs.existsSync(manifest)) return;
    const pkg = JSON.parse(fs.readFileSync(manifest));
    if (pkg.name === 'braces') {
      if (pkg.version !== '3.0.3') throw new Error('Review braces mitigation for version ' + pkg.version);
      found.add(fs.realpathSync(directory));
    }
    scanModules(path.join(directory, 'node_modules'));
  }
  for (const relative of ['node_modules', 'backend/node_modules', 'frontend/node_modules', 'packages/unifi-client/node_modules', 'updater/node_modules']) scanModules(path.join(root, relative));
  scanModules(path.join(process.cwd(), 'node_modules'));
  return [...found];
}
function check(directory, apply) {
  for (const edit of edits) {
    const target = path.join(directory, 'lib', edit.file);
    const source = fs.readFileSync(target, 'utf8').replaceAll('\r\n', '\n');
    if (hash(source) === edit.patched) continue;
    assert.equal(hash(source), edit.original, 'Unexpected braces source: ' + target);
    assert.ok(apply, 'Missing braces depth mitigation: ' + target);
    fs.writeFileSync(target, source.replaceAll(edit.from, edit.to));
  }
  const target = path.join(directory, 'lib', 'safe-depth.js');
  if (apply) fs.writeFileSync(target, guard);
  assert.equal(fs.readFileSync(target, 'utf8'), guard, 'Invalid AST depth guard');
  const braces = require(directory);
  assert.deepEqual(braces.expand('a/{b,c}/d'), ['a/b/d', 'a/c/d']);
  for (const method of ['parse', 'compile', 'expand', 'stringify']) {
    assert.throws(() => braces[method]('{'.repeat(4000) + 'x' + '}'.repeat(4000)), /safe depth/);
    assert.throws(() => braces[method]('('.repeat(4000) + 'x' + ')'.repeat(4000)), /safe depth/);
  }
  let ast = { type: 'text', value: 'x' };
  for (let i = 0; i < 10000; i++) ast = { type: 'brace', nodes: [ast] };
  for (const method of ['compile', 'expand', 'stringify']) assert.throws(() => braces[method](ast), /safe depth/);
}
function verify(apply = false) { const directories = installations(); for (const directory of directories) check(directory, apply); return directories.length; }
if (require.main === module) console.log('Verified braces depth mitigation in ' + verify(true) + ' installations');
module.exports = { verify };
