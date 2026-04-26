/**
 * Official Rules Sync Service
 *
 * Syncs rules from the official ZeroProof GitHub repository.
 * This is the only supported way to get rule updates without redeploying.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as crypto from 'crypto';
import { logger } from '../../utils/logger';

const RULES_DIR = process.env.RULES_DIR || path.join(__dirname, '../../../../rules');

// Official ZeroProof rules repository
const OFFICIAL_REPO = {
  owner: 'MKippen',
  repo: 'ZeroProof',
  branch: 'main',
  path: 'rules',
};

export interface SyncResult {
  success: boolean;
  filesDownloaded: number;
  filesUpdated: number;
  filesSkipped: number;
  errors: string[];
  lastSync: Date;
}

interface RepoFile {
  name: string;
  path: string;
  sha: string;
  type: 'file' | 'dir';
  download_url?: string;
}

/**
 * Official Rules Sync Service
 */
class OfficialRulesSyncService {
  private lastSyncResult: SyncResult | null = null;

  /**
   * Sync rules from the official ZeroProof repository
   */
  async syncFromOfficial(): Promise<SyncResult> {
    const result: SyncResult = {
      success: true,
      filesDownloaded: 0,
      filesUpdated: 0,
      filesSkipped: 0,
      errors: [],
      lastSync: new Date(),
    };

    try {
      logger.info(`Syncing rules from official repo: ${OFFICIAL_REPO.owner}/${OFFICIAL_REPO.repo}`);

      // Get repository contents
      const files = await this.getRepoContents(OFFICIAL_REPO.path);

      // Process each YAML file
      for (const file of files) {
        if (file.type === 'file' && (file.name.endsWith('.yaml') || file.name.endsWith('.yml'))) {
          try {
            const downloadResult = await this.downloadFile(file);
            if (downloadResult === 'new') {
              result.filesDownloaded++;
            } else if (downloadResult === 'updated') {
              result.filesUpdated++;
            } else {
              result.filesSkipped++;
            }
          } catch (error) {
            result.errors.push(`Failed to download ${file.path}: ${error}`);
          }
        }
      }

      logger.info(`Sync complete: ${result.filesDownloaded} new, ${result.filesUpdated} updated, ${result.filesSkipped} unchanged`);

    } catch (error) {
      result.success = false;
      result.errors.push(`Sync failed: ${error}`);
      logger.error('Failed to sync from official repo', { error });
    }

    this.lastSyncResult = result;
    return result;
  }

  /**
   * Get the last sync result
   */
  getLastSyncResult(): SyncResult | null {
    return this.lastSyncResult;
  }

  /**
   * Get repository contents via GitHub API
   */
  private async getRepoContents(repoPath: string): Promise<RepoFile[]> {
    const url = `https://api.github.com/repos/${OFFICIAL_REPO.owner}/${OFFICIAL_REPO.repo}/contents/${repoPath}?ref=${OFFICIAL_REPO.branch}`;

    const response = await this.fetchJson(url);

    if (!Array.isArray(response)) {
      return [];
    }

    const files: RepoFile[] = [];

    for (const item of response) {
      if (item.type === 'file') {
        files.push({
          name: item.name,
          path: item.path,
          sha: item.sha,
          type: 'file',
          download_url: item.download_url,
        });
      } else if (item.type === 'dir') {
        // Recursively get directory contents
        const subFiles = await this.getRepoContents(item.path);
        files.push(...subFiles);
      }
    }

    return files;
  }

  /**
   * Download a file from GitHub
   */
  private async downloadFile(file: RepoFile): Promise<'new' | 'updated' | 'skipped'> {
    if (!file.download_url) {
      throw new Error('No download URL');
    }

    // Preserve directory structure under rules/
    const relativePath = file.path.replace(/^rules\//, '');
    const targetPath = path.join(RULES_DIR, relativePath);
    const targetDirPath = path.dirname(targetPath);

    this.ensureDir(targetDirPath);

    // Fetch new content
    const newContent = await this.fetchText(file.download_url);
    const newHash = crypto.createHash('sha256').update(newContent).digest('hex');

    // Check if file exists and compare hash
    if (fs.existsSync(targetPath)) {
      const existingContent = fs.readFileSync(targetPath, 'utf8');
      const existingHash = crypto.createHash('sha256').update(existingContent).digest('hex');

      if (existingHash === newHash) {
        return 'skipped';
      }

      fs.writeFileSync(targetPath, newContent, 'utf8');
      return 'updated';
    }

    // Write new file
    fs.writeFileSync(targetPath, newContent, 'utf8');
    return 'new';
  }

  /**
   * Fetch JSON from URL
   */
  private fetchJson(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const options: https.RequestOptions = {
        headers: {
          'User-Agent': 'ZeroProof-RuleSync/1.0',
          'Accept': 'application/vnd.github.v3+json',
        },
      };

      https.get(url, options, (res) => {
        if (res.statusCode === 403 && res.headers['x-ratelimit-remaining'] === '0') {
          reject(new Error('GitHub API rate limit exceeded. Try again later.'));
          return;
        }

        if (res.statusCode === 404) {
          reject(new Error('Repository or path not found'));
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error('Invalid JSON response'));
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * Fetch text content from URL
   */
  private fetchText(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const options: https.RequestOptions = {
        headers: {
          'User-Agent': 'ZeroProof-RuleSync/1.0',
        },
      };

      https.get(url, options, (res) => {
        // Handle redirects
        if (res.statusCode === 301 || res.statusCode === 302) {
          const redirectUrl = res.headers.location;
          if (redirectUrl) {
            this.fetchText(redirectUrl).then(resolve).catch(reject);
            return;
          }
        }

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      }).on('error', reject);
    });
  }

  /**
   * Ensure directory exists
   */
  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Get official repository info
   */
  getOfficialRepoInfo() {
    return {
      owner: OFFICIAL_REPO.owner,
      repo: OFFICIAL_REPO.repo,
      branch: OFFICIAL_REPO.branch,
      url: `https://github.com/${OFFICIAL_REPO.owner}/${OFFICIAL_REPO.repo}`,
    };
  }
}

// Singleton instance
export const officialRulesSync = new OfficialRulesSyncService();

export default officialRulesSync;
