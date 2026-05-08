const mockPrisma = {
  setting: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
};

jest.mock('../../../src/services/database', () => ({
  __esModule: true,
  default: mockPrisma,
}));

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  compareTags,
  getReleaseChannel,
  getUpdateStatus,
  readCurrentVersion,
  setReleaseChannel,
  _resetUpdateCaches,
} from '../../../src/services/systemUpdateService';

interface FakeRelease {
  tag_name: string;
  name: string;
  body: string | null;
  html_url: string;
  prerelease: boolean;
  draft: boolean;
  published_at: string | null;
}

async function writeChangelog(content: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zp-changelog-'));
  const file = path.join(dir, 'CHANGELOG.md');
  await fs.writeFile(file, content, 'utf8');
  return file;
}

beforeEach(() => {
  jest.clearAllMocks();
  _resetUpdateCaches();
});

describe('compareTags', () => {
  it.each([
    ['v1.2.3', 'v1.2.2', 1],
    ['v1.2.3', 'v1.2.3', 0],
    ['v1.2.3', 'v1.2.4', -1],
    ['v2.0.0', 'v1.9.9', 1],
    ['v1.10.0', 'v1.9.0', 1], // numeric, not lexical
    ['1.1.3', 'v1.1.3', 0],   // tolerates leading-v
    ['v1.2.0', 'v1.2.0-beta.1', 1], // release > prerelease
    ['v1.2.0-beta.2', 'v1.2.0-beta.1', 1],
    ['v1.2.0-rc.1', 'v1.2.0-beta.5', 1], // rc > beta lexically
  ])('compareTags(%s, %s) = %s', (a, b, expected) => {
    expect(Math.sign(compareTags(a, b))).toBe(Math.sign(expected));
  });
});

describe('readCurrentVersion', () => {
  it('extracts version from the first ## [x.y.z] heading', async () => {
    const file = await writeChangelog(
      [
        '# Changelog',
        '',
        '## [1.1.3] - 2026-05-08',
        '### Added',
        '- thing',
        '',
        '## [1.1.2] - 2026-05-08',
      ].join('\n')
    );
    const result = await readCurrentVersion({ changelogPath: file });
    expect(result).toBe('v1.1.3');
  });

  it('returns null if CHANGELOG is missing', async () => {
    const result = await readCurrentVersion({
      changelogPath: '/nonexistent/CHANGELOG.md',
    });
    expect(result).toBeNull();
  });

  it('returns null if no version heading is present', async () => {
    const file = await writeChangelog('# Changelog\n\nNothing here.\n');
    const result = await readCurrentVersion({ changelogPath: file });
    expect(result).toBeNull();
  });

  it('handles pre-release version suffixes', async () => {
    const file = await writeChangelog('## [1.2.0-beta.1] - 2026-06-01\n');
    const result = await readCurrentVersion({ changelogPath: file });
    expect(result).toBe('v1.2.0-beta.1');
  });
});

describe('getReleaseChannel', () => {
  it('defaults to stable when no setting exists', async () => {
    mockPrisma.setting.findUnique.mockResolvedValue(null);
    const channel = await getReleaseChannel();
    expect(channel).toBe('stable');
  });

  it('returns beta when setting is { channel: "beta" }', async () => {
    mockPrisma.setting.findUnique.mockResolvedValue({
      key: 'system.releaseChannel',
      value: { channel: 'beta' },
    });
    const channel = await getReleaseChannel();
    expect(channel).toBe('beta');
  });

  it('treats unknown channel values as stable', async () => {
    mockPrisma.setting.findUnique.mockResolvedValue({
      key: 'system.releaseChannel',
      value: { channel: 'gibberish' },
    });
    const channel = await getReleaseChannel();
    expect(channel).toBe('stable');
  });

  it('handles legacy plain-string setting value', async () => {
    mockPrisma.setting.findUnique.mockResolvedValue({
      key: 'system.releaseChannel',
      value: 'beta',
    });
    const channel = await getReleaseChannel();
    expect(channel).toBe('beta');
  });
});

describe('setReleaseChannel', () => {
  it('upserts the setting with the given channel', async () => {
    mockPrisma.setting.upsert.mockResolvedValue({});
    await setReleaseChannel('beta');
    expect(mockPrisma.setting.upsert).toHaveBeenCalledWith({
      where: { key: 'system.releaseChannel' },
      create: { key: 'system.releaseChannel', value: { channel: 'beta' } },
      update: { value: { channel: 'beta' } },
    });
  });
});

describe('getUpdateStatus', () => {
  function release(
    tag: string,
    overrides: Partial<FakeRelease> = {}
  ): FakeRelease {
    return {
      tag_name: tag,
      name: tag,
      body: `Notes for ${tag}`,
      html_url: `https://github.com/MKippen/ZeroProof/releases/tag/${tag}`,
      prerelease: false,
      draft: false,
      published_at: '2026-05-08T00:00:00Z',
      ...overrides,
    };
  }

  it('reports hasUpdate=true when latest stable > current', async () => {
    mockPrisma.setting.findUnique.mockResolvedValue(null); // stable channel
    const file = await writeChangelog('## [1.1.3] - 2026-05-08\n');
    const status = await getUpdateStatus({
      changelogPath: file,
      fetchReleases: async () => [release('v1.1.4'), release('v1.1.3')],
    });
    expect(status.current).toBe('v1.1.3');
    expect(status.latest).toBe('v1.1.4');
    expect(status.hasUpdate).toBe(true);
    expect(status.channel).toBe('stable');
  });

  it('reports hasUpdate=false when current is latest', async () => {
    mockPrisma.setting.findUnique.mockResolvedValue(null);
    const file = await writeChangelog('## [1.1.3] - 2026-05-08\n');
    const status = await getUpdateStatus({
      changelogPath: file,
      fetchReleases: async () => [release('v1.1.3'), release('v1.1.2')],
    });
    expect(status.hasUpdate).toBe(false);
    expect(status.latest).toBe('v1.1.3');
  });

  it('skips prereleases on stable channel', async () => {
    mockPrisma.setting.findUnique.mockResolvedValue(null); // stable
    const file = await writeChangelog('## [1.1.3] - 2026-05-08\n');
    const status = await getUpdateStatus({
      changelogPath: file,
      fetchReleases: async () => [
        release('v1.2.0-beta.1', { prerelease: true }),
        release('v1.1.3'),
      ],
    });
    // Stable user should NOT be told a beta is available.
    expect(status.hasUpdate).toBe(false);
    expect(status.latest).toBe('v1.1.3');
  });

  it('includes prereleases on beta channel', async () => {
    mockPrisma.setting.findUnique.mockResolvedValue({
      value: { channel: 'beta' },
    });
    const file = await writeChangelog('## [1.1.3] - 2026-05-08\n');
    const status = await getUpdateStatus({
      changelogPath: file,
      fetchReleases: async () => [
        release('v1.2.0-beta.1', { prerelease: true }),
        release('v1.1.3'),
      ],
    });
    expect(status.hasUpdate).toBe(true);
    expect(status.latest).toBe('v1.2.0-beta.1');
  });

  it('still prefers a stable release over a beta when one is newer', async () => {
    mockPrisma.setting.findUnique.mockResolvedValue({
      value: { channel: 'beta' },
    });
    const file = await writeChangelog('## [1.1.3] - 2026-05-08\n');
    const status = await getUpdateStatus({
      changelogPath: file,
      fetchReleases: async () => [
        release('v1.2.0', { prerelease: false }),
        release('v1.2.0-beta.1', { prerelease: true }),
      ],
    });
    expect(status.latest).toBe('v1.2.0');
  });

  it('skips drafts in both channels', async () => {
    mockPrisma.setting.findUnique.mockResolvedValue({
      value: { channel: 'beta' },
    });
    const file = await writeChangelog('## [1.1.3] - 2026-05-08\n');
    const status = await getUpdateStatus({
      changelogPath: file,
      fetchReleases: async () => [
        release('v1.2.0', { draft: true }),
        release('v1.1.4'),
      ],
    });
    expect(status.latest).toBe('v1.1.4');
  });

  it('surfaces a fetch error in the response without throwing', async () => {
    mockPrisma.setting.findUnique.mockResolvedValue(null);
    const file = await writeChangelog('## [1.1.3] - 2026-05-08\n');
    const status = await getUpdateStatus({
      changelogPath: file,
      fetchReleases: async () => {
        throw new Error('GitHub returned 502');
      },
    });
    expect(status.latest).toBeNull();
    expect(status.hasUpdate).toBe(false);
    expect(status.error).toContain('502');
  });

  it('reports current="unknown" when CHANGELOG is missing but still works', async () => {
    mockPrisma.setting.findUnique.mockResolvedValue(null);
    const status = await getUpdateStatus({
      changelogPath: '/nonexistent/CHANGELOG.md',
      fetchReleases: async () => [release('v1.1.4')],
    });
    expect(status.current).toBe('unknown');
    expect(status.hasUpdate).toBe(false); // can't compare against unknown
    expect(status.latest).toBe('v1.1.4');
  });
});
