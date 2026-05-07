import { z } from 'zod';

/** UniFi event — historical activity log. `GET /stat/event`. */
export const EventSchema = z
  .object({
    _id: z.string().optional(),
    key: z.string().optional(),
    msg: z.string().optional(),
    time: z.number().optional(),
    datetime: z.string().optional(),
    site_id: z.string().optional(),
    subsystem: z.string().optional(),
    is_negative: z.boolean().optional(),
  })
  .passthrough();

export type SystemEvent = z.infer<typeof EventSchema>;

/** UniFi alarm — `GET /stat/alarm`. */
export const AlarmSchema = z
  .object({
    _id: z.string().optional(),
    key: z.string().optional(),
    msg: z.string().optional(),
    time: z.number().optional(),
    datetime: z.string().optional(),
    site_id: z.string().optional(),
    archived: z.boolean().optional(),
    handled_admin_id: z.string().optional(),
  })
  .passthrough();

export type Alarm = z.infer<typeof AlarmSchema>;

/**
 * `GET /api/s/{site}/stat/sysinfo` — controller info used to surface the
 * controller version and gateway uptime.
 */
export const SysInfoSchema = z
  .object({
    version: z.string().optional(),
    build: z.string().optional(),
    hostname: z.string().optional(),
    autobackup: z.boolean().optional(),
    timezone: z.string().optional(),
    udm_version: z.string().optional(),
    name: z.string().optional(),
    uptime: z.number().optional(),
  })
  .passthrough();

export type SysInfo = z.infer<typeof SysInfoSchema>;

/** Generic settings entry returned by `/get/setting` (one per `key`). */
export const SettingsEntrySchema = z
  .object({
    _id: z.string().optional(),
    key: z.string(),
    site_id: z.string().optional(),
  })
  .passthrough();

export type SettingsEntry = z.infer<typeof SettingsEntrySchema>;
