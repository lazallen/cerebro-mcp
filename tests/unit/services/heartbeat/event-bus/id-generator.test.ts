/**
 * Unit tests for event ID generator
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { EventIdGenerator } from '../../../../../src/services/heartbeat/event-bus/id-generator';

describe('EventIdGenerator', () => {
  const testDir = path.join(__dirname, '../../../../../.test-data/id-generator');

  beforeEach(async () => {
    // Clean up test directory
    await fs.rm(testDir, { recursive: true, force: true });
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up after tests
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('generateId', () => {
    it('should generate 4-character base36 IDs', async () => {
      const generator = new EventIdGenerator(testDir);
      const id = await generator.generateId();

      expect(id).toMatch(/^[0-9a-z]{4}$/);
      expect(id.length).toBe(4);
    });

    it('should generate sequential IDs', async () => {
      const generator = new EventIdGenerator(testDir);

      const id1 = await generator.generateId();
      const id2 = await generator.generateId();
      const id3 = await generator.generateId();

      expect(id1).toBe('0001');
      expect(id2).toBe('0002');
      expect(id3).toBe('0003');
    });

    it('should persist counter to disk', async () => {
      const generator = new EventIdGenerator(testDir);

      await generator.generateId();
      await generator.generateId();

      const counterFile = path.join(testDir, '.counter.json');
      const content = await fs.readFile(counterFile, 'utf-8');
      const data = JSON.parse(content);

      expect(data.counter).toBe(2);
      expect(data.date).toMatch(/^\d{8}$/);
    });

    it('should reset counter on date change', async () => {
      const generator = new EventIdGenerator(testDir);

      // Generate some IDs
      await generator.generateId();
      await generator.generateId();

      // Manually change the date in counter file to yesterday
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0].replace(/-/g, '');

      const counterFile = path.join(testDir, '.counter.json');
      await fs.writeFile(counterFile, JSON.stringify({ date: yesterdayStr, counter: 42 }));

      // Next ID should reset to 0001
      const id = await generator.generateId();
      expect(id).toBe('0001');
    });

    it('should handle missing counter file gracefully', async () => {
      const generator = new EventIdGenerator(testDir);
      const id = await generator.generateId();

      expect(id).toBe('0001');
    });

    it('should handle concurrent ID generation', async () => {
      const generator = new EventIdGenerator(testDir);

      // Generate 10 IDs concurrently
      const promises = Array.from({ length: 10 }, () => generator.generateId());
      const ids = await Promise.all(promises);

      // All IDs should be unique
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(10);

      // All IDs should be valid 4-character base36 strings
      ids.forEach((id) => {
        expect(id).toMatch(/^[0-9a-z]{4}$/);
      });
    });

    it('should support large counter values (base36 encoding)', async () => {
      const generator = new EventIdGenerator(testDir);

      // Manually set counter to value where next will be "0zzz"
      // 46654 + 1 = 46655 in decimal = "zzz" in base36 → "0zzz" (padded to 4 chars)
      const counterFile = path.join(testDir, '.counter.json');
      const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
      await fs.writeFile(counterFile, JSON.stringify({ date: today, counter: 46654 }));

      const id = await generator.generateId();
      expect(id).toBe('0zzz'); // 46655 in base36, padded to 4 chars
    });
  });

  describe('getDateString', () => {
    it('should return date in YYYYMMDD format', async () => {
      const generator = new EventIdGenerator(testDir);
      const dateStr = (generator as any).getDateString();

      expect(dateStr).toMatch(/^\d{8}$/);
      expect(dateStr.length).toBe(8);
    });
  });
});
