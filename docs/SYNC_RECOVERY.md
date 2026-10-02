# UniFi sync recovery

Manual and scheduled configuration syncs use the same PostgreSQL lease key,
`unifi:configuration-sync`. The lease is global because active configuration and
client inventory are currently shared across connections. A second sync receives
`SYNC_IN_PROGRESS` without starting another history or controller request.

## Recovery behavior

The owner renews a two-minute lease every 30 seconds. PostgreSQL's clock decides
expiry. If a process crashes, a later manual or scheduled sync can claim the
expired lease and mark that connection's interrupted history as failed before
starting a new history. Scheduled recovery still requires an active connection
with automatic sync enabled. Sync Now remains available for a stale status.

Configuration, findings, timeline, inventory, and completion status publish in one
transaction that verifies and locks the lease. An expired owner cannot publish
after a replacement takes over, or release its replacement's lease. Database
renewal uncertainty stops further publication by that handle. No operator should
delete a lease to interrupt work: stop its process and let the lease expire.
After work finishes, cleanup revokes the local handle immediately and waits up to
five seconds for database bookkeeping. Cleanup failure or timeout does not replace
the committed result or original failure; an unreleased database lease expires.

Changing connection credentials, endpoint, site, certificate policy, or active
state during collection prevents the old result from publishing. Retry uses the
current settings. Sync failures are visible in the UI; the UI does not replay a
sync automatically or claim fresh analysis after an unsuccessful refresh.

## Rollout and rollback

Migration `20260907000100_add_job_leases` adds a table without deleting or
rewriting configuration or history. Apply the normal database migration before
starting the updated scheduler; Compose already waits for the migrated backend's
health check.

Use a coordinated backend and scheduler restart for the first rollout. Stop old
backend and scheduler processes before admitting work on the new version, since
old binaries do not honor leases. Avoid rolling deployments with mixed versions.
The scheduler has a 20-second drain budget and a five-second dependency cleanup
budget, with a 30-second Compose stop grace period. Work exceeding the drain
budget exits unsuccessfully and relies on lease expiry for recovery.

For a source rollback, stop upgraded workers before starting old binaries. Leave
the additive lease table in place; source rollback does not reverse migrations.
Old versions retain their previous concurrency and stuck-status limitations.
Stateful upgrade failure and database restore procedures remain tracked in
[issue #49](https://github.com/MKippen/ZeroProof/issues/49).

## Scope and validation

The lease coordinates the two manual UniFi configuration routes and scheduled
UniFi configuration sync. Manual imports, independent analysis, DNS/firewall
polls, and other detector work do not yet share it. The scheduler prevents each
scheduled job from overlapping itself within one process, but this does not
coordinate separate scheduler instances or different jobs writing shared data.
An alive worker that continues renewing can retain ownership; the lease is not
an overall controller-work deadline. Hardware/controller behavior still requires
deployment-specific validation.

Run `scripts/ci/test-sync-leases.sh` to verify fresh and upgrade migrations,
concurrent ownership, expiry and failure fencing, and the shared sync lifecycle
against disposable PostgreSQL 15 databases. The fixture stubs only controller
traffic for lifecycle cases and never uses the operator's database. Unit tests
cover scheduler admission/shutdown and HTTP/UI success and failure contracts.
