# External dependencies

ZeroProof is a security tool. Every npm package we depend on widens our supply chain and our threat model. This document is the authoritative inventory of every external runtime dependency in the repository, why it's here, and why it's acceptable.

## Policy

**New runtime dependencies require explicit approval from @MKippen before they can be added.**

A new dep means a PR comment trail with:

1. What capability it provides that we cannot reasonably build ourselves in <1 day.
2. Maintainer reputation (org-backed? individual? bus factor?), weekly downloads, last commit, GitHub stars, open critical issues, and audit status.
3. Whether it pulls in transitive deps we don't already have.
4. Why a stdlib or already-present alternative isn't sufficient.
5. Approval comment from Mike before merge.

This rule applies to **runtime dependencies** (the `dependencies` field). Dev/build-only tooling (`devDependencies`) is treated more leniently — it doesn't ship to production, doesn't run in customer environments — but new dev deps should still be justified in the PR description.

When a dep we already depend on releases a security advisory, the policy is: read the advisory, decide whether the affected code path is exercised, patch or pin within one business day.

## packages/unifi-client (the standalone UniFi library)

Designed to ship externally as a zero-runtime-dep library wherever possible.

### Runtime

| Dep | Version | Purpose | Safety notes |
|---|---|---|---|
| `zod` | ^3.23.0 | Runtime schema validation at the API boundary so we never trust raw UniFi responses to be the shape we expect. Used internally only — public API surface uses inferred TS types. | 80M+ weekly downloads. Single org (Colin McDonnell). Pure TypeScript, no native bindings. No CVEs since v3.0. Treats unknown/extra fields explicitly via `.passthrough()` in our usage. |

HTTP transport uses Node's stdlib `node:https` / `node:http` directly — **no axios, undici, or other HTTP libraries.**

### Dev / build

| Dep | Purpose |
|---|---|
| `typescript` | TypeScript compiler |
| `tsup` | Bundles dual-format (ESM + CJS) output for npm publishing |
| `vitest` | Test runner (fast, ESM-native, fewer deps than Jest) |
| `@vitest/coverage-v8` | Coverage reports via V8's built-in instrumentation |
| `@types/node` | Type definitions for Node stdlib |

## backend (ZeroProof API + scheduler)

### Runtime

HTTP work is done via Node stdlib (`node:http` / `node:https`) — no axios, undici, or other HTTP libs.

| Dep | Purpose | Safety notes |
|---|---|---|
| `@prisma/client` | ORM client. Only way to talk to Postgres. | Prisma org. Audited regularly. Generated code, not hand-rolled SQL. |
| `bcrypt` | Password hashing for local user accounts. | Native module. Industry standard. Requires native build step. |
| `connect-pg-simple` | Postgres-backed session store for express-session. | Maintained by voxpelli. Direct, simple. |
| `cors` | CORS middleware. | Express maintainers. |
| `dotenv` | `.env` file loading in development only. | tiny, audited many times. |
| `express` | HTTP framework. | Foundational for Node ecosystems. |
| `express-rate-limit` | Rate-limit middleware. | Active, well-maintained. |
| `express-session` | Session middleware backing the cookie auth flow. | Express org. |
| `express-ws` | WebSocket upgrade for express. | Used for the `/ws` endpoint that streams events to the frontend. |
| `helmet` | Security headers. | Active, security-focused org. |
| `js-yaml` | YAML parser. We load security rules from `rules/*.yaml`. | sam-yaml maintained, schemas-only loading (no `!!js/function` etc). |
| `mqtt` | MQTT client. ESP32 telemetry comes in over MQTT. | mqttjs org. |
| `multer` | Multipart upload for ESP32 firmware uploads. | Express org. CVE history fully patched in 2.x. |
| `passport` | Auth strategy framework. | Jared Hanson (long-time maintainer). |
| `passport-local` | Local username/password strategy. | Same author as passport. |
| `winston` | Structured logger. | winstonjs org. |
| `zod` | Request validation in route handlers. | See unifi-client section. |

### Dev / build

Standard dev tooling: `typescript`, `tsx`, `nodemon`, `jest`, `ts-jest`, `eslint`, `@types/*`, `prisma` CLI.

## frontend (React + Vite SPA)

### Runtime

| Dep | Purpose | Safety notes |
|---|---|---|
| `react` / `react-dom` | UI framework. | Meta-backed. |
| `react-router-dom` | Client routing. | Remix team. |
| `@tanstack/react-query` | Server state caching, polling, mutations. | TanStack org. Active. |
| `@tanstack/react-table` | Headless table primitives (used in flows/devices/clients tables). | TanStack org. |
| `zustand` | Lightweight client state store. | pmndrs collective. ~10kB, no deps. |
| `react-hook-form` | Form state management with low re-render footprint. | Bluebill maintained. |
| `@hookform/resolvers` | Schema → resolver bridge for react-hook-form (we use the Zod resolver). | Same maintainer as react-hook-form. |
| `zod` | Form + URL param validation. | See unifi-client section. |
| `@radix-ui/react-*` | Headless, accessibility-focused UI primitives (dialog, dropdown, tabs, tooltip, etc.). | WorkOS-backed. Best-in-class accessibility audit. |
| `class-variance-authority` | Tailwind-class composition for variant components. | shadcn ecosystem. Tiny. |
| `clsx` | Conditional className join. ~200 bytes. | jorgebucaran. |
| `tailwind-merge` | Resolves conflicting Tailwind classes when composing. | dcastil. |
| `lucide-react` | Icon library. SVG-only, no JS at runtime. | Lucide org. |
| `recharts` | Charts (DNS Proxy + flow analytics). | recharts org. Big surface but battle-tested. |
| `cytoscape` / `react-cytoscapejs` | Graph visualization for the network topology view. | OICR-backed. |
| `date-fns` | Date formatting/parsing. Tree-shakeable, no global mutation. | date-fns collective. |
| `esptool-js` | **Espressif's official ESP32 firmware flasher.** Lets users flash the ESP32 sentinels directly from the browser via Web Serial. | Single-vendor (Espressif Systems). High trust given they're the chip vendor. Only loaded on the ESP32 setup page. |

### Dev / build

`vite`, `vitest`, `@vitejs/plugin-react`, `tailwindcss`, `postcss`, `autoprefixer`, `typescript`, `eslint`, `@testing-library/react`.

## External data sources (threat-intel feeds, OUI lists, etc.)

These aren't npm packages, but they widen our supply chain in a different way: we ingest their data and act on it. Treat additions like dep additions — Mike approves new feeds.

| Source | URL | License | Used by | Refresh | Notes |
|---|---|---|---|---|---|
| abuse.ch URLhaus | https://urlhaus.abuse.ch/api/ | CC0-1.0 | `IocEntry` cache (detectors look up flow `dstIp` / DNS `domain` against this) | Daily, full pull of `json_recent` (last 30d) | Public, free, no API key. Maintained by abuse.ch (Swiss research org). High-confidence malware-distribution URLs. We extract host + classify into `malware-c2` / `phishing` / `cryptominer` / `malware-distribution`. Fetched via `node:https` (no axios). |

When adding a feed: wire it under `backend/src/services/threatIntel/feeds/`, register in `backend/src/services/threatIntel/index.ts`, document the license + refresh cadence here.

## Process for adding a new dep

1. **Open a PR (or comment on the relevant one)** stating the package, version, purpose, and a one-paragraph "why now" justification. Include the npm page, GitHub link, last release date, and any CVE history.
2. **Wait for explicit approval** from @MKippen before merging.
3. **Update this document** in the same PR — every entry above gets a row.
4. **Pin the version** in the appropriate `package.json` (no `*` or `latest` ranges).

When in doubt about whether something counts: if it adds a row to `pnpm-lock.yaml` under our direct deps, it counts.

## Process for removing a dep

Anyone can propose removing a dep. Removal PRs are encouraged — fewer deps is always a security win.

## Audit cadence

Run `pnpm audit` on each package at least monthly. Triage any high/critical findings within one business day. Document the resolution (patch / pin / remove) in the PR that addresses it.
