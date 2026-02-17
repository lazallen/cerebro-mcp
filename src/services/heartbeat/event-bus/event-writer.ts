/**
 * Event writer with file locking and atomic writes
 * Writes markdown event files to disk with frontmatter and content
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as lockfile from 'proper-lockfile';
import type { EventFileFrontmatter } from '../../../types/heartbeat';
import type { EventWriterConfig } from '../types';
import { logger } from '../../../common/logger';

/**
 * Writes event files to disk with YAML frontmatter and markdown content
 */
export class EventWriter {
  private eventsDir: string;
  private lockTimeout: number;
  private lockRetries: number;

  constructor(config: EventWriterConfig) {
    this.eventsDir = config.eventsDir;
    this.lockTimeout = config.lockTimeout ?? 10000; // 10 seconds default
    this.lockRetries = config.lockRetries ?? 5;
  }

  /**
   * Write event file to disk with atomic write and file locking
   * @param date Date in YYYYMMDD format
   * @param eventType Event type identifier (e.g., 'email', 'calendar')
   * @param uniqueId Unique 4-character ID
   * @param frontmatter YAML frontmatter data
   * @param content Markdown content
   * @returns Filename of created event file
   */
  async writeEvent(
    date: string,
    eventType: string,
    uniqueId: string,
    frontmatter: EventFileFrontmatter,
    content: string
  ): Promise<string> {
    // Ensure events directory exists
    await fs.mkdir(this.eventsDir, { recursive: true });

    // Build filename
    const filename = this.buildFilename(date, eventType, uniqueId);
    const filepath = path.join(this.eventsDir, filename);

    logger.debug({
      operation: 'event_write_start',
      filename,
      eventType,
      message: `Writing event file ${filename}`,
    });

    // Build file content with frontmatter
    const fileContent = this.buildFileContent(frontmatter, content);

    // Acquire lock and write atomically
    let release: (() => Promise<void>) | null = null;
    try {
      // Create lock file (use a separate lock file to avoid conflicts)
      const lockPath = `${filepath}.lock`;

      // Ensure lock file exists (lockfile requires file to exist)
      try {
        await fs.access(lockPath);
      } catch {
        await fs.writeFile(lockPath, '');
      }

      release = await lockfile.lock(lockPath, {
        retries: {
          retries: this.lockRetries,
          minTimeout: 50,
          maxTimeout: 500,
        },
        stale: this.lockTimeout,
      });

      // Write to temp file first
      const tempPath = `${filepath}.tmp`;
      await fs.writeFile(tempPath, fileContent, 'utf-8');

      // Atomic rename
      await fs.rename(tempPath, filepath);

      logger.info({
        operation: 'event_written',
        filename,
        eventType,
        size: fileContent.length,
        message: `Event file written successfully: ${filename}`,
      });

      return filename;
    } catch (error) {
      logger.error({
        operation: 'event_write_error',
        filename,
        error: (error as Error).message,
        message: `Failed to write event file ${filename}`,
      });
      throw error;
    } finally {
      if (release) {
        await release();

        // Clean up lock file
        try {
          await fs.unlink(`${filepath}.lock`);
        } catch {
          // Ignore lock file cleanup errors
        }
      }
    }
  }

  /**
   * Build filename from components
   * @param date Date in YYYYMMDD format
   * @param eventType Event type identifier
   * @param uniqueId Unique 4-character ID
   * @returns Filename string
   */
  buildFilename(date: string, eventType: string, uniqueId: string): string {
    return `${date}-${eventType}-${uniqueId}.md`;
  }

  /**
   * Build file content with YAML frontmatter and markdown body
   * @param frontmatter Frontmatter data
   * @param content Markdown content
   * @returns Complete file content
   */
  private buildFileContent(frontmatter: EventFileFrontmatter, content: string): string {
    // Build YAML frontmatter with required fields first
    const yamlLines = [
      '---',
      `type: ${this.escapeYamlValue(frontmatter.type)}`,
      `timestamp: ${this.escapeYamlValue(frontmatter.timestamp)}`,
      `source_task_id: ${this.escapeYamlValue(frontmatter.source_task_id)}`,
    ];

    // Add any additional metadata fields
    for (const [key, value] of Object.entries(frontmatter)) {
      if (key !== 'type' && key !== 'timestamp' && key !== 'source_task_id' && value !== undefined) {
        yamlLines.push(`${key}: ${this.escapeYamlValue(value)}`);
      }
    }

    yamlLines.push('---', '');

    return yamlLines.join('\n') + content;
  }

  /**
   * Escape special characters in YAML values
   * @param value Value to escape
   * @returns Escaped value (quoted if necessary)
   */
  private escapeYamlValue(value: string): string {
    // Quote if contains special characters
    if (/[:#\[\]{}|>*&!%@`]/.test(value)) {
      return `"${value.replace(/"/g, '\\"')}"`;
    }
    return value;
  }
}
