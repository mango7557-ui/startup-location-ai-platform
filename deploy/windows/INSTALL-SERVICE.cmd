@echo off
setlocal
set "INSTALL_RESULT=%~dp0INSTALL-RESULT.txt"
>>"%INSTALL_RESULT%" echo ==== Startup Location service installer %date% %time% ====
if errorlevel 1 goto result_unavailable
>>"%INSTALL_RESULT%" echo Package: "%~dp0"
>>"%INSTALL_RESULT%" echo Target: D:\data\startup-location-platform
>>"%INSTALL_RESULT%" echo Run this file as administrator on your server.
if not exist "%~dp0runtime\node.exe" goto runtime_missing
"%~dp0runtime\node.exe" "%~dp0install-service.cjs" >>"%INSTALL_RESULT%" 2>&1
set "INSTALL_EXIT=%ERRORLEVEL%"
goto finished
:runtime_missing
>>"%INSTALL_RESULT%" echo FAILED [launch-node]: runtime\node.exe is missing. Copy the entire package folder.
set "INSTALL_EXIT=1"
:finished
>>"%INSTALL_RESULT%" echo Exit code: %INSTALL_EXIT%
type "%INSTALL_RESULT%"
echo.
echo Result saved to "%INSTALL_RESULT%"
pause
exit /b %INSTALL_EXIT%
:result_unavailable
echo FAILED [create-result-file]: Cannot write INSTALL-RESULT.txt beside this installer.
echo Copy the entire package to a writable folder on the server and run as administrator.
pause
exit /b 1
