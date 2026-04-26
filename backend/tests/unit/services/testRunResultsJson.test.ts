jest.mock('../../../src/services/database', () => ({
  __esModule: true,
  default: {
    testRun: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

import { buildStructuredResultsJson } from '../../../src/services/testRunResultsJson';

describe('testRunResultsJson', () => {
  it('preserves metadata and normalizes structured result fields', () => {
    const existing = {
      metadata: {
        topologyMetadata: { testTargets: [{ ip: '10.0.0.5', port: 80 }] },
      },
    };
    const incoming = {
      results: [{ op: 'tcp_connect', data: { host: '10.0.0.5', port: 80, open: false } }],
      transport: { chunked: true, chunkCount: 2 },
    };

    const structured = buildStructuredResultsJson(existing, incoming, {
      receivedChunks: 2,
      incomplete: false,
    });

    expect(structured.metadata).toBeDefined();
    expect((structured.metadata as Record<string, unknown>).topologyMetadata).toBeDefined();
    expect(Array.isArray(structured.commandResults)).toBe(true);
    expect(Array.isArray(structured.results)).toBe(true);
    expect((structured.transport as Record<string, unknown>).chunked).toBe(true);
    expect((structured.transport as Record<string, unknown>).receivedChunks).toBe(2);
    expect(structured.schemaVersion).toBe(2);
  });
});
