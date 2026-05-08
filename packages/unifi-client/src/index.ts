export { UnifiClient } from './client.js';
export type { UnifiClientOptions } from './client.js';
export type { UnifiClientConfig, UnifiLogger } from './config.js';
export type { HttpTransport, HttpRequest, HttpResponse } from './transport/http.js';
export {
  UnifiError,
  UnifiAuthError,
  UnifiNotFoundError,
  UnifiTransportError,
  UnifiResponseError,
} from './errors.js';

// Resource types — re-exported so consumers can name them in function signatures.
export type { FlowEvent, FlowListParams, FlowPage } from './resources/flows.js';
export type { Site } from './resources/sites.js';
export type {
  ThreatAlert,
  ThreatType,
  ThreatListParams,
  ThreatPage,
} from './resources/threats.js';
export type {
  Trigger,
  TriggerType,
  TriggerListParams,
  TriggerPage,
} from './resources/triggers.js';
export type { Device } from './resources/devices.js';
export type { Network, Wlan } from './resources/networks.js';
export type { NetworkClient } from './resources/clients.js';
export type {
  FirewallRule,
  FirewallGroup,
  FirewallPolicy,
} from './resources/firewall.js';
export type {
  TrafficRule,
  TrafficRoute,
  PortForward,
  RoutingRule,
} from './resources/traffic.js';
export type {
  SystemEvent,
  Alarm,
  SysInfo,
  SettingsEntry,
} from './resources/system.js';
