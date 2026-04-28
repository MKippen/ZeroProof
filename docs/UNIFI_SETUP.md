# Connecting ZeroProof to your UniFi controller

ZeroProof reads configuration from your UniFi Network Application to detect
security gaps. It never writes back. This guide walks through the safest way
to wire it up.

## TL;DR

1. Create a dedicated **read-only** UniFi user — never use Owner / Super Admin.
2. Confirm the ZeroProof server can reach your controller on the network.
3. Enter the host, port, username, and password on **/config** in ZeroProof.

That's it. The rest of this document explains each step in detail.

---

## 1. Create a read-only UniFi account

ZeroProof only needs read access. Creating a dedicated account with the
minimum role gives you three things:

- A clear audit trail in UniFi for everything ZeroProof touches.
- Damage containment — if the credentials leak, the worst case is "someone
  read your config", not "someone changed your network."
- Proof, in your own settings, that ZeroProof can't make changes.

### UniFi OS (UDM, UDR, UCG, Cloud Key Gen2+)

1. Open the UniFi UI at `https://<your-controller>` and sign in as Owner.
2. Go to **Settings → Admins & Users**.
3. Click **+ Invite Admin** (or the equivalent **Add Admin** button).
4. Choose **Restrict to local access only** so the account exists only
   inside your network.
5. Set:
   - **Username:** `zeroproof` (or anything you prefer)
   - **Password:** a strong password — store it in your password manager.
   - **Role:** **Limited Admin** with **Read Only** site access.
6. Save.

### Self-hosted UniFi Network Application (legacy)

1. Open the UI at `https://<your-controller>:8443`.
2. **Settings → Admins → Add New Admin** (the wording varies by version).
3. Pick **Limited Admin** and set the controller-wide role to **Read
   Only**. Make sure no Super Admin or Site Admin role is selected.
4. Save and verify the new account can log into the UI but cannot change
   anything.

> ZeroProof has been tested against the read-only role; if you find an
> endpoint that requires elevated permissions, please open an issue —
> that's a bug in ZeroProof, not a reason to upgrade your role.

## 2. Verify network reachability

The ZeroProof server has to be able to reach your controller's HTTPS port.
Two common gotchas:

- **VLAN isolation.** If ZeroProof runs on a Server / Trust VLAN and your
  controller is on a different VLAN, your firewall will silently drop the
  traffic. In UniFi, add a **Traffic Rule** that allows traffic from the
  ZeroProof server's IP (source) to the controller (destination) on the
  controller's HTTPS port (443 for UniFi OS, 8443 for legacy).
- **Loopback / port forwards / tunnels.** If your saved connection points
  at `127.0.0.1:<some-port>`, that's a tunnel — and tunnels go down. For
  long-lived setups, prefer the controller's real LAN IP and standard port.

A quick reachability check from the host running ZeroProof:

```bash
curl -sk https://<controller-ip>:443/ -o /dev/null -w "%{http_code}\n"
```

A `200` means you can reach it. A `connection refused` or timeout means
firewall rules need to change before going further.

## 3. Configure the connection in ZeroProof

1. Open ZeroProof and sign in.
2. Go to **/config** (the **UniFi Configuration** page).
3. In **Controller Connection Settings**, enter:
   - **Host / IP:** the controller's LAN IP (e.g. `192.168.1.1`).
   - **Port:** `443` for UniFi OS hardware, `8443` for self-hosted.
   - **Username / Password:** the read-only account you created above.
   - **Verify SSL certificate:** leave unchecked unless you've installed
     your own certificate on the controller. UniFi ships with a
     self-signed cert that will fail verification.
4. Click **Test Connection**. ZeroProof reports the controller version on
   success.
5. Click **Save Settings**. Then **Sync Configuration Now** to pull the
   first snapshot.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `Cannot connect to <host>:<port> - connection refused` | Tunnel down, firewall blocking, or wrong port. Try `443` if `8443` failed. |
| `Connection failed` with HTTP 401 | Wrong username/password, or the read-only account hasn't been saved. |
| `Verify SSL certificate` fails | UniFi self-signed cert. Uncheck **Verify SSL** unless you've installed a real cert. |
| Sync succeeds but timeline shows everything on one day | First-sync bootstrap pulls UniFi-native dates from `/stat/event`, alarms, and Mongo ObjectId timestamps. Anything older than your controller's event retention falls back to "now". This is a UniFi limit, not a ZeroProof bug. |

## What ZeroProof reads (and never writes)

ZeroProof's UniFi client is read-only by construction — there are no
`POST` / `PUT` / `DELETE` calls in the controller path. The endpoints
it touches:

- `/api/login` — authenticate
- `/api/self/sites` — list sites
- `/api/s/{site}/stat/sysinfo` — controller version
- `/api/s/{site}/stat/device` — devices (UAP/USW/UDM/etc.)
- `/api/s/{site}/stat/sta` and `/stat/alluser` — clients
- `/api/s/{site}/stat/event`, `/stat/alarm` — event/alarm history
- `/api/s/{site}/rest/networkconf`, `/rest/wlanconf`,
  `/rest/firewallrule`, `/rest/firewallgroup`, `/rest/portforward`,
  `/rest/routing`, `/rest/trafficrule`, `/rest/aclrule`,
  `/rest/setting` — config snapshots
- `/proxy/network/v2/api/site/{site}/firewall-policies`,
  `/firewall-zones`, `/acl-rules` — V2 zone/policy/ACL data

If you want to verify, the source is in
[`backend/src/services/unifiClient.ts`](../backend/src/services/unifiClient.ts).
