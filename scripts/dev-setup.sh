#!/bin/bash

# ZeroProof - Development Setup Script

set -e

echo "=================================="
echo "Development Environment Setup"
echo "=================================="
echo ""

# Check for Node.js
echo "Checking Node.js..."
if ! command -v node &> /dev/null; then
    echo "Node.js not found. Please install Node.js 20+ first."
    echo "  macOS: brew install node@20"
    echo "  Ubuntu: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo "Node.js version 20+ required. Current: $(node -v)"
    exit 1
fi
echo "Node.js $(node -v) - OK"

# Check for pnpm
echo "Checking pnpm..."
if ! command -v pnpm &> /dev/null; then
    echo "Installing pnpm..."
    npm install -g pnpm
fi
echo "pnpm $(pnpm -v) - OK"

# Check for Docker
echo "Checking Docker..."
if ! command -v docker &> /dev/null; then
    echo "Docker not found. Please install Docker first."
    exit 1
fi
echo "Docker - OK"

# Create .env files if they don't exist
if [ ! -f .env ]; then
    echo ""
    echo "Creating root .env file..."
    cp .env.example .env
    echo "Root .env file created. Edit it with your local settings."
fi

if [ ! -f backend/.env ]; then
    echo ""
    echo "Creating backend/.env file..."
    cp .env.example backend/.env
    echo "backend/.env file created. Edit it with your local settings."
fi

# Generate Mosquitto password file if it does not exist.
# The committed repo only includes a placeholder so real/default hashes are not published.
echo ""
echo "Checking MQTT password file..."
MQTT_USERNAME_VALUE="auditor"
MQTT_PASSWORD_VALUE="mqtt_password"
if [ -f .env ]; then
    # shellcheck disable=SC1091
    set -a
    source .env
    set +a
    MQTT_USERNAME_VALUE="${MQTT_USERNAME:-auditor}"
    MQTT_PASSWORD_VALUE="${MQTT_PASSWORD:-mqtt_password}"
fi
mkdir -p mosquitto/config
if [ ! -f mosquitto/config/passwd ]; then
    docker run --rm -v "$(pwd)/mosquitto/config:/mosquitto/config" eclipse-mosquitto:2 \
        mosquitto_passwd -b -c /mosquitto/config/passwd "$MQTT_USERNAME_VALUE" "$MQTT_PASSWORD_VALUE"
    chmod 600 mosquitto/config/passwd 2>/dev/null || true
    echo "MQTT password file generated."
else
    echo "MQTT password file already exists."
fi

# Start development services
echo ""
echo "Starting development services (PostgreSQL, MQTT, Redis)..."
docker compose -f docker-compose.dev.yml up -d

# Wait for PostgreSQL to be ready
echo "Waiting for PostgreSQL..."
sleep 5

# Install backend dependencies
echo ""
echo "Installing backend dependencies..."
cd backend
pnpm install

# Generate Prisma client
echo "Generating Prisma client..."
pnpm prisma generate

# Run database migrations
echo "Running database migrations..."
pnpm prisma migrate dev --name init 2>/dev/null || pnpm prisma migrate deploy

cd ..

# Install frontend dependencies
echo ""
echo "Installing frontend dependencies..."
cd frontend
pnpm install

cd ..

echo ""
echo "=================================="
echo "Development Setup Complete!"
echo "=================================="
echo ""
echo "To start development servers:"
echo ""
echo "  Terminal 1 (Backend):"
echo "    cd backend && pnpm dev"
echo ""
echo "  Terminal 2 (Frontend):"
echo "    cd frontend && pnpm dev"
echo ""
echo "Access:"
echo "  Frontend: http://localhost:5173"
echo "  Backend API: http://localhost:3000"
echo "  Database: localhost:5432"
echo "  MQTT: localhost:1883"
echo ""
echo "Default credentials: admin / (see DEFAULT_ADMIN_PASSWORD in .env)"
echo ""
