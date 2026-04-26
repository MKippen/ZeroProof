import { describe, it, expect } from 'vitest';
import { cn, formatDate, formatDuration, severityColor, statusColor, getScoreColor, isWanNetwork, filterInternalNetworks } from '@/lib/utils';

describe('Utility Functions', () => {
  describe('cn (classNames)', () => {
    it('merges class names', () => {
      expect(cn('foo', 'bar')).toBe('foo bar');
    });

    it('handles conditional classes', () => {
      expect(cn('foo', false && 'bar', 'baz')).toBe('foo baz');
      expect(cn('foo', true && 'bar', 'baz')).toBe('foo bar baz');
    });

    it('handles undefined and null', () => {
      expect(cn('foo', undefined, null, 'bar')).toBe('foo bar');
    });

    it('merges tailwind classes correctly', () => {
      // Should dedupe conflicting classes
      expect(cn('px-2', 'px-4')).toBe('px-4');
      expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
    });
  });

  describe('formatDate', () => {
    it('formats date correctly', () => {
      const date = new Date('2024-01-15T10:30:00Z');
      const formatted = formatDate(date);
      expect(formatted).toBeDefined();
      expect(typeof formatted).toBe('string');
      expect(formatted).toContain('2024');
    });

    it('handles string dates', () => {
      const formatted = formatDate('2024-01-15T10:30:00Z');
      expect(formatted).toBeDefined();
    });
  });

  describe('formatDuration', () => {
    it('formats seconds', () => {
      expect(formatDuration(30)).toBe('30s');
    });

    it('formats minutes and seconds', () => {
      expect(formatDuration(90)).toBe('1m 30s');
    });

    it('formats hours and minutes', () => {
      expect(formatDuration(3660)).toBe('1h 1m');
    });
  });

  describe('severityColor', () => {
    it('returns correct colors for severity levels', () => {
      expect(severityColor('CRITICAL')).toContain('red');
      expect(severityColor('HIGH')).toContain('orange');
      expect(severityColor('MEDIUM')).toContain('yellow');
      expect(severityColor('LOW')).toContain('blue');
      expect(severityColor('INFO')).toContain('gray');
    });

    it('handles lowercase input', () => {
      expect(severityColor('critical')).toContain('red');
    });

    it('returns default for unknown severity', () => {
      expect(severityColor('UNKNOWN')).toContain('gray');
    });
  });

  describe('statusColor', () => {
    it('returns green for success statuses', () => {
      expect(statusColor('ONLINE')).toContain('green');
      expect(statusColor('COMPLETED')).toContain('green');
      expect(statusColor('FIXED')).toContain('green');
    });

    it('returns red for error statuses', () => {
      expect(statusColor('ERROR')).toContain('red');
      expect(statusColor('FAILED')).toContain('red');
    });

    it('returns blue for in-progress statuses', () => {
      expect(statusColor('TESTING')).toContain('blue');
      expect(statusColor('RUNNING')).toContain('blue');
    });
  });

  describe('getScoreColor', () => {
    it('returns green for high scores', () => {
      expect(getScoreColor(80)).toContain('green');
      expect(getScoreColor(100)).toContain('green');
    });

    it('returns yellow for medium scores', () => {
      expect(getScoreColor(60)).toContain('yellow');
      expect(getScoreColor(79)).toContain('yellow');
    });

    it('returns orange for low scores', () => {
      expect(getScoreColor(40)).toContain('orange');
      expect(getScoreColor(59)).toContain('orange');
    });

    it('returns red for very low scores', () => {
      expect(getScoreColor(0)).toContain('red');
      expect(getScoreColor(39)).toContain('red');
    });
  });

  describe('isWanNetwork', () => {
    it('identifies WAN networks', () => {
      expect(isWanNetwork({ purpose: 'wan' })).toBe(true);
      expect(isWanNetwork({ name: 'Internet' })).toBe(true);
      expect(isWanNetwork({ name: 'WAN Gateway' })).toBe(true);
    });

    it('returns false for LAN networks', () => {
      expect(isWanNetwork({ name: 'Home LAN' })).toBe(false);
      expect(isWanNetwork({ name: 'IoT Network' })).toBe(false);
      expect(isWanNetwork({ purpose: 'corporate' })).toBe(false);
    });
  });

  describe('filterInternalNetworks', () => {
    it('filters out WAN networks', () => {
      const networks = [
        { name: 'LAN', purpose: 'corporate' },
        { name: 'Internet', purpose: 'wan' },
        { name: 'IoT', purpose: 'iot' },
      ];

      const filtered = filterInternalNetworks(networks);
      expect(filtered).toHaveLength(2);
      expect(filtered.map(n => n.name)).not.toContain('Internet');
    });
  });
});
