/**
 * RunLogWriter — writes RunLogEntry artifacts to system/runs/.
 * Each heartbeat cycle produces one run log file with a full audit trail.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { writeArtifact } from './artifact-writer';
import type { RunLogEntry, RunLogDecisionSummary, PolicyDecision } from '../policy/types';
import { logger } from '../../common/logger';

function runsDir(systemDir: string): string {
  return path.join(systemDir, 'runs');
}

function runFilename(entry: RunLogEntry): string {
  const date = entry.startedAt.slice(0, 10).replace(/-/g, '');
  const shortId = entry.runId.slice(-8);
  return `run_${date}_${shortId}.md`;
}

function toFrontmatter(entry: RunLogEntry): Record<string, unknown> {
  return {
    type: 'run-log',
    runId: entry.runId,
    policyId: entry.policyId,
    policyVersion: entry.policyVersion,
    startedAt: entry.startedAt,
    completedAt: entry.completedAt ?? '',
    eventsProcessed: entry.eventsProcessed,
    eventsActioned: entry.eventsActioned,
    humanItemsCreated: entry.humanItemsCreated,
    humanItemsResolved: entry.humanItemsResolved,
    claudeApprovalsRequested: entry.claudeApprovalsRequested,
    claudeApprovalsGranted: entry.claudeApprovalsGranted,
    errorCount: entry.errors.length,
    stages: entry.stages.join(','),
  };
}

function buildBody(entry: RunLogEntry, decisions: PolicyDecision[]): string {
  const lines: string[] = [
    `## Summary`,
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Events processed | ${entry.eventsProcessed} |`,
    `| Events actioned | ${entry.eventsActioned} |`,
    `| Human items created | ${entry.humanItemsCreated} |`,
    `| Human items resolved | ${entry.humanItemsResolved} |`,
    `| Claude approvals requested | ${entry.claudeApprovalsRequested} |`,
    `| Claude approvals granted | ${entry.claudeApprovalsGranted} |`,
    `| Errors | ${entry.errors.length} |`,
    '',
  ];

  if (entry.errors.length > 0) {
    lines.push(`## Errors`, '');
    for (const err of entry.errors) {
      lines.push(`- **${err.stage}**${err.eventId ? ` (${err.eventId})` : ''}: ${err.message}`);
    }
    lines.push('');
  }

  lines.push(`## Decision Details`, '');

  for (const summary of entry.decisions) {
    const decision = decisions.find((d) => d.eventId === summary.eventId);
    lines.push(`### ${summary.eventId}`, '');
    lines.push(`- Intent: **${summary.intent}** | Terminal: ${summary.terminal}`);
    lines.push(`- Actions: ${summary.actionTypes.join(', ') || 'none'}`);
    lines.push(`- Human item: ${summary.hasHumanItem ? 'yes' : 'no'}`);

    // Include full trace for HIGH risk or human-queue items
    if (summary.hasHumanItem && decision) {
      lines.push('', `#### Trace`, '');
      for (const entry of decision.trace) {
        const status = entry.matched ? '✓' : '✗';
        const term = entry.terminal ? ' [terminal]' : '';
        lines.push(`- ${status} **${entry.ruleId}** (priority ${entry.priority})${term}`);
        if (entry.gateOutcomes) {
          for (const gate of entry.gateOutcomes) {
            lines.push(
              `  - Gate: \`${gate.gate}\` applied=${gate.applied} reason="${gate.reason}"` +
                (gate.actionSuppressed ? ` suppressed=${gate.actionSuppressed}` : '')
            );
          }
        }
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Write a RunLogEntry to system/runs/.
 * Accepts the full decisions array for trace inclusion in HIGH-risk / human-queue events.
 */
export async function writeRunLog(
  entry: RunLogEntry,
  systemDir: string,
  decisions: PolicyDecision[] = []
): Promise<string> {
  const dir = runsDir(systemDir);
  await fs.mkdir(dir, { recursive: true });

  const filename = runFilename(entry);
  const body = buildBody(entry, decisions);

  await writeArtifact(dir, filename, toFrontmatter(entry), body);

  logger.info({
    operation: 'run_log_written',
    runId: entry.runId,
    eventsProcessed: entry.eventsProcessed,
    filename,
    message: `Run log written: ${filename}`,
  });

  return path.join(dir, filename);
}

/**
 * Build a RunLogDecisionSummary from a PolicyDecision.
 */
export function summariseDecision(decision: PolicyDecision): RunLogDecisionSummary {
  return {
    eventId: decision.eventId,
    intent: decision.classification.intent,
    terminal: decision.terminal,
    actionTypes: decision.actions.map((a) => a.type),
    hasHumanItem: decision.actions.some((a) => a.type === 'ASK_HUMAN'),
  };
}
