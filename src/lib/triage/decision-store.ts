/**
 * PolicyDecision artifact I/O for system/decisions/.
 * Writes PolicyDecision artifacts and tracks action application.
 */

import * as path from 'path';
import { writeArtifact, readArtifact, listArtifacts } from './artifact-writer';
import type { PolicyDecision, ResolvedAction } from '../policy/types';
import { logger } from '../../common/logger';

function decisionsDir(systemDir: string): string {
  return path.join(systemDir, 'decisions');
}

function decisionFilename(decision: PolicyDecision): string {
  const date = decision.timestamp.slice(0, 10).replace(/-/g, '');
  return `${date}-${decision.eventId}-decision.md`;
}

function toFrontmatter(decision: PolicyDecision, actionsApplied: boolean): Record<string, unknown> {
  return {
    type: 'policy-decision',
    eventId: decision.eventId,
    policyId: decision.policyId,
    policyVersion: decision.policyVersion,
    timestamp: decision.timestamp,
    intent: decision.classification.intent,
    urgency: decision.classification.urgency,
    risk: decision.classification.risk,
    confidence: decision.classification.confidence,
    terminal: decision.terminal,
    actionsApplied,
    // Serialised so the executor can recover the full action list without re-evaluation
    actionsJson: JSON.stringify(decision.actions),
  };
}

function buildBody(decision: PolicyDecision): string {
  const lines: string[] = [
    `## Classification\n`,
    `- Intent: **${decision.classification.intent}**`,
    `- Urgency: ${decision.classification.urgency}`,
    `- Risk: ${decision.classification.risk}`,
    `- Confidence: ${(decision.classification.confidence * 100).toFixed(0)}%`,
  ];

  if (decision.classification.rationale.length > 0) {
    lines.push(`- Rationale: ${decision.classification.rationale.join('; ')}`);
  }

  lines.push(`\n## Actions\n`);
  for (const action of decision.actions) {
    const approval = action.requiresApproval ? ' *(requires approval)*' : '';
    const applied = action.applied ? ` ✓ applied ${action.appliedAt ?? ''}` : '';
    lines.push(`- **${action.type}**${approval}${applied} — key: \`${action.idempotencyKey}\``);
    if (action.name) lines.push(`  - name: ${action.name}`);
    if (action.folder) lines.push(`  - folder: ${action.folder}`);
    if (action.question) lines.push(`  - question: ${action.question}`);
  }

  lines.push(`\n## Trace\n`);
  for (const entry of decision.trace) {
    const status = entry.matched ? '✓' : '✗';
    const term = entry.terminal ? ' [terminal]' : '';
    lines.push(
      `- ${status} **${entry.ruleId}** (priority ${entry.priority})${term}: ${entry.predicateResult.reason ?? ''}`
    );
    if (entry.gateOutcomes) {
      for (const gate of entry.gateOutcomes) {
        lines.push(
          `  - Gate: ${gate.gate} → ${gate.reason}${gate.actionSuppressed ? ` (suppressed: ${gate.actionSuppressed})` : ''}`
        );
      }
    }
  }

  return lines.join('\n') + '\n';
}

/**
 * Write a PolicyDecision artifact to system/decisions/.
 */
export async function saveDecision(systemDir: string, decision: PolicyDecision): Promise<void> {
  const dir = decisionsDir(systemDir);
  const filename = decisionFilename(decision);

  const frontmatter = toFrontmatter(decision, false);
  const body = buildBody(decision);

  await writeArtifact(dir, filename, frontmatter, body);

  logger.debug({
    operation: 'decision_saved',
    eventId: decision.eventId,
    intent: decision.classification.intent,
    message: `Decision saved: ${decision.eventId} → ${decision.classification.intent}`,
  });
}

/**
 * List all PolicyDecision artifacts where actionsApplied = false.
 */
export async function listPendingDecisions(systemDir: string): Promise<PolicyDecision[]> {
  const dir = decisionsDir(systemDir);
  const files = await listArtifacts(dir);
  const decisions: PolicyDecision[] = [];

  for (const filepath of files) {
    const artifact = await readArtifact(filepath);
    if (!artifact) continue;
    if (artifact.data['actionsApplied'] === true) continue;

    const decision = fromFrontmatter(artifact.data);
    if (decision) decisions.push(decision);
  }

  return decisions;
}

/**
 * Mark a specific action as applied in a decision file.
 */
export async function markActionApplied(
  systemDir: string,
  eventId: string,
  idempotencyKey: string,
  appliedAt: string
): Promise<void> {
  const dir = decisionsDir(systemDir);
  const files = await listArtifacts(dir);

  for (const filepath of files) {
    const artifact = await readArtifact(filepath);
    if (!artifact) continue;
    if (artifact.data['eventId'] !== eventId) continue;

    // Update the applied action in frontmatter
    const fm = { ...artifact.data };
    fm[`action_applied_${idempotencyKey.slice(-16)}`] = appliedAt;

    // Mark all actions applied if all idempotency keys are marked
    const filename = path.basename(filepath);
    await writeArtifact(dir, filename, fm, artifact.content);

    logger.debug({
      operation: 'action_marked_applied',
      eventId,
      idempotencyKey,
      appliedAt,
      message: `Action marked applied: ${idempotencyKey}`,
    });
    return;
  }
}

/**
 * Mark an entire decision as fully applied (actionsApplied = true).
 */
export async function markDecisionApplied(systemDir: string, eventId: string): Promise<void> {
  const dir = decisionsDir(systemDir);
  const files = await listArtifacts(dir);

  for (const filepath of files) {
    const artifact = await readArtifact(filepath);
    if (!artifact) continue;
    if (artifact.data['eventId'] !== eventId) continue;

    const fm = { ...artifact.data, actionsApplied: true };
    const filename = path.basename(filepath);
    await writeArtifact(dir, filename, fm, artifact.content);

    logger.debug({
      operation: 'decision_marked_applied',
      eventId,
      message: `Decision marked applied: ${eventId}`,
    });
    return;
  }

  logger.warn({
    operation: 'decision_mark_applied_not_found',
    eventId,
    message: `Decision not found for marking applied: ${eventId}`,
  });
}

/**
 * Reconstruct a PolicyDecision from frontmatter (minimal — trace not re-parsed).
 */
function fromFrontmatter(fm: Record<string, unknown>): PolicyDecision | null {
  const eventId = fm['eventId'] as string;
  if (!eventId) return null;

  // Recover actions from persisted JSON
  let actions: ResolvedAction[] = [];
  if (fm['actionsJson']) {
    try {
      actions = JSON.parse(fm['actionsJson'] as string) as ResolvedAction[];
    } catch {
      // Ignore — old decisions without actionsJson will have empty actions
    }
  }

  return {
    eventId,
    policyId: (fm['policyId'] as string) ?? '',
    policyVersion: (fm['policyVersion'] as string) ?? '',
    timestamp: (fm['timestamp'] as string) ?? '',
    classification: {
      intent: (fm['intent'] as PolicyDecision['classification']['intent']) ?? 'UNKNOWN',
      urgency: (fm['urgency'] as PolicyDecision['classification']['urgency']) ?? 'SOMEDAY',
      risk: (fm['risk'] as PolicyDecision['classification']['risk']) ?? 'MEDIUM',
      confidence: (fm['confidence'] as number) ?? 0,
      rationale: [],
    },
    actions,
    trace: [],
    terminal: (fm['terminal'] as boolean) ?? false,
  };
}
