/**
 * Triage I/O library public API.
 *
 * Provides atomic read/write helpers for all system/ artifact types:
 * - artifact-writer: generic frontmatter-markdown I/O with proper-lockfile
 * - triage-event-store: TriageEvent artifacts (system/triage/)
 * - decision-store: PolicyDecision artifacts (system/decisions/)
 * - human-queue-store: HumanQueueItem artifacts (system/human/)
 * - task-writer: task note artifacts (system/artifacts/tasks/)
 * - reading-pack-writer: daily reading pack notes (system/artifacts/reading-packs/)
 * - run-log-writer: RunLogEntry artifacts (system/runs/)
 * - human-queue-processor: re-evaluation trigger for resolved queue items
 * - signal-definitions: signal computation stubs for non-email sources
 */

export * from './artifact-writer';
export * from './triage-event-store';
export * from './decision-store';
export * from './human-queue-store';
export * from './task-writer';
export * from './reading-pack-writer';
export * from './run-log-writer';
export * from './human-queue-processor';
export * from './signal-definitions';
