/**
 * Event consumer with file watching using chokidar
 * Watches events directory and processes new event files
 */

import * as chokidar from 'chokidar';
import { EventReader, type ParsedEvent } from './event-reader';
import type { EventConsumerConfig } from '../types';
import { logger } from '../../../common/logger';

/**
 * Event handler callback
 */
export type EventHandler = (event: ParsedEvent, filename: string) => Promise<void>;

/**
 * Watches events directory and invokes handlers when new events arrive
 */
export class EventConsumer {
  private watcher: chokidar.FSWatcher | null = null;
  private eventReader: EventReader;
  private isWatching = false;

  constructor(private config: EventConsumerConfig) {
    this.eventReader = new EventReader(config.eventsDir);
  }

  /**
   * Start watching events directory
   * @param handler Callback to invoke for each new/existing event
   */
  async start(handler: EventHandler): Promise<void> {
    if (this.isWatching) {
      logger.warn({
        operation: 'event_consumer_already_running',
        message: 'Event consumer already watching',
      });
      return;
    }

    logger.info({
      operation: 'event_consumer_start',
      eventsDir: this.config.eventsDir,
      processExisting: this.config.processExisting,
      message: 'Starting event consumer',
    });

    // Process existing files if configured
    if (this.config.processExisting) {
      await this.processExistingEvents(handler);
    }

    // Start file watcher
    this.watcher = chokidar.watch(`${this.config.eventsDir}/*.md`, {
      persistent: true,
      ignoreInitial: true, // Don't fire for existing files (we handle that above)
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
    });

    this.watcher.on('add', async (filepath) => {
      await this.handleNewEvent(filepath, handler);
    });

    this.watcher.on('error', (error) => {
      logger.error({
        operation: 'event_consumer_error',
        error: (error as Error).message,
        message: 'Event consumer watcher error',
      });
    });

    this.isWatching = true;

    logger.info({
      operation: 'event_consumer_started',
      message: 'Event consumer started successfully',
    });
  }

  /**
   * Stop watching events directory
   */
  async stop(): Promise<void> {
    if (!this.isWatching) {
      return;
    }

    logger.info({
      operation: 'event_consumer_stop',
      message: 'Stopping event consumer',
    });

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    this.isWatching = false;

    logger.info({
      operation: 'event_consumer_stopped',
      message: 'Event consumer stopped',
    });
  }

  /**
   * Process existing event files
   * @param handler Event handler callback
   */
  private async processExistingEvents(handler: EventHandler): Promise<void> {
    logger.info({
      operation: 'process_existing_events',
      message: 'Processing existing event files',
    });

    try {
      const files = await this.eventReader.listEvents();

      for (const filename of files) {
        try {
          const event = await this.eventReader.readEvent(filename);
          await handler(event, filename);

          // Delete file if configured
          if (this.config.deleteAfterProcessing) {
            await this.deleteEventFile(filename);
          }
        } catch (error) {
          logger.error({
            operation: 'process_existing_event_error',
            filename,
            error: (error as Error).message,
            message: `Failed to process existing event ${filename}`,
          });
          // Continue with other files
        }
      }

      logger.info({
        operation: 'existing_events_processed',
        count: files.length,
        message: `Processed ${files.length} existing event files`,
      });
    } catch (error) {
      logger.error({
        operation: 'process_existing_events_error',
        error: (error as Error).message,
        message: 'Failed to process existing events',
      });
    }
  }

  /**
   * Handle new event file
   * @param filepath Full path to event file
   * @param handler Event handler callback
   */
  private async handleNewEvent(filepath: string, handler: EventHandler): Promise<void> {
    const filename = filepath.split('/').pop() ?? filepath;

    logger.info({
      operation: 'new_event_detected',
      filename,
      message: `New event file detected: ${filename}`,
    });

    try {
      const event = await this.eventReader.readEvent(filename);
      await handler(event, filename);

      logger.info({
        operation: 'event_processed',
        filename,
        message: `Event processed successfully: ${filename}`,
      });

      // Delete file if configured
      if (this.config.deleteAfterProcessing) {
        await this.deleteEventFile(filename);
      }
    } catch (error) {
      logger.error({
        operation: 'event_process_error',
        filename,
        error: (error as Error).message,
        message: `Failed to process event ${filename}`,
      });
    }
  }

  /**
   * Delete event file after processing
   * @param filename Event filename
   */
  private async deleteEventFile(filename: string): Promise<void> {
    try {
      const filepath = `${this.config.eventsDir}/${filename}`;
      await import('fs/promises').then((fs) => fs.unlink(filepath));

      logger.debug({
        operation: 'event_deleted',
        filename,
        message: `Event file deleted: ${filename}`,
      });
    } catch (error) {
      logger.error({
        operation: 'event_delete_error',
        filename,
        error: (error as Error).message,
        message: `Failed to delete event file ${filename}`,
      });
    }
  }
}
