<p align="center">
  <img src="frontend/public/zeroproof.svg" alt="ZeroProof Logo" width="120">
</p>

<h1 align="center">ZeroProof</h1>
<p align="center"><strong>Trust nothing. Validate everything.</strong></p>

<p align="center">
  <a href="https://github.com/MKippen/ZeroProof/actions"><img src="https://github.com/MKippen/ZeroProof/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
  <a href="https://github.com/MKippen/ZeroProof/releases"><img src="https://img.shields.io/github/v/release/MKippen/ZeroProof?include_prereleases" alt="Release"></a>
</p>

<p align="center">
A 100% local network security validation system for UniFi environments.<br>
Define your security intent, analyze your configuration, and validate with real-world hardware testing.
</p>

---

## At a Glance

| | |
|---|---|
| **Security Rules** | 39 rules across firewall, VLAN, WiFi, DNS, UPnP, IDS/IPS, VPN, ACL, version, and general hardening |
| **Optimization Rules** | 8 WiFi/network performance recommendations |
| **Hardware Tests** | 10 ESP32-backed validation workflows |
| **Intent Profiles** | 9 intent evaluations for work, guest, IoT, camera, DNS, and NAS segmentation |
| **Supported Controllers** | UniFi Network Application 10.x+ / UniFi OS 4.x+ |
| **Architecture** | Docker Compose (backend + frontend + postgres + MQTT) |
| **Privacy** | 100% local — zero telemetry, zero cloud, your network your data |
| **License** | MIT |

## Features

### Security Analysis Engine
- **39 Security Rules** covering firewall, VLAN isolation, wireless, DNS, UPnP, port forwards, IDS/IPS, VPN, ACL, version validation, and general hardening
- **YAML-based Rule Definitions** — extensible and auditable
- **Severity Classification** — CRITICAL, HIGH, MEDIUM, LOW, INFO with actionable remediation
- **Config Normalization** — handles UniFi API variations across controller versions
- **8 Optimization Rules** for WiFi and network performance recommendations

### Network Intent Profiles
- **Intent-Based Security** — define what your network should do (IoT isolation, guest network, work segmentation, DNS filtering, NAS access)
- **Compliance Scoring** — measure how closely your actual config matches your stated security goals
- **Gap Detection** — identifies exactly which settings need to change to meet your intent
- **Dismissal Tracking** — acknowledge known gaps without losing visibility

### Real-World Hardware Testing
- **ESP32 Test Devices** — deploy on each network segment to test from the client perspective
- **VLAN Isolation Validation** — verify isolation actually works, not just that it's configured
- **Port Scanning** — discover open ports and services across your network
- **Web-Based Device Flashing** — flash ESP32 firmware directly from the browser via WebSerial

### UniFi Integration
- **Live API Sync** — connect directly to your UniFi controller
- **Config Import** — upload UniFi backup files for offline analysis
- **Change Detection** — track configuration changes over time with timeline view
- **Multi-Site Support** — analyze multiple UniFi sites

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Raspberry Pi 4+ / Linux server / macOS
- ESP32 device (optional, for real-world testing)

### Installation

```bash
git clone https://github.com/MKippen/ZeroProof.git
cd ZeroProof
./scripts/install.sh
```

Access the dashboard at `https://your-ip`. On first visit ZeroProof routes
you to **/setup** to create your administrator account — you choose the
username and password yourself. There is no shipped default password.

If you're scripting the install (CI / IaC), set `DEFAULT_ADMIN_PASSWORD` in
`.env` and the backend will seed an `admin` account with that password
instead. The seeded admin will be flagged with `mustChangePassword=true`.

The installer generates `.env`, the Mosquitto password file, and a local self-signed certificate. Those generated files are intentionally ignored by git.

### Verify Installation

```bash
./scripts/smoke-test.sh
```

### Get the ESP32 firmware

ZeroProof serves prebuilt ESP32 firmware from `backend/firmware/`, but prebuilt binaries are not committed to the repo. `./scripts/install.sh` and `./scripts/dev-setup.sh` download the latest firmware release automatically. You can also rerun the firmware download manually:

```bash
./scripts/download-firmware.sh
```

The script downloads `zeroproof-esp32.bin` and `firmware.json` into `backend/firmware/`, verifies the SHA-256 checksum from the metadata, and skips work when the same verified firmware is already installed. Set `FIRMWARE_TAG=firmware-v...` or `FIRMWARE_REPO=owner/repo` to override the default latest firmware release from this repo. Set `SKIP_FIRMWARE_DOWNLOAD=true` when running setup offline.

Contributors who want to modify firmware can still build locally with PlatformIO from `esp32-firmware/`, but PlatformIO is optional for a normal ZeroProof install.

### UniFi Live Sync Tips

- Use your controller's real reachable address (for example `192.168.x.x` or `unifi.local`), not a stale local tunnel port.
- For UniFi OS consoles, start with port `443`. For older Network Application setups, try `8443`.
- In UI flow: **Test Connection** validates current form values, but **Sync Configuration Now** uses saved settings. Click **Save Settings** after successful test.
- If the backend is healthy but sync fails, it's usually controller reachability or credentials, not app uptime.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                  Your Local Network                   │
│                                                       │
│  ┌────────────────────────────────────────────────┐  │
│  │     Host (Pi / NUC / Mac / VM)                 │  │
│  │                                                 │  │
│  │  ┌──────────────────────────────────────────┐  │  │
│  │  │        Docker Compose Stack               │  │  │
│  │  │                                           │  │  │
│  │  │  ┌─────────┐ ┌──────────┐ ┌──────────┐  │  │  │
│  │  │  │ Nginx   │ │ Frontend │ │ Backend  │  │  │  │
│  │  │  │ :443    │ │ (React)  │ │ (Node)   │  │  │  │
│  │  │  └────┬────┘ └──────────┘ └────┬─────┘  │  │  │
│  │  │       │                         │        │  │  │
│  │  │  ┌────┴────────┬────────────────┴─────┐  │  │  │
│  │  │  │  Postgres   │  Mosquitto  │ Sched  │  │  │  │
│  │  │  │  :5432      │  :1883      │        │  │  │  │
│  │  │  └─────────────┴──────┬──────┴────────┘  │  │  │
│  │  └───────────────────────┼──────────────────┘  │  │
│  └──────────────────────────┼─────────────────────┘  │
│                              │ MQTT                    │
│  ┌───────────────────────────┼────────────────────┐   │
│  │    ESP32 Devices          │                    │   │
│  │  • VLAN isolation tests   │                    │   │
│  │  • Port scanning          │                    │   │
│  │  • Service discovery      │                    │   │
│  └───────────────────────────┴────────────────────┘   │
└───────────────────────────────────────────────────────┘
```

## Development

```bash
# Start dev containers
docker compose -f docker-compose.dev.yml up -d

# Backend
cd backend && pnpm dev

# Frontend (new terminal)
cd frontend && pnpm dev

# Run backend tests
cd backend && pnpm test -- --no-coverage

# Run frontend tests
cd frontend && pnpm test -- run
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for full development setup,
and [docs/UNIFI_SETUP.md](docs/UNIFI_SETUP.md) for connecting ZeroProof to
your UniFi controller with a least-privileged read-only user.

### Sandbox Testing

Run the clean-start sandbox harness (isolated DB + mock UniFi API + end-to-end flow):

```bash
./scripts/sandbox-clean-start.sh
```

See [docs/SANDBOX_TESTING.md](docs/SANDBOX_TESTING.md) for details.

## ESP32 Setup

The easiest way to set up an ESP32 is through the web interface:

1. Go to **Devices** > **Setup New Device**
2. Connect your ESP32 via USB
3. Follow the guided setup wizard

For manual setup, see [docs/ESP32_SETUP.md](docs/ESP32_SETUP.md).

## Security & Privacy

- **100% Local** — all data stays on your network
- **Zero Telemetry** — no phone-home, no analytics, no tracking
- **No Cloud Dependency** — self-hosted only
- **Encrypted Storage** — credentials encrypted with AES-256-GCM
- **Session-Based Auth** — no JWT tokens, server-side sessions only

## Tech Stack

| Component | Technology |
|-----------|------------|
| Backend | Node.js, Express, TypeScript, Prisma |
| Frontend | React, Vite, Tailwind CSS, shadcn/ui, Zustand |
| Database | PostgreSQL |
| Message Broker | MQTT (Mosquitto) |
| ESP32 Firmware | PlatformIO, Arduino |
| Containerization | Docker Compose |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development workflow, PR process, and rule authoring guide.

## License

MIT License — see [LICENSE](LICENSE) for details.
