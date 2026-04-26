import { CheckCircle2, XCircle, Clock, Globe, Shield, Network, HardDrive } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

interface VLANReachabilityResult {
  targetVlan: string;
  targetVlanName: string;
  expected: 'allow' | 'block' | 'unknown';
  verdict: 'pass' | 'fail' | 'unknown' | 'conflict';
  confidence: number;
  reason: string;
  evidenceCount: number;
  evidenceSource: 'esp32' | 'server-local';
  direction: 'src_to_dst';
  // Deprecated legacy fields
  canReach: boolean;
  shouldBeBlocked: boolean;
}

interface DeviceReachabilityResult {
  deviceName: string;
  deviceIp: string;
  canReach: boolean;
}

interface VLANValidation {
  lastTestRunId: string | null;
  lastTestDate: string | null;
  sourceDeviceId: string | null;
  sourceType: 'esp32' | 'server-local' | 'unknown';
  partialEvidence: boolean;
  internetAccess: boolean | null;
  dnsFiltering: boolean | null;
  vlanReachability: VLANReachabilityResult[];
  deviceReachability: DeviceReachabilityResult[];
}

interface VLANValidationResultsProps {
  validation: VLANValidation | null;
  className?: string;
}

function ValidationStatus({
  value,
  label,
  icon: Icon,
  expected,
}: {
  value: boolean | null;
  label: string;
  icon: React.ElementType;
  expected?: boolean;
}) {
  const isCorrect = expected === undefined ? value === true : value === expected;

  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-muted-foreground">{label}</span>
      {value === null ? (
        <span className="text-muted-foreground">-</span>
      ) : isCorrect ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
      ) : (
        <XCircle className="h-3.5 w-3.5 text-red-500" />
      )}
    </div>
  );
}

export function VLANValidationResults({
  validation,
  className,
}: VLANValidationResultsProps) {
  if (!validation) {
    return (
      <div className={cn('text-sm text-muted-foreground', className)}>
        <div className="flex items-center gap-2">
          <Clock className="h-3.5 w-3.5" />
          <span>No validation tests run yet</span>
        </div>
      </div>
    );
  }

  const lastTestTime = validation.lastTestDate
    ? formatDistanceToNow(new Date(validation.lastTestDate), { addSuffix: true })
    : null;

  return (
    <div className={cn('space-y-2', className)}>
      {lastTestTime && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span>Last test: {lastTestTime}</span>
        </div>
      )}
      {validation.partialEvidence && (
        <div className="text-[11px] text-blue-400">
          Host-based validation from server-local on this VLAN (directional, partial coverage).
        </div>
      )}

      <div className="space-y-1.5 border-t pt-2">
        <ValidationStatus
          value={validation.internetAccess}
          label="Internet Access"
          icon={Globe}
        />
        <ValidationStatus
          value={validation.dnsFiltering}
          label="DNS Filtering"
          icon={Shield}
        />
      </div>

      {/* VLAN Reachability */}
      {validation.vlanReachability.length > 0 && (
        <div className="space-y-1.5 border-t pt-2">
          <div className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <Network className="h-3 w-3" />
            VLAN Reachability
          </div>
          {validation.vlanReachability.map((result) => {
            const verdict = result.verdict || 'unknown';
            const expected = result.expected || (result.shouldBeBlocked ? 'block' : 'allow');
            const verdictLabel =
              verdict === 'pass'
                ? 'PASS'
                : verdict === 'fail'
                ? 'FAIL'
                : verdict === 'conflict'
                ? 'CONFLICT'
                : 'UNKNOWN';
            return (
              <div
                key={result.targetVlan}
                className="space-y-0.5 text-xs pl-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{result.targetVlanName}</span>
                  <span
                    className={cn('flex items-center gap-1', {
                      'text-green-500': verdict === 'pass',
                      'text-red-500': verdict === 'fail',
                      'text-amber-500': verdict === 'unknown' || verdict === 'conflict',
                    })}
                  >
                    {verdict === 'pass' ? (
                      <CheckCircle2 className="h-3 w-3" />
                    ) : verdict === 'fail' ? (
                      <XCircle className="h-3 w-3" />
                    ) : (
                      <Clock className="h-3 w-3" />
                    )}
                    {verdictLabel}
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground/90">
                  {result.direction === 'src_to_dst' ? 'src → dst' : result.direction} • expected {expected} • observed {result.canReach ? 'reachable' : 'blocked'} • confidence {(result.confidence * 100).toFixed(0)}% • source {result.evidenceSource === 'server-local' ? 'server-local' : 'ESP32'}
                </div>
                {result.reason && (
                  <div className="text-[11px] text-muted-foreground/80">{result.reason}</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Device Reachability */}
      {validation.deviceReachability.length > 0 && (
        <div className="space-y-1.5 border-t pt-2">
          <div className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <HardDrive className="h-3 w-3" />
            Device Reachability
          </div>
          {validation.deviceReachability.map((result) => (
            <div
              key={result.deviceIp}
              className="flex items-center justify-between text-xs pl-4"
            >
              <span className="text-muted-foreground" title={result.deviceIp}>
                {result.deviceName}
              </span>
              <span
                className={cn('flex items-center gap-1', {
                  'text-green-500': result.canReach,
                  'text-red-500': !result.canReach,
                })}
              >
                {result.canReach ? (
                  <>
                    <CheckCircle2 className="h-3 w-3" />
                    Reachable
                  </>
                ) : (
                  <>
                    <XCircle className="h-3 w-3" />
                    Blocked
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
