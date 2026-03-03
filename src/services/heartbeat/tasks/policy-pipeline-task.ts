/**
 * PolicyPipelineTask — evaluates items and determines their next action.
 *
 * Pipeline (per heartbeat cycle):
 *   1. Load all items with status: inbox
 *   2. Run local LLM enrichment for any item missing an ENHANCE action
 *   3. Evaluate the policy for each item
 *   4. Append the next action(s) to each item and update its status
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import matter from 'gray-matter';
import type { TaskHandler } from '../types';
import type { TaskConfig } from '../../../types/heartbeat';
import type { PolicyPipelineConfig, Policy } from '../../../lib/policy/types';
import { evaluate } from '../../../lib/policy/evaluator';
import { loadPolicy } from '../../../lib/policy/policy-loader';
import { listItems, updateItem } from '../../../lib/item/item-store';
import type { Item, Action } from '../../../lib/item/types';
import type { LocalEnrichmentService } from '../../enrichment/local-enrichment-service';
import { buildEnhanceAction } from '../../enrichment/local-enrichment-service';
import { JournalContextRetriever, extractTermsFromItem } from '../../../lib/journal/context-retriever';
import { logger } from '../../../common/logger';

interface ActiveTask {
  id: string;
  title: string;
}

/**
 * Load active (non-done) tasks from {rootDir}/tasks/*.md.
 * Skips tasks with status: done/completed/cancelled.
 * Returns [{id: slug, title}] sorted by filename.
 */
async function loadActiveTasks(rootDir: string): Promise<ActiveTask[]> {
  const tasksDir = path.join(rootDir, 'tasks');
  try {
    const files = (await fs.readdir(tasksDir)).filter((f) => f.endsWith('.md')).sort();
    const tasks: ActiveTask[] = [];
    for (const file of files) {
      try {
        const content = await fs.readFile(path.join(tasksDir, file), 'utf-8');
        const { data } = matter(content);
        const status = (data['status'] as string | undefined) ?? 'to-do';
        if (['done', 'completed', 'cancelled'].includes(status)) continue;
        const title =
          (data['title'] as string | undefined) ??
          file.replace('.md', '').replace(/-/g, ' ');
        tasks.push({ id: file.replace('.md', ''), title });
      } catch {
        // Skip unreadable files
      }
    }
    return tasks;
  } catch {
    return [];
  }
}

export class PolicyPipelineTask implements TaskHandler {
  constructor(
    private readonly systemDir: string,
    private readonly policyDir: string,
    private readonly localEnrichment?: LocalEnrichmentService,
    private readonly rootDir?: string
  ) {}

  async execute(taskConfig: TaskConfig): Promise<void> {
    const cfg = (taskConfig.config ?? {}) as PolicyPipelineConfig;
    const batchSize = cfg.batchSize ?? 50;

    logger.info({
      operation: 'policy_pipeline_start',
      taskId: taskConfig.id,
      message: 'PolicyPipelineTask starting',
    });

    // Stage 1: Load inbox items
    const inbox = await listItems(this.systemDir, ['inbox']);
    const batch = inbox.slice(0, batchSize);

    if (batch.length === 0) {
      logger.info({
        operation: 'policy_pipeline_no_items',
        message: 'No inbox items to process',
      });
      return;
    }

    logger.info({
      operation: 'policy_pipeline_items_loaded',
      count: batch.length,
      message: `Processing ${batch.length} inbox item(s)`,
    });

    // Stage 2: Build journal context index + load active tasks (once per cycle, best-effort)
    let contextRetriever: JournalContextRetriever | undefined;
    let activeTasks: ActiveTask[] = [];
    if (this.localEnrichment && this.rootDir) {
      const journalDir = path.join(this.rootDir, 'areas', 'journal');
      contextRetriever = new JournalContextRetriever();
      try {
        await contextRetriever.buildIndex(journalDir);
        logger.debug({
          operation: 'policy_pipeline_context_index_built',
          message: 'Journal context index built for enrichment cycle',
        });
      } catch (err) {
        logger.warn({
          operation: 'policy_pipeline_context_index_error',
          error: (err as Error).message,
          message: 'Failed to build journal context index — enriching without context',
        });
        contextRetriever = undefined;
      }

      activeTasks = await loadActiveTasks(this.rootDir);
      logger.debug({
        operation: 'policy_pipeline_tasks_loaded',
        count: activeTasks.length,
        message: `Loaded ${activeTasks.length} active task(s) for task-match enrichment`,
      });
    }

    // Stage 3: Enrich items that lack an ENHANCE action
    for (const item of batch) {
      const hasEnhance = item.actions.some((a) => a.type === 'ENHANCE');
      if (!hasEnhance && this.localEnrichment) {
        try {
          // Call 1: intent classification with optional journal context
          let contextBrief: string | undefined;
          if (contextRetriever?.isReady) {
            const terms = extractTermsFromItem(item);
            const snippets = contextRetriever.retrieve(terms);
            contextBrief = contextRetriever.formatBrief(snippets);
          }
          const result = await this.localEnrichment.enrich(item, contextBrief);
          const enhanceAction = buildEnhanceAction(result);

          // Call 2: task matching (separate focused call)
          if (activeTasks.length > 0) {
            const relatedTasks = await this.localEnrichment.findRelatedTasks(item, activeTasks);
            if (relatedTasks.length > 0) {
              enhanceAction.relatedTasks = relatedTasks;
            }
          }

          item.actions.push(enhanceAction);
          // Write immediately so enrichment survives a crash before evaluation
          await updateItem(this.systemDir, item);
        } catch (err) {
          logger.warn({
            operation: 'policy_pipeline_enrich_error',
            itemId: item.id,
            error: (err as Error).message,
            message: `Enrichment failed for ${item.id} — continuing without ENHANCE`,
          });
        }
      }
    }

    // Stage 4: Group by source, evaluate per-source policy
    const bySource = new Map<string, Item[]>();
    for (const item of batch) {
      const group = bySource.get(item.source) ?? [];
      group.push(item);
      bySource.set(item.source, group);
    }

    for (const [source, sourceItems] of bySource) {
      let policy: Policy;
      try {
        policy = await this.loadPolicyForSource(cfg, source);
      } catch (err) {
        logger.warn({
          operation: 'policy_pipeline_policy_load_error',
          source,
          error: (err as Error).message,
          message: `Could not load policy for source '${source}' — items will be queued for TRIAGE`,
        });
        // Fall back: queue all items in this source group for human review
        for (const item of sourceItems) {
          await this.applyActions(item, [
            { type: 'TRIAGE', question: `No policy found for source: ${source}` },
          ]);
        }
        continue;
      }

      const results = evaluate(policy, sourceItems);

      for (const result of results) {
        const item = sourceItems.find((i) => i.id === result.itemId);
        if (!item) continue;

        logger.debug({
          operation: 'policy_pipeline_evaluated',
          itemId: item.id,
          source: item.source,
          intent: result.classification.intent,
          confidence: result.classification.confidence,
          actions: result.nextActions.map((a) => a.type).join(', '),
          message: `Evaluated ${item.id}: ${result.classification.intent} (${(result.classification.confidence * 100).toFixed(0)}%)`,
        });

        await this.applyActions(item, result.nextActions);
      }
    }

    logger.info({
      operation: 'policy_pipeline_complete',
      taskId: taskConfig.id,
      processed: batch.length,
      message: `PolicyPipelineTask complete: ${batch.length} item(s) processed`,
    });
  }

  /**
   * Append next actions to an item and update its status accordingly.
   */
  private async applyActions(
    item: Item,
    nextActions: Array<{
      type: string;
      question?: string;
      folder?: string;
      name?: string;
      flagStatus?: string;
      calendarResponse?: string;
      note?: string;
    }>
  ): Promise<void> {
    const now = new Date().toISOString();

    for (const ruleAction of nextActions) {
      // For TRIAGE actions, try to generate a context-aware question via local LLM
      let question = ruleAction.question;
      if (ruleAction.type === 'TRIAGE' && this.localEnrichment) {
        const generated = await this.localEnrichment.generateTriageQuestion(item);
        if (generated) {
          question = generated;
        }
      }

      const action: Action = {
        type: ruleAction.type as Action['type'],
        at: now,
        status: 'pending',
        ...(question ? { question } : {}),
        ...(ruleAction.folder ? { folder: ruleAction.folder } : {}),
        ...(ruleAction.name ? { name: ruleAction.name } : {}),
        ...(ruleAction.flagStatus ? { flagStatus: ruleAction.flagStatus } : {}),
        ...(ruleAction.calendarResponse
          ? {
              calendarResponse: ruleAction.calendarResponse as Action['calendarResponse'],
            }
          : {}),
        ...(ruleAction.note ? { note: ruleAction.note } : {}),
      };
      item.actions.push(action);
    }

    // Derive new status from the appended actions
    const hasPendingTriage = item.actions.some(
      (a) => a.type === 'TRIAGE' && a.status === 'pending'
    );
    if (hasPendingTriage) {
      item.status = 'triage';
    } else {
      item.status = 'pending';
    }

    try {
      await updateItem(this.systemDir, item);
    } catch (err) {
      logger.error({
        operation: 'policy_pipeline_save_error',
        itemId: item.id,
        error: (err as Error).message,
        message: `Failed to save item ${item.id}`,
      });
    }
  }

  /**
   * Load the policy for a given source.
   * Resolution: {policyDir}/{source}.yaml → {policyDir}/email.yaml → {policyDir}/default.yaml
   */
  private async loadPolicyForSource(cfg: PolicyPipelineConfig, source: string): Promise<Policy> {
    const policyDir = cfg.policyDir
      ? path.isAbsolute(cfg.policyDir)
        ? cfg.policyDir
        : path.resolve(process.cwd(), cfg.policyDir)
      : this.policyDir;

    const candidates = [
      path.join(policyDir, `${source}.yaml`),
      path.join(policyDir, 'email.yaml'),
      path.join(policyDir, 'default.yaml'),
    ];

    // Also honour legacy single-file fallback
    if (cfg.policyFile) {
      candidates.push(
        path.isAbsolute(cfg.policyFile)
          ? cfg.policyFile
          : path.resolve(process.cwd(), cfg.policyFile)
      );
    }

    for (const candidate of candidates) {
      try {
        return await loadPolicy(candidate);
      } catch (err) {
        const msg = (err as Error).message ?? '';
        if (msg.startsWith('Policy file not found')) {
          // Expected — file simply doesn't exist, try next candidate
        } else {
          // File exists but failed to parse or validate — always warn
          logger.warn({
            operation: 'policy_load_invalid',
            candidate,
            error: msg,
            message: `Policy file invalid, skipping: ${candidate}`,
          });
        }
      }
    }

    throw new Error(`No policy found for source '${source}' in ${policyDir}`);
  }
}
