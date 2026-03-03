/**
 * Item store — atomic YAML read/write for system/messages/ and system/events/.
 *
 * Each item is a single YAML file (gray-matter format) whose filename is:
 *   YYYYMMDD-{source}-{id.slice(-8)}.yaml
 *
 * Files are written atomically using a temp file + rename, protected by
 * proper-lockfile to prevent concurrent writes from heartbeat tasks.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as lockfile from 'proper-lockfile';
import matter from 'gray-matter';
import type { Item, ItemStatus, ItemType } from './types';
import { logger } from '../../common/logger';

// ---------------------------------------------------------------------------
// Directory helpers
// ---------------------------------------------------------------------------

function messagesDir(systemDir: string): string {
  return path.join(systemDir, 'messages');
}

function eventsDir(systemDir: string): string {
  return path.join(systemDir, 'events');
}

function itemDir(systemDir: string, item: Item): string {
  return item.type === 'MESSAGE' ? messagesDir(systemDir) : eventsDir(systemDir);
}

function doneDir(activeDir: string): string {
  return path.join(activeDir, 'done');
}

/**
 * Compute the filename for a new item.
 * Uses the last 8 chars of the item ID to keep filenames short but
 * reasonably unique within a given day+source.
 */
export function itemFilename(item: Item): string {
  const date = item.createdAt.slice(0, 10).replace(/-/g, '');
  const shortId = item.id.replace(/[^a-zA-Z0-9]/g, '').slice(-8);
  return `${date}-${item.source}-${shortId}.yaml`;
}

// ---------------------------------------------------------------------------
// Low-level atomic write
// ---------------------------------------------------------------------------

async function writeItemToFile(filepath: string, item: Item): Promise<void> {
  await fs.mkdir(path.dirname(filepath), { recursive: true });

  // gray-matter.stringify('', data) → "---\nfield: value\n...\n---\n"
  // JSON round-trip strips undefined values — js-yaml throws on undefined
  const clean = JSON.parse(JSON.stringify(item)) as Record<string, unknown>;
  const fileContent = matter.stringify('', clean);

  const lockPath = `${filepath}.lock`;

  // Ensure the lock sentinel exists before acquiring
  try {
    await fs.access(lockPath);
  } catch {
    await fs.writeFile(lockPath, '');
  }

  let release: (() => Promise<void>) | null = null;
  try {
    release = await lockfile.lock(lockPath, {
      retries: { retries: 5, minTimeout: 50, maxTimeout: 500 },
      stale: 10000,
    });

    const tempPath = `${filepath}.tmp`;
    await fs.writeFile(tempPath, fileContent, 'utf-8');
    await fs.rename(tempPath, filepath);
  } catch (err) {
    logger.error({
      operation: 'item_write_error',
      filepath,
      error: (err as Error).message,
      message: `Failed to write item: ${path.basename(filepath)}`,
    });
    throw err;
  } finally {
    if (release) {
      await release();
      try {
        await fs.unlink(lockPath);
      } catch {
        // Ignore lock cleanup errors
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Save a new item to disk.
 * Uses the computed filename; will overwrite if the same file already exists
 * (e.g. re-ingest of an existing item with the same ID suffix).
 * To avoid clobbering a further-along item, check with getItem() first.
 */
export async function saveItem(systemDir: string, item: Item): Promise<void> {
  const dir = itemDir(systemDir, item);
  const filepath = path.join(dir, itemFilename(item));
  await writeItemToFile(filepath, item);

  logger.debug({
    operation: 'item_saved',
    itemId: item.id,
    source: item.source,
    status: item.status,
    message: `Item saved: ${item.id}`,
  });
}

/**
 * Update an existing item in-place.
 * Locates the item file by scanning for a matching ID, then overwrites it.
 * Falls back to saveItem() if no existing file is found.
 */
export async function updateItem(systemDir: string, item: Item): Promise<void> {
  const found = await findItemFile(systemDir, item.id);

  if (found) {
    await writeItemToFile(found.filepath, item);
  } else {
    // Item not on disk yet — write as new
    await saveItem(systemDir, item);
  }

  logger.debug({
    operation: 'item_updated',
    itemId: item.id,
    status: item.status,
    message: `Item updated: ${item.id}`,
  });
}

/**
 * Move an item file from its active directory (messages/ or events/) to the
 * corresponding done/ subdirectory. Called by the executor after ARCHIVE.
 * No-ops if the file is already in done/ or can't be found.
 */
export async function archiveItem(systemDir: string, item: Item): Promise<void> {
  const found = await findItemFile(systemDir, item.id);
  if (!found) {
    logger.warn({ operation: 'item_archive_not_found', itemId: item.id });
    return;
  }

  // If already inside a done/ directory, nothing to do
  if (path.dirname(found.filepath).endsWith('done')) return;

  const dest = path.join(doneDir(path.dirname(found.filepath)), path.basename(found.filepath));
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.rename(found.filepath, dest);

  // Clean up any stale lock sentinel left alongside the original file
  try { await fs.unlink(`${found.filepath}.lock`); } catch { /* ignore */ }

  logger.debug({
    operation: 'item_archived',
    itemId: item.id,
    dest,
    message: `Item archived: ${path.basename(dest)}`,
  });
}

/**
 * Read all items from system/messages/ and/or system/events/ that match the
 * given statuses. Returns items sorted oldest-first by createdAt.
 */
export async function listItems(
  systemDir: string,
  statuses: ItemStatus[],
  types?: ItemType[]
): Promise<Item[]> {
  const dirs: string[] = [];
  if (!types || types.includes('MESSAGE')) dirs.push(messagesDir(systemDir));
  if (!types || types.includes('EVENT')) dirs.push(eventsDir(systemDir));

  const items: Item[] = [];

  for (const dir of dirs) {
    let entries: string[];
    try {
      const raw = await fs.readdir(dir);
      entries = raw
        .filter((e) => e.endsWith('.yaml'))
        .sort()
        .map((e) => path.join(dir, e));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw err;
    }

    for (const filepath of entries) {
      try {
        const raw = await fs.readFile(filepath, 'utf-8');
        const parsed = matter(raw);
        const item = parsed.data as Item;
        if (!item.id) continue;
        if (!statuses.includes(item.status)) continue;
        items.push(item);
      } catch {
        // Skip unparseable files silently
      }
    }
  }

  return items.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

/**
 * Find a single item by its ID, searching both messages/ and events/.
 * Returns null if not found.
 */
export async function getItem(systemDir: string, id: string): Promise<Item | null> {
  const found = await findItemFile(systemDir, id);
  return found?.item ?? null;
}

/**
 * Check whether an item with the given ID already exists.
 * Uses a filename heuristic first, then falls back to a full scan.
 */
export async function itemExists(systemDir: string, id: string): Promise<boolean> {
  const found = await findItemFile(systemDir, id);
  return found !== null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface ItemFile {
  filepath: string;
  item: Item;
}

async function findItemFile(systemDir: string, id: string): Promise<ItemFile | null> {
  const activeDirs = [messagesDir(systemDir), eventsDir(systemDir)];
  // Search active dirs first, then done/ subdirectories
  const dirs = [...activeDirs, ...activeDirs.map(doneDir)];

  for (const dir of dirs) {
    let entries: string[];
    try {
      const raw = await fs.readdir(dir);
      entries = raw.filter((e) => e.endsWith('.yaml')).map((e) => path.join(dir, e));
    } catch {
      continue;
    }

    for (const filepath of entries) {
      try {
        const raw = await fs.readFile(filepath, 'utf-8');
        const parsed = matter(raw);
        const item = parsed.data as Item;
        if (item.id === id) return { filepath, item };
      } catch {
        continue;
      }
    }
  }

  return null;
}
