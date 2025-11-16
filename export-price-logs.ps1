# PowerShell script to export price logs from the Finance Arena backend
# Usage: .\export-price-logs.ps1 [backend-url]

param(
    [string]$BackendUrl = "http://localhost:8080"
)

Write-Host "Exporting price logs from $BackendUrl..." -ForegroundColor Cyan

try {
    $response = Invoke-RestMethod -Uri "$BackendUrl/api/price-logs/export" -Method Post -ContentType "application/json" -Body "{}"
    
    if ($response.ok) {
        Write-Host "✓ Price logs exported successfully!" -ForegroundColor Green
        Write-Host "  File path: $($response.filepath)" -ForegroundColor Yellow
        Write-Host "  Message: $($response.message)" -ForegroundColor Gray
        
        # Try to open the file location in Windows Explorer
        $filePath = $response.filepath
        if (Test-Path $filePath) {
            $directory = Split-Path -Parent $filePath
            Write-Host "`nOpening file location in Explorer..." -ForegroundColor Cyan
            Start-Process explorer.exe -ArgumentList "/select,`"$filePath`""
        } else {
            Write-Host "`nNote: File path reported as: $filePath" -ForegroundColor Yellow
            Write-Host "      (File may be on the server if running remotely)" -ForegroundColor Yellow
        }
    } else {
        Write-Host "✗ Export failed: $($response.error)" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "✗ Error exporting price logs:" -ForegroundColor Red
    Write-Host "  $($_.Exception.Message)" -ForegroundColor Red
    
    if ($_.Exception.Response) {
        $statusCode = $_.Exception.Response.StatusCode.value__
        Write-Host "  HTTP Status: $statusCode" -ForegroundColor Red
        
        if ($statusCode -eq 404) {
            Write-Host "`nTip: Make sure the backend server is running and the endpoint exists." -ForegroundColor Yellow
        } elseif ($statusCode -eq 500) {
            Write-Host "`nTip: Check the backend server logs for more details." -ForegroundColor Yellow
        }
    }
    
    Write-Host "`nMake sure:" -ForegroundColor Yellow
    Write-Host "  1. The backend server is running" -ForegroundColor Yellow
    Write-Host "  2. The URL is correct (currently: $BackendUrl)" -ForegroundColor Yellow
    Write-Host "  3. You have network access to the server" -ForegroundColor Yellow
    
    exit 1
}

