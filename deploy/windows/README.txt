Windows server installation and service upgrade

EXISTING SERVER: ONE USER ACTION
Copy this entire private package folder to your server through the authorized RDP session.
Right-click INSTALL-SERVICE.cmd and choose "Run as administrator".
Each run appends its result and exit code to INSTALL-RESULT.txt beside that CMD file.
If no service or PUBLIC-LINK.txt appears, open INSTALL-RESULT.txt in the package folder.
It identifies checks such as administrator, .NET, process identity, port ownership,
service registration, permissions, and HTTP health. API keys, configuration contents,
raw PowerShell/SC output, and process command lines are not recorded.
Default installation: D:\data\startup-location-platform
This upgrades only that application. Existing .env, members, sales records, and database
files are preserved. Private configuration/data from the package are NOT imported during
a service upgrade. No IIS, firewall, other Windows service, or network security rule changes.

The installer checks every file in manifest.json before changing the app, takes code and
online SQLite backups, and stops only processes whose executable, complete command line,
and creation time match this installation. Unrelated ports/processes/services cause refusal.
It installs the dedicated StartupLocationPlatform Windows service and verifies /api/health.
If conversion fails, it attempts to restore the previous code and running application.
An upgrade never restores an older database over current data automatically.
An exclusive .runtime\service-upgrade.lock prevents concurrent upgrades. If an installer
crashes, verify no installer is running before manually removing its stale lock.

SERVICE AND SHARING
Windows service: StartupLocationPlatform (Services app / services.msc)
Account: NT SERVICE\StartupLocationPlatform, a dedicated passwordless virtual account.
Automatic delayed startup after boot; recovery waits 10, 30, then 60 seconds on failures.
Application is bound to 127.0.0.1:3013 with NODE_ENV=production and TRUST_PROXY=loopback.
Only this application's folder permissions are restricted: executable/config read access,
write access to .runtime and PUBLIC-LINK.txt; administrators and installing user retain access.

The service starts a Cloudflare Quick Tunnel for temporary HTTPS sharing.
Open D:\data\startup-location-platform\PUBLIC-LINK.txt to find the latest URL.
Reconnect is automatic when the tunnel process exits. The URL changes when a new tunnel
is created after restart. This is NOT a fixed production URL and has no uptime guarantee.
Cloudflare documents Quick Tunnels as testing/development only, with 200 concurrent request
limit and no SSE. A fixed domain and named tunnel are separate future configuration.
Kakao login/JavaScript allowed domains must match the currently used HTTPS domain.
The same link file explicitly shows when sharing is stopped or reconnecting.

LOGS AND BACKUPS
Logs: D:\data\startup-location-platform\.runtime\logs
Service stdout/stderr: 10 MB per log segment, eight rotated files per stream.
Daily SQLite backups: .runtime\backups\daily-<UTC timestamp>\
Backup status: .runtime\last-backup.json
The service backs up on start if no successful backup exists in the last 24 hours, then
checks hourly. Each database uses SQLite's online backup API, includes committed WAL data,
and must pass PRAGMA quick_check. Keep the 14 newest completed daily backups.
accounts.sqlite and card_sales.sqlite are backed up independently, not as a cross-DB transaction.
Backups have SHA-256 manifests. Failed .partial directories are retained for inspection.
Before/after-stop upgrade snapshots: .runtime\upgrades\<UTC timestamp>\
Upgrade snapshots are retained, so check available disk space before later upgrades.
Local backups protect against application mistakes; copy them to another protected disk
or backup system for protection against server/disk loss. These files contain private data.

MANUAL RECOVERY (administrator, only after inspecting the failure)
1. Stop StartupLocationPlatform in the Windows Services application. Confirm it is stopped.
2. Keep a copy of the current .runtime, including SQLite -wal and -shm files. Never overwrite
   live databases. Select a completed backup with backup.json and validate its hashes.
3. To restore data deliberately, move current database/WAL/SHM files to a separate protected
   recovery folder first, then copy the selected accounts.sqlite and card_sales.sqlite to
   .runtime. Restoring old data discards changes made after that backup; choose consciously.
4. Start StartupLocationPlatform. Check the new PUBLIC-LINK.txt and site functionality.
5. Upgrade code snapshots contain files.json and hashes. Keep .env and .runtime unchanged
   when restoring code; if automatic code rollback reports failure, inspect the snapshot
   path printed by the installer before attempting another upgrade.

FRESH INSTALLATION
On an empty server, double-click INSTALL.cmd first. It refuses an existing destination and
busy port, installs the private configuration/data, and starts the initial user-session app.
Then run INSTALL-SERVICE.cmd as administrator for reboot-safe service operation.
START.cmd is only for the legacy user-session mode; use Windows Services after conversion.
Requirements: 64-bit Windows supported by Node.js 24, .NET Framework 4.6.1 or newer,
outbound HTTPS for API access and Cloudflare Tunnel. No npm/global setup is needed.

PRIVATE BUILD (source PC)
  node scripts/package-windows.js --include-config --include-data
Build output is ignored by Git under dist/windows. Only explicit --include-config and
--include-data flags include secrets/databases, under a separate private/ folder.
Do not upload the package, .env, SQLite databases, or backup folders to GitHub or a web root.
The manifest includes the installer files themselves. SHA-256 detects transfer corruption;
it is not a signature or substitute for trusting the source of this private package.
WinSW 2.12.0 and cloudflared binaries are pinned to verified hashes in the package builder.

Official references:
https://github.com/winsw/winsw/releases/tag/v2.12.0
https://github.com/winsw/winsw/blob/v2.12.0/doc/xmlConfigFile.md
https://github.com/winsw/winsw/blob/v2.12.0/doc/loggingAndErrorReporting.md
https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/
https://nodejs.org/docs/latest-v24.x/api/sqlite.html
https://learn.microsoft.com/windows-server/identity/ad-ds/manage/understand-service-accounts
