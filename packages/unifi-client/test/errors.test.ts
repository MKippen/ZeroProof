import { describe, it, expect } from 'vitest';
import {
  UnifiError,
  UnifiAuthError,
  UnifiNotFoundError,
  UnifiTransportError,
  UnifiResponseError,
} from '../src/errors.js';

describe('UnifiError hierarchy', () => {
  it('UnifiError preserves message and cause', () => {
    const cause = new Error('underlying');
    const err = new UnifiError('something broke', { cause });
    expect(err.message).toBe('something broke');
    expect(err.cause).toBe(cause);
    expect(err.name).toBe('UnifiError');
    expect(err).toBeInstanceOf(Error);
  });

  it('UnifiError works without options', () => {
    const err = new UnifiError('plain');
    expect(err.cause).toBeUndefined();
  });

  it('UnifiAuthError carries statusCode', () => {
    const err = new UnifiAuthError('bad creds', { statusCode: 401 });
    expect(err.statusCode).toBe(401);
    expect(err.name).toBe('UnifiAuthError');
    expect(err).toBeInstanceOf(UnifiError);
  });

  it('UnifiNotFoundError formats path into message', () => {
    const err = new UnifiNotFoundError('/api/missing');
    expect(err.message).toContain('/api/missing');
    expect(err.path).toBe('/api/missing');
    expect(err.name).toBe('UnifiNotFoundError');
  });

  it('UnifiTransportError carries optional statusCode and path', () => {
    const err = new UnifiTransportError('socket hang up', { statusCode: 502, path: '/api/foo' });
    expect(err.statusCode).toBe(502);
    expect(err.path).toBe('/api/foo');
    expect(err.name).toBe('UnifiTransportError');
  });

  it('UnifiResponseError summarizes up to 3 issues in message', () => {
    const issues = [
      { path: 'data.0.id', message: 'Required' },
      { path: 'data.1.action', message: 'Expected string, got null' },
      { path: 'data.2.policies.0.name', message: 'Required' },
      { path: 'data.3.id', message: 'Required' },
    ];
    const err = new UnifiResponseError('/v2/api/site/default/foo', issues);
    expect(err.path).toBe('/v2/api/site/default/foo');
    expect(err.issues).toEqual(issues);
    expect(err.message).toContain('data.0.id');
    expect(err.message).toContain('data.1.action');
    expect(err.message).toContain('data.2.policies.0.name');
    expect(err.message).toContain('…'); // 4th issue elided
  });

  it('UnifiResponseError handles small issue arrays without ellipsis', () => {
    const err = new UnifiResponseError('/p', [{ path: 'foo', message: 'bar' }]);
    expect(err.message).not.toContain('…');
  });

  it('all subclasses inherit from UnifiError for catch-all handling', () => {
    expect(new UnifiAuthError('a')).toBeInstanceOf(UnifiError);
    expect(new UnifiNotFoundError('p')).toBeInstanceOf(UnifiError);
    expect(new UnifiTransportError('m')).toBeInstanceOf(UnifiError);
    expect(new UnifiResponseError('p', [])).toBeInstanceOf(UnifiError);
  });
});
