'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { DatabaseSync, backup } = require('node:sqlite');
const DATABASES = ['accounts.sqlite', 'card_sales.sqlite'];
const stamp = () => new Date().toISOString().replace(/[-:.]/g, '');
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function inside(root, relative) {
  if (!relative || path.isAbsolute(relative)) throw new Error('Invalid relative package path.');
  const full = path.resolve(root, relative);
  if (!full.toLowerCase().startsWith(path.resolve(root).toLowerCase() + path.sep)) throw new Error('Path escapes its directory.');
  return full;
}
function regular(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Not a regular file: ${path.basename(file)}`);
}
function verifyPackage(source) {
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
  if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Empty package manifest.');
  const names = new Set();
  for (const entry of manifest.files) {
    if (names.has(entry.path.toLowerCase())) throw new Error('Duplicate manifest path.');
    names.add(entry.path.toLowerCase());
    const file = inside(source, entry.path);
    regular(file);
    if (digest(file) !== entry.sha256) throw new Error(`Package checksum failed: ${entry.path}`);
  }
  for (const required of ['app/server/index.js', 'runtime/node.exe', 'install-service.cjs', 'service-worker.cjs', 'operations.cjs', 'service/WinSW.exe', 'service/cloudflared.exe', 'service/WinSW-LICENSE.txt', 'service/cloudflared-LICENSE.txt']) {
    if (!names.has(required.toLowerCase())) throw new Error(`Missing package file: ${required}`);
  }
  return manifest;
}
function appEntries(manifest) {
  return manifest.files.filter(entry => entry.path.startsWith('app/')).map(entry => ({ source: entry.path, target: entry.path.slice(4) }));
}
function copyFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}
function captureFiles(root, backupDir, relativeFiles) {
  fs.mkdirSync(backupDir, { recursive: false });
  const records = [...new Set(relativeFiles)].map(relative => {
    const original = inside(root, relative);
    const exists = fs.existsSync(original);
    if (exists) { regular(original); copyFile(original, inside(backupDir, relative)); }
    return { path: relative, existed: exists, sha256: exists ? digest(original) : null };
  });
  fs.writeFileSync(path.join(backupDir, 'files.json'), JSON.stringify(records, null, 2), { flag: 'wx' });
  return records;
}
function restoreFiles(root, backupDir) {
  const records = JSON.parse(fs.readFileSync(path.join(backupDir, 'files.json'), 'utf8'));
  for (const record of records) {
    const target = inside(root, record.path);
    if (record.existed) {
      const original = inside(backupDir, record.path);
      if (digest(original) !== record.sha256) throw new Error('Rollback checksum failed.');
      copyFile(original, target);
    } else if (fs.existsSync(target)) {
      regular(target);
      fs.unlinkSync(target);
    }
  }
}
async function backupDatabases(root, destinationRoot, { label = 'daily', keep = 14, now = stamp() } = {}) {
  if (!/^[a-z]+$/.test(label) || !/^\d{8}T\d{9}Z$/.test(now)) throw new Error('Invalid backup name.');
  fs.mkdirSync(destinationRoot, { recursive: true });
  const name = `${label}-${now}`;
  const partial = inside(destinationRoot, `${name}.partial`);
  const complete = inside(destinationRoot, name);
  fs.mkdirSync(partial, { recursive: false });
  const files = [];
  for (const filename of DATABASES) {
    const source = path.join(root, '.runtime', filename);
    if (!fs.existsSync(source)) continue;
    const db = new DatabaseSync(source, { readOnly: true });
    const output = path.join(partial, filename);
    try { db.exec('PRAGMA busy_timeout=5000'); await backup(db, output); } finally { db.close(); }
    // The destination is an offline snapshot. Convert it to a self-contained file;
    // opening a copied WAL database read-only can otherwise leave WAL/SHM sidecars.
    const check = new DatabaseSync(output);
    try {
      check.exec('PRAGMA journal_mode=DELETE');
      if (Object.values(check.prepare('PRAGMA quick_check').get())[0] !== 'ok') throw new Error(`Backup validation failed: ${filename}`);
    } finally { check.close(); }
    files.push({ path: filename, sha256: digest(output), bytes: fs.statSync(output).size });
  }
  if (!files.length) { fs.rmdirSync(partial); return null; }
  fs.writeFileSync(path.join(partial, 'backup.json'), JSON.stringify({ format: 'startup-location-sqlite-backup-v1', createdAt: new Date().toISOString(), files }, null, 2));
  fs.renameSync(partial, complete);
  // Only complete backups produced by this program are eligible for retention cleanup.
  const backups = fs.readdirSync(destinationRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && new RegExp(`^${label}-\\d{8}T\\d{9}Z$`).test(entry.name))
    .map(entry => entry.name).sort().reverse();
  for (const old of backups.slice(keep)) {
    const directory = inside(destinationRoot, old);
    const marker = path.join(directory, 'backup.json');
    if (!fs.existsSync(marker)) continue;
    const metadata = JSON.parse(fs.readFileSync(marker, 'utf8'));
    const allowed = new Set(['backup.json', ...DATABASES]);
    if (metadata.format !== 'startup-location-sqlite-backup-v1' || !Array.isArray(metadata.files) || fs.readdirSync(directory).some(file => !allowed.has(file))) continue;
    const originals = fs.readdirSync(directory).map(file => inside(directory, file));
    for (const full of originals) regular(full);
    if (!metadata.files.every(file => DATABASES.includes(file.path) && fs.existsSync(inside(directory, file.path)) && digest(inside(directory, file.path)) === file.sha256)) continue;
    for (const full of originals) fs.unlinkSync(full);
    fs.rmdirSync(directory);
  }
  return complete;
}
module.exports = { DATABASES, stamp, digest, inside, verifyPackage, appEntries, copyFile, captureFiles, restoreFiles, backupDatabases };
