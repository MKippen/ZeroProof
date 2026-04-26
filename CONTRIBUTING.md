# Contributing to ZeroProof

Thanks for your interest in contributing to ZeroProof! This document covers the development workflow, PR process, and how to add new security rules.

## Development Setup

### Prerequisites

- Node.js 20+
- pnpm
- Docker and Docker Compose
- PostgreSQL (via Docker)

### Getting Started

```bash
# Clone the repo
git clone https://github.com/MKippen/ZeroProof.git
cd ZeroProof

# Start dev infrastructure
docker compose -f docker-compose.dev.yml up -d

# Backend
cd backend
pnpm install
npx prisma db push
pnpm dev

# Frontend (new terminal)
cd frontend
pnpm install
pnpm dev
```

The backend runs on `http://localhost:3000` and the frontend on `http://localhost:5173`.

### Running Tests

```bash
# Backend unit tests
cd backend && pnpm test -- --no-coverage

# Frontend tests
cd frontend && pnpm test -- run

# Sandbox integration tests (requires running Docker containers)
./scripts/sandbox-clean-start.sh
```

## Pull Request Process

1. Create a feature branch from `main`
2. Make your changes
3. Run `cd backend && pnpm test -- --no-coverage` to verify tests pass
4. Run `cd frontend && pnpm test -- run` to verify frontend tests pass
5. Open a PR against `main`
6. Describe what changed and why in the PR description

### Commit Message Format

We use conventional-ish commit messages:

```
feat: add new security rule for X
fix: correct VLAN isolation detection for Y
test: add persona config for apartment network
docs: update installation guide
refactor: simplify config normalizer
```

## Adding Security Rules

Security rules live in `rules/security/industry-standards/` as YAML files. Each rule has:

- **id**: Unique identifier (e.g., `IS-FW-003`)
- **name**: Human-readable name
- **description**: What it checks
- **category**: One of: firewall, vlan, wireless, dns, port, upnp, ids_ips, access_control, switch, general, vpn, optimization
- **severity**: CRITICAL, HIGH, MEDIUM, LOW, or INFO
- **detection**: Target, filter, condition, and output template

### Example Rule

```yaml
- id: "IS-EXAMPLE-001"
  name: "Example Rule Name"
  description: |
    What this rule checks for and why it matters.
  category: firewall
  severity: HIGH
  impact: |
    What happens if this is misconfigured.
  remediation: |
    How to fix the issue.

  detection:
    target: firewallRules
    filter:
      enabled: true

    condition:
      operator: AND
      checks:
        - field: some_field
          op: equals
          value: "bad_value"

    output:
      affected_resource: "Resource: {{name}}"
      details: "Description of what was found"
```

### Testing Your Rule

1. Add a test config to `backend/tests/fixtures/unifiConfigs.ts` that triggers your rule
2. Add positive and negative cases to the validation matrix in `backend/tests/unit/services/ruleLoader/ruleEngine.test.ts`
3. Run `cd backend && pnpm test -- --no-coverage` to verify

## Project Structure

```
backend/
  src/
    analyzers/      # Intent analyzer
    api/routes/     # Express route handlers
    scanners/       # Security analysis engine + config normalizer
    services/       # Core services (UniFi client, rule loader, etc.)
    scheduler.ts    # Background sync tasks
  tests/
    fixtures/       # Test config data
    unit/           # Unit tests
    sandbox/        # Integration tests with mock UniFi controller

frontend/
  src/
    pages/          # React page components
    stores/         # Zustand state stores
    components/     # Reusable UI components

rules/
  security/         # YAML security rule definitions
  tests/            # YAML test definitions (ESP32)
  intents/          # YAML intent evaluation definitions
```

## Code of Conduct

Be respectful and constructive. We're all here to make UniFi networks more secure.
