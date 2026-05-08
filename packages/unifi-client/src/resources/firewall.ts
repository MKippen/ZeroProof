import { z } from 'zod';
import type { ResolvedConfig } from '../config.js';
import type { HttpTransport } from '../transport/http.js';
import type { Session } from '../auth/session.js';
import { legacyList, v2Raw } from '../transport/helpers.js';
import { apiRequest, parseOrThrow } from '../transport/request.js';
import { LegacyEnvelope } from '../schemas/envelope.js';
import {
  FirewallRuleSchema,
  FirewallGroupSchema,
  FirewallPolicySchema,
  type FirewallRule,
  type FirewallGroup,
  type FirewallPolicy,
} from '../schemas/firewall.js';

export type { FirewallRule, FirewallGroup, FirewallPolicy };

/**
 * Firewall rules — legacy zone-less rule definitions. UniFi 10.x is moving
 * customers toward `firewall-policies` (zone-based), but the legacy ruleset
 * is still in use on most installs.
 */
export class FirewallRulesResource {
  constructor(
    private readonly config: ResolvedConfig,
    private readonly transport: HttpTransport,
    private readonly session: Session
  ) {}

  async list(): Promise<FirewallRule[]> {
    return legacyList(
      this.config,
      this.transport,
      this.session,
      '/rest/firewallrule',
      FirewallRuleSchema
    );
  }

  /** Create a firewall rule. Returns the created object including its `_id`. */
  async create(rule: Partial<FirewallRule>): Promise<FirewallRule> {
    const path = `/api/s/${this.config.siteId}/rest/firewallrule`;
    const raw = await apiRequest(this.config, this.transport, this.session, {
      method: 'POST',
      path,
      body: rule,
    });
    const parsed = parseOrThrow(path, LegacyEnvelope(FirewallRuleSchema), raw);
    if (!parsed.data[0]) {
      throw new Error('Firewall rule create returned no data');
    }
    return parsed.data[0];
  }

  /** Update an existing firewall rule by id. */
  async update(ruleId: string, updates: Partial<FirewallRule>): Promise<FirewallRule> {
    const path = `/api/s/${this.config.siteId}/rest/firewallrule/${ruleId}`;
    const raw = await apiRequest(this.config, this.transport, this.session, {
      method: 'PUT',
      path,
      body: updates,
    });
    const parsed = parseOrThrow(path, LegacyEnvelope(FirewallRuleSchema), raw);
    if (!parsed.data[0]) {
      throw new Error(`Firewall rule update for ${ruleId} returned no data`);
    }
    return parsed.data[0];
  }

  /** Delete a firewall rule by id. */
  async delete(ruleId: string): Promise<void> {
    const path = `/api/s/${this.config.siteId}/rest/firewallrule/${ruleId}`;
    await apiRequest(this.config, this.transport, this.session, { method: 'DELETE', path });
  }
}

/** Firewall groups — named address / port lists used by firewall rules. */
export class FirewallGroupsResource {
  constructor(
    private readonly config: ResolvedConfig,
    private readonly transport: HttpTransport,
    private readonly session: Session
  ) {}

  async list(): Promise<FirewallGroup[]> {
    return legacyList(
      this.config,
      this.transport,
      this.session,
      '/rest/firewallgroup',
      FirewallGroupSchema
    );
  }

  async create(group: {
    name: string;
    group_type: string;
    group_members: string[];
  }): Promise<FirewallGroup> {
    const path = `/api/s/${this.config.siteId}/rest/firewallgroup`;
    const raw = await apiRequest(this.config, this.transport, this.session, {
      method: 'POST',
      path,
      body: group,
    });
    const parsed = parseOrThrow(path, LegacyEnvelope(FirewallGroupSchema), raw);
    if (!parsed.data[0]) {
      throw new Error('Firewall group create returned no data');
    }
    return parsed.data[0];
  }
}

/**
 * Zone-based firewall policies (UniFi Network 10.x). Returned as a bare
 * array — distinct from the legacy `{meta, data}` envelope.
 */
export class FirewallPoliciesResource {
  constructor(
    private readonly config: ResolvedConfig,
    private readonly transport: HttpTransport,
    private readonly session: Session
  ) {}

  async list(): Promise<FirewallPolicy[]> {
    return v2Raw(
      this.config,
      this.transport,
      this.session,
      '/firewall-policies',
      z.array(FirewallPolicySchema)
    );
  }
}
