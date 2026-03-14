param(
    [string]$WebsiteDir = "website"
)

$repoRoot = Split-Path -Parent $PSScriptRoot
$targetDir = Join-Path $repoRoot $WebsiteDir

if (-not (Test-Path $targetDir)) {
    throw "Website directory not found: $targetDir"
}

# Ensure common Node and npm-global paths are available in this process.
$commonPaths = @(
    "C:\Program Files\nodejs",
    (Join-Path $env:APPDATA "npm")
)

foreach ($pathEntry in $commonPaths) {
    if (Test-Path $pathEntry) {
        if (-not ($env:Path -split ';' | Where-Object { $_ -eq $pathEntry })) {
            $env:Path = "$pathEntry;$env:Path"
        }
    }
}

$wranglerCmd = Get-Command wrangler -ErrorAction SilentlyContinue
if (-not $wranglerCmd) {
    throw "Wrangler was not found on PATH. Install with: npm install -g wrangler"
}

Write-Host "Starting Cloudflare Pages preview for $targetDir"
Write-Host "Press Ctrl+C to stop."

Push-Location $repoRoot
try {
    & wrangler pages dev $WebsiteDir
}
finally {
    Pop-Location
}
