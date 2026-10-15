@echo off
chcp 65001 >nul 2>&1
title Docker Desktop cleanup (run as Administrator)
echo ============================================================
echo   Docker Desktop + WSL installer leftovers cleanup
echo   Right-click this file - Run as administrator
echo ============================================================
echo.
echo [1/4] Stopping Docker processes and removing its service...
taskkill /F /IM "Docker Desktop.exe" /T >nul 2>&1
taskkill /F /IM "com.docker.backend.exe" /T >nul 2>&1
taskkill /F /IM "com.docker.build.exe" /T >nul 2>&1
taskkill /F /IM "com.docker.proxy.exe" /T >nul 2>&1
net stop com.docker.service /y >nul 2>&1
sc delete com.docker.service >nul 2>&1
echo       OK

echo [2/4] Deleting leftover folders...
rd /s /q "D:\Docker" >nul 2>&1
rd /s /q "C:\Program Files\Docker" >nul 2>&1
rd /s /q "C:\ProgramData\Docker" >nul 2>&1
rd /s /q "%LOCALAPPDATA%\Docker" >nul 2>&1
rd /s /q "%APPDATA%\Docker" >nul 2>&1
rd /s /q "%TEMP%\DockerDesktopInstallers" >nul 2>&1
echo       OK

echo [3/4] Removing Docker entries from PATH...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$u=[Environment]::GetEnvironmentVariable('Path','User'); if($u){$n=($u -split ';' | Where-Object { $_ -and $_ -notmatch 'Docker' }) -join ';'; [Environment]::SetEnvironmentVariable('Path',$n,'User')}; $m=[Environment]::GetEnvironmentVariable('Path','Machine'); if($m){$n2=($m -split ';' | Where-Object { $_ -and $_ -notmatch 'Docker' }) -join ';'; [Environment]::SetEnvironmentVariable('Path',$n2,'Machine')}; Write-Host '      OK'"

echo.
echo [4/4] Result check:
if exist "D:\Docker" (echo   D:\Docker              : STILL EXISTS) else (echo   D:\Docker              : removed)
if exist "C:\Program Files\Docker" (echo   C:\Program Files\Docker : STILL EXISTS) else (echo   C:\Program Files\Docker : removed)
sc query com.docker.service >nul 2>&1
if errorlevel 1 (echo   com.docker.service    : removed) else (echo   com.docker.service    : STILL EXISTS)
echo.
echo All done. This script file can be deleted manually.
pause
