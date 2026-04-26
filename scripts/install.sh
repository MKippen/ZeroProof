#!/bin/bash

# ZeroProof - Installation Script
# Supports: Raspberry Pi 4+, Ubuntu/Debian, macOS

set -e

echo "=================================="
echo "  ZeroProof Installer"
echo "  Network Security Validation"
echo "=================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${YELLOW}Note: Some operations may require sudo${NC}"
fi

# Detect OS
OS="unknown"
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
elif [ "$(uname)" == "Darwin" ]; then
    OS="macos"
fi

echo "Detected OS: $OS"
echo ""

# ---- Docker check ----
echo "Checking for Docker..."
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}Docker not found. Installing...${NC}"

    if [ "$OS" == "macos" ]; then
        echo "Please install Docker Desktop from https://docker.com/products/docker-desktop"
        exit 1
    else
        curl -fsSL https://get.docker.com | sh
        sudo usermod -aG docker "$USER"
        echo -e "${GREEN}Docker installed successfully${NC}"
        echo -e "${YELLOW}Please log out and back in for Docker group permissions${NC}"
    fi
else
    echo -e "${GREEN}Docker found${NC}"
fi

# ---- Docker daemon check ----
echo "Checking Docker daemon..."
if ! docker info &> /dev/null; then
    echo -e "${RED}Docker daemon is not running.${NC}"
    if [ "$OS" == "macos" ]; then
        echo "Please start Docker Desktop and try again."
    else
        echo "Try: sudo systemctl start docker"
    fi
    exit 1
fi
echo -e "${GREEN}Docker daemon is running${NC}"

# ---- Docker Compose check ----
echo "Checking for Docker Compose..."
COMPOSE_CMD=""
if docker compose version &> /dev/null; then
    COMPOSE_CMD="docker compose"
elif command -v docker-compose &> /dev/null; then
    COMPOSE_CMD="docker-compose"
else
    echo -e "${YELLOW}Docker Compose not found.${NC}"
    if [ "$OS" == "macos" ]; then
        echo "Please update Docker Desktop to a version that includes Docker Compose."
        exit 1
    else
        echo -e "${YELLOW}Installing Docker Compose plugin...${NC}"
        sudo apt-get update && sudo apt-get install -y docker-compose-plugin
        COMPOSE_CMD="docker compose"
    fi
fi
echo -e "${GREEN}Docker Compose found${NC}"

# ---- Port conflict check ----
echo ""
echo "Checking for port conflicts..."
PORT_CONFLICT=false
for PORT in 80 443; do
    if command -v lsof &> /dev/null; then
        if lsof -i :"$PORT" -sTCP:LISTEN &> /dev/null; then
            echo -e "${YELLOW}Warning: Port $PORT is already in use${NC}"
            PORT_CONFLICT=true
        fi
    elif command -v ss &> /dev/null; then
        if ss -tlnp | grep -q ":$PORT "; then
            echo -e "${YELLOW}Warning: Port $PORT is already in use${NC}"
            PORT_CONFLICT=true
        fi
    fi
done
if [ "$PORT_CONFLICT" = true ]; then
    echo -e "${YELLOW}Port conflicts detected. ZeroProof uses ports 80 and 443.${NC}"
    echo -e "${YELLOW}Stop the conflicting service or adjust the docker-compose.yml ports.${NC}"
    read -rp "Continue anyway? [y/N] " CONTINUE
    if [[ ! "$CONTINUE" =~ ^[Yy]$ ]]; then
        exit 1
    fi
else
    echo -e "${GREEN}No port conflicts${NC}"
fi

# ---- .env file (idempotent) ----
echo ""
if [ -f .env ]; then
    echo -e "${YELLOW}.env file already exists.${NC}"
    read -rp "Overwrite with new credentials? [y/N] " OVERWRITE
    if [[ ! "$OVERWRITE" =~ ^[Yy]$ ]]; then
        echo "Keeping existing .env file."
    else
        echo "Generating new credentials..."
        GENERATE_ENV=true
    fi
else
    GENERATE_ENV=true
fi

if [ "${GENERATE_ENV:-false}" = true ]; then
    echo "Generating secure credentials..."

    POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 32)
    MQTT_PASSWORD=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 32)
    SESSION_SECRET=$(openssl rand -base64 48 | tr -dc 'a-zA-Z0-9' | head -c 48)
    ENCRYPTION_KEY=$(openssl rand -base64 48 | tr -dc 'a-zA-Z0-9' | head -c 32)
    DEFAULT_ADMIN_PASSWORD=$(openssl rand -base64 16 | tr -dc 'a-zA-Z0-9' | head -c 16)

    cat > .env << EOF
# Generated on $(date)
# ZeroProof Configuration

# Database
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_DB=zeroproof

# MQTT
MQTT_USERNAME=auditor
MQTT_PASSWORD=$MQTT_PASSWORD

# Backend
NODE_ENV=production
SESSION_SECRET=$SESSION_SECRET
ENCRYPTION_KEY=$ENCRYPTION_KEY
DEFAULT_ADMIN_PASSWORD=$DEFAULT_ADMIN_PASSWORD
EOF

    echo -e "${GREEN}Created .env file with secure credentials${NC}"
fi

# Source .env for MQTT password setup
# shellcheck disable=SC1091
source .env

# ---- SSL certificates ----
echo ""
if [ -f nginx/ssl/server.crt ] && [ -f nginx/ssl/server.key ]; then
    echo -e "${GREEN}SSL certificate already exists, skipping generation${NC}"
else
    echo "Generating self-signed SSL certificate..."
    mkdir -p nginx/ssl

    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout nginx/ssl/server.key \
        -out nginx/ssl/server.crt \
        -subj "/CN=zeroproof/O=ZeroProof/C=US" \
        2>/dev/null

    echo -e "${GREEN}SSL certificate generated${NC}"
fi

# ---- MQTT password file ----
echo ""
echo "Configuring MQTT authentication..."
if ! docker run --rm -v "$(pwd)/mosquitto/config:/mosquitto/config" eclipse-mosquitto:2 \
    mosquitto_passwd -b -c /mosquitto/config/passwd auditor "$MQTT_PASSWORD" 2>/dev/null; then
    echo -e "${YELLOW}Warning: MQTT password setup failed. MQTT auth may not work.${NC}"
    echo "You can retry manually: docker run --rm -v \"\$(pwd)/mosquitto/config:/mosquitto/config\" eclipse-mosquitto:2 mosquitto_passwd -b -c /mosquitto/config/passwd auditor \"<password>\""
else
    chmod 600 mosquitto/config/passwd 2>/dev/null || true
    echo -e "${GREEN}MQTT configured${NC}"
fi

# ---- Build and start services ----
echo ""
echo "Building and starting services..."
$COMPOSE_CMD build
$COMPOSE_CMD up -d

# ---- Health check loop (replaces sleep 10) ----
echo ""
echo "Waiting for services to become healthy..."
TIMEOUT=60
ELAPSED=0
HEALTHY=false

while [ $ELAPSED -lt $TIMEOUT ]; do
    if $COMPOSE_CMD ps --format json 2>/dev/null | grep -q '"running"' || \
       $COMPOSE_CMD ps 2>/dev/null | grep -q "running"; then
        # Try hitting the health endpoint
        if curl -sk https://localhost/health &> /dev/null || \
           curl -sk http://localhost:3000/health &> /dev/null; then
            HEALTHY=true
            break
        fi
    fi
    sleep 3
    ELAPSED=$((ELAPSED + 3))
    echo -n "."
done
echo ""

if [ "$HEALTHY" = true ]; then
    echo -e "${GREEN}Services started successfully!${NC}"
else
    echo -e "${YELLOW}Services may still be starting. Check status with: $COMPOSE_CMD ps${NC}"
    echo -e "${YELLOW}Check logs with: $COMPOSE_CMD logs${NC}"
fi

# ---- Summary ----
if [ "$OS" == "macos" ]; then
    LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || echo "localhost")
else
    LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")
fi

echo ""
echo "=================================="
echo -e "${GREEN}Installation Complete!${NC}"
echo "=================================="
echo ""
echo "Access the dashboard at:"
echo -e "  ${GREEN}https://$LOCAL_IP${NC}"
echo ""
if [ "${GENERATE_ENV:-false}" = true ]; then
    echo "Default credentials:"
    echo "  Username: admin"
    echo "  Password: $DEFAULT_ADMIN_PASSWORD"
    echo ""
fi
echo -e "${YELLOW}IMPORTANT: Change the default password after first login!${NC}"
echo ""
echo "Useful commands:"
echo "  View logs:    $COMPOSE_CMD logs -f"
echo "  Stop:         $COMPOSE_CMD down"
echo "  Restart:      $COMPOSE_CMD restart"
echo ""
