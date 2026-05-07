import type { ResolvedConfig } from '../config.js';
import type { HttpTransport } from '../transport/http.js';
import type { Session } from '../auth/session.js';
import { legacyList } from '../transport/helpers.js';
import {
  EventSchema,
  AlarmSchema,
  SysInfoSchema,
  SettingsEntrySchema,
  type SystemEvent,
  type Alarm,
  type SysInfo,
  type SettingsEntry,
} from '../schemas/system.js';

export type { SystemEvent, Alarm, SysInfo, SettingsEntry };

/**
 * Events resource — historical activity log entries from `/stat/event`. Each
 * entry has a `key` (e.g. `EVT_AP_CONNECTED`), an `msg`, and a `time`.
 */
export class EventsResource {
  constructor(
    private readonly config: ResolvedConfig,
    private readonly transport: HttpTransport,
    private readonly session: Session
  ) {}

  /** List recent events. `limit` is server-side capped via `_limit` query param. */
  async list(options: { limit?: number } = {}): Promise<SystemEvent[]> {
    const path = options.limit !== undefined ? `/stat/event?_limit=${options.limit}` : '/stat/event';
    return legacyList(this.config, this.transport, this.session, path, EventSchema);
  }
}

/** Alarms resource — active operational alarms from `/stat/alarm`. */
export class AlarmsResource {
  constructor(
    private readonly config: ResolvedConfig,
    private readonly transport: HttpTransport,
    private readonly session: Session
  ) {}

  /** List recent alarms (default: server's default limit). */
  async list(options: { limit?: number } = {}): Promise<Alarm[]> {
    const path = options.limit !== undefined ? `/stat/alarm?_limit=${options.limit}` : '/stat/alarm';
    return legacyList(this.config, this.transport, this.session, path, AlarmSchema);
  }
}

/** System info / sysinfo resource — controller version, hostname, uptime. */
export class SystemInfoResource {
  constructor(
    private readonly config: ResolvedConfig,
    private readonly transport: HttpTransport,
    private readonly session: Session
  ) {}

  async get(): Promise<SysInfo | null> {
    const rows = await legacyList(
      this.config,
      this.transport,
      this.session,
      '/stat/sysinfo',
      SysInfoSchema
    );
    return rows[0] ?? null;
  }

  /** Convenience accessor — returns `version` from sysinfo, or null if unavailable. */
  async getControllerVersion(): Promise<string | null> {
    const info = await this.get();
    return info?.version ?? null;
  }
}

/** Site settings — heterogeneous list keyed by `key`. */
export class SettingsResource {
  constructor(
    private readonly config: ResolvedConfig,
    private readonly transport: HttpTransport,
    private readonly session: Session
  ) {}

  /** All settings entries on this site (one per setting `key`). */
  async list(): Promise<SettingsEntry[]> {
    return legacyList(
      this.config,
      this.transport,
      this.session,
      '/get/setting',
      SettingsEntrySchema
    );
  }

  /** Find a single settings entry by key. */
  async getByKey(key: string): Promise<SettingsEntry | null> {
    const all = await this.list();
    return all.find((entry) => entry.key === key) ?? null;
  }
}
