/**
 * Unit tests for HumanQueueStore (T038)
 * Tests: create item, listByStatus, updateItemStatus, lifecycle transitions
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  createItem,
  listByStatus,
  updateItemStatus,
} from '../../../src/lib/triage/human-queue-store';
import type { HumanQueueItem } from '../../../src/lib/policy/types';

let tmpDir: string;
let systemDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hq-test-'));
  systemDir = tmpDir;
  await fs.mkdir(path.join(systemDir, 'human'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeItem(overrides: Partial<HumanQueueItem> = {}): HumanQueueItem {
  return {
    id: 'hq-test-001',
    itemType: 'ask_human',
    eventRef: 'event-001',
    status: 'pending',
    createdAt: '2026-02-19T09:00:00Z',
    question: 'Is this an action item?',
    ...overrides,
  };
}

describe('createItem', () => {
  test('creates a file in system/human/', async () => {
    const item = makeItem();
    const filepath = await createItem(item, systemDir);

    const stat = await fs.stat(filepath);
    expect(stat.isFile()).toBe(true);
    expect(filepath).toContain('hq_');
    expect(filepath.endsWith('.md')).toBe(true);
  });

  test('file contains correct frontmatter fields', async () => {
    const item = makeItem({ id: 'hq-002', question: 'Review please?' });
    const filepath = await createItem(item, systemDir);

    const content = await fs.readFile(filepath, 'utf-8');
    expect(content).toContain('id: hq-002');
    expect(content).toContain('itemType: ask_human');
    expect(content).toContain('status: pending');
    expect(content).toContain('eventRef: event-001');
    expect(content).toContain('question: Review please?');
  });

  test('body includes human-readable question', async () => {
    const item = makeItem({ question: 'Should this be actioned?' });
    const filepath = await createItem(item, systemDir);

    const content = await fs.readFile(filepath, 'utf-8');
    expect(content).toContain('Should this be actioned?');
  });

  test('sequential counters for same day', async () => {
    const item1 = makeItem({ id: 'hq-a' });
    const item2 = makeItem({ id: 'hq-b' });

    const p1 = await createItem(item1, systemDir);
    const p2 = await createItem(item2, systemDir);

    expect(path.basename(p1)).not.toBe(path.basename(p2));
  });

  test('claude_approval item type written correctly', async () => {
    const item = makeItem({
      id: 'hq-claude-001',
      itemType: 'claude_approval',
      reason: 'Low confidence enrichment result',
      localConfidence: 0.45,
    });
    const filepath = await createItem(item, systemDir);

    const content = await fs.readFile(filepath, 'utf-8');
    expect(content).toContain('itemType: claude_approval');
    expect(content).toContain('localConfidence: 0.45');
  });
});

describe('listByStatus', () => {
  test('returns only items with matching status', async () => {
    await createItem(makeItem({ id: 'hq-p1', status: 'pending' }), systemDir);
    await createItem(makeItem({ id: 'hq-r1', status: 'resolved' }), systemDir);
    await createItem(makeItem({ id: 'hq-p2', status: 'pending' }), systemDir);

    const pending = await listByStatus(systemDir, ['pending']);
    expect(pending).toHaveLength(2);
    expect(pending.every((i) => i.status === 'pending')).toBe(true);

    const resolved = await listByStatus(systemDir, ['resolved']);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].id).toBe('hq-r1');
  });

  test('returns empty array when no items match', async () => {
    await createItem(makeItem({ status: 'pending' }), systemDir);

    const complete = await listByStatus(systemDir, ['complete']);
    expect(complete).toHaveLength(0);
  });

  test('supports multiple statuses in one call', async () => {
    await createItem(makeItem({ id: 'hq-a', status: 'approved' }), systemDir);
    await createItem(makeItem({ id: 'hq-d', status: 'declined' }), systemDir);
    await createItem(makeItem({ id: 'hq-p', status: 'pending' }), systemDir);

    const result = await listByStatus(systemDir, ['approved', 'declined']);
    expect(result).toHaveLength(2);
    expect(result.map((i) => i.status).sort()).toEqual(['approved', 'declined']);
  });

  test('returns empty when human/ dir is empty', async () => {
    const result = await listByStatus(systemDir, ['pending']);
    expect(result).toHaveLength(0);
  });
});

describe('updateItemStatus', () => {
  test('updates status of existing item', async () => {
    await createItem(makeItem({ id: 'hq-upd-001', status: 'pending' }), systemDir);

    const updated = await updateItemStatus(systemDir, 'hq-upd-001', 'resolved');
    expect(updated).toBe(true);

    const items = await listByStatus(systemDir, ['resolved']);
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe('resolved');
  });

  test('preserves body content when updating frontmatter', async () => {
    await createItem(
      makeItem({ id: 'hq-body-001', question: 'Should we action this?' }),
      systemDir
    );

    await updateItemStatus(systemDir, 'hq-body-001', 'resolved', 'Yes, action it');

    const items = await listByStatus(systemDir, ['resolved']);
    expect(items[0].answer).toBe('Yes, action it');

    // Verify question body text is preserved by reading the file directly
    const humanDir = path.join(systemDir, 'human');
    const files = await fs.readdir(humanDir);
    const content = await fs.readFile(path.join(humanDir, files[0]), 'utf-8');
    expect(content).toContain('Should we action this?');
  });

  test('sets resolvedAt when transitioning to resolved', async () => {
    await createItem(makeItem({ id: 'hq-ts-001', status: 'pending' }), systemDir);
    await updateItemStatus(systemDir, 'hq-ts-001', 'resolved');

    const items = await listByStatus(systemDir, ['resolved']);
    expect(items[0].resolvedAt).toBeTruthy();
    expect(new Date(items[0].resolvedAt).getFullYear()).toBe(2026);
  });

  test('returns false for non-existent item', async () => {
    const result = await updateItemStatus(systemDir, 'nonexistent-id', 'complete');
    expect(result).toBe(false);
  });

  test('status lifecycle: pending → resolved → complete', async () => {
    await createItem(makeItem({ id: 'hq-lifecycle', status: 'pending' }), systemDir);

    await updateItemStatus(systemDir, 'hq-lifecycle', 'resolved', 'This is an action item');
    let items = await listByStatus(systemDir, ['resolved']);
    expect(items[0].status).toBe('resolved');
    expect(items[0].answer).toBe('This is an action item');

    await updateItemStatus(systemDir, 'hq-lifecycle', 'complete');
    items = await listByStatus(systemDir, ['complete']);
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe('complete');

    // No longer in resolved list
    const resolved = await listByStatus(systemDir, ['resolved']);
    expect(resolved).toHaveLength(0);
  });
});
