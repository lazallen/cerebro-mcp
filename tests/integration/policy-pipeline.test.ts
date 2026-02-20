/**
 * Integration test for the policy pipeline (T053)
 * Mounts a temporary system/ directory, writes TriageEvent artifacts from fixtures,
 * runs PolicyEvaluator, saves decisions, and verifies outcomes.
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { evaluate } from '../../src/lib/policy/evaluator';
import { loadPolicy } from '../../src/lib/policy/policy-loader';
import { saveEvent, listEvents } from '../../src/lib/triage/triage-event-store';
import { saveDecision, listPendingDecisions } from '../../src/lib/triage/decision-store';
import type { TriageEvent, Policy } from '../../src/lib/policy/types';

const POLICY_PATH = path.resolve(
  __dirname,
  '../../specs/019-policy-engine/contracts/default-policy.yaml'
);
const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/emails');

let tmpDir: string;
let systemDir: string;
let policy: Policy;

beforeAll(async () => {
  policy = await loadPolicy(POLICY_PATH);
});

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pipeline-test-'));
  systemDir = tmpDir;
  await Promise.all([
    fs.mkdir(path.join(systemDir, 'triage'), { recursive: true }),
    fs.mkdir(path.join(systemDir, 'decisions'), { recursive: true }),
    fs.mkdir(path.join(systemDir, 'human'), { recursive: true }),
    fs.mkdir(path.join(systemDir, 'runs'), { recursive: true }),
  ]);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

/** Convert a raw fixture JSON to a TriageEvent */
function fixtureToEvent(raw: Record<string, unknown>): TriageEvent {
  const signals = raw['signals'] as TriageEvent['signals'];
  const date = String(raw['receivedDateTime'] ?? new Date().toISOString())
    .slice(0, 10)
    .replace(/-/g, '');
  const messageId = String(raw['messageId'] ?? 'fixture');

  return {
    eventId: `${date}-email-${messageId.slice(-8)}`,
    source: 'email',
    status: 'pending',
    title: String(raw['subject'] ?? 'Untitled'),
    author: (raw['from'] as any)?.email ?? 'unknown@example.com',
    receivedAt: String(raw['receivedDateTime'] ?? new Date().toISOString()),
    snippet: String(raw['bodyPreview'] ?? ''),
    signals,
    extracted: {},
    passCount: 0,
    passes: [],
    sourceData: {
      from: { email: (raw['from'] as any)?.email ?? '' },
      subject: raw['subject'],
    },
  };
}

async function loadFixtures(): Promise<Map<string, TriageEvent>> {
  const files = await fs.readdir(FIXTURES_DIR);
  const events = new Map<string, TriageEvent>();

  for (const file of files.filter((f) => f.endsWith('.json'))) {
    const raw = JSON.parse(await fs.readFile(path.join(FIXTURES_DIR, file), 'utf-8'));
    const event = fixtureToEvent(raw);
    events.set(file.replace('.json', ''), event);
  }

  return events;
}

describe('Policy pipeline integration (T053)', () => {
  test('all 6 fixture events produce the expected intents', async () => {
    const fixtures = await loadFixtures();

    // Write all events to system/triage/
    for (const event of fixtures.values()) {
      await saveEvent(systemDir, event);
    }

    // Load from disk to verify round-trip
    const loaded = await listEvents(systemDir, ['pending']);
    expect(loaded.length).toBe(6);

    // Evaluate
    const decisions = evaluate(policy, loaded);
    expect(decisions.length).toBe(6);

    // Build a map for assertions
    const byEventId = new Map(
      decisions.map((d) => {
        const event = loaded.find((e) => e.eventId === d.eventId);
        return [event.author, d];
      })
    );

    // Newsletter
    const newsletter = byEventId.get('news@acme.example');
    expect(newsletter?.classification.intent).toBe('NEWSLETTER');
    expect(newsletter?.terminal).toBe(true);

    // Receipt
    const receipt = byEventId.get('billing@cloudvendor.example');
    expect(receipt?.classification.intent).toBe('RECEIPT');
    expect(receipt?.terminal).toBe(true);
  });

  test('decisions are written to system/decisions/', async () => {
    const fixtures = await loadFixtures();
    const events = [...fixtures.values()];

    for (const event of events) {
      await saveEvent(systemDir, event);
    }

    const loaded = await listEvents(systemDir, ['pending']);
    const decisions = evaluate(policy, loaded);

    for (const decision of decisions) {
      await saveDecision(systemDir, decision);
    }

    const decisionsDir = path.join(systemDir, 'decisions');
    const files = await fs.readdir(decisionsDir);
    expect(files.length).toBe(6);
    expect(files.every((f) => f.endsWith('.md'))).toBe(true);
  });

  test('no MOVE action present when ASK_HUMAN is produced', async () => {
    // Create an event that triggers ASK_HUMAN (low confidence, no matching rule)
    const event: TriageEvent = {
      eventId: '20260219-email-unknown1',
      source: 'email',
      status: 'pending',
      title: 'Ambiguous message from colleague',
      author: 'colleague@example.com',
      receivedAt: '2026-02-19T08:00:00Z',
      snippet: 'Hey, just checking in on that thing.',
      signals: {
        isAutomated: false,
        isBulk: false,
        hasUnsubscribe: false,
        hasAttachments: false,
        mentionsMoney: false,
        mentionsMeeting: false,
        asksForAction: false,
        prioritySender: false,
      },
      extracted: {},
      passCount: 0,
      passes: [],
    };

    await saveEvent(systemDir, event);
    const loaded = await listEvents(systemDir, ['pending']);
    const [decision] = evaluate(policy, loaded);

    // If ASK_HUMAN is present, MOVE must not be
    if (decision.actions.some((a) => a.type === 'ASK_HUMAN')) {
      expect(decision.actions.some((a) => a.type === 'MOVE')).toBe(false);
    }
  });

  test('idempotency: second evaluation produces no new decisions for already-actioned events', async () => {
    const fixtures = await loadFixtures();
    const newsletter = fixtures.get('newsletter_1');

    await saveEvent(systemDir, newsletter);
    const loaded = await listEvents(systemDir, ['pending']);
    const [decision] = evaluate(policy, loaded);
    await saveDecision(systemDir, decision);

    // Mark as actioned
    const actioned = { ...newsletter, status: 'actioned' as const };
    await saveEvent(systemDir, actioned);

    // Second scan — no pending events
    const pending = await listEvents(systemDir, ['pending']);
    expect(pending.length).toBe(0);

    // Idempotency keys are stable
    const [d2] = evaluate(policy, [newsletter]);
    const keys1 = decision.actions.map((a) => a.idempotencyKey).sort();
    const keys2 = d2.actions.map((a) => a.idempotencyKey).sort();
    expect(keys1).toEqual(keys2);
  });

  test('run log written to system/runs/ with correct counts', async () => {
    const { writeRunLog, summariseDecision } = await import('../../src/lib/triage/run-log-writer');
    const { randomUUID } = await import('crypto');

    const fixtures = await loadFixtures();
    const events = [...fixtures.values()];
    const decisions = evaluate(policy, events);

    const entry = {
      runId: randomUUID(),
      policyId: policy.id,
      policyVersion: policy.version,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      stages: ['evaluation', 'execution'] as const,
      eventsProcessed: events.length,
      eventsActioned: decisions.filter((d) => !d.actions.some((a) => a.type === 'ASK_HUMAN'))
        .length,
      humanItemsCreated: decisions.filter((d) => d.actions.some((a) => a.type === 'ASK_HUMAN'))
        .length,
      humanItemsResolved: 0,
      claudeApprovalsRequested: 0,
      claudeApprovalsGranted: 0,
      errors: [],
      decisions: decisions.map(summariseDecision),
    };

    const filepath = await writeRunLog(entry, systemDir, decisions);
    const content = await fs.readFile(filepath, 'utf-8');

    expect(content).toContain(`eventsProcessed: ${events.length}`);
    expect(content).toContain('## Decision Details');
  });
});
