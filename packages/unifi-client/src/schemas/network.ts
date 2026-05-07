import { z } from 'zod';

/** UniFi network (VLAN/LAN config) — `GET /rest/networkconf`. */
export const NetworkSchema = z
  .object({
    _id: z.string(),
    name: z.string().optional(),
    purpose: z.string().optional(),
    vlan: z.union([z.number(), z.string()]).optional(),
    vlan_enabled: z.boolean().optional(),
    enabled: z.boolean().optional(),
    site_id: z.string().optional(),
    ip_subnet: z.string().optional(),
    domain_name: z.string().optional(),
    dhcpd_enabled: z.boolean().optional(),
    dhcpd_dns_enabled: z.boolean().optional(),
    dhcpd_dns_1: z.string().optional(),
    dhcpd_dns_2: z.string().optional(),
    dhcpd_dns_3: z.string().optional(),
    dhcpd_dns_4: z.string().optional(),
  })
  .passthrough();

export type Network = z.infer<typeof NetworkSchema>;

/** UniFi WLAN config — `GET /rest/wlanconf`. */
export const WlanSchema = z
  .object({
    _id: z.string(),
    name: z.string().optional(),
    enabled: z.boolean().optional(),
    security: z.string().optional(),
    wpa_mode: z.string().optional(),
    networkconf_id: z.string().optional(),
    site_id: z.string().optional(),
  })
  .passthrough();

export type Wlan = z.infer<typeof WlanSchema>;
