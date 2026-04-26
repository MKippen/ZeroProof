import { useEffect, useState } from 'react';
import { Shield, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import api from '@/api/client';
import type { NetworkClientDetail } from '@/types';

export function ClientDetailPanel({
  mac,
  onClose,
}: {
  mac: string;
  onClose: () => void;
}) {
  const [client, setClient] = useState<NetworkClientDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isCurrent = true;
    setLoading(true);
    setClient(null);

    api.get<NetworkClientDetail>(`/timeline/clients/${mac}`)
      .then((res) => {
        if (!isCurrent) return;
        if (res.success && res.data) setClient(res.data);
        else setClient(null);
      })
      .catch(() => {
        if (!isCurrent) return;
        setClient(null);
      })
      .finally(() => {
        if (!isCurrent) return;
        setLoading(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [mac]);

  return (
    <div className="fixed inset-y-0 right-0 w-full sm:w-96 max-w-full bg-card border-l border-border/50 shadow-lg z-50 flex flex-col pb-[max(1rem,env(safe-area-inset-bottom))]">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border/50">
        <h3 className="text-sm font-semibold">Device Detail</h3>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <div className="animate-spin h-6 w-6 border-2 border-orange-500 border-t-transparent rounded-full" />
          </div>
        ) : client ? (
          <>
            {/* Device info */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Device Info</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Name</p>
                  <p className="font-medium break-words">{client.displayName || client.hostname || 'Unknown'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">MAC</p>
                  <p className="font-mono text-xs">{client.mac}</p>
                </div>
                {client.oui && (
                  <div>
                    <p className="text-xs text-muted-foreground">Manufacturer</p>
                    <p>{client.oui}</p>
                  </div>
                )}
                {client.lastIp && (
                  <div>
                    <p className="text-xs text-muted-foreground">IP Address</p>
                    <p className="font-mono text-xs">{client.lastIp}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-muted-foreground">Connection</p>
                  <p>{client.isWired ? 'Wired' : 'Wireless'}</p>
                </div>
              </div>
            </div>

            {/* Network context */}
            {client.network && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Network</h4>
                <div className="p-3 rounded-lg bg-muted/30 border border-border/30 space-y-1 text-sm">
                  <p><span className="text-muted-foreground">Network:</span> {client.network.name}</p>
                  {client.network.vlan !== undefined && (
                    <p><span className="text-muted-foreground">VLAN:</span> {client.network.vlan}</p>
                  )}
                  {client.network.subnet && (
                    <p><span className="text-muted-foreground">Subnet:</span> {client.network.subnet}</p>
                  )}
                  {client.network.isGuest && (
                    <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-xs bg-yellow-500/20 text-yellow-400">Guest Network</span>
                  )}
                </div>
              </div>
            )}

            {/* WiFi network */}
            {client.wifiNetwork && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">WiFi</h4>
                <div className="p-3 rounded-lg bg-muted/30 border border-border/30 space-y-1 text-sm">
                  <p><span className="text-muted-foreground">SSID:</span> {client.wifiNetwork.ssid}</p>
                  <p><span className="text-muted-foreground">Security:</span> {client.wifiNetwork.security}</p>
                </div>
              </div>
            )}

            {/* Firewall rules */}
            {client.applicableFirewallRules && client.applicableFirewallRules.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Applicable Firewall Rules</h4>
                <div className="space-y-1">
                  {client.applicableFirewallRules.map((rule, i) => (
                    <div key={i} className="flex items-center gap-2 p-2 rounded bg-muted/20 border border-border/20 text-xs">
                      <Shield className="h-3 w-3 text-muted-foreground" />
                      <span className="flex-1">{rule.name}</span>
                      <span className={cn(
                        'px-1.5 py-0.5 rounded text-[10px] font-medium',
                        rule.action === 'drop' || rule.action === 'reject'
                          ? 'bg-red-500/20 text-red-400'
                          : 'bg-green-500/20 text-green-400'
                      )}>
                        {rule.action}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Timestamps */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tracking</h4>
              <div className="text-sm space-y-1">
                {client.unifiFirstSeen && (
                  <p><span className="text-muted-foreground">First seen:</span> {new Date(client.unifiFirstSeen).toLocaleDateString()}</p>
                )}
                {client.unifiLastSeen && (
                  <p><span className="text-muted-foreground">Last seen:</span> {new Date(client.unifiLastSeen).toLocaleDateString()}</p>
                )}
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-8">Client not found</p>
        )}
      </div>
    </div>
  );
}
