const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkAcl() {
  const config = await prisma.configuration.findFirst({ where: { isActive: true } });
  if (!config) {
    console.log('No active config');
    await prisma.$disconnect();
    return;
  }

  const json = config.configJson;

  // Check settings for ACL
  const settings = json.settings || json.setting || [];
  for (const s of settings) {
    if (s.acl_l3_isolation) {
      console.log('L3 ACL Isolation:', JSON.stringify(s.acl_l3_isolation, null, 2));
    }
  }

  // Check for ACL rules
  const aclRules = json.aclRules || json.aclrule || [];
  console.log('ACL Rules:', JSON.stringify(aclRules, null, 2));

  // Check networks for Work
  const networks = json.networkconf || json.networks || [];
  const workNet = networks.find(n => n.name && n.name.toLowerCase().includes('work'));
  if (workNet) {
    console.log('Work Network:', JSON.stringify({ _id: workNet._id, name: workNet.name, vlan: workNet.vlan }, null, 2));
  }

  await prisma.$disconnect();
}

checkAcl().catch(console.error);
