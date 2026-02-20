/**
 * Reading pack writer for system/artifacts/reading-packs/.
 * Appends FYI entries to a daily Markdown reading pack note.
 * Multiple FYI events in one run are consolidated into a single YYYY-MM-DD.md file.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import type { TriageEvent } from '../policy/types';
import { logger } from '../../common/logger';

// Lockfile-based atomic append helper (uses simple read-modify-write with proper-lockfile)
import { lock } from 'proper-lockfile';

/**
 * Append a FYI entry to the daily reading pack in system/artifacts/reading-packs/.
 * Creates the file if absent; appends if present.
 * Filename: YYYY-MM-DD.md (derived from event receivedAt).
 */
export async function appendEntry(event: TriageEvent, systemDir: string): Promise<string> {
  const packsDir = path.join(systemDir, 'artifacts', 'reading-packs');
  await fs.mkdir(packsDir, { recursive: true });

  const date = event.receivedAt.slice(0, 10); // YYYY-MM-DD
  const filename = `${date}.md`;
  const filepath = path.join(packsDir, filename);

  // Ensure file exists so lockfile can lock it
  await fs.writeFile(filepath, '', { flag: 'a' });

  // Acquire lock, read, append, write, release
  let releaseFn: (() => Promise<void>) | null = null;
  try {
    releaseFn = await lock(filepath, { retries: { retries: 5, minTimeout: 50 } });

    const existing = await fs.readFile(filepath, 'utf-8');

    // Add header if file is new
    const header = existing.trim().length === 0 ? `# Reading Pack — ${date}\n\n` : '';

    const entry = formatEntry(event);
    const content = existing + header + entry;

    await fs.writeFile(filepath, content, 'utf-8');
  } finally {
    if (releaseFn) await releaseFn();
  }

  logger.info({
    operation: 'reading_pack_entry_appended',
    eventId: event.eventId,
    date,
    filename,
    message: `Reading pack entry appended: ${filename}`,
  });

  return filepath;
}

function formatEntry(event: TriageEvent): string {
  const lines: string[] = [
    `## ${event.title} — ${event.author}`,
    '',
    `- **Received**: ${event.receivedAt}`,
    `- **Source**: ${event.source}`,
    `- **Event ref**: ${event.eventId}`,
    '',
  ];

  if (event.snippet) {
    lines.push(event.snippet.slice(0, 300).trim());
    lines.push('');
  }

  lines.push('---', '');
  return lines.join('\n');
}
