import { CampaignDefinition, CampaignOptions, CampaignStepDefinition } from './types';

export const RESIDENTIAL_PROXY_CAMPAIGN_ID = 'residential-proxy-kimwolf';

export const campaignSteps: CampaignStepDefinition[] = [
  {
    id: 'setup',
    label: 'Setup',
    description: 'Check config, telemetry, and validation runner readiness.',
  },
  {
    id: 'configure',
    label: 'Configure',
    description: 'Choose target networks, device candidates, and validation ports.',
  },
  {
    id: 'collect',
    label: 'Collect',
    description: 'Build curated evidence from UniFi config, clients, events, and alarms.',
  },
  {
    id: 'evaluate',
    label: 'Evaluate',
    description: 'Score posture, telemetry, and candidate devices into a campaign verdict.',
  },
  {
    id: 'validate',
    label: 'Validate',
    description: 'Run TCP validation from an available ESP32 or server-local runner.',
  },
  {
    id: 'cleanup',
    label: 'Cleanup',
    description: 'Track guided remediation tasks and rerun validation.',
  },
];

export const residentialProxyDefaultOptions: CampaignOptions = {
  targetNetworkKeywords: ['iot', 'guest', 'media', 'streaming', 'unknown', 'untrusted'],
  validationPorts: [5555, 12108, 3222, 5858, 40860, 1080, 3128, 8080, 8291],
  manualClientMacs: [],
  lookbackHours: 72,
  validationTimeoutMs: 800,
  cleanupCompleted: [],
};

const residentialProxyCampaign: CampaignDefinition = {
  id: RESIDENTIAL_PROXY_CAMPAIGN_ID,
  name: 'Residential Proxy / Kimwolf-Style Local Network Exposure',
  shortName: 'Residential Proxy',
  description:
    'Find suspicious Android TV, TV box, digital frame, and unknown AOSP-like clients, then validate risky local proxy and ADB exposure with ZeroProof runners.',
  category: 'Threat Campaign',
  severity: 'HIGH',
  frontendComponent: 'ResidentialProxyCampaign',
  references: [
    {
      label: 'KrebsOnSecurity: The Kimwolf Botnet Is Stalking Your Local Network',
      url: 'https://krebsonsecurity.com/2026/01/the-kimwolf-botnet-is-stalking-your-local-network/',
    },
    {
      label: 'Synthient: A Broken System Fueling Botnets',
      url: 'https://synthient.com/blog/a-broken-system-fueling-botnets',
    },
    {
      label: 'Infoblox: Kimwolf Howls from Inside the Enterprise',
      url: 'https://www.infoblox.com/blog/threat-intelligence/kimwolf-howls-from-inside-the-enterprise/',
    },
    {
      label: 'IPASIS: Detecting Residential Proxies',
      url: 'https://ipasis.com/blog/detecting-residential-proxies-techniques',
    },
    {
      label: 'Ubiquiti: UniFi System Logs and SIEM Integration',
      url: 'https://help.ui.com/hc/en-us/articles/33349041044119-UniFi-System-Logs-SIEM-Integration',
    },
  ],
  requiredDataSources: [
    'Active UniFi configuration',
    'UniFi client inventory',
    'Recent UniFi events and alarms when a controller connection is configured',
    'Server-local or ESP32 validation runner',
  ],
  steps: campaignSteps,
  options: [
    {
      id: 'targetNetworkKeywords',
      label: 'Target network keywords',
      type: 'string[]',
      defaultValue: residentialProxyDefaultOptions.targetNetworkKeywords,
      description: 'Network names matching these words are included by default.',
    },
    {
      id: 'validationPorts',
      label: 'Validation ports',
      type: 'number[]',
      defaultValue: residentialProxyDefaultOptions.validationPorts,
      description: 'TCP ports checked on candidate devices.',
    },
    {
      id: 'lookbackHours',
      label: 'Telemetry lookback',
      type: 'number',
      defaultValue: residentialProxyDefaultOptions.lookbackHours,
      description: 'Hours of UniFi events and alarms to scan for curated matches.',
    },
  ],
  defaultOptions: residentialProxyDefaultOptions,
};

export const campaignRegistry: Record<string, CampaignDefinition> = {
  [residentialProxyCampaign.id]: residentialProxyCampaign,
};

export function listCampaignDefinitions(): CampaignDefinition[] {
  return Object.values(campaignRegistry);
}

export function getCampaignDefinition(campaignId: string): CampaignDefinition | undefined {
  return campaignRegistry[campaignId];
}
