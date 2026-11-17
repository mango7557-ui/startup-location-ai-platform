'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { backupDatabases } = require('./operations.cjs');
const root = __dirname;
const runtime = path.join(root, '.runtime');
const linkFile = path.join(root, 'PUBLIC-LINK.txt');
const settings = JSON.parse(fs.readFileSync(path.join(root, 'deployment.json'), 'utf8'));
if (fs.existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
Object.assign(process.env, {
  NODE_ENV: 'production', TRUST_PROXY: 'loopback', HOST: '127.0.0.1', PORT: String(settings.port),
  ACCOUNTS_DB: path.join(runtime, 'accounts.sqlite'), CARD_SALES_DB: path.join(runtime, 'card_sales.sqlite')
});
let pinnedDomain = false;
try {
  const base = new URL(process.env.PUBLIC_BASE_URL || '');
  pinnedDomain = base.protocol === 'https:' && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(base.hostname) && !base.hostname.endsWith('.trycloudflare.com');
} catch { }
if (!pinnedDomain) process.env.PUBLIC_BASE_URL = '';
let stopping = false;
let tunnel, retryTimer, backupTimer, backupActive;
const server = require('./server/index.js');
const log = message => console.log(`${new Date().toISOString()} ${message}`);
function writeLink(url, state) {
  fs.writeFileSync(linkFile, `${url || 'Temporary HTTPS link is not ready.'}\r\n\r\n${state}\r\nThis is a temporary sharing URL, not a fixed production domain.\r\nThe URL changes after tunnel/server restart. No uptime guarantee.\r\nUpdated: ${new Date().toISOString()}\r\n`);
}
function startTunnel() {
  if (stopping || settings.quickTunnel === false) return;
  writeLink('', 'Connecting to temporary sharing service.');
  const home = path.join(runtime, 'tunnel');
  fs.mkdirSync(home, { recursive: true });
  const child = spawn(path.join(root, 'service/cloudflared.exe'), ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--metrics', '127.0.0.1:0', '--url', `http://127.0.0.1:${settings.port}`], {
    cwd: home, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home }
  });
  tunnel = child;
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  let tail = '', published = '', connected = false;
  function output(data) {
    const message = data.toString();
    process.stderr.write(message);
    tail = (tail + message).slice(-8192);
    const match = tail.match(/https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com\b/);
    if (match && published !== match[0]) {
      published = match[0];
      if (!pinnedDomain) process.env.PUBLIC_BASE_URL = published;
      writeLink(published, 'Temporary URL allocated. Tunnel connection is still being established.');
      log(`Temporary sharing URL: ${published}`);
    }
    if (published && !connected && tail.includes('Registered tunnel connection')) {
      connected = true;
      writeLink(published, 'Cloudflare tunnel connection registered. This temporary URL has no uptime guarantee.');
    }
  }
  child.stdout.on('data', output); child.stderr.on('data', output);
  child.on('error', error => log(`Tunnel could not start (${error.code || 'UNKNOWN'}).`));
  child.once('close', code => {
    if (stopping) return;
    writeLink('', 'Temporary sharing disconnected; reconnecting in 15 seconds.');
    log(`Tunnel exited (${code}); retrying.`);
    retryTimer = setTimeout(startTunnel, 15000);
  });
}
async function dailyBackup() {
  if (backupActive || stopping) return;
  const marker = path.join(runtime, 'last-backup.json');
  let last = 0;
  try { last = Date.parse(JSON.parse(fs.readFileSync(marker, 'utf8')).completedAt) || 0; } catch { }
  if (Date.now() - last < 24 * 60 * 60 * 1000) return;
  backupActive = backupDatabases(root, path.join(runtime, 'backups'), { keep: 14 });
  try {
    const output = await backupActive;
    if (output) {
      fs.writeFileSync(marker, JSON.stringify({ completedAt: new Date().toISOString(), directory: path.basename(output) }));
      log('Daily SQLite backup completed and integrity checked.');
    }
  } catch (error) { log(`Daily backup failed (${error.code || 'VALIDATION_OR_IO_ERROR'}); will retry in one hour.`); }
  finally { backupActive = null; }
}
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  clearTimeout(retryTimer); clearInterval(backupTimer);
  writeLink('', 'Service is stopped. Start the Windows service to create a new temporary URL.');
  if (tunnel && tunnel.exitCode === null) tunnel.kill();
  server.close(async () => {
    if (backupActive) await backupActive.catch(() => {});
    process.exit(code);
  });
  server.closeIdleConnections?.();
  setTimeout(() => process.exit(code), 25000).unref();
}
server.on('error', error => { log(`HTTP server failed (${error.code || 'UNKNOWN'}).`); shutdown(1); });
server.listen(settings.port, '127.0.0.1', () => {
  log(`Windows service ready on 127.0.0.1:${settings.port}.`);
  startTunnel();
  void dailyBackup();
  backupTimer = setInterval(dailyBackup, 60 * 60 * 1000);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => shutdown());
process.on('uncaughtException', error => { log(`Service exception (${error.code || 'UNEXPECTED'}).`); shutdown(1); });
process.on('unhandledRejection', () => { log('Service promise rejected unexpectedly.'); shutdown(1); });
