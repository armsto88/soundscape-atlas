param(
    [int]$Port = 8787
)

$errors = 0

function Write-Pass($Message) {
    Write-Host "[PASS] $Message" -ForegroundColor Green
}

function Write-Fail($Message) {
    Write-Host "[FAIL] $Message" -ForegroundColor Red
}

function Write-Warn($Message) {
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

Write-Host "Checking frontend preview prerequisites..." -ForegroundColor Cyan

$pythonCmd = Get-Command py -ErrorAction SilentlyContinue
if (-not $pythonCmd) {
    $pythonCmd = Get-Command python -ErrorAction SilentlyContinue
}

if ($pythonCmd) {
    Write-Pass "Python found: $($pythonCmd.Name)"
}
else {
    Write-Fail "Python not found on PATH. Install Python 3 to use local static preview."
    $errors++
}

$wranglerCmd = Get-Command wrangler -ErrorAction SilentlyContinue
$wranglerFallback = Join-Path $env:APPDATA "npm\wrangler.cmd"
if ($wranglerCmd) {
    Write-Pass "Wrangler found: $($wranglerCmd.Name)"
}
elseif (Test-Path $wranglerFallback) {
    Write-Pass "Wrangler found at: $wranglerFallback"
}
else {
    Write-Warn "Wrangler not found. Install with: npm install -g wrangler"
}

$websiteDir = Join-Path (Split-Path -Parent $PSScriptRoot) "website"
if (Test-Path $websiteDir) {
    Write-Pass "Website directory exists: $websiteDir"
}
else {
    Write-Fail "Website directory missing: $websiteDir"
    $errors++
}

$portInUse = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
if ($portInUse) {
    Write-Warn "Port $Port is already in use. Local preview may fail to start."
}
else {
    Write-Pass "Port $Port is available"
}

if ($errors -gt 0) {
    Write-Host "\nPreflight check failed with $errors blocking issue(s)." -ForegroundColor Red
    exit 1
}

Write-Host "\nPreflight check complete. Blocking requirements look good." -ForegroundColor Green
exit 0
