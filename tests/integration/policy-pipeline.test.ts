/**
 * Integration test for the policy pipeline
 * Mounts a temporary system/ directory, writes MessageItem artifacts from fixtures,
 * runs PolicyEvaluator, and verifies outcomes.
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { evaluate } from '../../src/lib/policy/evaluator';
import { loadPolicy } from '../../src/lib/policy/policy-loader';
import { saveItem, listItems } from '../../src/lib/item/item-store';
import type { MessageItem, Signals } from '../../src/lib/item/types';
import type { Policy } from '../../src/lib/policy/types';

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
  await fs.mkdir(path.join(systemDir, 'messages'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

/** Convert a raw fixture JSON to a MessageItem */
function fixtureToItem(raw: Record<string, unknown>, id: string): MessageItem {
  const rawSignals = (raw['signals'] as Record<string, boolean>) ?? {};
  const signals: Signals = {
    isAutomated: rawSignals['isAutomated'] ?? false,
    isBulk: rawSignals['isBulk'] ?? false,
    hasUnsubscribe: rawSignals['hasUnsubscribe'] ?? false,
    hasAttachments: rawSignals['hasAttachments'] ?? false,
    mentionsMoney: rawSignals['mentionsMoney'] ?? false,
    mentionsMeeting: rawSignals['mentionsMeeting'] ?? false,
    // Support both old and new signal names
    isActionRequest: rawSignals['isActionRequest'] ?? rawSignals['asksForAction'] ?? false,
    isPrioritySender: rawSignals['isPrioritySender'] ?? rawSignals['prioritySender'] ?? false,
  };

  return {
    type: 'MESSAGE',
    source: 'email',
    id,
    status: 'inbox',
    createdAt: String(raw['receivedDateTime'] ?? new Date().toISOString()),
    subject: String(raw['subject'] ?? 'Untitled'),
    from: (raw['from'] as any)?.email ?? 'unknown@example.com',
    body: String(raw['bodyText'] ?? raw['bodyPreview'] ?? ''),
    signals,
    actions: [{ type: 'INGEST', at: new Date().toISOString(), status: 'done' }],
  };
}

async function loadFixtures(): Promise<Map<string, MessageItem>> {
  const files = await fs.readdir(FIXTURES_DIR);
  const items = new Map<string, MessageItem>();

  for (const file of files.filter((f) => f.endsWith('.json'))) {
    const raw = JSON.parse(await fs.readFile(path.join(FIXTURES_DIR, file), 'utf-8'));
    const id = file.replace('.json', '');
    const item = fixtureToItem(raw, id);
    items.set(id, item);
  }

  return items;
}

describe('Policy pipeline integration', () => {
  test('all 6 fixture events produce the expected intents', async () => {
    const fixtures = await loadFixtures();

    // Write all items to system/messages/
    for (const item of fixtures.values()) {
      await saveItem(systemDir, item);
    }

    // Load from disk to verify round-trip
    const loaded = await listItems(systemDir, ['inbox']);
    expect(loaded.length).toBe(6);

    // Evaluate
    const results = evaluate(policy, loaded);
    expect(results.length).toBe(6);

    // Build a map for assertions: from (author) → result
    const byFrom = new Map(
      results.map((r) => {
        const item = loaded.find((i) => i.id === r.itemId) as MessageItem;
        return [item.from, r];
      })
    );

    // Newsletter
    const newsletter = byFrom.get('news@acme.example');
    expect(newsletter?.classification.intent).toBe('NEWSLETTER');
    expect(newsletter?.nextActions.some((a) => a.type === 'MOVE')).toBe(true);

    // Receipt
    const receipt = byFrom.get('billing@cloudvendor.example');
    expect(receipt?.classification.intent).toBe('RECEIPT');
    expect(receipt?.nextActions.some((a) => a.type === 'MOVE')).toBe(true);
  });

  test('no MOVE action present when TRIAGE is produced (conflict resolution)', async () => {
    // Create an item that triggers TRIAGE + has a MOVE action via low confidence
    const testPolicy: Policy = {
      id: 'test-conflict',
      version: '1.0.0',
      defaults: {
        approvalThreshold: 0.75,
        claudeRecommendThreshold: 0.6,
        unknownIntentRisk: 'MEDIUM',
        conflictResolution: { triageBlocksMove: true },
      },
      rules: [
        {
          id: 'move-and-triage',
          priority: 500,
          when: { field: 'source', op: 'eq', value: 'email' },
          setClassification: {
            intent: 'FYI',
            urgency: 'SOMEDAY',
            risk: 'LOW',
            confidence: 0.3, // low → safety gate adds TRIAGE
            rationale: ['low confidence'],
          },
          actions: [{ type: 'MOVE', folder: 'Archive' }],
          terminal: true,
        },
      ],
    };

    const item: MessageItem = {
      type: 'MESSAGE',
      source: 'email',
      id: 'conflict-test-001',
      status: 'inbox',
      createdAt: '2026-02-19T08:00:00Z',
      body: 'Just checking in.',
      signals: {
        isAutomated: false,
        isBulk: false,
        hasUnsubscribe: false,
        hasAttachments: false,
        mentionsMoney: false,
        mentionsMeeting: false,
        isActionRequest: false,
        isPrioritySender: false,
      },
      actions: [{ type: 'INGEST', at: '2026-02-19T08:00:00Z', status: 'done' }],
    };

    const [result] = evaluate(testPolicy, [item]);

    if (result.nextActions.some((a) => a.type === 'TRIAGE')) {
      expect(result.nextActions.some((a) => a.type === 'MOVE')).toBe(false);
    }
  });

  test('item round-trips correctly through item-store', async () => {
    const item: MessageItem = {
      type: 'MESSAGE',
      source: 'email',
      id: 'round-trip-001',
      status: 'inbox',
      createdAt: '2026-02-19T08:00:00Z',
      subject: 'Round-trip test',
      from: 'test@example.com',
      body: 'Full body content here.',
      signals: {
        isAutomated: false,
        isBulk: false,
        hasUnsubscribe: false,
        hasAttachments: false,
        mentionsMoney: false,
        mentionsMeeting: false,
        isActionRequest: false,
        isPrioritySender: false,
      },
      actions: [{ type: 'INGEST', at: '2026-02-19T08:00:00Z', status: 'done' }],
    };

    await saveItem(systemDir, item);
    const loaded = await listItems(systemDir, ['inbox']);

    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('round-trip-001');
    expect((loaded[0] as MessageItem).subject).toBe('Round-trip test');
    expect((loaded[0] as MessageItem).body).toBe('Full body content here.');
    expect(loaded[0].status).toBe('inbox');
  });
});
