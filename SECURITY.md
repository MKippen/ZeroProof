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
- **Command injection** or remote code execution in the backend
- **Credential exposure** (e.g., UniFi controller passwords, session secrets)
- **SQL injection** or database access issues
- **Cross-site scripting (XSS)** in the frontend
- **Privilege escalation** in the API
- **MQTT message injection** that could affect device behavior

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
