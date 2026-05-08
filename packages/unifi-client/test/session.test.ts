import { describe, it, expect } from 'vitest';
import { Session } from '../src/auth/session.js';

describe('Session', () => {
  it('starts logged out with no auth headers', () => {
    const s = new Session();
    expect(s.isLoggedIn()).toBe(false);
    expect(s.authHeaders()).toEqual({});
  });

  it('captures cookies from set-cookie header (string array)', () => {
    const s = new Session();
    s.ingestResponseHeaders({
      'set-cookie': ['TOKEN=abc; Path=/; HttpOnly', 'csrf=xyz; Secure'],
    });
    const headers = s.authHeaders();
    expect(headers.Cookie).toBe('TOKEN=abc; csrf=xyz');
  });

  it('handles a single set-cookie value (not in an array)', () => {
    const s = new Session();
    s.ingestResponseHeaders({
      'set-cookie': 'unifises=session-id; Path=/',
    } as never);
    expect(s.authHeaders().Cookie).toBe('unifises=session-id');
  });

  it('captures CSRF token from x-csrf-token header', () => {
    const s = new Session();
    s.ingestResponseHeaders({ 'x-csrf-token': 'csrf-value' });
    expect(s.authHeaders()['X-CSRF-Token']).toBe('csrf-value');
  });

  it('captures CSRF token from array-form header', () => {
    const s = new Session();
    s.ingestResponseHeaders({ 'x-csrf-token': ['array-csrf', 'second'] });
    expect(s.authHeaders()['X-CSRF-Token']).toBe('array-csrf');
  });

  it('does not set CSRF when header is missing or blank', () => {
    const s = new Session();
    s.ingestResponseHeaders({});
    expect(s.authHeaders()['X-CSRF-Token']).toBeUndefined();
    s.ingestResponseHeaders({ 'x-csrf-token': '' });
    expect(s.authHeaders()['X-CSRF-Token']).toBeUndefined();
  });

  it('markLoggedIn / markLoggedOut toggle the flag', () => {
    const s = new Session();
    s.markLoggedIn();
    expect(s.isLoggedIn()).toBe(true);
    s.markLoggedOut();
    expect(s.isLoggedIn()).toBe(false);
  });

  it('markLoggedOut clears cookies and CSRF', () => {
    const s = new Session();
    s.ingestResponseHeaders({ 'set-cookie': ['T=1'], 'x-csrf-token': 'csrf' });
    s.markLoggedIn();
    s.markLoggedOut();
    expect(s.authHeaders()).toEqual({});
  });

  it('strips cookie attributes (only key=value pairs preserved)', () => {
    const s = new Session();
    s.ingestResponseHeaders({
      'set-cookie': ['SESSION=abcdef; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600'],
    });
    expect(s.authHeaders().Cookie).toBe('SESSION=abcdef');
  });
});
