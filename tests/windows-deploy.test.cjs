'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { spawn } = require('node:child_process');
const net = require('node:net');
const { digest, backupDatabases, inside } = require('../deploy/windows/operations.cjs');
const { upgrade, verifyLegacy, commandMatches, serviceXml } = require('../deploy/windows/install-service.cjs');
const scratch = fs.mkdtempSync(path.join(__dirname, '../.runtime/windows-service-test-'));
test.after(() => {
  const resolved = path.resolve(scratch), expected = path.resolve(__dirname, '../.runtime') + path.sep;
  assert(resolved.startsWith(expected));
  fs.rmSync(resolved, { recursive: true, force: true });
});
function write(root, name, data) { const file = inside(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); }
function fixture(name) {
  const base = path.join(scratch, name), source = path.join(base, 'package'), target = path.join(base, 'installed');
  const packageFiles = {
    'app/server/index.js': 'new application', 'app/public/index.html': 'new page',
    'runtime/node.exe': 'mock runtime', 'service-worker.cjs': 'mock worker', 'operations.cjs': 'mock operations',
    'service/WinSW.exe': 'mock wrapper', 'service/cloudflared.exe': 'mock tunnel',
    'service/WinSW-LICENSE.txt': 'MIT', 'service/cloudflared-LICENSE.txt': 'Apache-2.0',
    'private/server.env': 'DO_NOT_IMPORT=secret', 'private/data/accounts.sqlite': 'DO_NOT_IMPORT',
    'install-service.cjs': 'installer bytes'
  };
  for (const [file, data] of Object.entries(packageFiles)) write(source, file, data);
  write(source, 'manifest.json', JSON.stringify({ files: Object.keys(packageFiles).map(file => ({ path: file, sha256: digest(path.join(source, file)) })) }));
  write(target, '.env', 'KEEP=existing_secret');
  write(target, 'deployment.json', JSON.stringify({ host: '127.0.0.1', port: 3219 }));
  write(target, 'runtime/node.exe', 'mock runtime');
  write(target, 'server/index.js', 'old application');
  fs.mkdirSync(path.join(target, '.runtime'));
  const db = new DatabaseSync(path.join(target, '.runtime/accounts.sqlite'));
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT); INSERT INTO users(name) VALUES('preserve me')");
  return { source, target, db };
}
function host({ fail = false, onHealthy = () => {} } = {}) {
  const calls = [];
  return {
    calls,
    async inspect() { calls.push('inspect'); return { wasRunning: true, service: null, legacy: [] }; },
    async stopPrevious() { calls.push('stopPrevious'); },
    async configure() { calls.push('configure'); },
    async start() { calls.push('start'); },
    async healthy() { calls.push('healthy'); onHealthy(); if (fail) throw new Error('Injected startup failure'); },
    async stopNew() { calls.push('stopNew'); },
    async restartPrevious() { calls.push('restartPrevious'); }
  };
}
test('upgrade preserves existing private configuration and committed WAL records', async () => {
  const f = fixture('success'), controller = host();
  try {
    const result = await upgrade({ ...f, host: controller });
    assert.equal(fs.readFileSync(path.join(f.target, '.env'), 'utf8'), 'KEEP=existing_secret');
    assert.equal(f.db.prepare('SELECT name FROM users').get().name, 'preserve me');
    assert.equal(fs.readFileSync(path.join(f.target, 'server/index.js'), 'utf8'), 'new application');
    const backups = fs.readdirSync(path.join(result.snapshot, 'databases-final'));
    const backupDb = new DatabaseSync(path.join(result.snapshot, 'databases-final', backups[0], 'accounts.sqlite'), { readOnly: true });
    try { assert.equal(backupDb.prepare('SELECT name FROM users').get().name, 'preserve me'); } finally { backupDb.close(); }
    assert.deepEqual(controller.calls, ['inspect', 'stopPrevious', 'configure', 'start', 'healthy']);
  } finally { f.db.close(); }
});
test('failed service startup restores code and previous startup without reverting newer data', async () => {
  const f = fixture('rollback');
  const controller = host({ fail: true, onHealthy: () => f.db.exec("INSERT INTO users(name) VALUES('new data survives')") });
  try {
    await assert.rejects(upgrade({ ...f, host: controller }), /previous application restored/);
    assert.equal(fs.readFileSync(path.join(f.target, 'server/index.js'), 'utf8'), 'old application');
    assert.equal(fs.readFileSync(path.join(f.target, '.env'), 'utf8'), 'KEEP=existing_secret');
    assert.equal(f.db.prepare('SELECT count(*) AS count FROM users').get().count, 2);
    assert.equal(fs.existsSync(path.join(f.target, 'service-worker.cjs')), false);
    assert.deepEqual(controller.calls.slice(-2), ['stopNew', 'restartPrevious']);
  } finally { f.db.close(); }
});
test('tampered installer is refused before stopping or changing any application', async () => {
  const f = fixture('tamper'), controller = host();
  try {
    write(f.source, 'install-service.cjs', 'changed after manifest creation');
    await assert.rejects(upgrade({ ...f, host: controller }), /checksum failed/);
    assert.deepEqual(controller.calls, []);
    assert.equal(fs.readFileSync(path.join(f.target, 'server/index.js'), 'utf8'), 'old application');
  } finally { f.db.close(); }
});
test('concurrent installers are refused without disturbing the existing lock or application', async () => {
  const f = fixture('locked'), controller = host();
  try {
    write(f.target, '.runtime/service-upgrade.lock', 'another installer owns this lock');
    await assert.rejects(upgrade({ ...f, host: controller }), /Another installation holds/);
    assert.deepEqual(controller.calls, []);
    assert.equal(fs.readFileSync(path.join(f.target, '.runtime/service-upgrade.lock'), 'utf8'), 'another installer owns this lock');
  } finally { f.db.close(); }
});
test('PID ownership requires exact executable and full command, not a path substring', () => {
  const root = path.join(scratch, 'ownership'), exe = path.join(root, 'runtime/node.exe'), server = path.join(root, 'server/index.js');
  const record = { supervisorPid: 100, serverPid: 101, server };
  assert(commandMatches(`"${exe}" "${server}"`, exe, server));
  assert(!commandMatches(`"${exe}" "${server}" --other`, exe, server));
  assert.throws(() => verifyLegacy(root, record, [{ ProcessId: 101, ExecutablePath: exe, CommandLine: `"${exe}" "${server}.other"` }]), /another command/);
  assert.equal(verifyLegacy(root, record, [{ ProcessId: 101, ExecutablePath: exe, CommandLine: `"${exe}" "${server}"` }]).length, 1);
});
test('backup retention only removes validated generated names and preserves unrelated directories', async () => {
  const f = fixture('retention'), directory = path.join(f.target, '.runtime/backups');
  try {
    for (const day of ['01', '02', '03']) await backupDatabases(f.target, directory, { keep: 2, now: `202611${day}T120000000Z` });
    write(directory, 'important-user-folder/note.txt', 'keep');
    write(directory, 'daily-20261001T120000000Z/unknown.txt', 'keep');
    await backupDatabases(f.target, directory, { keep: 2, now: '20261104T120000000Z' });
    assert(!fs.existsSync(path.join(directory, 'daily-20261102T120000000Z')));
    assert(fs.existsSync(path.join(directory, 'daily-20261104T120000000Z/backup.json')));
    assert(fs.existsSync(path.join(directory, 'important-user-folder/note.txt')));
    assert(fs.existsSync(path.join(directory, 'daily-20261001T120000000Z/unknown.txt')));
  } finally { f.db.close(); }
});
test('service definition escapes paths and bounds logs without privileged account defaults', () => {
  const xml = serviceXml('D:\\data\\A&B');
  assert(xml.includes('A&amp;B'));
  assert(xml.includes('<keepFiles>8</keepFiles>'));
  assert(xml.includes('<stoptimeout>30 sec</stoptimeout>'));
  assert(!xml.includes('LocalSystem'));
});
test('service worker serves on loopback with production settings and produces a verified daily backup', async () => {
  const f = fixture('worker');
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  write(f.target, 'deployment.json', JSON.stringify({ host: '127.0.0.1', port, quickTunnel: false }));
  for (const file of ['service-worker.cjs', 'operations.cjs']) fs.copyFileSync(path.join(__dirname, '../deploy/windows', file), path.join(f.target, file));
  write(f.target, 'server/index.js', `module.exports=require('node:http').createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:'OK',mode:process.env.NODE_ENV,proxy:process.env.TRUST_PROXY,host:process.env.HOST}));});`);
  const worker = spawn(process.execPath, [path.join(f.target, 'service-worker.cjs')], { cwd: f.target, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  worker.stdout.on('data', chunk => { output += chunk; }); worker.stderr.on('data', chunk => { output += chunk; });
  try {
    let result;
    for (let n = 0; n < 50; n++) {
      try { result = await (await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(300) })).json(); } catch (error) { if (n === 49) output += ` Request failure: ${error.message} ${error.cause?.code || ''}`; }
      if (result && fs.existsSync(path.join(f.target, '.runtime/last-backup.json'))) break;
      if (worker.exitCode !== null) assert.fail(`Worker exited: ${output}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.deepEqual(result, { status: 'OK', mode: 'production', proxy: 'loopback', host: '127.0.0.1' }, output);
    assert(fs.existsSync(path.join(f.target, '.runtime/last-backup.json')), output);
    const backup = JSON.parse(fs.readFileSync(path.join(f.target, '.runtime/last-backup.json'), 'utf8'));
    const copy = new DatabaseSync(path.join(f.target, '.runtime/backups', backup.directory, 'accounts.sqlite'), { readOnly: true });
    try { assert.equal(copy.prepare('SELECT name FROM users').get().name, 'preserve me'); } finally { copy.close(); }
  } finally {
    if (worker.exitCode === null) {
      const ended = new Promise(resolve => worker.once('exit', resolve));
      worker.kill(); await ended;
    }
    f.db.close();
  }
});
