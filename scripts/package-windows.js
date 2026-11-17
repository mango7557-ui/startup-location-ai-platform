'use strict';
// A strict allowlist prevents personal folders or development artifacts from being shipped.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { DatabaseSync, backup } = require('node:sqlite');
const ROOT = path.resolve(__dirname, '..');
const args = new Set(process.argv.slice(2));
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
const out = path.join(ROOT, 'dist', 'windows', `startup-location-install-${stamp}`);
const appFiles = [
  'package.json', '.env.example',
  'public/index.html', 'public/app.js', 'public/styles.css', 'public/workspace.js',
  'server/index.js', 'server/data/publicDatasetStore.js', 'server/data/koreaRegionsFull.js',
  'server/services/accounts.js', 'server/services/cardSalesService.js', 'server/services/externalApiConnectors.js'
];
const vendorFiles = [
  { source: '.runtime/winsw/WinSW.NET461.exe', target: 'service/WinSW.exe', sha256: 'b5066b7bbdfba1293e5d15cda3caaea88fbeab35bd5b38c41c913d492aadfc4f', url: 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW.NET461.exe' },
  { source: '.runtime/cloudflared.exe', target: 'service/cloudflared.exe', sha256: '341deda3db5ec498a0482254d6c38c0b7cf01a30c37bb5dd95d2216d08955e35', url: 'https://github.com/cloudflare/cloudflared/releases' }
];
function copy(from, relative) {
  const target = path.join(out, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(from, target, fs.constants.COPYFILE_EXCL);
}
async function main() {
  if (process.platform !== 'win32' || Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Build this package with Windows Node.js 24.');
  for (const vendor of vendorFiles) {
    if (createHash('sha256').update(fs.readFileSync(path.join(ROOT, vendor.source))).digest('hex') !== vendor.sha256) throw new Error(`Vendor checksum failed: ${vendor.target}`);
  }
  fs.mkdirSync(out, { recursive: false });
  for (const file of appFiles) copy(path.join(ROOT, file), path.join('app', file));
  for (const file of ['install.cjs', 'run.cjs', 'INSTALL.cmd', 'START.cmd', 'README.txt', 'install-service.cjs', 'service-worker.cjs', 'operations.cjs', 'INSTALL-SERVICE.cmd']) copy(path.join(ROOT, 'deploy/windows', file), file);
  for (const vendor of vendorFiles) copy(path.join(ROOT, vendor.source), vendor.target);
  copy(path.join(ROOT, '.runtime/winsw/LICENSE.txt'), 'service/WinSW-LICENSE.txt');
  copy(path.join(ROOT, '.runtime/cloudflared-LICENSE.txt'), 'service/cloudflared-LICENSE.txt');
  copy(process.execPath, 'runtime/node.exe');
  if (args.has('--include-config')) copy(path.join(ROOT, '.env'), 'private/server.env');
  if (args.has('--include-data')) {
    fs.mkdirSync(path.join(out, 'private/data'), { recursive: true });
    for (const name of ['accounts.sqlite', 'card_sales.sqlite']) {
      const source = path.join(ROOT, '.runtime', name);
      if (!fs.existsSync(source)) continue;
      const db = new DatabaseSync(source, { readOnly: true });
      try { await backup(db, path.join(out, 'private/data', name)); } finally { db.close(); }
    }
  }
  const files = [];
  function walk(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) walk(full);
      else files.push({ path: path.relative(out, full).replaceAll('\\', '/'), sha256: createHash('sha256').update(fs.readFileSync(full)).digest('hex') });
    }
  }
  walk(out);
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ node: process.version, vendors: vendorFiles.map(({ target, sha256, url }) => ({ path: target, sha256, url })), files }, null, 2));
  console.log(JSON.stringify({ package: out, files: files.length, privateConfig: args.has('--include-config'), databaseBackup: args.has('--include-data') }));
}
fs.mkdirSync(path.dirname(out), { recursive: true });
main().catch(err => { console.error('Packaging failed:', err.message); process.exitCode = 1; });
