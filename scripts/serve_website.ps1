param(
    [int]$Port = 8787,
    [string]$WebsiteDir = "website",
    [string]$BindAddress = "0.0.0.0"
)

$repoRoot = Split-Path -Parent $PSScriptRoot
$targetDir = Join-Path $repoRoot $WebsiteDir

if (-not (Test-Path $targetDir)) {
    throw "Website directory not found: $targetDir"
}

Write-Host "Serving $targetDir at http://localhost:$Port"
Write-Host "LAN access (same Wi-Fi): http://<your-local-ip>:$Port"
Write-Host "Press Ctrl+C to stop."

Push-Location $targetDir
try {
    if (Get-Command py -ErrorAction SilentlyContinue) {
        py -3 -m http.server $Port --bind $BindAddress
    }
    elseif (Get-Command python -ErrorAction SilentlyContinue) {
        python -m http.server $Port --bind $BindAddress
    }
    else {
        throw "Python is not available on PATH."
    }
}
finally {
    Pop-Location
}
