# @uguard/unifi-client

TypeScript client for the UniFi Network controller. Designed to be:

- **Self-contained** — no environment variables, no logger imports, no Prisma. All knobs are passed in by the caller.
- **Strongly typed** — hand-rolled response schemas validated with Zod at the boundary; consumers see clean TypeScript types.
- **Test-friendly** — every resource is covered by fixture-driven tests against a `MockTransport`, so the lib doesn't need a live controller to verify behaviour.
- **Resilient** — handles UniFi-OS-vs-legacy path fallback, the "controller returned the SPA index.html instead of JSON" footgun, and self-signed TLS as an explicit opt-in.
- **Async-iterator-first** — paginated resources expose both `.list(...)` (one page) and `.iterate(...)` (auto-paginated async generator) so callers don't have to manage page state.

## Usage

```ts
import { UnifiClient } from '@uguard/unifi-client';

const client = new UnifiClient({
  host: '192.168.1.1',
  port: 443,
  username: 'admin',
  password: 'hunter2',
  siteId: 'default',
  allowSelfSigned: true,           // opt-in for self-signed certs (default: strict TLS)
  // Optional injections:
  logger: console,                 // default: silent
  basePath: '/proxy/network',      // default; legacy fallback automatic
  timeoutMs: 30_000,
});

await client.login();

// Streaming iterator — handles pagination, never holds the full set in memory
for await (const flow of client.flows.iterate({ beginTime: Date.now() - 24 * 3600_000 })) {
  console.log(flow.action, flow.source?.client_name, '→', flow.destination?.ip);
}

// Or grab a single page with explicit control
const page = await client.flows.list({ beginTime, endTime, limit: 200, page: 0 });

await client.logout();
```

## Errors

Library calls reject with a typed error hierarchy:

```ts
import {
  UnifiError,            // base — catch this for everything
  UnifiAuthError,        // 401/403, login failure, expired session
  UnifiNotFoundError,    // 404 / endpoint missing on this controller version
  UnifiTransportError,   // network, TLS, timeout
  UnifiResponseError,    // schema validation failed (controller returned an unexpected shape)
} from '@uguard/unifi-client';
```

## Testing

```bash
pnpm test         # one-shot
pnpm test:watch   # watch mode
```

Fixtures live in `test/fixtures/` — sanitized real UniFi 10.x payloads (public IPs and MACs replaced with documentation-range placeholders). Re-capture against a live controller via the `backend/scripts/capture-fixture.ts` script in the umbrella repo.

## License

MIT
