'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const source = __dirname;
const target = path.resolve(process.argv[2] || 'D:\\data\\startup-location-platform');
const port = Number(process.argv[3] || 3013);
async function assertPortFree() {
  await new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setTimeout(3000);
    socket.once('connect', () => { socket.destroy(); reject(new Error(`Port ${port} is already in use. No process was stopped.`)); });
    socket.once('timeout', () => { socket.destroy(); reject(new Error('Could not verify the port.')); });
    socket.once('error', err => err.code === 'ECONNREFUSED' ? resolve() : reject(err));
  });
}
async function main() {
  if (process.platform !== 'win32' || Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Use the bundled Windows Node.js 24 executable.');
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port must be 1024-65535.');
  if (target === path.parse(target).root) throw new Error('A drive root cannot be the installation directory.');
  if (fs.existsSync(target)) throw new Error(`Destination already exists: ${target}. Nothing was overwritten.`);
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
  for (const file of manifest.files) {
    const full = path.resolve(source, file.path);
    if (!full.toLowerCase().startsWith(source.toLowerCase() + path.sep)) throw new Error('Invalid package path.');
    if (createHash('sha256').update(fs.readFileSync(full)).digest('hex') !== file.sha256) throw new Error(`Package checksum failed: ${file.path}`);
  }
  if (!fs.existsSync(path.join(source, 'private/server.env'))) throw new Error('private/server.env is missing. Configure the server before installing.');
  await assertPortFree();
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(path.join(source, 'app'), target, { recursive: true, errorOnExist: true, force: false });
  fs.cpSync(path.join(source, 'runtime'), path.join(target, 'runtime'), { recursive: true, errorOnExist: true, force: false });
  for (const file of ['run.cjs', 'START.cmd']) fs.copyFileSync(path.join(source, file), path.join(target, file), fs.constants.COPYFILE_EXCL);
  fs.copyFileSync(path.join(source, 'private/server.env'), path.join(target, '.env'), fs.constants.COPYFILE_EXCL);
  fs.mkdirSync(path.join(target, '.runtime'), { recursive: true });
  if (fs.existsSync(path.join(source, 'private/data'))) fs.cpSync(path.join(source, 'private/data'), path.join(target, '.runtime'), { recursive: true, errorOnExist: true, force: false });
  fs.writeFileSync(path.join(target, 'deployment.json'), JSON.stringify({ host: '127.0.0.1', port }), { flag: 'wx' });
  const start = spawnSync(path.join(target, 'runtime/node.exe'), [path.join(target, 'run.cjs'), '--detach'], { cwd: target, stdio: 'inherit', windowsHide: true });
  if (start.status !== 0) throw new Error('Files installed, but startup failed. Check .runtime/logs.');
  let healthy = false;
  for (let n = 0; n < 15; n++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok && (await r.json()).status === 'OK') { healthy = true; break; }
    } catch { }
  }
  if (!healthy) throw new Error('Files installed, but health check failed. Check .runtime/logs.');
  console.log(`Installed and responding: http://localhost:${port}`);
  console.log(`Directory: ${target}`);
  console.log('No existing site, firewall, IIS, execution policy, or system settings were changed.');
  console.log('Runs in this user session. RDP disconnect keeps it running; signing out or rebooting stops it.');
}
main().catch(err => { console.error('Installation stopped:', err.message); process.exitCode = 1; });
