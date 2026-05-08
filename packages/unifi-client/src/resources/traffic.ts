import { z } from 'zod';
import type { ResolvedConfig } from '../config.js';
import type { HttpTransport } from '../transport/http.js';
import type { Session } from '../auth/session.js';
import { legacyList, v2Raw } from '../transport/helpers.js';
import {
  TrafficRuleSchema,
  TrafficRouteSchema,
  PortForwardSchema,
  RoutingRuleSchema,
  type TrafficRule,
  type TrafficRoute,
  type PortForward,
  type RoutingRule,
} from '../schemas/traffic.js';

export type { TrafficRule, TrafficRoute, PortForward, RoutingRule };

/** Traffic rules — application/domain/category-aware shaping rules (v2). */
export class TrafficRulesResource {
  constructor(
    private readonly config: ResolvedConfig,
    private readonly transport: HttpTransport,
    private readonly session: Session
  ) {}

  async list(): Promise<TrafficRule[]> {
    return v2Raw(
      this.config,
      this.transport,
      this.session,
      '/trafficrules',
      z.array(TrafficRuleSchema)
    );
  }
}

/** Traffic routes — source-based routes for VPN / split-tunnel scenarios (v2). */
export class TrafficRoutesResource {
  constructor(
    private readonly config: ResolvedConfig,
    private readonly transport: HttpTransport,
    private readonly session: Session
  ) {}

  async list(): Promise<TrafficRoute[]> {
    return v2Raw(
      this.config,
      this.transport,
      this.session,
      '/trafficroutes',
      z.array(TrafficRouteSchema)
    );
  }
}

/** Port forwards — legacy `/rest/portforward`. */
export class PortForwardsResource {
  constructor(
    private readonly config: ResolvedConfig,
    private readonly transport: HttpTransport,
    private readonly session: Session
  ) {}

  async list(): Promise<PortForward[]> {
    return legacyList(
      this.config,
      this.transport,
      this.session,
      '/rest/portforward',
      PortForwardSchema
    );
  }
}

/** Static routing rules — legacy `/rest/routing`. */
export class RoutingRulesResource {
  constructor(
    private readonly config: ResolvedConfig,
    private readonly transport: HttpTransport,
    private readonly session: Session
  ) {}

  async list(): Promise<RoutingRule[]> {
    return legacyList(
      this.config,
      this.transport,
      this.session,
      '/rest/routing',
      RoutingRuleSchema
    );
  }
}
