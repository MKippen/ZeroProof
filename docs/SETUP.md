# Development Setup Guide

Complete setup instructions for ZeroProof development on macOS and Windows.

## Prerequisites

### Required Software

| Software | Version | macOS Install | Windows Install |
|----------|---------|---------------|-----------------|
| Node.js | 20+ LTS | `brew install node@20` | [nodejs.org](https://nodejs.org/) |
| pnpm | 9+ | `npm install -g pnpm` | `npm install -g pnpm` |
| Docker Desktop | Latest | [docker.com](https://www.docker.com/products/docker-desktop/) | [docker.com](https://www.docker.com/products/docker-desktop/) |
| Git | Latest | `brew install git` | [git-scm.com](https://git-scm.com/) |
| VS Code | Latest | [code.visualstudio.com](https://code.visualstudio.com/) | [code.visualstudio.com](https://code.visualstudio.com/) |

### Optional (for ESP32 development)

| Software | Version | Install |
|----------|---------|---------|
| PlatformIO | Latest | VS Code Extension |
| Python | 3.11+ | Required for PlatformIO |

---

## macOS Setup

### Step 1: Install Homebrew (if not installed)

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### Step 2: Install Prerequisites

```bash
# Install Node.js 20
brew install node@20

# Add Node to PATH (add to ~/.zshrc or ~/.bashrc)
echo 'export PATH="/opt/homebrew/opt/node@20/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc

# Install pnpm
npm install -g pnpm

# Install Docker Desktop
brew install --cask docker

# Verify installations
node --version   # Should be 20.x
pnpm --version   # Should be 9.x
docker --version # Should show Docker version
```

### Step 3: Clone and Setup

```bash
# Clone the repository
git clone https://github.com/MKippen/ZeroProof.git
cd ZeroProof

# Run the setup script
./scripts/dev-setup.sh
```

### Step 4: Start Development Servers

**Terminal 1 - Backend:**
```bash
cd backend
pnpm dev
```

**Terminal 2 - Frontend:**
```bash
cd frontend
pnpm dev
```

Access the app at: http://localhost:5173

---

## Windows Setup

### Step 1: Install Prerequisites

#### Option A: Using winget (Windows 11 / Windows 10 with App Installer)

Open PowerShell as Administrator:

```powershell
# Install Node.js 20 LTS
winget install OpenJS.NodeJS.LTS

# Install Git
winget install Git.Git

# Install Docker Desktop
winget install Docker.DockerDesktop

# Install VS Code
winget install Microsoft.VisualStudioCode

# Restart PowerShell, then install pnpm
npm install -g pnpm
```

#### Option B: Manual Installation

1. **Node.js 20 LTS**: Download from [nodejs.org](https://nodejs.org/)
2. **Git**: Download from [git-scm.com](https://git-scm.com/)
3. **Docker Desktop**: Download from [docker.com](https://www.docker.com/products/docker-desktop/)
4. **VS Code**: Download from [code.visualstudio.com](https://code.visualstudio.com/)

After installing Node.js, open a new PowerShell window and run:
```powershell
npm install -g pnpm
```

### Step 2: Configure Docker Desktop

1. Open Docker Desktop
2. Go to Settings > Resources > WSL Integration
3. Enable integration with your default WSL 2 distro
4. Apply & Restart

### Step 3: Clone and Setup

Open PowerShell (regular user, not Administrator):

```powershell
# Clone the repository
git clone https://github.com/MKippen/ZeroProof.git
cd ZeroProof

# Run the setup script
.\scripts\dev-setup.ps1
```

If you get an execution policy error:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
.\scripts\dev-setup.ps1
```

### Step 4: Start Development Servers

**PowerShell Window 1 - Backend:**
```powershell
cd backend
pnpm dev
```

**PowerShell Window 2 - Frontend:**
```powershell
cd frontend
pnpm dev
```

Access the app at: http://localhost:5173

---

## Manual Setup (Both Platforms)

If the automated scripts don't work, follow these steps:

### 1. Start Docker Services

```bash
# Start PostgreSQL, MQTT broker, and Redis
docker run --rm -v "$(pwd)/mosquitto/config:/mosquitto/config" eclipse-mosquitto:2 \
  mosquitto_passwd -b -c /mosquitto/config/passwd auditor "${MQTT_PASSWORD:-mqtt_password}"
docker compose -f docker-compose.dev.yml up -d

# Verify services are running
docker compose -f docker-compose.dev.yml ps
```

### 2. Setup Backend

```bash
cd backend

# Install dependencies
pnpm install

# Copy environment file
cp ../.env.example .env
# Or on Windows: copy ..\\.env.example .env

# Generate Prisma client
pnpm prisma generate

# Run database migrations
pnpm prisma migrate dev

# Verify setup
pnpm test
```

### 3. Setup Frontend

```bash
cd frontend

# Install dependencies
pnpm install

# Verify setup
pnpm lint
```

---

## Environment Configuration

### Backend (.env)

Create `backend/.env` with these values for development:

```env
# Database
POSTGRES_DB=zeroproof_dev
POSTGRES_PASSWORD=dev_password
DATABASE_URL=postgresql://postgres:dev_password@localhost:5432/zeroproof_dev

# MQTT
MQTT_BROKER=localhost
MQTT_PORT=1883
MQTT_USERNAME=auditor
MQTT_PASSWORD=mqtt_password

# Backend
NODE_ENV=development
PORT=3000
SESSION_SECRET=dev-session-secret-change-me-32chars
ENCRYPTION_KEY=dev-encryption-key-32-bytes-minimum
# DEFAULT_ADMIN_PASSWORD is optional. If unset, ZeroProof routes the user to
# /setup on first load. Uncomment to seed an admin non-interactively.
# DEFAULT_ADMIN_PASSWORD=
# CORS_ORIGIN=http://localhost:5173

# UniFi (optional - for live sync)
# UNIFI_HOST=192.168.1.1
# UNIFI_USERNAME=admin
# UNIFI_PASSWORD=your-password
```

### Frontend

The frontend uses Vite's proxy for API requests in development. No additional configuration needed.

---

## VS Code Setup

### Recommended Extensions

Install these extensions for the best development experience:

```
ESLint (dbaeumer.vscode-eslint)
Prettier (esbenp.prettier-vscode)
Prisma (Prisma.prisma)
Docker (ms-azuretools.vscode-docker)
GitLens (eamodio.gitlens)
Thunder Client (rangav.vscode-thunder-client)
Tailwind CSS IntelliSense (bradlc.vscode-tailwindcss)
```

### Workspace Settings

The repo includes `.vscode/settings.json` with recommended settings. Key settings:

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit"
  },
  "typescript.preferences.importModuleSpecifier": "relative"
}
```

---

## Common Issues & Solutions

### Docker Issues

**"Cannot connect to Docker daemon"**
- macOS: Open Docker Desktop and wait for it to start
- Windows: Ensure Docker Desktop is running and WSL 2 integration is enabled

**Port already in use**
```bash
# Find what's using the port
lsof -i :5432  # macOS/Linux
netstat -ano | findstr :5432  # Windows

# Stop conflicting service or change port in docker-compose.dev.yml
```

### Database Issues

**"Connection refused" to PostgreSQL**
```bash
# Check if PostgreSQL container is running
docker compose -f docker-compose.dev.yml ps

# Restart if needed
docker compose -f docker-compose.dev.yml restart postgres
```

**Migration errors**
```bash
cd backend

# Reset database (WARNING: deletes all data)
pnpm prisma migrate reset

# Or apply pending migrations
pnpm prisma migrate dev
```

### Node/pnpm Issues

**"pnpm: command not found"**
```bash
# Reinstall pnpm
npm install -g pnpm

# Verify
pnpm --version
```

**"Node version mismatch"**
```bash
# Check version
node --version

# macOS: Switch to Node 20
brew unlink node
brew link node@20

# Windows: Use nvm-windows or reinstall Node 20
```

### UniFi Controller Sync Issues

**Backend is healthy but UniFi sync fails**
- Verify backend first:
```bash
curl http://localhost:3000/health
```
- A healthy backend does not guarantee the controller is reachable.

**"Cannot connect to ... connection refused"**
- Validate host and port directly:
```bash
nc -zv <controller-host> <controller-port>
```
- For UniFi OS consoles/gateways, prefer port `443`.
- For older UniFi Network Application installs, try `8443`.
- If you use a tunnel port (for example `65225`), ensure the tunnel process is running.

**Using Docker and controller is on host/local network**
- Do not rely on `127.0.0.1` unless your tunnel is active.
- Set `HOST_IP=<your-host-lan-ip>` in `.env` so backend containers can route back to host services.

**Settings page shows old sync error after changes**
- In settings, click **Save Settings** after updating host/port/credentials.
- `Test Connection` checks form values, while `Sync Configuration Now` uses saved DB settings.
- Re-run sync after saving to refresh `lastSyncStatus` / `lastSyncError`.

### Windows-Specific Issues

**Line ending issues (CRLF vs LF)**
```bash
# Configure Git to handle line endings
git config --global core.autocrlf input

# Fix existing files
git add --renormalize .
```

**Long path issues**
```powershell
# Enable long paths (run as Administrator)
git config --system core.longpaths true
```

---

## Verifying Your Setup

Run these commands to verify everything is working:

```bash
# Check Docker services
docker compose -f docker-compose.dev.yml ps
# Should show postgres, mosquitto, redis as "running"

# Check backend
cd backend
pnpm test
# Should show all tests passing

# Check frontend
cd frontend
pnpm lint
# Should show no errors

# Check database connection
cd backend
pnpm prisma studio
# Should open database GUI in browser
```

---

## Next Steps

1. **Read the Development Guide**: See [DEVELOPMENT.md](./DEVELOPMENT.md) for coding guidelines
2. **Explore the API**: See [API.md](./API.md) for API documentation
3. **ESP32 Setup**: See [ESP32_SETUP.md](./ESP32_SETUP.md) for test device setup
4. **Deployment**: See [DEPLOYMENT.md](./DEPLOYMENT.md) for production deployment

---

## Getting Help

- **Issues**: Open an issue on [GitHub](https://github.com/MKippen/ZeroProof/issues)
- **Discussions**: Use GitHub Discussions for questions
