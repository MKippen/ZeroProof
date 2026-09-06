# ZeroProof - Windows Development Setup Script
# Run this script in PowerShell (not as Administrator)

$ErrorActionPreference = "Stop"
$projectRoot = Join-Path $PSScriptRoot ".."
Set-Location $projectRoot

Write-Host "==================================" -ForegroundColor Cyan
Write-Host "Development Environment Setup" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""

# Check for Node.js
Write-Host "Checking Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = node -v 2>$null
    if (-not $nodeVersion) {
        throw "Node.js not found"
    }
    $majorVersion = [int]($nodeVersion -replace 'v(\d+)\..*', '$1')
    if ($majorVersion -ne 24) {
        Write-Host "Node.js 24 LTS required. Current: $nodeVersion" -ForegroundColor Red
        Write-Host "Download from: https://nodejs.org/" -ForegroundColor Yellow
        exit 1
    }
    Write-Host "Node.js $nodeVersion - OK" -ForegroundColor Green
}
catch {
    Write-Host "Node.js not found. Please install Node.js 24 LTS first." -ForegroundColor Red
    Write-Host "  Download: https://nodejs.org/" -ForegroundColor Yellow
    Write-Host "  Or use: winget install OpenJS.NodeJS.LTS" -ForegroundColor Yellow
    exit 1
}

# Use the repository's pinned package manager, matching CI and Docker.
Write-Host "Checking pnpm..." -ForegroundColor Yellow
$packageManager = (Get-Content (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json).packageManager
$expectedPnpmVersion = $packageManager -replace '^pnpm@', ''
$pnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $pnpmCommand -or (pnpm -v) -ne $expectedPnpmVersion) {
    Write-Host "Installing $packageManager..." -ForegroundColor Yellow
    npm install --global $packageManager
    if ($LASTEXITCODE -ne 0) { throw "Failed to install $packageManager" }
}
Write-Host "pnpm $(pnpm -v) - OK" -ForegroundColor Green

# Check for Docker
Write-Host "Checking Docker..." -ForegroundColor Yellow
try {
    $dockerVersion = docker --version 2>$null
    if (-not $dockerVersion) {
        throw "Docker not found"
    }
    Write-Host "Docker - OK" -ForegroundColor Green
}
catch {
    Write-Host "Docker not found. Please install Docker Desktop first." -ForegroundColor Red
    Write-Host "  Download: https://www.docker.com/products/docker-desktop/" -ForegroundColor Yellow
    Write-Host "  Make sure Docker Desktop is running and WSL 2 integration is enabled." -ForegroundColor Yellow
    exit 1
}

# Check if Docker daemon is running
Write-Host "Checking Docker daemon..." -ForegroundColor Yellow
try {
    docker info 2>$null | Out-Null
    Write-Host "Docker daemon - OK" -ForegroundColor Green
}
catch {
    Write-Host "Docker daemon is not running. Please start Docker Desktop." -ForegroundColor Red
    exit 1
}

# Create .env files if they don't exist
$projectRoot = Join-Path $PSScriptRoot ".."
$rootEnvFile = Join-Path $projectRoot ".env"
$backendEnvFile = Join-Path $projectRoot "backend" ".env"
$envExampleFile = Join-Path $projectRoot ".env.example"

if (-not (Test-Path $envExampleFile)) {
    Write-Host "Warning: .env.example not found. You'll need to create .env files manually." -ForegroundColor Yellow
}
else {
    if (-not (Test-Path $rootEnvFile)) {
        Write-Host ""
        Write-Host "Creating root .env file..." -ForegroundColor Yellow
        Copy-Item $envExampleFile $rootEnvFile
        Write-Host "Root .env file created. Edit it with your local settings." -ForegroundColor Green
    }
    if (-not (Test-Path $backendEnvFile)) {
        Write-Host ""
        Write-Host "Creating backend/.env file..." -ForegroundColor Yellow
        Copy-Item $envExampleFile $backendEnvFile
        Write-Host "backend/.env file created. Edit it with your local settings." -ForegroundColor Green
    }
}

# Generate Mosquitto password file if it does not exist.
# The committed repo only includes a placeholder so real/default hashes are not published.
Write-Host ""
Write-Host "Checking MQTT password file..." -ForegroundColor Yellow
$mqttUsername = "auditor"
$mqttPassword = "mqtt_password"
if (Test-Path $rootEnvFile) {
    Get-Content $rootEnvFile | ForEach-Object {
        if ($_ -match '^\s*MQTT_USERNAME=(.*)$') {
            $mqttUsername = $Matches[1].Trim()
        }
        if ($_ -match '^\s*MQTT_PASSWORD=(.*)$') {
            $mqttPassword = $Matches[1].Trim()
        }
    }
}
$mosquittoConfigDir = Join-Path $projectRoot "mosquitto\config"
$passwdFile = Join-Path $mosquittoConfigDir "passwd"
if (-not (Test-Path $mosquittoConfigDir)) {
    New-Item -ItemType Directory -Path $mosquittoConfigDir | Out-Null
}
if (-not (Test-Path $passwdFile)) {
    docker run --rm -v "${mosquittoConfigDir}:/mosquitto/config" eclipse-mosquitto:2 mosquitto_passwd -b -c /mosquitto/config/passwd $mqttUsername $mqttPassword
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to generate MQTT password file" -ForegroundColor Red
        exit 1
    }
    Write-Host "MQTT password file generated." -ForegroundColor Green
}
else {
    Write-Host "MQTT password file already exists." -ForegroundColor Green
}

# Fetch released ESP32 firmware so the web flasher works without PlatformIO.
Write-Host ""
if ($env:SKIP_FIRMWARE_DOWNLOAD -eq "true") {
    Write-Host "Skipping ESP32 firmware download because SKIP_FIRMWARE_DOWNLOAD=true" -ForegroundColor Yellow
}
elseif (Get-Command bash -ErrorAction SilentlyContinue) {
    Write-Host "Fetching ESP32 firmware release..." -ForegroundColor Yellow
    $downloadScript = Join-Path $projectRoot "scripts\download-firmware.sh"
    & bash $downloadScript
    if ($LASTEXITCODE -eq 0) {
        Write-Host "ESP32 firmware ready." -ForegroundColor Green
    }
    else {
        Write-Host "Warning: ESP32 firmware download failed." -ForegroundColor Yellow
        Write-Host "The app will still start, but browser flashing stays disabled until firmware is installed." -ForegroundColor Yellow
        Write-Host "Retry after setup with: bash scripts/download-firmware.sh" -ForegroundColor Yellow
    }
}
else {
    Write-Host "Warning: bash was not found, so ESP32 firmware was not downloaded." -ForegroundColor Yellow
    Write-Host "Install Git Bash or WSL, then run: bash scripts/download-firmware.sh" -ForegroundColor Yellow
}

# Start development services
Write-Host ""
Write-Host "Starting development services (PostgreSQL, MQTT, Redis)..." -ForegroundColor Yellow
Push-Location $projectRoot
try {
    docker compose -f docker-compose.dev.yml up -d --wait --wait-timeout 90 postgres mosquitto redis
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to start Docker services"
    }
}
catch {
    Write-Host "Failed to start Docker services. Make sure docker-compose.dev.yml exists." -ForegroundColor Red
    Pop-Location
    exit 1
}

# Resolve once at the workspace root and build the backend's local library.
Write-Host "Installing workspace dependencies..." -ForegroundColor Yellow
pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw "Failed to install workspace dependencies" }
pnpm --filter @uguard/unifi-client build
if ($LASTEXITCODE -ne 0) { throw "Failed to build workspace library" }

Write-Host "Generating Prisma client..." -ForegroundColor Yellow
pnpm --dir backend prisma generate
if ($LASTEXITCODE -ne 0) { throw "Failed to generate Prisma client" }

Write-Host "Applying committed database migrations..." -ForegroundColor Yellow
pnpm --dir backend prisma migrate deploy
if ($LASTEXITCODE -ne 0) { throw "Database migration failed" }

Pop-Location

Write-Host ""
Write-Host "==================================" -ForegroundColor Cyan
Write-Host "Development Setup Complete!" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "To start development servers:" -ForegroundColor White
Write-Host ""
Write-Host "  PowerShell Window 1 (Backend):" -ForegroundColor Yellow
Write-Host "    cd backend; pnpm dev" -ForegroundColor White
Write-Host ""
Write-Host "  PowerShell Window 2 (Frontend):" -ForegroundColor Yellow
Write-Host "    cd frontend; pnpm dev" -ForegroundColor White
Write-Host ""
Write-Host "Access:" -ForegroundColor Yellow
Write-Host "  Frontend:    http://localhost:5173" -ForegroundColor White
Write-Host "  Backend API: http://localhost:3000" -ForegroundColor White
Write-Host "  Database:    localhost:5432" -ForegroundColor White
Write-Host "  MQTT:        localhost:1883" -ForegroundColor White
Write-Host ""
Write-Host "Admin password: see DEFAULT_ADMIN_PASSWORD in .env, or complete first-run setup" -ForegroundColor Yellow
Write-Host ""
