/**
 * GitHub Sync Service
 *
 * Syncs rules from external GitHub repositories.
 * Supports downloading rule packs and community contributions.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as crypto from 'crypto';
import { logger } from '../../utils/logger';

const RULES_DIR = process.env.RULES_DIR || path.join(__dirname, '../../../../rules');

export interface GitHubRepoConfig {
  owner: string;
  repo: string;
  branch?: string;
  path?: string;
  token?: string;
  name: string;
  description?: string;
}

export interface SyncResult {
  success: boolean;
  filesDownloaded: number;
  filesUpdated: number;
  filesSkipped: number;
  errors: string[];
  lastSync: Date;
}

export interface RepoFile {
  name: string;
  path: string;
  sha: string;
  type: 'file' | 'dir';
  download_url?: string;
}

/**
 * GitHub Sync Service
 */
export class GitHubSyncService {
  private repos: Map<string, GitHubRepoConfig> = new Map();
  private syncHistory: Map<string, SyncResult> = new Map();

  /**
   * Add a repository to sync from
   */
  addRepository(config: GitHubRepoConfig): void {
    const key = `${config.owner}/${config.repo}`;
    this.repos.set(key, {
      ...config,
      branch: config.branch || 'main',
      path: config.path || 'rules',
    });
    logger.info(`Added GitHub repository: ${key}`);
  }

  /**
   * Remove a repository
   */
  removeRepository(owner: string, repo: string): void {
    const key = `${owner}/${repo}`;
    this.repos.delete(key);
    logger.info(`Removed GitHub repository: ${key}`);
  }

  /**
   * Get all configured repositories
   */
  getRepositories(): GitHubRepoConfig[] {
    return Array.from(this.repos.values());
  }

  /**
   * Sync rules from a specific repository
   */
  async syncRepository(owner: string, repo: string): Promise<SyncResult> {
    const key = `${owner}/${repo}`;
    const config = this.repos.get(key);

    if (!config) {
      return {
        success: false,
        filesDownloaded: 0,
        filesUpdated: 0,
        filesSkipped: 0,
        errors: [`Repository not configured: ${key}`],
        lastSync: new Date(),
      };
    }

    const result: SyncResult = {
      success: true,
      filesDownloaded: 0,
      filesUpdated: 0,
      filesSkipped: 0,
      errors: [],
      lastSync: new Date(),
    };

    try {
      // Get repository contents
      const files = await this.getRepoContents(config, config.path!);

      // Create target directory for this repo
      const targetDir = path.join(RULES_DIR, 'community', `${owner}-${repo}`);
      this.ensureDir(targetDir);

      // Download each YAML file
      for (const file of files) {
        if (file.type === 'file' && (file.name.endsWith('.yaml') || file.name.endsWith('.yml'))) {
          try {
            const downloaded = await this.downloadFile(file, targetDir, config);
            if (downloaded === 'new') {
              result.filesDownloaded++;
            } else if (downloaded === 'updated') {
              result.filesUpdated++;
            } else {
              result.filesSkipped++;
            }
          } catch (error) {
            result.errors.push(`Failed to download ${file.path}: ${error}`);
          }
        }
      }

      logger.info(`Synced ${key}: ${result.filesDownloaded} new, ${result.filesUpdated} updated, ${result.filesSkipped} skipped`);

    } catch (error) {
      result.success = false;
      result.errors.push(`Sync failed: ${error}`);
      logger.error(`Failed to sync ${key}`, { error });
    }

    this.syncHistory.set(key, result);
    return result;
  }

  /**
   * Sync all configured repositories
   */
  async syncAll(): Promise<Map<string, SyncResult>> {
    const results = new Map<string, SyncResult>();

    for (const [key, config] of this.repos) {
      const result = await this.syncRepository(config.owner, config.repo);
      results.set(key, result);
    }

    return results;
  }

  /**
   * Get repository contents via GitHub API
   */
  private async getRepoContents(config: GitHubRepoConfig, repoPath: string): Promise<RepoFile[]> {
    const url = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${repoPath}?ref=${config.branch}`;

    const response = await this.fetchJson(url, config.token);

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
        const subFiles = await this.getRepoContents(config, item.path);
        files.push(...subFiles);
      }
    }

    return files;
  }

  /**
   * Download a file from GitHub
   */
  private async downloadFile(
    file: RepoFile,
    targetDir: string,
    config: GitHubRepoConfig
  ): Promise<'new' | 'updated' | 'skipped'> {
    if (!file.download_url) {
      throw new Error('No download URL');
    }

    // Preserve directory structure
    const relativePath = file.path.replace(/^rules\//, '');
    const targetPath = path.join(targetDir, relativePath);
    const targetDirPath = path.dirname(targetPath);

    this.ensureDir(targetDirPath);

    // Check if file exists and compare hash
    if (fs.existsSync(targetPath)) {
      const existingContent = fs.readFileSync(targetPath, 'utf8');
      const existingHash = crypto.createHash('sha1').update(existingContent).digest('hex');

      // GitHub uses blob SHA which includes header, so we can't compare directly
      // Just check if content changed
      const newContent = await this.fetchText(file.download_url, config.token);
      const newHash = crypto.createHash('sha1').update(newContent).digest('hex');

      if (existingHash === newHash) {
        return 'skipped';
      }

      fs.writeFileSync(targetPath, newContent, 'utf8');
      return 'updated';
    }

    // Download new file
    const content = await this.fetchText(file.download_url, config.token);
    fs.writeFileSync(targetPath, content, 'utf8');
    return 'new';
  }

  /**
   * Fetch JSON from URL
   */
  private fetchJson(url: string, token?: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {
        'User-Agent': 'ZeroProof-RuleSync/1.0',
        'Accept': 'application/vnd.github.v3+json',
      };

      if (token) {
        headers['Authorization'] = `token ${token}`;
      }

      const options: https.RequestOptions = { headers };

      https.get(url, options, (res) => {
        if (res.statusCode === 403 && res.headers['x-ratelimit-remaining'] === '0') {
          reject(new Error('GitHub API rate limit exceeded'));
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
          } catch (e) {
            reject(new Error('Invalid JSON response'));
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * Fetch text content from URL
   */
  private fetchText(url: string, token?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {
        'User-Agent': 'ZeroProof-RuleSync/1.0',
      };

      if (token) {
        headers['Authorization'] = `token ${token}`;
      }

      const options: https.RequestOptions = { headers };

      https.get(url, options, (res) => {
        // Handle redirects
        if (res.statusCode === 301 || res.statusCode === 302) {
          const redirectUrl = res.headers.location;
          if (redirectUrl) {
            this.fetchText(redirectUrl, token).then(resolve).catch(reject);
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
   * Get sync history for a repository
   */
  getSyncHistory(owner: string, repo: string): SyncResult | undefined {
    return this.syncHistory.get(`${owner}/${repo}`);
  }

  /**
   * Get all sync history
   */
  getAllSyncHistory(): Map<string, SyncResult> {
    return new Map(this.syncHistory);
  }
}

// Singleton instance
export const githubSync = new GitHubSyncService();

export default githubSync;
