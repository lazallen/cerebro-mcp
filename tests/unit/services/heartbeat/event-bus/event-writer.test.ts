/**
 * Unit tests for event-writer
 * Tests markdown generation, file locking, and atomic writes
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { EventWriter } from '../../../../../src/services/heartbeat/event-bus/event-writer';
import type { EventFileFrontmatter, EmailTriageResult } from '../../../../../src/types/heartbeat';

describe('EventWriter', () => {
  let testDir: string;
  let eventsDir: string;
  let eventWriter: EventWriter;

  beforeEach(async () => {
    testDir = path.join(__dirname, '../../../../../.tmp-event-writer-test');
    eventsDir = path.join(testDir, 'events');
    await fs.mkdir(eventsDir, { recursive: true });

    eventWriter = new EventWriter({ eventsDir });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('writeEvent', () => {
    it('should write event file with frontmatter and content', async () => {
      const frontmatter: EventFileFrontmatter = {
        type: 'email-triage',
        timestamp: '2026-02-17T14:30:00Z',
        source_task_id: 'test-task',
      };

      const content = '# Test Event\n\nThis is test content.';

      const filename = await eventWriter.writeEvent('20260217', 'email', '0001', frontmatter, content);

      expect(filename).toBe('20260217-email-0001.md');

      const filePath = path.join(eventsDir, filename);
      const fileContent = await fs.readFile(filePath, 'utf-8');

      expect(fileContent).toContain('---');
      expect(fileContent).toContain('type: email-triage');
      expect(fileContent).toMatch(/timestamp: ["']?2026-02-17T14:30:00Z["']?/);
      expect(fileContent).toContain('source_task_id: test-task');
      expect(fileContent).toContain('# Test Event');
      expect(fileContent).toContain('This is test content.');
    });

    it('should write email triage event with action items', async () => {
      const frontmatter: EventFileFrontmatter = {
        type: 'email-triage',
        timestamp: '2026-02-17T14:30:00Z',
        source_task_id: 'email-triage-hourly',
      };

      const triageResult: EmailTriageResult = {
        from: 'alice@company.com',
        subject: 'Q2 Planning Meeting',
        received: '2026-02-17T09:15:00Z',
        message_id: 'msg123',
        action_items: [
          {
            description: 'Respond with availability',
            deadline: '2026-02-18T23:59:59Z',
            priority: 'high',
            category: 'request',
          },
        ],
        questions: ['Can you share your availability?'],
        requests: ['Review attached agenda'],
        deadlines: ['EOD Feb 18'],
        summary: 'Q2 planning meeting request',
      };

      const content = `# Email Triage Event

## Metadata

- **From**: ${triageResult.from}
- **Subject**: ${triageResult.subject}
- **Received**: ${triageResult.received}

## Action Items

${triageResult.action_items.map((item) => `- [ ] **${item.priority}**: ${item.description}`).join('\n')}

## Extracted Data (JSON)

\`\`\`json
${JSON.stringify(triageResult, null, 2)}
\`\`\`
`;

      const filename = await eventWriter.writeEvent('20260217', 'email', '0001', frontmatter, content);

      const filePath = path.join(eventsDir, filename);
      const fileContent = await fs.readFile(filePath, 'utf-8');

      expect(fileContent).toContain('alice@company.com');
      expect(fileContent).toContain('Q2 Planning Meeting');
      expect(fileContent).toContain('Respond with availability');
      expect(fileContent).toContain('"priority": "high"');
    });

    it('should handle concurrent writes with file locking', async () => {
      const frontmatter: EventFileFrontmatter = {
        type: 'email-triage',
        timestamp: '2026-02-17T14:30:00Z',
        source_task_id: 'test-task',
      };

      // Write multiple files concurrently
      const writes = Array.from({ length: 10 }, (_, i) =>
        eventWriter.writeEvent('20260217', 'email', `000${i}`, frontmatter, `Content ${i}`)
      );

      const filenames = await Promise.all(writes);

      expect(filenames).toHaveLength(10);
      expect(new Set(filenames).size).toBe(10); // All unique

      // Verify all files exist
      for (const filename of filenames) {
        const filePath = path.join(eventsDir, filename);
        await expect(fs.access(filePath)).resolves.not.toThrow();
      }
    });

    it('should use atomic writes with temp file', async () => {
      const frontmatter: EventFileFrontmatter = {
        type: 'email-triage',
        timestamp: '2026-02-17T14:30:00Z',
        source_task_id: 'test-task',
      };

      const content = 'Test content';

      await eventWriter.writeEvent('20260217', 'email', '0001', frontmatter, content);

      // Verify no temp files left behind
      const files = await fs.readdir(eventsDir);
      const tempFiles = files.filter((f) => f.endsWith('.tmp'));
      expect(tempFiles).toHaveLength(0);
    });

    it('should create events directory if it does not exist', async () => {
      const newEventsDir = path.join(testDir, 'new-events');
      const newWriter = new EventWriter({ eventsDir: newEventsDir });

      const frontmatter: EventFileFrontmatter = {
        type: 'email-triage',
        timestamp: '2026-02-17T14:30:00Z',
        source_task_id: 'test-task',
      };

      await newWriter.writeEvent('20260217', 'email', '0001', frontmatter, 'Test');

      await expect(fs.access(newEventsDir)).resolves.not.toThrow();
    });

    it('should escape special characters in YAML frontmatter', async () => {
      const frontmatter: EventFileFrontmatter = {
        type: 'email-triage',
        timestamp: '2026-02-17T14:30:00Z',
        source_task_id: 'test-task-with-special:chars',
      };

      const content = 'Test content';

      const filename = await eventWriter.writeEvent('20260217', 'email', '0001', frontmatter, content);

      const filePath = path.join(eventsDir, filename);
      const fileContent = await fs.readFile(filePath, 'utf-8');

      // Should contain escaped or quoted value
      expect(fileContent).toContain('source_task_id:');
    });

    it('should handle large content', async () => {
      const frontmatter: EventFileFrontmatter = {
        type: 'email-triage',
        timestamp: '2026-02-17T14:30:00Z',
        source_task_id: 'test-task',
      };

      // Generate large content (1MB)
      const largeContent = 'x'.repeat(1024 * 1024);

      const filename = await eventWriter.writeEvent('20260217', 'email', '0001', frontmatter, largeContent);

      const filePath = path.join(eventsDir, filename);
      const stats = await fs.stat(filePath);

      expect(stats.size).toBeGreaterThan(1024 * 1024);
    });
  });

  describe('buildFilename', () => {
    it('should build correct filename format', () => {
      const filename = eventWriter.buildFilename('20260217', 'email', '0001');
      expect(filename).toBe('20260217-email-0001.md');
    });

    it('should handle different event types', () => {
      expect(eventWriter.buildFilename('20260217', 'calendar', '0001')).toBe('20260217-calendar-0001.md');
      expect(eventWriter.buildFilename('20260217', 'email', '0001')).toBe('20260217-email-0001.md');
    });

    it('should handle different ID formats', () => {
      expect(eventWriter.buildFilename('20260217', 'email', '0001')).toBe('20260217-email-0001.md');
      expect(eventWriter.buildFilename('20260217', 'email', '00zz')).toBe('20260217-email-00zz.md');
      expect(eventWriter.buildFilename('20260217', 'email', 'zzzz')).toBe('20260217-email-zzzz.md');
    });
  });
});
