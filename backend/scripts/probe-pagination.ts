/** Diagnose UniFi /traffic-flows pagination behavior. */
import prisma from '../src/services/database';
import { decrypt } from '../src/utils/encryption';
import { UnifiClient } from '@uguard/unifi-client';
import { resolveControllerHost } from '../src/services/unifiClient';

async function main(): Promise<void> {
  const conn = await prisma.uniFiConnection.findFirst({ where: { isActive: true } });
  if (!conn) throw new Error('no conn');

  const client = new UnifiClient({
    host: resolveControllerHost(conn.host),
    port: conn.port,
    username: decrypt(conn.usernameEnc),
    password: decrypt(conn.passwordEnc),
    siteId: conn.siteId,
    allowSelfSigned: true,
  });
  await client.login();

  const since = Date.now() - 24 * 60 * 60 * 1000;
  const seenIds = new Set<string>();
  for (let page = 0; page < 5; page++) {
    const result = await client.flows.list({ beginTime: since, endTime: Date.now(), limit: 50, page });
    const newOnPage = result.data.filter((r) => !seenIds.has(r.id)).length;
    console.log(
      `page=${page}: ${result.data.length} rows, ${newOnPage} unseen, hasNext=${result.hasNext}, totalPageCount=${result.totalPageCount}, totalElementCount=${result.totalElementCount}`
    );
    for (const r of result.data) seenIds.add(r.id);
  }
  console.log(`unique seen across 5 pages: ${seenIds.size}`);
  await client.logout();
  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
