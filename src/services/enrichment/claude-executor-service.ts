/**
 * ClaudeExecutorService — autonomous feature development via Claude.
 *
 * Given a prompt, executes the full SpecKit workflow on a dedicated git branch:
 *   spec → clarify (pause if questions) → plan → tasks → implement
 *
 * Questions are surfaced as triage items. The job resumes automatically once
 * all questions are answered by the human reviewer.
 *
 * Uses claude-sonnet-4-6 for all steps.
 */

import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as childProcess from 'child_process';
import { randomUUID } from 'crypto';
import { saveItem, getItem } from '../../lib/item/item-store';
import type { Item, Action, MessageItem } from '../../lib/item/types';
import { logger } from '../../common/logger';

const MODEL = 'claude-sonnet-4-6';
const MAX_IMPL_TURNS = 30;

// Allowed prefixes for run_command tool
const ALLOWED_COMMANDS = [
  'npm test', 'npm run lint', 'npm run build',
  'git status', 'git diff', 'git log', 'git branch',
  'ls ', 'ls\n', 'find ', 'cat ',
];

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ExecuteJobOptions {
  item: Item;
  action: Action;
  workDir: string;    // repository root (process.cwd())
  systemDir: string;  // for saving question items
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class ClaudeExecutorService {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  /**
   * Execute or resume a CLAUDE_EXECUTE job.
   * Mutates `action` in place (jobStep, branchName, etc.) so caller can persist it.
   */
  async executeJob(opts: ExecuteJobOptions): Promise<void> {
    const { item, action, workDir, systemDir } = opts;
    const step = action.jobStep ?? 'init';

    logger.info({
      operation: 'claude_executor_start',
      itemId: item.id,
      step,
      message: `ClaudeExecutorService: starting job for ${item.id} at step=${step}`,
    });

    try {
      if (step === 'init' || step === 'spec') {
        await this.runSpec(item, action, workDir);
      }

      if (action.jobStep === 'clarify') {
        await this.runClarify(item, action, systemDir);
        if (action.status === 'waiting') return; // paused for questions
      }

      if (action.jobStep === 'plan') {
        await this.runPlan(item, action, workDir, systemDir);
      }

      if (action.jobStep === 'tasks') {
        await this.runTasks(item, action, workDir);
      }

      if (action.jobStep === 'implement') {
        await this.runImplement(item, action, workDir);
      }

      action.jobStep = 'done';
      logger.info({
        operation: 'claude_executor_done',
        itemId: item.id,
        branchName: action.branchName,
        message: `ClaudeExecutorService: job complete for ${item.id} on ${action.branchName}`,
      });
    } catch (err) {
      logger.error({
        operation: 'claude_executor_error',
        itemId: item.id,
        step: action.jobStep,
        error: (err as Error).message,
        message: `ClaudeExecutorService: job failed for ${item.id}: ${(err as Error).message}`,
      });
      throw err;
    }
  }

  /**
   * Check whether all pending clarification questions have been answered.
   * If yes, returns the answers map and updates action to resume.
   * If no, returns null (job stays waiting).
   */
  async checkResume(
    action: Action,
    systemDir: string
  ): Promise<Record<string, string> | null> {
    const ids = action.questionItemIds ?? [];
    if (ids.length === 0) {
      action.status = 'pending';
      action.jobStep = 'plan';
      return {};
    }

    const answers: Record<string, string> = {};
    for (const id of ids) {
      const qItem = await getItem(systemDir, id);
      if (!qItem) continue;
      const triageAction = qItem.actions.find(
        (a) => a.type === 'TRIAGE' && a.status === 'done' && a.answer
      );
      if (!triageAction?.answer) return null; // still waiting
      const question = qItem.type === 'MESSAGE' ? (qItem as MessageItem).subject ?? '' : '';
      answers[question] = triageAction.answer;
    }

    // All answered — resume
    action.status = 'pending';
    action.jobStep = 'plan';
    return answers;
  }

  // ─── Steps ─────────────────────────────────────────────────────────────────

  private async runSpec(item: Item, action: Action, workDir: string): Promise<void> {
    const prompt = action.prompt ?? this.itemToPrompt(item);

    // Determine feature ID and slug
    const featureId = await this.nextFeatureId(workDir);
    const slug = this.slugify(prompt);
    const branchName = `claude/${featureId}-${slug}`;
    const specDir = `specs/${featureId}-${slug}`;

    action.branchName = branchName;
    action.specDir = specDir;
    action.jobStep = 'spec';

    // Create branch
    await this.runGit(`checkout -b ${branchName}`, workDir);
    await fs.mkdir(path.join(workDir, specDir), { recursive: true });

    // Generate spec
    const spec = await this.callClaude(
      'You are a software architect. Write a concise feature specification in markdown.',
      `Feature request:\n${prompt}\n\nWrite spec.md with sections: Overview, Requirements, Technical Design, Out of Scope.`
    );

    await fs.writeFile(path.join(workDir, specDir, 'spec.md'), spec, 'utf-8');
    await this.commitFiles([`${specDir}/spec.md`], `feat(${featureId}): add spec`, workDir);

    logger.info({ operation: 'claude_executor_spec_done', itemId: item.id, specDir });
    action.jobStep = 'clarify';
  }

  private async runClarify(item: Item, action: Action, systemDir: string): Promise<void> {
    const specDir = action.specDir!;
    const workDir = path.resolve(process.cwd());
    const spec = await fs.readFile(path.join(workDir, specDir, 'spec.md'), 'utf-8');

    const raw = await this.callClaude(
      'Review a feature spec and identify critical missing information.',
      `Spec:\n${spec}\n\nReturn ONLY valid JSON: {"questions":["q1","q2"]}. List 0-3 essential clarifying questions. Return empty array if spec is clear enough to implement.`
    );

    let questions: string[] = [];
    try {
      const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned) as { questions?: unknown };
      if (Array.isArray(parsed.questions)) {
        questions = (parsed.questions as unknown[]).filter((q): q is string => typeof q === 'string').slice(0, 3);
      }
    } catch {
      // No questions if parse fails
    }

    if (questions.length === 0) {
      action.jobStep = 'plan';
      return;
    }

    // Create triage items for each question
    const questionItemIds: string[] = [];
    for (const question of questions) {
      const qItemId = await this.createQuestionItem(question, item.id, action.specDir!, systemDir);
      questionItemIds.push(qItemId);
    }

    action.questionItemIds = questionItemIds;
    action.status = 'waiting';
    action.jobStep = 'clarify-waiting';

    logger.info({
      operation: 'claude_executor_clarify_waiting',
      itemId: item.id,
      questionCount: questions.length,
      message: `Job paused: ${questions.length} clarification question(s) created`,
    });
  }

  private async runPlan(
    item: Item,
    action: Action,
    workDir: string,
    systemDir: string
  ): Promise<void> {
    const specDir = action.specDir!;
    const spec = await fs.readFile(path.join(workDir, specDir, 'spec.md'), 'utf-8');

    // Gather any question answers
    let answersText = '';
    const ids = action.questionItemIds ?? [];
    if (ids.length > 0) {
      const parts: string[] = [];
      for (const id of ids) {
        const qItem = await getItem(systemDir, id);
        if (!qItem) continue;
        const triageAction = qItem.actions.find((a) => a.type === 'TRIAGE' && a.answer);
        const question = qItem.type === 'MESSAGE' ? (qItem as MessageItem).subject ?? '' : '';
        if (triageAction?.answer) parts.push(`Q: ${question}\nA: ${triageAction.answer}`);
      }
      if (parts.length > 0) answersText = '\n\nClarifications:\n' + parts.join('\n\n');
    }

    const plan = await this.callClaude(
      'You are a software architect. Write a detailed implementation plan in markdown.',
      `Spec:\n${spec}${answersText}\n\nWrite plan.md covering: Architecture, Files to Create/Modify, Implementation Steps, Testing Strategy.`
    );

    await fs.writeFile(path.join(workDir, specDir, 'plan.md'), plan, 'utf-8');
    await this.commitFiles([`${specDir}/plan.md`], `feat: add implementation plan`, workDir);

    logger.info({ operation: 'claude_executor_plan_done', itemId: item.id });
    action.jobStep = 'tasks';
  }

  private async runTasks(item: Item, action: Action, workDir: string): Promise<void> {
    const specDir = action.specDir!;
    const spec = await fs.readFile(path.join(workDir, specDir, 'spec.md'), 'utf-8');
    const plan = await fs.readFile(path.join(workDir, specDir, 'plan.md'), 'utf-8');

    const tasks = await this.callClaude(
      'You are a software engineer. Generate a tasks.md with ordered, actionable implementation tasks.',
      `Spec:\n${spec}\n\nPlan:\n${plan}\n\nWrite tasks.md with a numbered list of concrete tasks. Each task: checkbox [ ], title, 1-line description, affected files.`
    );

    await fs.writeFile(path.join(workDir, specDir, 'tasks.md'), tasks, 'utf-8');
    await this.commitFiles([`${specDir}/tasks.md`], `feat: add implementation tasks`, workDir);

    logger.info({ operation: 'claude_executor_tasks_done', itemId: item.id });
    action.jobStep = 'implement';
  }

  private async runImplement(item: Item, action: Action, workDir: string): Promise<void> {
    const specDir = action.specDir!;
    const spec = await fs.readFile(path.join(workDir, specDir, 'spec.md'), 'utf-8');
    const plan = await fs.readFile(path.join(workDir, specDir, 'plan.md'), 'utf-8');
    const tasks = await fs.readFile(path.join(workDir, specDir, 'tasks.md'), 'utf-8');

    const tools: Anthropic.Messages.Tool[] = [
      {
        name: 'read_file',
        description: 'Read a file from the repository',
        input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      },
      {
        name: 'write_file',
        description: 'Write content to a file (creates directories as needed)',
        input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
      },
      {
        name: 'list_files',
        description: 'List files in a directory',
        input_schema: { type: 'object', properties: { dir: { type: 'string' } }, required: ['dir'] },
      },
      {
        name: 'run_command',
        description: 'Run a shell command. Allowed: npm test, npm run lint, npm run build, git status, git diff, ls, find, cat',
        input_schema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
      },
      {
        name: 'git_commit',
        description: 'Commit all staged changes with a message',
        input_schema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
      },
      {
        name: 'complete',
        description: 'Signal that implementation is complete',
        input_schema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
      },
    ];

    const systemPrompt =
      'You are an expert TypeScript software engineer implementing a feature. ' +
      'Use the provided tools to read existing code, write new files, run tests, and commit your work. ' +
      'Follow the existing code patterns. Run npm run build and npm test when done to verify. ' +
      'Call complete() when the implementation is working.';

    const userPrompt =
      `Implement this feature:\n\n${spec}\n\nPlan:\n${plan}\n\nTasks:\n${tasks}\n\n` +
      `Repository is at: ${workDir}\nCurrent branch: ${action.branchName}`;

    const messages: Anthropic.Messages.MessageParam[] = [
      { role: 'user', content: userPrompt },
    ];

    let turns = 0;
    while (turns < MAX_IMPL_TURNS) {
      turns++;

      const response = await this.client.messages.create({
        model: MODEL,
        max_tokens: 8192,
        system: systemPrompt,
        tools,
        messages,
      });

      // Add assistant's response to message history
      messages.push({ role: 'assistant', content: response.content });

      if (response.stop_reason === 'end_turn') break;

      if (response.stop_reason === 'tool_use') {
        const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
        let shouldStop = false;

        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;

          let result: string;
          try {
            const input = block.input as Record<string, string>;
            if (block.name === 'complete') {
              shouldStop = true;
              result = 'Implementation complete';
            } else if (block.name === 'read_file') {
              result = await fs.readFile(path.join(workDir, input['path']!), 'utf-8');
            } else if (block.name === 'write_file') {
              const filePath = path.join(workDir, input['path']!);
              await fs.mkdir(path.dirname(filePath), { recursive: true });
              await fs.writeFile(filePath, input['content']!, 'utf-8');
              result = `Written: ${input['path']}`;
            } else if (block.name === 'list_files') {
              const files = await fs.readdir(path.join(workDir, input['dir']!));
              result = files.join('\n');
            } else if (block.name === 'run_command') {
              result = await this.safeRunCommand(input['command']!, workDir);
            } else if (block.name === 'git_commit') {
              await this.runGit('add -A', workDir);
              await this.runGit(`commit -m ${JSON.stringify(input['message']!)}`, workDir);
              result = `Committed: ${input['message']}`;
            } else {
              result = `Unknown tool: ${block.name}`;
            }
          } catch (err) {
            result = `Error: ${(err as Error).message}`;
          }

          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
        }

        messages.push({ role: 'user', content: toolResults });
        if (shouldStop) break;
      }
    }

    logger.info({
      operation: 'claude_executor_implement_done',
      itemId: item.id,
      turns,
      message: `Implementation complete in ${turns} turns`,
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async callClaude(system: string, user: string): Promise<string> {
    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: user }],
    });
    const block = response.content[0];
    return block?.type === 'text' ? block.text : '';
  }

  private async createQuestionItem(
    question: string,
    parentItemId: string,
    specDir: string,
    systemDir: string
  ): Promise<string> {
    const id = randomUUID();
    const now = new Date().toISOString();

    const qItem: MessageItem = {
      type: 'MESSAGE',
      source: 'other',
      id,
      status: 'triage',
      createdAt: now,
      subject: question,
      from: 'claude-executor',
      body: `Clarification needed for ${specDir}.\n\nParent item: ${parentItemId}`,
      signals: {
        isAutomated: true,
        isBulk: false,
        hasUnsubscribe: false,
        hasAttachments: false,
        mentionsMoney: false,
        mentionsMeeting: false,
        isActionRequest: true,
        isPrioritySender: false,
      },
      actions: [
        { type: 'INGEST', at: now, status: 'done' },
        { type: 'TRIAGE', at: now, status: 'pending', question },
      ],
    };

    await saveItem(systemDir, qItem);
    return id;
  }

  private async nextFeatureId(workDir: string): Promise<string> {
    const specsDir = path.join(workDir, 'specs');
    try {
      const entries = await fs.readdir(specsDir);
      const numbers = entries
        .map((e) => parseInt(e.split('-')[0] ?? '0', 10))
        .filter((n) => !isNaN(n));
      const max = numbers.length > 0 ? Math.max(...numbers) : 0;
      return String(max + 1).padStart(3, '0');
    } catch {
      return '001';
    }
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 40);
  }

  private itemToPrompt(item: Item): string {
    if (item.type === 'MESSAGE') {
      const msg = item as MessageItem;
      return `${msg.subject ?? ''}\n\n${msg.body ?? ''}`.trim();
    }
    return `${item.title}\n\n${item.description ?? ''}`.trim();
  }

  private async runGit(args: string, workDir: string): Promise<string> {
    return new Promise((resolve, reject) => {
      childProcess.exec(`git ${args}`, { cwd: workDir }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout.trim());
      });
    });
  }

  private async commitFiles(files: string[], message: string, workDir: string): Promise<void> {
    for (const file of files) {
      await this.runGit(`add ${JSON.stringify(file)}`, workDir);
    }
    try {
      await this.runGit(`commit -m ${JSON.stringify(message)}`, workDir);
    } catch (err) {
      // Nothing to commit is fine
      if (!(err as Error).message.includes('nothing to commit')) throw err;
    }
  }

  private async safeRunCommand(command: string, workDir: string): Promise<string> {
    const allowed = ALLOWED_COMMANDS.some(
      (prefix) => command === prefix.trim() || command.startsWith(prefix)
    );
    if (!allowed) {
      return `Command not allowed: ${command}`;
    }
    return new Promise((resolve) => {
      childProcess.exec(command, { cwd: workDir, timeout: 60000 }, (_err, stdout, stderr) => {
        resolve((stdout + stderr).slice(0, 4000));
      });
    });
  }
}
