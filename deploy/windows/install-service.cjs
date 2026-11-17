'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { stamp, digest, inside, verifyPackage, appEntries, copyFile, captureFiles, restoreFiles, backupDatabases } = require('./operations.cjs');
const SERVICE = 'StartupLocationPlatform';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const escapeXml = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

function serviceXml(root) {
  const base = escapeXml(root);
  return `<service>
  <id>${SERVICE}</id>
  <name>Startup Location Platform</name>
  <description>Location analysis site, daily SQLite backups, and temporary HTTPS sharing.</description>
  <executable>${base}\\runtime\\node.exe</executable>
  <arguments>"${base}\\service-worker.cjs"</arguments>
  <workingdirectory>${base}</workingdirectory>
  <serviceaccount><domain>NT SERVICE</domain><user>${SERVICE}</user></serviceaccount>
  <startmode>Automatic</startmode>
  <delayedAutoStart>true</delayedAutoStart>
  <stoptimeout>30 sec</stoptimeout>
  <stopparentprocessfirst>true</stopparentprocessfirst>
  <onfailure action="restart" delay="10 sec"/>
  <onfailure action="restart" delay="30 sec"/>
  <onfailure action="restart" delay="60 sec"/>
  <resetfailure>1 hour</resetfailure>
  <logpath>${base}\\.runtime\\logs</logpath>
  <log mode="roll-by-size"><sizeThreshold>10240</sizeThreshold><keepFiles>8</keepFiles></log>
</service>\r\n`;
}
function noLinks(full) {
  let current = path.resolve(full);
  while (current !== path.dirname(current)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('Installation paths must not contain junctions or symbolic links.');
    current = path.dirname(current);
  }
}
function commandMatches(command, exe, script) {
  const tokens = String(command || '').match(/"[^"]*"|[^\s]+/g)?.map(token => token.replace(/^"|"$/g, '')) || [];
  return tokens.length === 2 && tokens[0].toLowerCase() === exe.toLowerCase() && tokens[1].toLowerCase() === script.toLowerCase();
}
function verifyLegacy(root, record, processes) {
  if (!record || record.server?.toLowerCase() !== path.join(root, 'server/index.js').toLowerCase()) throw new Error('Existing process ownership cannot be verified.');
  const expected = [[record.supervisorPid, 'run.cjs'], [record.serverPid, 'server/index.js']];
  const matches = [];
  for (const [pid, script] of expected) {
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid recorded process ID.');
    const process = processes.find(item => item.ProcessId === pid);
    if (!process) continue;
    const exe = path.join(root, 'runtime/node.exe');
    if (process.ExecutablePath?.toLowerCase() !== exe.toLowerCase() || !commandMatches(process.CommandLine, exe, path.join(root, script))) {
      throw new Error('Recorded process ID belongs to another command. Nothing was stopped.');
    }
    matches.push(process);
  }
  return matches;
}
function powershell(script, input = {}) {
  const prelude = "$ErrorActionPreference='Stop'; [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); $p = $env:STARTUP_LOCATION_INPUT | ConvertFrom-Json; ";
  const encoded = Buffer.from(prelude + script, 'utf16le').toString('base64');
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    encoding: 'utf8', windowsHide: true, env: { ...process.env, STARTUP_LOCATION_INPUT: JSON.stringify(input) }, maxBuffer: 2 * 1024 * 1024
  });
  if (result.error || result.status !== 0) throw new Error('Windows configuration check failed. No credentials were printed. Run INSTALL-SERVICE.cmd as administrator.');
  const output = result.stdout.replace(/^\uFEFF/, '').trim();
  return output ? JSON.parse(output) : null;
}
function executable(file, args) {
  const result = spawnSync(file, args, { encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`${path.basename(file)} ${args[0]} failed (exit ${result.status}).`);
}
function windowsHost(root, port) {
  const wrapper = path.join(root, 'service/platform-service.exe');
  const query = () => powershell(`$s = Get-CimInstance Win32_Service -Filter "Name='${SERVICE}'"; if ($s) { $s | Select-Object Name,State,PathName,ProcessId,StartName | ConvertTo-Json -Compress } else { 'null' }`);
  async function waitFor(state) {
    for (let n = 0; n < 45; n++) {
      const current = query();
      if (state === 'absent' ? !current : current?.State === state) return;
      await pause(1000);
    }
    throw new Error(`Service did not reach ${state}.`);
  }
  return {
    async inspect() {
      const isAdmin = powershell("([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) | ConvertTo-Json");
      if (!isAdmin) throw new Error('Right-click INSTALL-SERVICE.cmd and choose Run as administrator.');
      powershell("$v = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\NET Framework Setup\\NDP\\v4\\Full').Release; if ($v -lt 394254) { throw '.NET Framework 4.6.1 or newer is required.' }; 'true'");
      const service = query();
      if (service && (service.PathName.replace(/^"|"$/g, '').toLowerCase() !== wrapper.toLowerCase() || service.StartName.toLowerCase() !== `nt service\\${SERVICE.toLowerCase()}`)) throw new Error('Another service uses this name or account. Nothing was changed.');
      let record = null;
      try { record = JSON.parse(fs.readFileSync(path.join(root, '.runtime/process.json'), 'utf8')); } catch { }
      const processes = powershell('Get-CimInstance Win32_Process | Select-Object ProcessId,ExecutablePath,CommandLine,@{n="CreationDate";e={$_.CreationDate.ToUniversalTime().ToString("o")}} | ConvertTo-Json -Compress') || [];
      const legacy = !service || service.State !== 'Running' ? (record ? verifyLegacy(root, record, processes) : []) : [];
      const listeners = powershell('@(Get-NetTCPConnection -State Listen -LocalPort $p.port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique) | ConvertTo-Json -Compress', { port });
      const owners = listeners == null ? [] : Array.isArray(listeners) ? listeners : [listeners];
      for (const owner of owners) {
        const worker = processes.find(item => item.ProcessId === owner);
        const isService = service?.State === 'Running' && worker?.ExecutablePath?.toLowerCase() === path.join(root, 'runtime/node.exe').toLowerCase() && commandMatches(worker.CommandLine, path.join(root, 'runtime/node.exe'), path.join(root, 'service-worker.cjs'));
        if (!isService && !legacy.some(item => item.ProcessId === owner)) throw new Error('The site port belongs to an unverified process. Nothing was stopped.');
      }
      return { service, legacy, wasRunning: owners.length > 0 };
    },
    async stopPrevious(state) {
      if (state.service?.State === 'Running') { executable('sc.exe', ['stop', SERVICE]); await waitFor('Stopped'); }
      // Check the executable, entire command, and creation time again immediately before termination.
      for (const item of state.legacy) powershell('$q = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $p.ProcessId); if ($q) { if ($q.ExecutablePath -cne $p.ExecutablePath -or $q.CommandLine -cne $p.CommandLine -or $q.CreationDate.ToUniversalTime().ToString("o") -cne $p.CreationDate) { throw "Process identity changed" }; Stop-Process -Id $q.ProcessId -ErrorAction Stop }; "true"', item);
      await pause(500);
    },
    async configure(state) {
      // WinSW also registers its own Event Log source while elevated, which the
      // least-privilege service account cannot create during its first startup.
      if (!state.service) executable(wrapper, ['install']);
      else executable('sc.exe', ['config', SERVICE, 'start=', 'delayed-auto']);
      executable('sc.exe', ['failure', SERVICE, 'reset=', '3600', 'actions=', 'restart/10000/restart/30000/restart/60000']);
      executable('sc.exe', ['failureflag', SERVICE, '1']);
      // Limit changes to this application's own files. No firewall, IIS, or other service changes.
      powershell(`$owner = [Security.Principal.WindowsIdentity]::GetCurrent().User;
function Protect-AppPath($file, $directory, $access) {
  if ($directory) { $acl = New-Object Security.AccessControl.DirectorySecurity; $inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' }
  else { $acl = New-Object Security.AccessControl.FileSecurity; $inherit = [Security.AccessControl.InheritanceFlags]::None }
  $acl.SetAccessRuleProtection($true,$false);
  foreach ($sid in @('S-1-5-18','S-1-5-32-544',$owner.Value)) {
    $identity = New-Object Security.Principal.SecurityIdentifier($sid);
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl',$inherit,'None','Allow')));
  }
  $account = New-Object Security.Principal.NTAccount('NT SERVICE', '${SERVICE}');
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($account,$access,$inherit,'None','Allow')));
  Set-Acl -LiteralPath $file -AclObject $acl;
}
Protect-AppPath $p.root $true 'ReadAndExecute';
Protect-AppPath (Join-Path $p.root '.runtime') $true 'Modify';
Protect-AppPath (Join-Path $p.root '.env') $false 'Read';
Protect-AppPath (Join-Path $p.root 'PUBLIC-LINK.txt') $false 'Modify';
'true'`, { root });
    },
    async start() { executable('sc.exe', ['start', SERVICE]); await waitFor('Running'); },
    async healthy() {
      for (let n = 0; n < 30; n++) {
        try {
          const result = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
          if (result.ok && (await result.json()).status === 'OK') return;
        } catch { }
        await pause(1000);
      }
      throw new Error('Service health check failed.');
    },
    async stopNew(state) {
      const current = query();
      if (!current) return;
      if (current.PathName.replace(/^"|"$/g, '').toLowerCase() !== wrapper.toLowerCase()) throw new Error('Cannot roll back a service with an unexpected executable.');
      if (current.State !== 'Stopped') { executable('sc.exe', ['stop', SERVICE]); await waitFor('Stopped'); }
      if (!state.service) { executable('sc.exe', ['delete', SERVICE]); await waitFor('absent'); }
    },
    async restartPrevious(state) {
      if (!state.wasRunning) return;
      if (state.service) { executable('sc.exe', ['start', SERVICE]); await waitFor('Running'); }
      else executable(path.join(root, 'runtime/node.exe'), [path.join(root, 'run.cjs'), '--detach']);
      await this.healthy();
    }
  };
}
async function upgradeUnlocked({ source, target, host }) {
  noLinks(source); noLinks(target);
  const manifest = verifyPackage(source);
  for (const file of ['.env', 'deployment.json', 'runtime/node.exe', 'server/index.js']) {
    noLinks(path.join(target, file));
    if (!fs.existsSync(path.join(target, file))) throw new Error('A complete existing installation is required. Run INSTALL.cmd first.');
  }
  for (const file of ['accounts.sqlite', 'card_sales.sqlite']) noLinks(path.join(target, '.runtime', file));
  const settings = JSON.parse(fs.readFileSync(path.join(target, 'deployment.json'), 'utf8'));
  if (!Number.isInteger(settings.port) || settings.port < 1024 || settings.port > 65535 || settings.host !== '127.0.0.1') throw new Error('Unrecognized existing deployment settings.');
  const copies = [
    ...appEntries(manifest),
    ...['service-worker.cjs', 'operations.cjs', 'runtime/node.exe'].map(file => ({ source: file, target: file })),
    { source: 'service/WinSW.exe', target: 'service/platform-service.exe' },
    { source: 'service/WinSW-LICENSE.txt', target: 'service/WinSW-LICENSE.txt' },
    { source: 'service/cloudflared-LICENSE.txt', target: 'service/cloudflared-LICENSE.txt' },
    { source: 'service/cloudflared.exe', target: 'service/cloudflared.exe' }
  ];
  for (const entry of copies) {
    if (entry.target === '.env' || entry.target.startsWith('.runtime/')) throw new Error('Package cannot overwrite persistent data or secrets.');
    noLinks(inside(target, entry.target));
  }
  noLinks(path.join(target, '.runtime'));
  const state = await host.inspect();
  const updateRoot = path.join(target, '.runtime/upgrades');
  noLinks(updateRoot);
  fs.mkdirSync(updateRoot, { recursive: true });
  const snapshot = path.join(updateRoot, stamp());
  const codeFiles = [...copies.map(entry => entry.target), 'deployment.json', 'service/platform-service.xml', 'PUBLIC-LINK.txt'];
  captureFiles(target, snapshot, codeFiles);
  await backupDatabases(target, path.join(snapshot, 'databases'), { label: 'upgrade' });
  let stopped = false;
  try {
    stopped = true;
    await host.stopPrevious(state);
    // Capture final committed transactions after the old process stops, including its WAL.
    await backupDatabases(target, path.join(snapshot, 'databases-final'), { label: 'upgrade' });
    for (const entry of copies) {
      const from = inside(source, entry.source), to = inside(target, entry.target);
      if (!fs.existsSync(to) || digest(from) !== digest(to)) copyFile(from, to);
    }
    fs.writeFileSync(path.join(target, 'service/platform-service.xml'), serviceXml(target));
    fs.writeFileSync(path.join(target, 'deployment.json'), JSON.stringify({ ...settings, host: '127.0.0.1', quickTunnel: true, service: SERVICE }, null, 2));
    fs.writeFileSync(path.join(target, 'PUBLIC-LINK.txt'), 'Temporary HTTPS sharing will appear here after the service starts.\r\n');
    await host.configure(state);
    await host.start();
    await host.healthy();
    fs.writeFileSync(path.join(snapshot, 'SUCCESS.json'), JSON.stringify({ completedAt: new Date().toISOString(), service: SERVICE, preserved: ['.env', '.runtime/accounts.sqlite', '.runtime/card_sales.sqlite'] }));
    return { target, service: SERVICE, snapshot };
  } catch (error) {
    if (stopped) {
      try {
        await host.stopNew(state);
        restoreFiles(target, snapshot);
        await host.restartPrevious(state);
        throw new Error(`Service conversion failed; previous application restored. ${error.message}`);
      } catch (rollbackError) {
        if (rollbackError.message.startsWith('Service conversion failed; previous')) throw rollbackError;
        throw new Error(`Service conversion failed, and automatic recovery needs attention. Snapshot: ${snapshot}. ${rollbackError.message}`);
      }
    }
    throw error;
  }
}
async function upgrade(options) {
  const lock = path.join(options.target, '.runtime/service-upgrade.lock');
  noLinks(lock);
  let descriptor;
  try { descriptor = fs.openSync(lock, 'wx'); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Another installation holds .runtime/service-upgrade.lock. If an earlier installer crashed, confirm it has stopped before removing the stale lock.');
    throw error;
  }
  const token = randomUUID();
  try {
    fs.writeFileSync(descriptor, JSON.stringify({ token, pid: process.pid, startedAt: new Date().toISOString() }));
    return await upgradeUnlocked(options);
  } finally {
    fs.closeSync(descriptor);
    try { if (JSON.parse(fs.readFileSync(lock, 'utf8')).token === token) fs.unlinkSync(lock); } catch { }
  }
}
async function main() {
  if (process.platform !== 'win32' || Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Use bundled Windows Node.js 24.');
  const target = path.resolve(process.argv[2] || 'D:\\data\\startup-location-platform');
  const settings = JSON.parse(fs.readFileSync(path.join(target, 'deployment.json'), 'utf8'));
  const result = await upgrade({ source: __dirname, target, host: windowsHost(target, settings.port) });
  console.log(`Windows service installed and healthy: ${result.service}`);
  console.log('Automatic startup and failure recovery enabled. Existing accounts, data, and .env preserved.');
  console.log(`Temporary HTTPS sharing URL: ${path.join(target, 'PUBLIC-LINK.txt')}`);
  console.log('This URL changes after restart; it is not a fixed production domain.');
  console.log(`Upgrade backup: ${result.snapshot}`);
}
if (require.main === module) main().catch(error => { console.error('Installation stopped:', error.message); process.exitCode = 1; });
module.exports = { SERVICE, serviceXml, commandMatches, verifyLegacy, upgrade };
