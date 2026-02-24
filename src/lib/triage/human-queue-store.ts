/**
 * HumanQueueStore — read/write for system/human/ queue items.
 * Each item is a frontmatter markdown file: hq_YYYYMMDD_<counter>.md
 * Supports ask_human (human clarification) and claude_approval (LLM gating) item types.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { writeArtifact, readArtifact, listArtifacts } from './artifact-writer';
import type { HumanQueueItem, HumanQueueItemStatus } from '../policy/types';
import { logger } from '../../common/logger';

function humanDir(systemDir: string): string {
  return path.join(systemDir, 'human');
}

function itemFilename(date: string, counter: number): string {
  return `hq_${date}_${String(counter).padStart(3, '0')}.md`;
}

function toFrontmatter(item: HumanQueueItem): Record<string, unknown> {
  const fm: Record<string, unknown> = {
    type: 'human-queue-item',
    id: item.id,
    itemType: item.itemType,
    eventRef: item.eventRef,
    status: item.status,
    createdAt: item.createdAt,
  };

  if (item.resolvedAt) fm['resolvedAt'] = item.resolvedAt;
  if (item.question) fm['question'] = item.question;
  if (item.reason) fm['reason'] = item.reason;
  if (item.localConfidence !== undefined) fm['localConfidence'] = item.localConfidence;
  if (item.answer !== undefined) fm['answer'] = item.answer;
  if (item.approvalRef) fm['approvalRef'] = item.approvalRef;

  return fm;
}

function fromFrontmatter(fm: Record<string, unknown>): HumanQueueItem | null {
  const id = fm['id'] as string;
  if (!id) return null;

  return {
    id,
    itemType: (fm['itemType'] as HumanQueueItem['itemType']) ?? 'ask_human',
    eventRef: (fm['eventRef'] as string) ?? '',
    status: (fm['status'] as HumanQueueItemStatus) ?? 'pending',
    createdAt: (fm['createdAt'] as string) ?? new Date().toISOString(),
    resolvedAt: fm['resolvedAt'] as string | undefined,
    question: fm['question'] as string | undefined,
    reason: fm['reason'] as string | undefined,
    localConfidence: fm['localConfidence'] as number | undefined,
    answer: fm['answer'] as string | undefined,
    approvalRef: fm['approvalRef'] as string | undefined,
  };
}

/**
 * Write a new HumanQueueItem to system/human/.
 * Returns the path to the written file.
 */
export async function createItem(
  item: HumanQueueItem,
  systemDir: string,
  /** Optional pre-formatted markdown context block appended to the body */
  contextBody?: string
): Promise<string> {
  const dir = humanDir(systemDir);
  await fs.mkdir(dir, { recursive: true });

  const date = item.createdAt.slice(0, 10).replace(/-/g, '');

  // Counter based on existing items for today
  const existing = await fs.readdir(dir).catch(() => [] as string[]);
  const todayCount = existing.filter((f) => f.startsWith(`hq_${date}`) && f.endsWith('.md')).length;
  const filename = itemFilename(date, todayCount + 1);

  const body = buildBody(item, contextBody);
  await writeArtifact(dir, filename, toFrontmatter(item), body);

  logger.info({
    operation: 'human_queue_item_created',
    id: item.id,
    itemType: item.itemType,
    eventRef: item.eventRef,
    filename,
    message: `Human queue item created: ${item.id}`,
  });

  return path.join(dir, filename);
}

/**
 * List all HumanQueueItems with the given statuses from system/human/.
 */
export async function listByStatus(
  systemDir: string,
  statuses: HumanQueueItemStatus[]
): Promise<HumanQueueItem[]> {
  const dir = humanDir(systemDir);
  const files = await listArtifacts(dir);
  const items: HumanQueueItem[] = [];

  for (const filepath of files) {
    const artifact = await readArtifact(filepath);
    if (!artifact) continue;

    const status = artifact.data['status'] as HumanQueueItemStatus;
    if (!statuses.includes(status)) continue;

    const item = fromFrontmatter(artifact.data);
    if (item) items.push(item);
  }

  return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Update the status (and optionally answer) of a HumanQueueItem.
 * Preserves existing body content (only frontmatter is updated).
 */
export async function updateItemStatus(
  systemDir: string,
  id: string,
  status: HumanQueueItemStatus,
  answer?: string
): Promise<boolean> {
  const dir = humanDir(systemDir);
  const files = await listArtifacts(dir);

  for (const filepath of files) {
    const artifact = await readArtifact(filepath);
    if (!artifact) continue;
    if (artifact.data['id'] !== id) continue;

    const item = fromFrontmatter(artifact.data);
    if (!item) continue;

    const updated: HumanQueueItem = {
      ...item,
      status,
      answer: answer ?? item.answer,
      resolvedAt: ['resolved', 'approved', 'declined', 'complete'].includes(status)
        ? new Date().toISOString()
        : item.resolvedAt,
    };

    const filename = path.basename(filepath);
    await writeArtifact(dir, filename, toFrontmatter(updated), artifact.content);

    logger.info({
      operation: 'human_queue_item_updated',
      id,
      status,
      message: `Human queue item status updated: ${id} → ${status}`,
    });

    return true;
  }

  return false;
}

/**
 * Sweep system/human/ for items with status 'complete' and move them to system/human/done/.
 * Called by PipelineArchiveTask.
 * Returns the number of items archived.
 */
export async function archiveCompletedItems(systemDir: string): Promise<number> {
  const dir = humanDir(systemDir);
  const doneDir = path.join(dir, 'done');
  const files = await listArtifacts(dir);
  let count = 0;

  for (const filepath of files) {
    const artifact = await readArtifact(filepath);
    if (!artifact) continue;
    if (artifact.data['status'] !== 'complete') continue;

    await fs.mkdir(doneDir, { recursive: true });
    const destPath = path.join(doneDir, path.basename(filepath));
    await fs.rename(filepath, destPath);

    try {
      await fs.unlink(`${filepath}.lock`);
    } catch {
      /* ignore */
    }

    const id = String(artifact.data['id'] ?? '');
    logger.info({
      operation: 'human_queue_item_archived',
      id,
      dest: destPath,
      message: `Human queue item archived: ${id}`,
    });
    count++;
  }

  return count;
}

function buildBody(item: HumanQueueItem, contextBody?: string): string {
  const lines: string[] = [
    `## ${item.itemType === 'ask_human' ? 'Human Review Required' : 'Claude Approval Required'}`,
    '',
    `- **Event ref**: ${item.eventRef}`,
    `- **Created**: ${item.createdAt}`,
  ];

  if (item.question) {
    lines.push('', '### Question', '', item.question);
  }

  if (item.reason) {
    lines.push('', '### Reason', '', item.reason);
  }

  if (item.localConfidence !== undefined) {
    lines.push('', `*Local LLM confidence: ${(item.localConfidence * 100).toFixed(0)}%*`);
  }

  if (contextBody) {
    lines.push('', '### Event Context', '', contextBody);
  }

  lines.push('');
  return lines.join('\n');
}
