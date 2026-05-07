import prisma from '../src/services/database';
import { decrypt } from '../src/utils/encryption';
import { UniFiClient } from '../src/services/unifiClient';

async function main(): Promise<void> {
  const conn = await prisma.uniFiConnection.findFirst({ where: { isActive: true } });
  if (!conn) throw new Error('no UniFi connection in DB');

  const client = new UniFiClient({
    host: conn.host,
    port: conn.port,
    username: decrypt(conn.usernameEnc),
    password: decrypt(conn.passwordEnc),
    siteId: conn.siteId,
  });

  console.log('→ login()');
  const ok = await client.login();
  console.log('  result:', ok);

  console.log('→ getSites()');
  const sites = await client.getSites();
  console.log(`  sites: ${sites.length}`);

  console.log('→ getControllerVersion()');
  const v = await client.getControllerVersion();
  console.log(`  version: ${v}`);

  console.log('→ getDevices()');
  const devices = await client.getDevices();
  console.log(`  devices: ${devices.length}`);

  console.log('→ getNetworks()');
  const networks = await client.getNetworks();
  console.log(`  networks: ${networks.length}`);

  console.log('→ getFirewallPolicies()');
  const policies = await client.getFirewallPolicies();
  console.log(`  policies: ${policies.length}`);

  console.log('→ getClients()');
  const clients = await client.getClients();
  console.log(`  clients: ${clients.length}`);

  console.log('→ getFullConfig()');
  const cfg = await client.getFullConfig();
  console.log(`  fetched at ${cfg.fetchedAt.toISOString()}`);
  console.log(`  totals: ${cfg.devices.length}d / ${cfg.networks.length}n / ${cfg.wlans.length}w / ${cfg.clients.length}c / ${cfg.firewallPolicies.length}fp`);

  await client.logout();
  await prisma.$disconnect();
  console.log('✓ all good');
}

main().catch((err) => { console.error('FAIL:', err); process.exit(1); });
