/**
 * File-based storage for Slack message actions
 *
 * Provides CRUD operations for storing and managing captured message actions
 * with atomic file writes for data integrity.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'fs';
import { dirname } from 'path';
import { randomUUID } from 'crypto';
import type {
  StoredMessageAction,
  SlackMessageActionPayload,
  MessageActionSummary,
  MessageActionStorageSchema,
} from '../../types/slack-message-action';

/**
 * Current schema version for migrations
 */
const SCHEMA_VERSION = 1;

/**
 * Default storage path
 */
const DEFAULT_STORAGE_PATH = '.tasks/slack-actions.json';

/**
 * Options for filtering actions
 */
export interface ListActionsOptions {
  /** Filter by processed status */
  processed?: boolean;
}

/**
 * File-based storage for message actions
 */
export class MessageActionStorage {
  private readonly storagePath: string;

  /**
   * Creates a new MessageActionStorage instance
   *
   * @param storagePath - Path to the storage file (default: .tasks/slack-actions.json)
   */
  constructor(storagePath: string = DEFAULT_STORAGE_PATH) {
    this.storagePath = storagePath;
  }

  /**
   * Ensures the storage directory exists
   */
  private ensureDirectory(): void {
    const dir = dirname(this.storagePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Reads the current storage state
   */
  private readStorage(): MessageActionStorageSchema {
    if (!existsSync(this.storagePath)) {
      return { version: SCHEMA_VERSION, actions: [] };
    }

    try {
      const content = readFileSync(this.storagePath, 'utf8');
      const data = JSON.parse(content) as MessageActionStorageSchema;
      return data;
    } catch {
      // If file is corrupted, start fresh
      return { version: SCHEMA_VERSION, actions: [] };
    }
  }

  /**
   * Writes storage state atomically (write to temp, then rename)
   */
  private writeStorage(data: MessageActionStorageSchema): void {
    this.ensureDirectory();
    const tempPath = `${this.storagePath}.tmp`;

    // Write to temp file
    writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');

    // Atomic rename
    renameSync(tempPath, this.storagePath);
  }

  /**
   * Adds a new message action to storage
   *
   * @param payload - The Slack message action payload
   * @returns The stored action with generated ID and timestamp
   */
  add(payload: SlackMessageActionPayload): StoredMessageAction {
    const storage = this.readStorage();

    const action: StoredMessageAction = {
      id: randomUUID(),
      receivedAt: new Date().toISOString(),
      processed: false,
      payload,
    };

    storage.actions.push(action);
    this.writeStorage(storage);

    return action;
  }

  /**
   * Lists all actions, optionally filtered
   *
   * @param options - Filter options
   * @returns Array of action summaries
   */
  list(options: ListActionsOptions = {}): MessageActionSummary[] {
    const storage = this.readStorage();
    let actions = storage.actions;

    // Apply processed filter if specified
    if (options.processed !== undefined) {
      actions = actions.filter((a) => a.processed === options.processed);
    }

    // Convert to summaries
    return actions.map((action) => this.toSummary(action));
  }

  /**
   * Gets a single action by ID
   *
   * @param id - The action ID
   * @returns The stored action or null if not found
   */
  get(id: string): StoredMessageAction | null {
    const storage = this.readStorage();
    const action = storage.actions.find((a) => a.id === id);
    return action ?? null;
  }

  /**
   * Deletes an action by ID
   *
   * @param id - The action ID
   * @returns true if deleted, false if not found
   */
  delete(id: string): boolean {
    const storage = this.readStorage();
    const index = storage.actions.findIndex((a) => a.id === id);

    if (index === -1) {
      return false;
    }

    storage.actions.splice(index, 1);
    this.writeStorage(storage);

    return true;
  }

  /**
   * Gets the total count of actions
   *
   * @param options - Filter options
   * @returns The count of actions
   */
  count(options: ListActionsOptions = {}): number {
    return this.list(options).length;
  }

  /**
   * Clears all actions from storage
   */
  clear(): void {
    this.writeStorage({ version: SCHEMA_VERSION, actions: [] });
  }

  /**
   * Converts a stored action to a summary view
   */
  private toSummary(action: StoredMessageAction): MessageActionSummary {
    const messageText = action.payload.message.text || '';
    const maxPreviewLength = 100;
    const messagePreview =
      messageText.length > maxPreviewLength
        ? messageText.substring(0, maxPreviewLength) + '...'
        : messageText;

    return {
      id: action.id,
      receivedAt: action.receivedAt,
      processed: action.processed,
      channelName: action.payload.channel.name,
      userName: action.payload.user.name,
      messagePreview,
    };
  }

  /**
   * Gets the storage file path (for testing/debugging)
   */
  getStoragePath(): string {
    return this.storagePath;
  }

  /**
   * Removes the storage file entirely (for testing cleanup)
   */
  removeStorageFile(): void {
    if (existsSync(this.storagePath)) {
      unlinkSync(this.storagePath);
    }
    // Also remove temp file if exists
    const tempPath = `${this.storagePath}.tmp`;
    if (existsSync(tempPath)) {
      unlinkSync(tempPath);
    }
  }
}
