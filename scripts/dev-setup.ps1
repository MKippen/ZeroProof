# ZeroProof - Windows Development Setup Script
# Run this script in PowerShell (not as Administrator)

$ErrorActionPreference = "Stop"

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
    if ($majorVersion -lt 20) {
        Write-Host "Node.js version 20+ required. Current: $nodeVersion" -ForegroundColor Red
        Write-Host "Download from: https://nodejs.org/" -ForegroundColor Yellow
        exit 1
    }
    Write-Host "Node.js $nodeVersion - OK" -ForegroundColor Green
}
catch {
    Write-Host "Node.js not found. Please install Node.js 20+ first." -ForegroundColor Red
    Write-Host "  Download: https://nodejs.org/" -ForegroundColor Yellow
    Write-Host "  Or use: winget install OpenJS.NodeJS.LTS" -ForegroundColor Yellow
    exit 1
}

# Check for pnpm
Write-Host "Checking pnpm..." -ForegroundColor Yellow
try {
    $pnpmVersion = pnpm -v 2>$null
    if (-not $pnpmVersion) {
        throw "pnpm not found"
    }
    Write-Host "pnpm $pnpmVersion - OK" -ForegroundColor Green
}
catch {
    Write-Host "Installing pnpm..." -ForegroundColor Yellow
    npm install -g pnpm
    $pnpmVersion = pnpm -v
    Write-Host "pnpm $pnpmVersion - OK" -ForegroundColor Green
}

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
    docker compose -f docker-compose.dev.yml up -d
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to start Docker services"
    }
}
catch {
    Write-Host "Failed to start Docker services. Make sure docker-compose.dev.yml exists." -ForegroundColor Red
    Pop-Location
    exit 1
}

# Wait for PostgreSQL to be ready
Write-Host "Waiting for PostgreSQL to be ready..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# Install backend dependencies
Write-Host ""
Write-Host "Installing backend dependencies..." -ForegroundColor Yellow
Set-Location (Join-Path $projectRoot "backend")
pnpm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to install backend dependencies" -ForegroundColor Red
    Pop-Location
    exit 1
}

# Generate Prisma client
Write-Host "Generating Prisma client..." -ForegroundColor Yellow
pnpm prisma generate
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to generate Prisma client" -ForegroundColor Red
    Pop-Location
    exit 1
}

# Run database migrations
Write-Host "Running database migrations..." -ForegroundColor Yellow
try {
    pnpm prisma migrate dev --name init 2>$null
}
catch {
    pnpm prisma migrate deploy
}

# Install frontend dependencies
Write-Host ""
Write-Host "Installing frontend dependencies..." -ForegroundColor Yellow
Set-Location (Join-Path $projectRoot "frontend")
pnpm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to install frontend dependencies" -ForegroundColor Red
    Pop-Location
    exit 1
}

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
Write-Host "Default credentials: admin / (see DEFAULT_ADMIN_PASSWORD in .env)" -ForegroundColor Yellow
Write-Host ""
