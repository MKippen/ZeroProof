/**
 * Direct tests for transport/helpers.ts — covers the cases where the v2
 * envelope omits optional metadata fields (the controller occasionally elides
 * `total_page_count` etc.) and falls back to safe defaults.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { resolveConfig } from '../src/config.js';
import { Session } from '../src/auth/session.js';
import { v2PaginatedPost, legacyList, v2Raw } from '../src/transport/helpers.js';
import { MockTransport } from './helpers/MockTransport.js';

const config = resolveConfig({
  host: 'h',
  port: 443,
  username: 'u',
  password: 'p',
});

const ItemSchema = z.object({ id: z.string() });

describe('v2PaginatedPost', () => {
  it('returns hasNext from explicit `has_next` flag when present', async () => {
    const transport = new MockTransport().on(
      'POST',
      '/proxy/network/v2/api/site/default/x',
      () => ({
        data: {
          data: [{ id: 'a' }],
          page_number: 0,
          total_element_count: 5,
          total_page_count: 3,
          has_next: true,
        },
      })
    );
    const session = new Session();
    const result = await v2PaginatedPost(config, transport, session, '/x', {}, ItemSchema);
    expect(result.hasNext).toBe(true);
    expect(result.totalElementCount).toBe(5);
  });

  it('falls back to page_number < total_page_count - 1 when has_next is missing', async () => {
    const transport = new MockTransport().on(
      'POST',
      '/proxy/network/v2/api/site/default/x',
      () => ({
        data: {
          data: [{ id: 'a' }],
          page_number: 0,
          total_element_count: 10,
          total_page_count: 3,
        },
      })
    );
    const session = new Session();
    const result = await v2PaginatedPost(config, transport, session, '/x', {}, ItemSchema);
    expect(result.hasNext).toBe(true);
  });

  it('returns hasNext=false on a single-page response', async () => {
    const transport = new MockTransport().on(
      'POST',
      '/proxy/network/v2/api/site/default/x',
      () => ({
        data: {
          data: [{ id: 'a' }],
          page_number: 0,
          total_element_count: 1,
          total_page_count: 1,
        },
      })
    );
    const session = new Session();
    const result = await v2PaginatedPost(config, transport, session, '/x', {}, ItemSchema);
    expect(result.hasNext).toBe(false);
  });

  it('handles envelopes that omit total_page_count entirely', async () => {
    const transport = new MockTransport().on(
      'POST',
      '/proxy/network/v2/api/site/default/x',
      () => ({
        data: {
          data: [{ id: 'a' }],
          page_number: 0,
          total_element_count: 1,
        },
      })
    );
    const session = new Session();
    const result = await v2PaginatedPost(config, transport, session, '/x', {}, ItemSchema);
    expect(result.totalPageCount).toBe(0);
    expect(result.hasNext).toBe(false);
  });
});

describe('legacyList', () => {
  it('extracts the data array from the meta/data envelope', async () => {
    const transport = new MockTransport().on(
      'GET',
      '/proxy/network/api/s/default/foo',
      () => ({ data: { meta: { rc: 'ok' }, data: [{ id: 'one' }, { id: 'two' }] } })
    );
    const session = new Session();
    const items = await legacyList(config, transport, session, '/foo', ItemSchema);
    expect(items.map((i) => i.id)).toEqual(['one', 'two']);
  });

  it('returns empty array on empty envelope', async () => {
    const transport = new MockTransport().on(
      'GET',
      '/proxy/network/api/s/default/foo',
      () => ({ data: { meta: { rc: 'ok' }, data: [] } })
    );
    const session = new Session();
    const items = await legacyList(config, transport, session, '/foo', ItemSchema);
    expect(items).toEqual([]);
  });
});

describe('v2Raw', () => {
  it('passes the raw response through the schema verbatim', async () => {
    const transport = new MockTransport().on(
      'GET',
      '/proxy/network/v2/api/site/default/foo',
      () => ({ data: [{ id: 'a' }, { id: 'b' }] })
    );
    const session = new Session();
    const result = await v2Raw(config, transport, session, '/foo', z.array(ItemSchema));
    expect(result).toEqual([{ id: 'a' }, { id: 'b' }]);
  });
});
