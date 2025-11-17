# PowerShell script to kill any process using port 8080
# Usage: .\kill-port.ps1 [port]
# Example: .\kill-port.ps1 8080

param(
    [int]$Port = 8080
)

Write-Host "Checking for processes using port $Port..." -ForegroundColor Yellow

# Find processes using the port
$connections = netstat -ano | findstr ":$Port"

if ($connections) {
    $pids = @()
    foreach ($line in $connections) {
        if ($line -match 'LISTENING\s+(\d+)$') {
            $pid = $matches[1]
            if ($pid -and $pid -ne '0') {
                $pids += $pid
            }
        }
    }
    
    $uniquePids = $pids | Select-Object -Unique
    
    if ($uniquePids.Count -gt 0) {
        Write-Host "Found processes using port $Port:" -ForegroundColor Red
        foreach ($pid in $uniquePids) {
            try {
                $process = Get-Process -Id $pid -ErrorAction SilentlyContinue
                if ($process) {
                    Write-Host "  PID $pid : $($process.ProcessName)" -ForegroundColor Red
                    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
                    Write-Host "  ✓ Killed PID $pid" -ForegroundColor Green
                }
            } catch {
                Write-Host "  ⚠ Could not kill PID $pid (may already be terminated)" -ForegroundColor Yellow
            }
        }
        Write-Host "`nPort $Port should now be free!" -ForegroundColor Green
    } else {
        Write-Host "No processes found using port $Port" -ForegroundColor Green
    }
} else {
    Write-Host "No processes found using port $Port" -ForegroundColor Green
}

Write-Host "`nWaiting 2 seconds for port to be released..." -ForegroundColor Yellow
Start-Sleep -Seconds 2

# Verify port is free
$stillInUse = netstat -ano | findstr ":$Port"
if ($stillInUse) {
    Write-Host "⚠ Warning: Port $Port may still be in use" -ForegroundColor Yellow
} else {
    Write-Host "✓ Port $Port is now free!" -ForegroundColor Green
}

