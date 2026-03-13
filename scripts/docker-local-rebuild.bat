@echo off
setlocal

cd /d "%~dp0.."

echo Building pocker-local:dev...
docker build -t pocker-local:dev .
if errorlevel 1 exit /b 1

echo Recreating container pocker-local...
docker rm -f pocker-local >nul 2>&1
docker run -d --name pocker-local -p 3000:3000 pocker-local:dev
if errorlevel 1 exit /b 1

echo Container is running on http://localhost:3000
