@echo off
REM Batch script to export price logs from the Finance Arena backend
REM Usage: export-price-logs.bat [backend-url]

setlocal

set BACKEND_URL=%1
if "%BACKEND_URL%"=="" set BACKEND_URL=http://localhost:8080

echo Exporting price logs from %BACKEND_URL%...

REM Check if PowerShell is available
where powershell >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Error: PowerShell is not available.
    echo Please install PowerShell or use the .ps1 script directly.
    exit /b 1
)

REM Run the PowerShell script
powershell.exe -ExecutionPolicy Bypass -File "%~dp0export-price-logs.ps1" "%BACKEND_URL%"

endlocal

