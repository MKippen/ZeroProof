/**
 * Settings card for the DNS allowlist.
 *
 * Two stacked sections:
 *   1. Built-in defaults — read-only list grouped by category, with
 *      per-entry and per-category toggles to disable.
 *   2. Your allowlist — CRUD over user-managed entries (global or
 *      device-scoped), with a backreference link to the finding that
 *      seeded each entry.
 *
 * Backed by /api/v1/dns-allowlist. The Detections page mirrors this
 * state via the same query key so an allowlist action there shows up
 * here immediately.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Globe, Smartphone, Trash2, X } from 'lucide-react';
import api from '@/api/client';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/useToast';
import { cn, formatDate } from '@/lib/utils';
import type {
  ApiResponse,
  DnsAllowlistState,
  DnsAllowlistUserEntry,
} from '@/types';

function requireData<T>(response: ApiResponse<T>): T {
  if (!response.success || response.data === undefined) {
    throw new Error(response.error?.message || 'Request failed');
  }
  return response.data;
}

function builtinKey(categoryId: string, domain: string): string {
  return `${categoryId}:${domain}`;
}
function builtinCategoryKey(categoryId: string): string {
  return `${categoryId}:*`;
}

export function DnsAllowlistSettings(): JSX.Element {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const stateQuery = useQuery({
    queryKey: ['dns-allowlist'],
    queryFn: async () =>
      requireData(await api.get<DnsAllowlistState>('/dns-allowlist')),
  });

  const toggleMutation = useMutation({
    mutationFn: async (keys: string[]) => {
      await api.put('/dns-allowlist/builtin-disabled', { keys });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['dns-allowlist'] });
    },
    onError: (err: Error) =>
      toast({ variant: 'destructive', title: 'Update failed', description: err.message }),
  });

  const createMutation = useMutation({
    mutationFn: async (body: {
      parentDomain: string;
      scope: 'GLOBAL' | 'DEVICE';
      deviceKey?: string;
      deviceLabel?: string;
      note?: string;
    }) => {
      const res = await api.post<{ id: string }>('/dns-allowlist', body);
      return requireData(res);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['dns-allowlist'] });
      toast({ title: 'Allowlist entry added' });
    },
    onError: (err: Error) =>
      toast({ variant: 'destructive', title: 'Add failed', description: err.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/dns-allowlist/${id}`);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['dns-allowlist'] });
    },
    onError: (err: Error) =>
      toast({ variant: 'destructive', title: 'Delete failed', description: err.message }),
  });

  const state = stateQuery.data;
  const disabled = useMemo(
    () => new Set(state?.disabledBuiltins ?? []),
    [state?.disabledBuiltins]
  );

  function toggleKey(key: string, currentlyDisabled: boolean): void {
    const next = new Set(disabled);
    if (currentlyDisabled) next.delete(key);
    else next.add(key);
    toggleMutation.mutate(Array.from(next));
  }

  if (stateQuery.isLoading) {
    return (
      <Card id="allowlist">
        <CardHeader>
          <CardTitle>DNS allowlist</CardTitle>
          <CardDescription>Loading…</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  if (!state) {
    return (
      <Card id="allowlist">
        <CardHeader>
          <CardTitle>DNS allowlist</CardTitle>
          <CardDescription>Failed to load allowlist.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div id="allowlist" className="space-y-6 scroll-mt-24">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            DNS allowlist — built-in defaults
          </CardTitle>
          <CardDescription>
            Known-safe domains that DNS detectors skip. Disable a category or
            individual domain to start seeing detections for it again.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {state.builtIn.categories.map((cat) => (
            <BuiltInCategory
              key={cat.id}
              category={cat}
              disabled={disabled}
              onToggle={toggleKey}
              busy={toggleMutation.isPending}
            />
          ))}
        </CardContent>
      </Card>

      <UserEntriesCard
        entries={state.userEntries}
        onCreate={(body) => createMutation.mutate(body)}
        onDelete={(id) => deleteMutation.mutate(id)}
        createBusy={createMutation.isPending}
        deleteBusy={deleteMutation.isPending}
      />
    </div>
  );
}

function BuiltInCategory({
  category,
  disabled,
  onToggle,
  busy,
}: {
  category: { id: string; label: string; domains: string[] };
  disabled: Set<string>;
  onToggle: (key: string, currentlyDisabled: boolean) => void;
  busy: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const catKey = builtinCategoryKey(category.id);
  const categoryDisabled = disabled.has(catKey);
  const activeCount = category.domains.filter(
    (d) => !disabled.has(builtinKey(category.id, d)) && !categoryDisabled
  ).length;

  return (
    <div className="rounded-md border border-border/60">
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="font-medium">{category.label}</span>
          <span className="text-xs text-muted-foreground">
            {activeCount}/{category.domains.length} active
          </span>
        </button>
        <Button
          variant={categoryDisabled ? 'outline' : 'ghost'}
          size="sm"
          disabled={busy}
          onClick={() => onToggle(catKey, categoryDisabled)}
          className="h-7 text-xs"
        >
          {categoryDisabled ? 'Enable all' : 'Disable all'}
        </Button>
      </div>
      {open && (
        <ul className="divide-y divide-border/40 border-t border-border/40">
          {category.domains.map((d) => {
            const key = builtinKey(category.id, d);
            const isDisabled = categoryDisabled || disabled.has(key);
            return (
              <li
                key={d}
                className={cn(
                  'flex items-center justify-between gap-3 px-4 py-1.5 text-sm',
                  isDisabled && 'opacity-60'
                )}
              >
                <span className="font-mono text-xs">*.{d}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy || categoryDisabled}
                  onClick={() => onToggle(key, disabled.has(key))}
                  className="h-6 px-2 text-xs"
                  title={
                    categoryDisabled
                      ? 'Whole category disabled'
                      : disabled.has(key)
                        ? 'Re-enable detections for this domain'
                        : 'Disable detections for this domain'
                  }
                >
                  {disabled.has(key) ? 'Enable' : 'Disable'}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function UserEntriesCard({
  entries,
  onCreate,
  onDelete,
  createBusy,
  deleteBusy,
}: {
  entries: DnsAllowlistUserEntry[];
  onCreate: (body: {
    parentDomain: string;
    scope: 'GLOBAL' | 'DEVICE';
    deviceKey?: string;
    deviceLabel?: string;
    note?: string;
  }) => void;
  onDelete: (id: string) => void;
  createBusy: boolean;
  deleteBusy: boolean;
}): JSX.Element {
  const [showForm, setShowForm] = useState(false);
  const [parentDomain, setParentDomain] = useState('');
  const [scope, setScope] = useState<'GLOBAL' | 'DEVICE'>('GLOBAL');
  const [deviceKey, setDeviceKey] = useState('');
  const [deviceLabel, setDeviceLabel] = useState('');
  const [note, setNote] = useState('');

  function submit(): void {
    const trimmed = parentDomain.trim().replace(/^\*\./, '').replace(/\.$/, '');
    if (!trimmed) return;
    if (scope === 'DEVICE' && !deviceKey.trim()) return;
    onCreate({
      parentDomain: trimmed,
      scope,
      deviceKey: scope === 'DEVICE' ? deviceKey.trim() : undefined,
      deviceLabel:
        scope === 'DEVICE' && deviceLabel.trim() ? deviceLabel.trim() : undefined,
      note: note.trim() ? note.trim() : undefined,
    });
    setParentDomain('');
    setDeviceKey('');
    setDeviceLabel('');
    setNote('');
    setShowForm(false);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Smartphone className="h-5 w-5" />
              Your allowlist
            </CardTitle>
            <CardDescription>
              Custom entries layered on top of the built-in defaults.
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant={showForm ? 'ghost' : 'default'}
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? (
              <>
                <X className="mr-1 h-3 w-3" /> Cancel
              </>
            ) : (
              '+ Add entry'
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {showForm && (
          <div className="mb-4 grid gap-3 rounded-md border border-border/60 p-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="al-domain">Parent domain</Label>
              <Input
                id="al-domain"
                placeholder="e.g. a2z.com"
                value={parentDomain}
                onChange={(e) => setParentDomain(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Subdomain match — adding <code>a2z.com</code> covers{' '}
                <code>foo.a2z.com</code> as well.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="al-scope">Scope</Label>
              <select
                id="al-scope"
                value={scope}
                onChange={(e) => setScope(e.target.value as 'GLOBAL' | 'DEVICE')}
                className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
              >
                <option value="GLOBAL">Everywhere</option>
                <option value="DEVICE">This device only</option>
              </select>
            </div>
            {scope === 'DEVICE' && (
              <>
                <div className="space-y-1">
                  <Label htmlFor="al-device-key">Device key (DNS client IP)</Label>
                  <Input
                    id="al-device-key"
                    placeholder="192.168.2.148"
                    value={deviceKey}
                    onChange={(e) => setDeviceKey(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="al-device-label">Friendly label (optional)</Label>
                  <Input
                    id="al-device-label"
                    placeholder="Kids Photo Frame"
                    value={deviceLabel}
                    onChange={(e) => setDeviceLabel(e.target.value)}
                  />
                </div>
              </>
            )}
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="al-note">Note (optional)</Label>
              <Input
                id="al-note"
                placeholder="Why is this safe?"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <Button onClick={submit} disabled={createBusy || !parentDomain.trim()}>
                {createBusy ? 'Adding…' : 'Add entry'}
              </Button>
            </div>
          </div>
        )}

        {entries.length === 0 ? (
          <div className="flex min-h-24 items-center justify-center rounded-md border border-dashed border-border/60 text-sm text-muted-foreground">
            No custom allowlist entries yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border/60">
            <table className="min-w-[700px] w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Domain</th>
                  <th className="px-3 py-2 font-medium">Scope</th>
                  <th className="px-3 py-2 font-medium">Added</th>
                  <th className="px-3 py-2 font-medium">From</th>
                  <th className="px-3 py-2 font-medium">Note</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {entries.map((e) => (
                  <tr key={e.id} className="align-top hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono text-xs">
                      *.{e.parentDomain}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {e.scope === 'GLOBAL' ? (
                        <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-emerald-300">
                          Everywhere
                        </span>
                      ) : (
                        <span>
                          <span className="rounded bg-blue-500/20 px-1.5 py-0.5 text-blue-300">
                            Device
                          </span>
                          <span className="ml-2 font-mono">
                            {e.deviceLabel ? `${e.deviceLabel} ` : ''}({e.deviceKey})
                          </span>
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                      {formatDate(e.createdAt)}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {e.sourceDetectionId ? (
                        <span className="font-mono text-muted-foreground">
                          {e.sourceDetectionId.slice(0, 8)}…
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Manual</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {e.note ?? '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={deleteBusy}
                        onClick={() => onDelete(e.id)}
                        className="h-7 px-2 text-xs"
                      >
                        <Trash2 className="mr-1 h-3 w-3" />
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
