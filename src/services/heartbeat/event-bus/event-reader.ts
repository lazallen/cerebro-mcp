/**
 * Event reader for parsing markdown event files
 * Extracts YAML frontmatter and JSON data blocks from event files
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { EventFileFrontmatter } from '../../../types/heartbeat';
import { logger } from '../../../common/logger';

/**
 * Parsed event file structure
 */
export interface ParsedEvent {
  /** YAML frontmatter data */
  frontmatter: EventFileFrontmatter;

  /** Markdown content (without frontmatter) */
  content: string;

  /** Parsed JSON data from code blocks (if present) */
  jsonData?: Record<string, unknown>;
}

/**
 * Reads and parses event files from disk
 */
export class EventReader {
  constructor(private eventsDir: string) {}

  /**
   * Read and parse an event file
   * @param filename Event filename
   * @returns Parsed event structure
   * @throws Error if file cannot be read or parsed
   */
  async readEvent(filename: string): Promise<ParsedEvent> {
    const filepath = path.join(this.eventsDir, filename);

    logger.debug({
      operation: 'event_read_start',
      filename,
      message: `Reading event file ${filename}`,
    });

    try {
      const content = await fs.readFile(filepath, 'utf-8');

      // Parse frontmatter
      const frontmatter = this.parseFrontmatter(content);

      // Extract content after frontmatter
      const markdownContent = this.extractContent(content);

      // Extract JSON data if present
      const jsonData = this.extractJsonData(markdownContent);

      logger.debug({
        operation: 'event_read_success',
        filename,
        hasJsonData: !!jsonData,
        message: `Event file parsed successfully: ${filename}`,
      });

      return {
        frontmatter,
        content: markdownContent,
        jsonData,
      };
    } catch (error) {
      logger.error({
        operation: 'event_read_error',
        filename,
        error: (error as Error).message,
        message: `Failed to read event file ${filename}`,
      });
      throw error;
    }
  }

  /**
   * List all event files in directory with optional filtering
   * @param datePattern Optional date filter (YYYYMMDD)
   * @param eventType Optional event type filter
   * @returns Array of event filenames sorted chronologically
   */
  async listEvents(datePattern?: string, eventType?: string): Promise<string[]> {
    try {
      const files = await fs.readdir(this.eventsDir);

      // Filter for markdown files only
      let eventFiles = files.filter((f) => f.endsWith('.md'));

      // Apply date filter
      if (datePattern) {
        eventFiles = eventFiles.filter((f) => f.startsWith(datePattern));
      }

      // Apply event type filter
      if (eventType) {
        const pattern = new RegExp(`^\\d{8}-${eventType}-\\w{4}\\.md$`);
        eventFiles = eventFiles.filter((f) => pattern.test(f));
      }

      // Sort chronologically
      eventFiles.sort();

      return eventFiles;
    } catch (error) {
      logger.error({
        operation: 'list_events_error',
        datePattern,
        eventType,
        error: (error as Error).message,
        message: 'Failed to list event files',
      });
      throw error;
    }
  }

  /**
   * Parse YAML frontmatter from markdown content
   * @param content File content
   * @returns Frontmatter object
   * @throws Error if frontmatter is missing or invalid
   */
  private parseFrontmatter(content: string): EventFileFrontmatter {
    // Match frontmatter between --- delimiters
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

    if (!frontmatterMatch) {
      throw new Error('No frontmatter found in event file');
    }

    const frontmatterText = frontmatterMatch[1];

    // Parse YAML manually (simple key: value format)
    const frontmatter: Record<string, string> = {};

    for (const line of frontmatterText.split('\n')) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match) {
        const [, key, value] = match;
        // Remove quotes if present
        frontmatter[key] = value.replace(/^["']|["']$/g, '');
      }
    }

    // Validate required fields
    if (!frontmatter.type || !frontmatter.timestamp || !frontmatter.source_task_id) {
      throw new Error('Frontmatter missing required fields (type, timestamp, source_task_id)');
    }

    return {
      type: frontmatter.type,
      timestamp: frontmatter.timestamp,
      source_task_id: frontmatter.source_task_id,
    };
  }

  /**
   * Extract markdown content after frontmatter
   * @param content Full file content
   * @returns Markdown content without frontmatter
   */
  private extractContent(content: string): string {
    // Remove frontmatter section
    const withoutFrontmatter = content.replace(/^---\n[\s\S]*?\n---\n/, '');
    return withoutFrontmatter.trim();
  }

  /**
   * Extract JSON data from markdown code blocks
   * @param content Markdown content
   * @returns Parsed JSON object or undefined if no JSON found
   */
  private extractJsonData(content: string): Record<string, unknown> | undefined {
    // Match first JSON code block
    const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);

    if (!jsonMatch) {
      return undefined;
    }

    const jsonText = jsonMatch[1];

    try {
      return JSON.parse(jsonText) as Record<string, unknown>;
    } catch (error) {
      logger.warn({
        operation: 'json_parse_error',
        error: (error as Error).message,
        message: 'Failed to parse JSON block in event file',
      });
      return undefined;
    }
  }
}
