/**
 * Unit tests for event-reader
 * Tests markdown parsing, frontmatter extraction, and JSON block parsing
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { EventReader } from '../../../../../src/services/heartbeat/event-bus/event-reader';
import type { EventFileFrontmatter, EmailTriageResult } from '../../../../../src/types/heartbeat';

describe('EventReader', () => {
  let testDir: string;
  let eventsDir: string;
  let eventReader: EventReader;

  beforeEach(async () => {
    testDir = path.join(__dirname, '../../../../../.tmp-event-reader-test');
    eventsDir = path.join(testDir, 'events');
    await fs.mkdir(eventsDir, { recursive: true });

    eventReader = new EventReader(eventsDir);
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('readEvent', () => {
    it('should read and parse event file with frontmatter', async () => {
      const content = `---
type: email-triage
timestamp: 2026-02-17T14:30:00Z
source_task_id: test-task
---

# Test Event

This is test content.
`;

      const filename = '20260217-email-0001.md';
      await fs.writeFile(path.join(eventsDir, filename), content);

      const event = await eventReader.readEvent(filename);

      expect(event.frontmatter.type).toBe('email-triage');
      expect(event.frontmatter.timestamp).toBe('2026-02-17T14:30:00Z');
      expect(event.frontmatter.source_task_id).toBe('test-task');
      expect(event.content).toContain('# Test Event');
      expect(event.content).toContain('This is test content.');
    });

    it('should extract JSON data from code blocks', async () => {
      const triageResult: EmailTriageResult = {
        from: 'alice@company.com',
        subject: 'Q2 Planning',
        received: '2026-02-17T09:15:00Z',
        message_id: 'msg123',
        action_items: [
          {
            description: 'Respond with availability',
            priority: 'high',
            category: 'request',
          },
        ],
        questions: [],
        requests: [],
        deadlines: [],
        summary: 'Test summary',
      };

      const content = `---
type: email-triage
timestamp: 2026-02-17T14:30:00Z
source_task_id: email-triage-hourly
---

# Email Triage Event

## Metadata

- **From**: alice@company.com
- **Subject**: Q2 Planning

## Extracted Data (JSON)

\`\`\`json
${JSON.stringify(triageResult, null, 2)}
\`\`\`
`;

      const filename = '20260217-email-0001.md';
      await fs.writeFile(path.join(eventsDir, filename), content);

      const event = await eventReader.readEvent(filename);

      expect(event.jsonData).toBeDefined();
      expect(event.jsonData?.from).toBe('alice@company.com');
      expect(event.jsonData?.subject).toBe('Q2 Planning');
      expect(event.jsonData?.action_items).toHaveLength(1);
      expect(event.jsonData?.action_items[0].description).toBe('Respond with availability');
    });

    it('should handle event files without JSON blocks', async () => {
      const content = `---
type: email-triage
timestamp: 2026-02-17T14:30:00Z
source_task_id: test-task
---

# Simple Event

No JSON data here.
`;

      const filename = '20260217-email-0001.md';
      await fs.writeFile(path.join(eventsDir, filename), content);

      const event = await eventReader.readEvent(filename);

      expect(event.frontmatter.type).toBe('email-triage');
      expect(event.jsonData).toBeUndefined();
    });

    it('should throw error for missing frontmatter', async () => {
      const content = `# Event Without Frontmatter

This should fail.
`;

      const filename = '20260217-email-0001.md';
      await fs.writeFile(path.join(eventsDir, filename), content);

      await expect(eventReader.readEvent(filename)).rejects.toThrow('No frontmatter found');
    });

    it('should throw error for invalid YAML frontmatter', async () => {
      const content = `---
invalid yaml: [unclosed bracket
---

# Event
`;

      const filename = '20260217-email-0001.md';
      await fs.writeFile(path.join(eventsDir, filename), content);

      await expect(eventReader.readEvent(filename)).rejects.toThrow();
    });

    it('should throw error for non-existent file', async () => {
      await expect(eventReader.readEvent('non-existent.md')).rejects.toThrow();
    });

    it('should handle multiple JSON blocks and use the first one', async () => {
      const content = `---
type: email-triage
timestamp: 2026-02-17T14:30:00Z
source_task_id: test-task
---

# Event

\`\`\`json
{"first": "block"}
\`\`\`

\`\`\`json
{"second": "block"}
\`\`\`
`;

      const filename = '20260217-email-0001.md';
      await fs.writeFile(path.join(eventsDir, filename), content);

      const event = await eventReader.readEvent(filename);

      expect(event.jsonData).toEqual({ first: 'block' });
    });

    it('should handle invalid JSON in code block gracefully', async () => {
      const content = `---
type: email-triage
timestamp: 2026-02-17T14:30:00Z
source_task_id: test-task
---

# Event

\`\`\`json
{invalid json}
\`\`\`
`;

      const filename = '20260217-email-0001.md';
      await fs.writeFile(path.join(eventsDir, filename), content);

      const event = await eventReader.readEvent(filename);

      // Should not throw, just skip invalid JSON
      expect(event.jsonData).toBeUndefined();
    });
  });

  describe('listEvents', () => {
    it('should list all event files in directory', async () => {
      await fs.writeFile(path.join(eventsDir, '20260217-email-0001.md'), 'test1');
      await fs.writeFile(path.join(eventsDir, '20260217-email-0002.md'), 'test2');
      await fs.writeFile(path.join(eventsDir, '20260217-calendar-0001.md'), 'test3');

      const files = await eventReader.listEvents();

      expect(files).toHaveLength(3);
      expect(files).toContain('20260217-email-0001.md');
      expect(files).toContain('20260217-email-0002.md');
      expect(files).toContain('20260217-calendar-0001.md');
    });

    it('should filter events by date pattern', async () => {
      await fs.writeFile(path.join(eventsDir, '20260217-email-0001.md'), 'test1');
      await fs.writeFile(path.join(eventsDir, '20260218-email-0001.md'), 'test2');
      await fs.writeFile(path.join(eventsDir, '20260217-calendar-0001.md'), 'test3');

      const files = await eventReader.listEvents('20260217');

      expect(files).toHaveLength(2);
      expect(files).toContain('20260217-email-0001.md');
      expect(files).toContain('20260217-calendar-0001.md');
      expect(files).not.toContain('20260218-email-0001.md');
    });

    it('should filter events by type', async () => {
      await fs.writeFile(path.join(eventsDir, '20260217-email-0001.md'), 'test1');
      await fs.writeFile(path.join(eventsDir, '20260217-email-0002.md'), 'test2');
      await fs.writeFile(path.join(eventsDir, '20260217-calendar-0001.md'), 'test3');

      const files = await eventReader.listEvents(undefined, 'email');

      expect(files).toHaveLength(2);
      expect(files).toContain('20260217-email-0001.md');
      expect(files).toContain('20260217-email-0002.md');
      expect(files).not.toContain('20260217-calendar-0001.md');
    });

    it('should filter by both date and type', async () => {
      await fs.writeFile(path.join(eventsDir, '20260217-email-0001.md'), 'test1');
      await fs.writeFile(path.join(eventsDir, '20260217-calendar-0001.md'), 'test2');
      await fs.writeFile(path.join(eventsDir, '20260218-email-0001.md'), 'test3');

      const files = await eventReader.listEvents('20260217', 'email');

      expect(files).toHaveLength(1);
      expect(files).toContain('20260217-email-0001.md');
    });

    it('should return empty array when no events match', async () => {
      await fs.writeFile(path.join(eventsDir, '20260217-email-0001.md'), 'test1');

      const files = await eventReader.listEvents('20260218');

      expect(files).toHaveLength(0);
    });

    it('should ignore non-markdown files', async () => {
      await fs.writeFile(path.join(eventsDir, '20260217-email-0001.md'), 'test1');
      await fs.writeFile(path.join(eventsDir, '.counter.json'), '{}');
      await fs.writeFile(path.join(eventsDir, 'readme.txt'), 'info');

      const files = await eventReader.listEvents();

      expect(files).toHaveLength(1);
      expect(files).toContain('20260217-email-0001.md');
    });

    it('should sort events chronologically', async () => {
      await fs.writeFile(path.join(eventsDir, '20260217-email-0003.md'), 'test3');
      await fs.writeFile(path.join(eventsDir, '20260217-email-0001.md'), 'test1');
      await fs.writeFile(path.join(eventsDir, '20260217-email-0002.md'), 'test2');

      const files = await eventReader.listEvents();

      expect(files).toEqual([
        '20260217-email-0001.md',
        '20260217-email-0002.md',
        '20260217-email-0003.md',
      ]);
    });
  });
});
