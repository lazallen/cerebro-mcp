/**
 * Event ID generator with base36 encoding and daily reset
 * Generates unique 4-character IDs (0001-zzzz) providing 1,679,616 unique IDs per day
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as lockfile from 'proper-lockfile';
import type { CounterState } from '../../../types/heartbeat';
import { logger } from '../../../common/logger';

export class EventIdGenerator {
  private counterFile: string;
  private counter: number = 0;

  constructor(private baseDir: string) {
    this.counterFile = path.join(baseDir, '.counter.json');
  }

  /**
   * Get current date in YYYYMMDD format
   */
  private getDateString(): string {
    return new Date().toISOString().split('T')[0].replace(/-/g, '');
  }

  /**
   * Generate a unique 4-character ID for today
   * @returns Base36 encoded ID (e.g., "0001", "00a5", "zzzz")
   */
  async generateId(): Promise<string> {
    // Ensure directory and counter file exist before trying to lock
    await fs.mkdir(this.baseDir, { recursive: true });

    // Create counter file if it doesn't exist
    try {
      await fs.access(this.counterFile);
    } catch {
      // Counter file doesn't exist, create it
      const today = this.getDateString();
      await fs.writeFile(this.counterFile, JSON.stringify({ date: today, counter: 0 }, null, 2));
    }

    // Acquire lock to prevent concurrent access
    let release: (() => Promise<void>) | null = null;
    try {
      release = await lockfile.lock(this.counterFile, {
        retries: {
          retries: 10,
          minTimeout: 50,
          maxTimeout: 500,
        },
        stale: 10000, // 10 seconds
      });

      const today = this.getDateString();

      // Read current counter from file (handles multi-process scenarios)
      try {
        const data = await fs.readFile(this.counterFile, 'utf-8');
        const stored: CounterState = JSON.parse(data);

        if (stored.date === today) {
          this.counter = stored.counter;
        } else {
          // Date mismatch - reset counter
          this.counter = 0;
        }
      } catch (error) {
        // File doesn't exist or is invalid, start fresh
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          logger.warn({
            operation: 'id_generator_load_error',
            error: (error as Error).message,
            message: 'Failed to load counter file, starting fresh',
          });
        }
        this.counter = 0;
      }

      // Increment counter
      this.counter++;

      // Base36 encoding: 0-9, a-z (36 characters)
      // 36^4 = 1,679,616 unique IDs per day
      const id = this.counter.toString(36).padStart(4, '0');

      // Persist counter (already atomic with temp file + rename)
      await this.persistCounterLocked(today, this.counter);

      logger.debug({
        operation: 'id_generated',
        id,
        counter: this.counter,
        date: today,
      });

      return id;
    } finally {
      // Always release lock
      if (release) {
        await release();
      }
    }
  }

  /**
   * Persist counter to disk atomically (called with lock held)
   */
  private async persistCounterLocked(date: string, counter: number): Promise<void> {
    try {
      const state: CounterState = { date, counter };
      const tempFile = `${this.counterFile}.tmp`;

      // Write to temp file first
      await fs.writeFile(tempFile, JSON.stringify(state, null, 2));

      // Atomic rename (on most filesystems)
      await fs.rename(tempFile, this.counterFile);
    } catch (error) {
      logger.error({
        operation: 'id_generator_persist_error',
        error: (error as Error).message,
        date,
        counter,
        message: 'Failed to persist counter',
      });
      throw error;
    }
  }
}
