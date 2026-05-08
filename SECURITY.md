# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in ZeroProof, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, please email: **security@zeroproof.dev** (or open a private security advisory on GitHub).

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will acknowledge receipt within 48 hours and aim to provide a fix within 7 days for critical issues.

## Scope

ZeroProof is a security auditing tool that runs entirely on your local network. The following are in scope for security reports:

- **Authentication bypass** in the web interface or API
- **CSRF / session-fixation** — including ways to defeat the synchronizer-token check
- **Command injection** or remote code execution in the backend
- **Credential exposure** (e.g., UniFi controller passwords, session secrets)
- **SQL injection** or database access issues
- **Cross-site scripting (XSS)** in the frontend
- **Privilege escalation** in the API
- **MQTT message injection** that could affect device behavior
- **Threat-intel cache poisoning** — ways an attacker could inject malicious entries into `IocEntry` to suppress detections or generate false positives
- **Detection-engine bypass** — ways to evade `ioc_match`, `validated_compromise`, `dns_tunneling`, etc. while remaining within the data ZeroProof ingests

## Out of Scope

- Vulnerabilities in upstream dependencies (report to the upstream project)
- Issues that require physical access to the host machine
- Self-signed certificate warnings (expected for local deployment)
- Denial of service against the local instance

## Security Design

ZeroProof follows these security principles:

- **100% local** — no data leaves your network
- **No telemetry** — zero analytics or phone-home behavior
- **Session-based auth** — server-side sessions, not JWT
- **Encrypted credential storage** — UniFi passwords encrypted with AES-256-GCM
- **No default credentials in production** — installer generates random passwords
- **Parameterized queries** — Prisma ORM prevents SQL injection
- **CSRF protection** — synchronizer-token middleware on `/api/v1/*` requires `X-CSRF-Token` to match a per-session crypto-random token on every mutating request. Cookie is `httpOnly` + `SameSite=Strict` (production) so the token is unreachable from third-party origins. Token rotates on login / logout.
- **External-dependency policy** — every npm package and threat-intel data source (e.g., abuse.ch URLhaus) is inventoried in [EXTERNALS.md](EXTERNALS.md). Detectors NEVER make outbound network calls themselves; they read from a cached `IocEntry` table refreshed daily by a single orchestrator, so a feed outage never stalls detection and a feed poisoning attempt only affects what's been refreshed since.

## Detection-engine notes

ZeroProof's detection engine produces findings with confidence and severity tiers. A few important properties:

- **Detectors are pure functions** — input (windowed events) → output (findings). They never write to the DB directly; the runner persists results so the dedupe + severity-escalation logic lives in one place.
- **Severity escalates but never silently downgrades** — re-evaluating evidence that was once `CRITICAL` cannot quietly become `MEDIUM`. The worst-seen severity is preserved with `occurrences` incremented.
- **Per-rule retention** — each detector's YAML can override the default 14-day TTL; expired and resolved findings are pruned by a daily sweep.
- **Rule logic is split between TS and YAML** — detection logic ships through normal code review; severity / remediation / references can evolve without a redeploy.
