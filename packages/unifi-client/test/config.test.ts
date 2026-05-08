import { describe, it, expect, vi } from 'vitest';
import { resolveConfig } from '../src/config.js';

describe('resolveConfig', () => {
  const baseInput = {
    host: '192.168.1.1',
    port: 443,
    username: 'admin',
    password: 'hunter2',
  };

  it('applies sensible defaults when only required fields are passed', () => {
    const resolved = resolveConfig(baseInput);
    expect(resolved.siteId).toBe('default');
    expect(resolved.allowSelfSigned).toBe(false);
    expect(resolved.basePath).toBe('/proxy/network');
    expect(resolved.timeoutMs).toBe(30_000);
    expect(typeof resolved.now()).toBe('number');
  });

  it('passes through explicit overrides', () => {
    const resolved = resolveConfig({
      ...baseInput,
      siteId: 'east-coast',
      allowSelfSigned: true,
      basePath: '/network',
      timeoutMs: 5000,
    });
    expect(resolved.siteId).toBe('east-coast');
    expect(resolved.allowSelfSigned).toBe(true);
    expect(resolved.basePath).toBe('/network');
    expect(resolved.timeoutMs).toBe(5000);
  });

  it('treats allowSelfSigned as opt-in — only `true` enables it', () => {
    expect(resolveConfig({ ...baseInput, allowSelfSigned: undefined }).allowSelfSigned).toBe(false);
    // @ts-expect-error — guarding against truthy non-boolean inputs leaking through
    expect(resolveConfig({ ...baseInput, allowSelfSigned: 1 }).allowSelfSigned).toBe(false);
    expect(resolveConfig({ ...baseInput, allowSelfSigned: false }).allowSelfSigned).toBe(false);
    expect(resolveConfig({ ...baseInput, allowSelfSigned: true }).allowSelfSigned).toBe(true);
  });

  it('throws on missing required fields with a clear message', () => {
    expect(() => resolveConfig({ ...baseInput, host: '' })).toThrow(/host/);
    expect(() => resolveConfig({ ...baseInput, username: '' })).toThrow(/username/);
    expect(() => resolveConfig({ ...baseInput, password: '' })).toThrow(/password/);
  });

  it('falls back to silent logger when none provided', () => {
    const resolved = resolveConfig(baseInput);
    // None of these should throw or have side effects
    resolved.logger.debug('x');
    resolved.logger.info('x');
    resolved.logger.warn('x');
    resolved.logger.error('x');
  });

  it('fills in missing logger methods with no-ops', () => {
    const debug = vi.fn();
    const resolved = resolveConfig({ ...baseInput, logger: { debug } });
    resolved.logger.debug('hello');
    expect(debug).toHaveBeenCalledWith('hello');
    // info/warn/error should be no-ops without throwing
    expect(() => resolved.logger.info('x')).not.toThrow();
  });

  it('uses caller-provided clock', () => {
    const resolved = resolveConfig({ ...baseInput, now: () => 12345 });
    expect(resolved.now()).toBe(12345);
  });
});
