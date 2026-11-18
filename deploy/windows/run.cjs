'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const root = __dirname;
const settings = JSON.parse(fs.readFileSync(path.join(root, 'deployment.json'), 'utf8'));
const runtime = path.join(root, '.runtime');
const logDir = path.join(runtime, 'logs');
const node = path.join(root, 'runtime/node.exe');
const server = path.join(root, 'server/index.js');
async function main() {
  fs.mkdirSync(logDir, { recursive: true });
  if (process.argv.includes('--detach')) {
    await new Promise((resolve, reject) => {
      const socket = net.connect({ host: '127.0.0.1', port: settings.port });
      socket.setTimeout(3000);
      socket.once('connect', () => { socket.destroy(); reject(new Error('Server port is already in use.')); });
      socket.once('timeout', () => { socket.destroy(); reject(new Error('Port check timed out.')); });
      socket.once('error', err => err.code === 'ECONNREFUSED' ? resolve() : reject(err));
    });
    const out = fs.openSync(path.join(logDir, 'server.log'), 'a');
    const error = fs.openSync(path.join(logDir, 'server-error.log'), 'a');
    const background = spawn(node, [__filename], { cwd: root, detached: true, windowsHide: true, stdio: ['ignore', out, error] });
    background.unref();
    fs.closeSync(out); fs.closeSync(error);
    return;
  }
  let attempts = 0;
  let stopping = false;
  let child;
  function start() {
    child = spawn(node, [server], {
      cwd: root, windowsHide: true, stdio: 'inherit',
      env: { ...process.env, HOST: '127.0.0.1', PORT: String(settings.port), ACCOUNTS_DB: path.join(runtime, 'accounts.sqlite'), CARD_SALES_DB: path.join(runtime, 'card_sales.sqlite') }
    });
    fs.writeFileSync(path.join(runtime, 'process.json'), JSON.stringify({ supervisorPid: process.pid, serverPid: child.pid, server, port: settings.port }));
    child.once('error', err => { console.error('Server startup failed:', err.code || err.message); process.exitCode = 1; });
    child.once('exit', (code) => {
      if (stopping || code === 0) return;
      if (++attempts > 3) { console.error('Server restart limit reached.'); process.exitCode = 1; return; }
      setTimeout(start, 5000);
    });
  }
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; if (child && child.exitCode === null) child.kill(); });
  start();
}
main().catch(err => { console.error('Startup stopped:', err.message); process.exitCode = 1; });
