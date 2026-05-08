/**
 * End-to-end smoke for the firewall telemetry sync path.
 *
 * 1. Looks up the active UniFi connection in the dev DB.
 * 2. Calls `syncFirewallTelemetry` once.
 * 3. Counts the rows landed and prints the watermarks.
 */
import prisma from '../src/services/database';
import { syncFirewallTelemetry } from '../src/services/firewall/flowSync';

async function main(): Promise<void> {
  const conn = await prisma.uniFiConnection.findFirst({ where: { isActive: true } });
  if (!conn) throw new Error('no active UniFi connection in DB');

  console.log(`→ syncFirewallTelemetry(${conn.id})`);
  const result = await syncFirewallTelemetry(conn.id);
  console.log(`  flows: +${result.flowsInserted} new, ${result.flowsSkipped} dup`);
  console.log(`  threats: +${result.threatsInserted} new, ${result.threatsSkipped} dup`);
  console.log(`  flowsHighWater: ${result.flowsHighWater?.toISOString() ?? 'unchanged'}`);
  console.log(`  threatsHighWater: ${result.threatsHighWater?.toISOString() ?? 'unchanged'}`);

  const [flowsTotal, threatsTotal, sample] = await Promise.all([
    prisma.firewallFlowEvent.count({ where: { connectionId: conn.id } }),
    prisma.firewallThreatEvent.count({ where: { connectionId: conn.id } }),
    prisma.firewallFlowEvent.findFirst({
      where: { connectionId: conn.id },
      orderBy: { occurredAt: 'desc' },
      select: {
        srcClientName: true,
        srcMac: true,
        dstIp: true,
        dstRegion: true,
        primaryPolicyName: true,
        action: true,
        occurredAt: true,
      },
    }),
  ]);
  console.log(`  rows in DB: ${flowsTotal} flows, ${threatsTotal} threats`);
  if (sample) {
    console.log('  sample flow:', sample);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('SMOKE FAILED:', err);
  process.exit(1);
});
