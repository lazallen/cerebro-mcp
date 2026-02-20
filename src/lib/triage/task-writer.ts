/**
 * Task artifact writer for system/artifacts/tasks/.
 * Creates a Markdown task note from an ACTION_REQUIRED policy decision.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { writeArtifact } from './artifact-writer';
import type { TriageEvent } from '../policy/types';
import { logger } from '../../common/logger';

/**
 * Create a task artifact in system/artifacts/tasks/ for an ACTION_REQUIRED event.
 * Filename: YYYYMMDD-task-<counter>.md
 * Counter is derived from the count of existing task files in the directory.
 */
export async function createTask(event: TriageEvent, systemDir: string): Promise<string> {
  const tasksDir = path.join(systemDir, 'artifacts', 'tasks');
  await fs.mkdir(tasksDir, { recursive: true });

  // Derive date prefix from event receivedAt
  const date = event.receivedAt.slice(0, 10).replace(/-/g, '');

  // Counter based on existing task files for today
  const existing = await fs.readdir(tasksDir).catch(() => [] as string[]);
  const todayCount = existing.filter((f) => f.startsWith(date) && f.endsWith('.md')).length;
  const counter = String(todayCount + 1).padStart(3, '0');

  const filename = `${date}-task-${counter}.md`;

  const frontmatter: Record<string, unknown> = {
    type: 'task',
    source: event.source,
    eventRef: event.eventId,
    title: event.title,
    author: event.author,
    createdAt: new Date().toISOString(),
    status: 'open',
  };

  const body = [
    `## ${event.title}`,
    '',
    `- **Source**: ${event.source}`,
    `- **From**: ${event.author}`,
    `- **Received**: ${event.receivedAt}`,
    `- **Event ref**: ${event.eventId}`,
    '',
    '## Context',
    '',
    event.snippet || '_(no snippet available)_',
    '',
  ].join('\n');

  await writeArtifact(tasksDir, filename, frontmatter, body);

  logger.info({
    operation: 'task_created',
    eventId: event.eventId,
    filename,
    message: `Task artifact created: ${filename}`,
  });

  return path.join(tasksDir, filename);
}
