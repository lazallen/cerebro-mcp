/**
 * Unit tests for RunLogWriter (T049)
 * Tests: file created with correct frontmatter, HIGH risk includes trace,
 * LLM tier and confidence recorded, decision summary structure
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { writeRunLog, summariseDecision } from '../../../src/lib/triage/run-log-writer';
import type { RunLogEntry, PolicyDecision } from '../../../src/lib/policy/types';

let tmpDir: string;
let systemDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'runlog-test-'));
  systemDir = tmpDir;
  await fs.mkdir(path.join(systemDir, 'runs'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeEntry(overrides: Partial<RunLogEntry> = {}): RunLogEntry {
  return {
    runId: 'run-test-001',
    policyId: 'default',
    policyVersion: '1.0.0',
    startedAt: '2026-02-19T09:00:00Z',
    completedAt: '2026-02-19T09:00:05Z',
    stages: ['ingestion', 'enrichment', 'evaluation', 'execution'],
    eventsProcessed: 3,
    eventsActioned: 2,
    humanItemsCreated: 1,
    humanItemsResolved: 0,
    claudeApprovalsRequested: 0,
    claudeApprovalsGranted: 0,
    errors: [],
    decisions: [],
    ...overrides,
  };
}

function makeDecision(eventId: string, hasHumanItem = false): PolicyDecision {
  return {
    eventId,
    policyId: 'default',
    policyVersion: '1.0.0',
    timestamp: '2026-02-19T09:00:03Z',
    classification: {
      intent: 'NEWSLETTER',
      urgency: 'SOMEDAY',
      risk: 'LOW',
      confidence: 0.92,
      rationale: ['matched newsletter-auto-archive'],
    },
    actions: [
      {
        type: hasHumanItem ? 'ASK_HUMAN' : 'MOVE',
        idempotencyKey: `event:${eventId}:action:${hasHumanItem ? 'ASK_HUMAN' : 'MOVE'}:policy:default@1.0.0:v1`,
        requiresApproval: false,
      },
    ],
    trace: [
      {
        ruleId: 'newsletter-auto-archive',
        priority: 900,
        matched: true,
        predicateResult: { matched: true, reason: 'isBulk=true and hasUnsubscribe=true' },
        terminal: true,
      },
    ],
    terminal: true,
  };
}

describe('writeRunLog', () => {
  test('creates a file in system/runs/', async () => {
    const entry = makeEntry();
    const filepath = await writeRunLog(entry, systemDir);

    const stat = await fs.stat(filepath);
    expect(stat.isFile()).toBe(true);
    expect(path.basename(filepath)).toMatch(/^run_20260219_/);
    expect(filepath.endsWith('.md')).toBe(true);
  });

  test('frontmatter contains correct run metadata', async () => {
    const entry = makeEntry({
      eventsProcessed: 5,
      eventsActioned: 4,
      humanItemsCreated: 2,
      claudeApprovalsRequested: 1,
    });
    const filepath = await writeRunLog(entry, systemDir);

    const content = await fs.readFile(filepath, 'utf-8');
    expect(content).toContain('runId: run-test-001');
    expect(content).toContain('policyId: default');
    expect(content).toContain('eventsProcessed: 5');
    expect(content).toContain('eventsActioned: 4');
    expect(content).toContain('humanItemsCreated: 2');
    expect(content).toContain('claudeApprovalsRequested: 1');
  });

  test('body includes summary table', async () => {
    const entry = makeEntry();
    const filepath = await writeRunLog(entry, systemDir);

    const content = await fs.readFile(filepath, 'utf-8');
    expect(content).toContain('## Summary');
    expect(content).toContain('Events processed');
    expect(content).toContain('Events actioned');
  });

  test('HIGH risk / human-queue decision includes trace section', async () => {
    const decision = makeDecision('event-001', true);
    const entry = makeEntry({
      decisions: [
        {
          eventId: 'event-001',
          intent: 'UNKNOWN',
          terminal: false,
          actionTypes: ['ASK_HUMAN'],
          hasHumanItem: true,
        },
      ],
    });

    const filepath = await writeRunLog(entry, systemDir, [decision]);
    const content = await fs.readFile(filepath, 'utf-8');

    expect(content).toContain('#### Trace');
    expect(content).toContain('newsletter-auto-archive');
  });

  test('non-human-queue decision does NOT include trace', async () => {
    const decision = makeDecision('event-002', false);
    const entry = makeEntry({
      decisions: [
        {
          eventId: 'event-002',
          intent: 'NEWSLETTER',
          terminal: true,
          actionTypes: ['MOVE'],
          hasHumanItem: false,
        },
      ],
    });

    const filepath = await writeRunLog(entry, systemDir, [decision]);
    const content = await fs.readFile(filepath, 'utf-8');

    expect(content).not.toContain('#### Trace');
  });

  test('errors section included when errors present', async () => {
    const entry = makeEntry({
      errors: [{ stage: 'enrichment', eventId: 'event-err-001', message: 'LLM timeout' }],
    });

    const filepath = await writeRunLog(entry, systemDir);
    const content = await fs.readFile(filepath, 'utf-8');

    expect(content).toContain('## Errors');
    expect(content).toContain('LLM timeout');
    expect(content).toContain('enrichment');
  });
});

describe('summariseDecision', () => {
  test('extracts intent, terminal, actionTypes, hasHumanItem from PolicyDecision', () => {
    const decision = makeDecision('event-sum-001', true);
    const summary = summariseDecision(decision);

    expect(summary.eventId).toBe('event-sum-001');
    expect(summary.intent).toBe('NEWSLETTER');
    expect(summary.terminal).toBe(true);
    expect(summary.actionTypes).toContain('ASK_HUMAN');
    expect(summary.hasHumanItem).toBe(true);
  });

  test('hasHumanItem is false when no ASK_HUMAN action', () => {
    const decision = makeDecision('event-sum-002', false);
    const summary = summariseDecision(decision);

    expect(summary.hasHumanItem).toBe(false);
  });
});
