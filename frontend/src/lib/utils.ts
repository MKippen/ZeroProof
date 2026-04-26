import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes}m ${secs}s`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

export function severityColor(severity: string): string {
  switch (severity.toUpperCase()) {
    case 'CRITICAL':
      return 'text-red-600 bg-red-100';
    case 'HIGH':
      return 'text-orange-600 bg-orange-100';
    case 'MEDIUM':
      return 'text-yellow-600 bg-yellow-100';
    case 'LOW':
      return 'text-blue-600 bg-blue-100';
    case 'INFO':
      return 'text-gray-600 bg-gray-100';
    default:
      return 'text-gray-600 bg-gray-100';
  }
}

export function statusColor(status: string): string {
  switch (status.toUpperCase()) {
    case 'ONLINE':
    case 'COMPLETED':
    case 'FIXED':
      return 'text-green-600 bg-green-100';
    case 'OFFLINE':
    case 'CANCELLED':
      return 'text-gray-600 bg-gray-100';
    case 'TESTING':
    case 'RUNNING':
    case 'QUEUED':
    case 'ACKNOWLEDGED':
      return 'text-blue-600 bg-blue-100';
    case 'ERROR':
    case 'FAILED':
    case 'OPEN':
      return 'text-red-600 bg-red-100';
    case 'FALSE_POSITIVE':
      return 'text-purple-600 bg-purple-100';
    default:
      return 'text-gray-600 bg-gray-100';
  }
}

export function getScoreColor(score: number): string {
  if (score >= 80) return 'text-green-600';
  if (score >= 60) return 'text-yellow-600';
  if (score >= 40) return 'text-orange-600';
  return 'text-red-600';
}

export function getScoreBgColor(score: number): string {
  if (score >= 80) return 'bg-green-500';
  if (score >= 60) return 'bg-yellow-500';
  if (score >= 40) return 'bg-orange-500';
  return 'bg-red-500';
}

/**
 * Check if a network is a WAN/Internet network (should be excluded from most selections)
 */
export function isWanNetwork(network: { name?: string; purpose?: string }): boolean {
  const name = network.name?.toLowerCase() || '';
  const purpose = network.purpose?.toLowerCase() || '';
  return (
    purpose === 'wan' ||
    name.includes('internet') ||
    name.includes('wan') ||
    name.startsWith('wan')
  );
}

/**
 * Filter networks to only include internal/LAN networks (exclude WAN/Internet)
 * Use this everywhere networks are displayed in dropdowns or selections
 */
export function filterInternalNetworks<T extends { name?: string; purpose?: string }>(
  networks: T[]
): T[] {
  return networks.filter((n) => !isWanNetwork(n));
}
