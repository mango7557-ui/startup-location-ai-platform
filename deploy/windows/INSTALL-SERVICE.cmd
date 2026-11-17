@echo off
echo Run this file as administrator on your server.
echo It upgrades only D:\data\startup-location-platform and preserves its settings and databases.
"%~dp0runtime\node.exe" "%~dp0install-service.cjs"
pause
