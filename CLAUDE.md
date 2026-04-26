# ZeroProof - Claude Code Project Guide

## Project Overview

ZeroProof is a security auditing tool for Ubiquiti UniFi networks. It connects to UniFi controllers, pulls configuration snapshots, and analyzes them for security vulnerabilities using a rules engine. The app runs as Docker containers (backend, scheduler, frontend, postgres, redis, mosquitto).

## Architecture

- **Backend**: Express.js + TypeScript + Prisma ORM + PostgreSQL
- **Frontend**: React + TypeScript + Vite + Tailwind + shadcn/ui + Zustand
- **Scheduler**: Same backend codebase, runs as separate container for background sync tasks
- **Auth**: Session-based with Passport.js (no JWT)

## Key Directories

- `backend/src/services/` — Core business logic (unifiClient, configChangeService, notificationService, timelineService)
- `backend/src/analyzers/` — Security analysis engine (intentAnalyzer, rule evaluation)
- `backend/src/api/routes/` — Express route handlers
- `backend/src/scheduler.ts` — Background sync and change detection
- `frontend/src/pages/` — React page components
- `frontend/src/stores/` — Zustand state stores
- `frontend/src/types/` — Shared TypeScript types
- `rules/` — YAML security rule definitions

## UniFi Version Policy

**ZeroProof only supports the latest versions of UniFi Network Application.** This is a deliberate architectural decision, not a limitation.

### Why

- Running outdated UniFi firmware is itself a security vulnerability — ZeroProof exists to enforce security best practices, and we practice what we preach.
- Maintaining backwards compatibility with old API versions creates dead code paths, untestable edge cases, and false confidence in security analysis.
- UniFi's API evolves significantly between major versions (V1 REST vs V2 zone-based firewall policies, ACL rules in 8.2+, etc.). Supporting old versions means incomplete security coverage.
- We want every security check to work reliably. It's better to tell the user "update your controller" than to silently skip checks that don't apply to their version.

### In Practice

- The `UniFiClient` (`backend/src/services/unifiClient.ts`) should target the latest UniFi Network Application API paths.
- When UniFi introduces new features/APIs, we add support and may drop old fallback paths.
- The dual-endpoint strategy (UniFi OS vs legacy controller) remains because both run current versions — this is about deployment type, not version.
- Use the `/unifi-update` slash command regularly to check for new UniFi releases and update the codebase accordingly.

### Current Target

- **UniFi Network Application**: 10.x+ (zone-based firewall policies, ACL rules, traffic rules)
- **UniFi OS**: 4.x+

## Development Commands

- `docker compose -f docker-compose.dev.yml up -d` — Start dev environment
- `docker compose -f docker-compose.dev.yml up -d --build backend scheduler frontend` — Rebuild and restart
- Backend tests: `cd backend && pnpm test -- --no-coverage`
- Frontend tests: `cd frontend && pnpm test -- run`
- Prisma: `cd backend && pnpm prisma db push` (for dev schema sync)

## UniFi Connectivity Notes

- A passing backend health check (`/health`) does not mean UniFi sync will pass; controller reachability and auth are separate concerns.
- In Docker, `localhost`/`127.0.0.1` points at the container. For host-based controller paths, prefer real LAN IPs and set `HOST_IP` in `.env` when needed.
- Current `UniFiClient` behavior: loopback hosts are resolved for container networking (uses `HOST_IP` when provided, else `host.docker.internal`).
- Port guidance:
  - UniFi OS: usually `443`
  - Legacy Network Application: often `8443`
  - Non-standard tunnel ports only work while the tunnel is active.
- Route behavior matters during debugging:
  - `POST /api/v1/unifi/test` uses request payload host/port/credentials.
  - `POST /api/v1/unifi/sync` uses persisted `UniFiConnection` values.
  - If test succeeds but sync fails, verify settings were saved.

## Conventions

- Backend uses `import prisma from './database'` for DB access (singleton pattern)
- All API routes require auth via `requireAuth` middleware (from `backend/src/api/middleware/auth.ts`)
- Frontend API calls go through `frontend/src/api/client.ts` (axios instance with session cookie)
- Zustand stores in `frontend/src/stores/` — flat state + actions pattern
- Security rules are YAML files in `rules/` — loaded by `backend/src/services/ruleLoader/`
