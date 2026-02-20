/**
 * TriageEvent artifact I/O for system/triage/.
 * Reads and writes TriageEvent frontmatter-markdown files.
 * Append-only for EvaluationPass history — never overwrites existing pass sections.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { writeArtifact, readArtifact, listArtifacts } from './artifact-writer';
import type { TriageEvent, TriageEventStatus, EvaluationPass } from '../policy/types';
import { logger } from '../../common/logger';

function triageDir(systemDir: string): string {
  return path.join(systemDir, 'triage');
}

function eventFilename(event: TriageEvent): string {
  // Derive date prefix from receivedAt
  const date = event.receivedAt.slice(0, 10).replace(/-/g, '');
  return `${date}-${event.source}-${event.eventId.slice(-8)}.md`;
}

/**
 * Convert a TriageEvent to frontmatter scalars (flat, machine-readable).
 */
function toFrontmatter(event: TriageEvent): Record<string, unknown> {
  const fm: Record<string, unknown> = {
    type: 'triage-event',
    eventId: event.eventId,
    source: event.source,
    status: event.status,
    title: event.title,
    author: event.author,
    receivedAt: event.receivedAt,
    passCount: event.passCount,
  };

  // Use latestPassTimestamp from passes array if not set explicitly
  const latestPass = event.passes.length > 0 ? event.passes[event.passes.length - 1] : undefined;

  const latestTs = event.latestPassTimestamp ?? latestPass?.timestamp;
  if (latestTs) {
    fm['latestPassTimestamp'] = latestTs;
  }

  // Flatten signals as signals_*
  for (const [k, v] of Object.entries(event.signals)) {
    fm[`signals_${k}`] = v;
  }

  // Flatten extracted fields as extracted_*
  for (const [k, v] of Object.entries(event.extracted)) {
    if (v !== undefined) fm[`extracted_${k}`] = v;
  }

  // Persist sourceData as JSON so executor can recover messageId, calendarEventId, etc.
  if (event.sourceData && Object.keys(event.sourceData).length > 0) {
    fm['sourceDataJson'] = JSON.stringify(event.sourceData);
  }

  // Flatten latest decision summary as latest_decision_* (for quick querying)
  if (latestPass) {
    const d = latestPass.decision;
    fm['latest_decision_intent'] = d.classification.intent;
    fm['latest_decision_confidence'] = d.classification.confidence;
    fm['latest_decision_risk'] = d.classification.risk;
    fm['latest_decision_urgency'] = d.classification.urgency;
    fm['latest_decision_actions'] = d.actions.map((a) => a.type).join(',');
    fm['latest_decision_terminal'] = d.terminal;
  }

  return fm;
}

/**
 * Build the body for a TriageEvent — snippet + pass history.
 */
function buildBody(event: TriageEvent, existingBody?: string): string {
  // Snippet section (only written on first save)
  const isNew = !existingBody;
  let body = isNew ? `## Snippet\n\n${event.snippet}\n\n` : (existingBody ?? '');

  // Append new passes if any
  if (event.passes.length > 0) {
    if (!body.includes('## Evaluation History')) {
      body += '\n## Evaluation History\n';
    }

    // Find the highest pass number already recorded
    const existingPassNumbers = [...body.matchAll(/### Pass (\d+)/g)].map((m) =>
      parseInt(m[1], 10)
    );
    const lastRecorded = existingPassNumbers.length ? Math.max(...existingPassNumbers) : 0;

    // Append only new passes
    for (const pass of event.passes) {
      if (pass.passNumber > lastRecorded) {
        body += formatPass(pass);
      }
    }
  }

  return body;
}

function formatPass(pass: EvaluationPass): string {
  const d = pass.decision;
  const llmInfo = pass.llmTier
    ? ` | LLM: ${pass.llmTier}${pass.llmConfidence !== undefined ? ` (${(pass.llmConfidence * 100).toFixed(0)}%)` : ''}`
    : '';
  const rulesMatched = d.trace.filter((t) => t.matched).length;

  return (
    `\n### Pass ${pass.passNumber} — ${pass.timestamp} (policy: ${pass.policyId}@${pass.policyVersion}${llmInfo})\n\n` +
    `- Intent: ${d.classification.intent} | Confidence: ${(d.classification.confidence * 100).toFixed(0)}% | Risk: ${d.classification.risk} | Urgency: ${d.classification.urgency}\n` +
    `- Rules evaluated: ${d.trace.length} / Matched: ${rulesMatched}\n` +
    `- Actions: ${d.actions.map((a) => a.type).join(', ') || 'none'}\n` +
    `- Terminal: ${d.terminal}\n`
  );
}

/**
 * Read all TriageEvent artifacts with the given statuses from system/triage/.
 * Returns events sorted by receivedAt ascending.
 */
export async function listEvents(
  systemDir: string,
  statuses: TriageEventStatus[]
): Promise<TriageEvent[]> {
  const dir = triageDir(systemDir);
  const files = await listArtifacts(dir);
  const events: TriageEvent[] = [];

  for (const filepath of files) {
    const artifact = await readArtifact(filepath);
    if (!artifact) continue;

    const fm = artifact.data;
    if (!statuses.includes(fm['status'] as TriageEventStatus)) continue;

    const event = fromFrontmatter(fm, artifact.content);
    if (event) events.push(event);
  }

  // Sort by receivedAt ascending
  return events.sort((a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime());
}

/**
 * Read a single TriageEvent by eventId from system/triage/.
 */
export async function getEvent(systemDir: string, eventId: string): Promise<TriageEvent | null> {
  const dir = triageDir(systemDir);
  const files = await listArtifacts(dir);

  for (const filepath of files) {
    const artifact = await readArtifact(filepath);
    if (!artifact) continue;
    if (artifact.data['eventId'] === eventId) {
      return fromFrontmatter(artifact.data, artifact.content);
    }
  }
  return null;
}

/**
 * Write or update a TriageEvent artifact atomically.
 * On update: overwrites frontmatter scalars, appends new pass sections to body.
 */
export async function saveEvent(systemDir: string, event: TriageEvent): Promise<void> {
  const dir = triageDir(systemDir);
  const filename = eventFilename(event);
  const filepath = path.join(dir, filename);

  // Read existing body if file already exists
  const existing = await readArtifact(filepath);
  const existingBody = existing?.content;

  const frontmatter = toFrontmatter(event);
  const body = buildBody(event, existingBody);

  await writeArtifact(dir, filename, frontmatter, body);

  logger.debug({
    operation: 'triage_event_saved',
    eventId: event.eventId,
    status: event.status,
    passCount: event.passCount,
    message: `TriageEvent saved: ${event.eventId}`,
  });
}

/**
 * Reconstruct a TriageEvent from frontmatter scalars and body content.
 */
function fromFrontmatter(fm: Record<string, unknown>, content: string): TriageEvent | null {
  const eventId = fm['eventId'] as string;
  if (!eventId) return null;

  // Reconstruct signals from signals_* keys
  const signals: Record<string, boolean | string | number> = {};
  for (const [k, v] of Object.entries(fm)) {
    if (k.startsWith('signals_')) {
      signals[k.slice('signals_'.length)] = v as boolean | string | number;
    }
  }

  // Reconstruct extracted from extracted_* keys
  const extracted: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fm)) {
    if (k.startsWith('extracted_')) {
      extracted[k.slice('extracted_'.length)] = v;
    }
  }

  // Reconstruct sourceData from sourceDataJson if present
  let sourceData: Record<string, unknown> | undefined;
  if (fm['sourceDataJson']) {
    try {
      sourceData = JSON.parse(fm['sourceDataJson'] as string) as Record<string, unknown>;
    } catch {
      // Ignore parse errors
    }
  }

  return {
    eventId,
    source: (fm['source'] as TriageEvent['source']) ?? 'other',
    status: (fm['status'] as TriageEventStatus) ?? 'pending',
    title: (fm['title'] as string) ?? '',
    author: (fm['author'] as string) ?? '',
    receivedAt: (fm['receivedAt'] as string) ?? new Date().toISOString(),
    snippet: extractSnippet(content),
    signals: signals as TriageEvent['signals'],
    extracted,
    passCount: (fm['passCount'] as number) ?? 0,
    latestPassTimestamp: fm['latestPassTimestamp'] as string | undefined,
    passes: [], // Pass history is stored in body only; not re-parsed on read
    sourceData,
  };
}

function extractSnippet(content: string): string {
  const snippetMatch = content.match(/## Snippet\s*\n\n([\s\S]*?)(?:\n\n##|\s*$)/);
  return snippetMatch ? snippetMatch[1].trim() : '';
}

/**
 * Move a triage event file from system/triage/ to system/triage/done/.
 * Called after all actions for an event have been fully applied.
 * No-op if the file cannot be found (already moved or never existed).
 */
export async function archiveEvent(systemDir: string, eventId: string): Promise<void> {
  const dir = triageDir(systemDir);
  const doneDir = path.join(dir, 'done');
  const files = await listArtifacts(dir);

  for (const filepath of files) {
    const artifact = await readArtifact(filepath);
    if (!artifact) continue;
    if (artifact.data['eventId'] !== eventId) continue;

    await fs.mkdir(doneDir, { recursive: true });
    const destPath = path.join(doneDir, path.basename(filepath));
    await fs.rename(filepath, destPath);

    // Clean up lock file if present
    try {
      await fs.unlink(`${filepath}.lock`);
    } catch {
      // Ignore — lock file may not exist
    }

    logger.debug({
      operation: 'triage_event_archived',
      eventId,
      dest: destPath,
      message: `Triage event archived: ${eventId}`,
    });
    return;
  }
}
