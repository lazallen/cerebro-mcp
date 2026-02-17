/**
 * Email triage task implementation
 * Fetches unread emails, analyzes with LLM, and creates event files
 */

import TurndownService from 'turndown';
import type { TaskConfig, EmailTriageResult } from '../../../types/heartbeat';
import type { TaskHandler, EmailTriageConfig } from '../types';
import { EventWriter } from '../event-bus/event-writer';
import { EventIdGenerator } from '../event-bus/id-generator';
import { logger } from '../../../common/logger';

/**
 * Microsoft Graph email message type (simplified)
 */
interface GraphMessage {
  id: string;
  from: { emailAddress: { address: string; name?: string } };
  subject: string;
  receivedDateTime: string;
  body: { content: string; contentType?: string };
  bodyPreview?: string;
}

/**
 * Email triage task handler
 */
export class EmailTriageTask implements TaskHandler {
  private idGenerator: EventIdGenerator;
  private eventWriter: EventWriter;
  private turndownService: TurndownService;

  constructor(
    private graphClient: any, // MicrosoftService instance
    private lfClient: any, // LocalFoundryClient instance
    eventWriter: EventWriter | string // EventWriter instance or events directory path
  ) {
    if (typeof eventWriter === 'string') {
      this.eventWriter = new EventWriter({ eventsDir: eventWriter });
      this.idGenerator = new EventIdGenerator(eventWriter);
    } else {
      this.eventWriter = eventWriter;
      // Extract base directory from event writer config
      this.idGenerator = new EventIdGenerator((eventWriter as any).eventsDir ?? './data/events');
    }

    // Initialize turndown service for HTML to Markdown conversion
    this.turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      emDelimiter: '_',
    });

    // Remove unwanted elements that don't add value
    this.turndownService.remove(['style', 'script', 'noscript', 'iframe', 'object', 'embed']);
  }

  /**
   * Execute email triage task
   * @param taskConfig Task configuration
   */
  async execute(taskConfig: TaskConfig): Promise<void> {
    const config = taskConfig.config as EmailTriageConfig;

    logger.info({
      operation: 'email_triage_start',
      taskId: taskConfig.id,
      maxEmails: config.maxEmails ?? 50,
      message: 'Starting email triage task',
    });

    try {
      // Fetch unread emails
      const emails = await this.fetchUnreadEmails(config.maxEmails ?? 50);

      if (emails.length === 0) {
        logger.info({
          operation: 'email_triage_no_emails',
          taskId: taskConfig.id,
          message: 'No unread emails to process',
        });
        return;
      }

      logger.info({
        operation: 'email_triage_fetched',
        taskId: taskConfig.id,
        emailCount: emails.length,
        message: `Fetched ${emails.length} unread emails`,
      });

      // Process emails in batches for concurrency
      const batchSize = config.batchSize ?? 10;
      await this.processEmailsInBatches(emails, batchSize, taskConfig, config);

      logger.info({
        operation: 'email_triage_complete',
        taskId: taskConfig.id,
        processedCount: emails.length,
        message: `Email triage completed: processed ${emails.length} emails`,
      });
    } catch (error) {
      logger.error({
        operation: 'email_triage_error',
        taskId: taskConfig.id,
        error: (error as Error).message,
        message: 'Email triage task failed',
      });
      throw error;
    }
  }

  /**
   * Fetch unread emails from Microsoft Graph
   * @param maxEmails Maximum number of emails to fetch
   * @returns Array of email messages
   */
  private async fetchUnreadEmails(maxEmails: number): Promise<GraphMessage[]> {
    try {
      // Call Microsoft Graph API
      const response = await this.graphClient.getUnreadEmails?.({ top: maxEmails });
      return response ?? [];
    } catch (error) {
      logger.error({
        operation: 'fetch_emails_error',
        error: (error as Error).message,
        message: 'Failed to fetch unread emails',
      });
      return [];
    }
  }

  /**
   * Process emails sequentially (one at a time) to avoid rate limiting
   * @param emails Array of emails to process
   * @param _batchSize Unused - kept for API compatibility
   * @param taskConfig Task configuration
   * @param config Email triage configuration
   */
  private async processEmailsInBatches(
    emails: GraphMessage[],
    _batchSize: number,
    taskConfig: TaskConfig,
    config: EmailTriageConfig
  ): Promise<void> {
    logger.info({
      operation: 'email_sequential_process_start',
      emailCount: emails.length,
      message: `Processing ${emails.length} emails sequentially to avoid rate limiting`,
    });

    // Process emails one at a time to avoid Microsoft Graph rate limits
    // and to give LLM time to process each email independently
    for (let i = 0; i < emails.length; i++) {
      const email = emails[i];

      logger.debug({
        operation: 'email_sequential_process',
        emailIndex: i + 1,
        totalEmails: emails.length,
        emailId: email.id,
        subject: email.subject,
        message: `Processing email ${i + 1}/${emails.length}: ${email.subject}`,
      });

      await this.processEmail(email, taskConfig, config);

      // Add a small delay between emails to be nice to the API and LLM
      if (i < emails.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
        logger.debug({
          operation: 'email_delay',
          message: 'Waiting 1 second before next email',
        });
      }
    }

    logger.info({
      operation: 'email_sequential_process_complete',
      emailCount: emails.length,
      message: `Completed processing ${emails.length} emails sequentially`,
    });
  }

  /**
   * Process a single email: analyze with LLM and create event file
   * @param email Email message
   * @param taskConfig Task configuration
   * @param config Email triage configuration
   */
  private async processEmail(
    email: GraphMessage,
    taskConfig: TaskConfig,
    config: EmailTriageConfig
  ): Promise<void> {
    try {
      logger.debug({
        operation: 'email_process_start',
        emailId: email.id,
        subject: email.subject,
        message: `Processing email: ${email.subject}`,
      });

      // Convert HTML email body to markdown using turndown
      const bodyMarkdown = this.turndownService.turndown(email.body.content);

      logger.debug({
        operation: 'html_to_markdown_conversion',
        emailId: email.id,
        originalLength: email.body.content.length,
        markdownLength: bodyMarkdown.length,
        message: 'Converted HTML to markdown',
      });

      // Strip URLs from markdown for LLM analysis (to reduce token count)
      const bodyMarkdownWithoutUrls = this.stripUrlsFromMarkdown(bodyMarkdown);

      logger.debug({
        operation: 'url_stripping',
        emailId: email.id,
        originalLength: bodyMarkdown.length,
        strippedLength: bodyMarkdownWithoutUrls.length,
        message: 'Stripped URLs from markdown for LLM',
      });

      // Extract action items using LLM (send URL-stripped version)
      const triageResult = await this.analyzeEmailWithLLM(email, bodyMarkdownWithoutUrls);

      // But store the full markdown (with URLs) in the result
      triageResult.body_markdown = bodyMarkdown;

      // Generate unique ID
      const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
      const uniqueId = await this.idGenerator.generateId();

      // Convert to markdown
      const markdown = this.convertEmailToMarkdown(email, triageResult);

      // Write event file with email metadata in frontmatter
      const filename = await this.eventWriter.writeEvent(
        date,
        config.eventType ?? 'email',
        uniqueId,
        {
          type: 'email-triage',
          timestamp: new Date().toISOString(),
          source_task_id: taskConfig.id,
          from: email.from.emailAddress.address,
          from_name: email.from.emailAddress.name,
          subject: email.subject,
          received: email.receivedDateTime,
          message_id: email.id,
        },
        markdown
      );

      logger.info({
        operation: 'email_processed',
        emailId: email.id,
        filename,
        actionItemCount: triageResult.action_items.length,
        message: `Email processed: ${email.subject} -> ${filename}`,
      });

      // Move email to target folder if configured
      if (config.targetFolder) {
        try {
          await this.graphClient.moveEmail?.(
            email.id,
            config.targetFolder,
            true // Always mark as read when moving to triaged folder
          );

          logger.info({
            operation: 'email_moved',
            emailId: email.id,
            targetFolder: config.targetFolder,
            markedAsRead: true,
            message: `Email moved to ${config.targetFolder} and marked as read: ${email.subject}`,
          });
        } catch (moveError) {
          logger.error({
            operation: 'email_move_error',
            emailId: email.id,
            targetFolder: config.targetFolder,
            error: (moveError as Error).message,
            message: `Failed to move email to ${config.targetFolder}: ${email.subject}`,
          });
          // Don't throw - email was processed successfully, just not moved
        }
      }
    } catch (error) {
      logger.error({
        operation: 'email_process_error',
        emailId: email.id,
        error: (error as Error).message,
        message: `Failed to process email: ${email.subject}`,
      });
      // Don't throw - continue with other emails
    }
  }

  /**
   * Analyze email content with LocalFoundry LLM to extract action items
   * HTML to markdown conversion is done separately using turndown
   * @param email Email message
   * @param bodyMarkdown Email body already converted to markdown
   * @returns Email triage result
   */
  private async analyzeEmailWithLLM(
    email: GraphMessage,
    bodyMarkdown: string
  ): Promise<EmailTriageResult> {
    // Truncate markdown to fit in model's context window (phi-4-mini: ~1024 tokens input max)
    // Reserve 200 tokens for prompt structure and 500 for output
    // Leaves ~300 tokens for email content (~1200 characters)
    const maxBodyChars = 1200;
    const truncatedBody = bodyMarkdown.length > maxBodyChars
      ? bodyMarkdown.substring(0, maxBodyChars) + '\n...[truncated]'
      : bodyMarkdown;

    const prompt = this.buildLLMPrompt(email, truncatedBody);

    logger.debug({
      operation: 'llm_analysis_start',
      emailId: email.id,
      subject: email.subject,
      promptLength: prompt.length,
      bodyLength: truncatedBody.length,
      message: 'Starting LLM analysis for email',
    });

    try {
      // Call LocalFoundry LLM with chatCompletion
      const messages = [
        {
          role: 'system' as const,
          content: 'You are an email analysis assistant. Analyze ONLY the single email provided below. Ignore any previous emails or context. Extract action items, questions, requests, and deadlines from the email content. If there are no action items, return an empty array. Return ONLY valid JSON with no additional text or explanation.',
        },
        {
          role: 'user' as const,
          content: prompt,
        },
      ];

      const response = await this.lfClient.chatCompletion(messages, {
        temperature: 0.1, // Very low temperature to reduce randomness
        max_tokens: 500, // Limit output to fit within total token budget
      });

      // Strip markdown code block wrappers if present
      // LLM sometimes returns ```json\n{...}\n``` instead of pure JSON
      let content = response.trim();
      content = content.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();

      logger.debug({
        operation: 'llm_response_preprocessing',
        emailId: email.id,
        originalLength: response.length,
        processedLength: content.length,
        hadCodeBlock: response !== content,
        message: 'Preprocessed LLM response',
      });

      // Parse LLM response
      const parsed = JSON.parse(content);

      // Filter out invalid or placeholder action items
      const validCategories = ['question', 'request', 'task', 'deadline'];
      const validActionItems = (parsed.action_items ?? []).filter((item: any) => {
        // Remove items with invalid categories
        if (!validCategories.includes(item.category)) {
          return false;
        }
        // Remove placeholder descriptions
        const desc = (item.description || '').toLowerCase();
        if (desc.includes('no action') || desc.includes('none mentioned') || desc.includes('not mentioned')) {
          return false;
        }
        return true;
      });

      logger.debug({
        operation: 'llm_analysis_complete',
        emailId: email.id,
        actionItemCount: validActionItems.length,
        filteredCount: (parsed.action_items?.length ?? 0) - validActionItems.length,
        message: 'LLM analysis completed',
      });

      return {
        from: email.from.emailAddress.address,
        subject: email.subject,
        received: email.receivedDateTime,
        message_id: email.id,
        intent: parsed.intent,
        tone: parsed.tone,
        action_items: validActionItems,
        questions: parsed.questions ?? [],
        requests: parsed.requests ?? [],
        deadlines: parsed.deadlines ?? [],
        summary: parsed.summary ?? '',
        body_markdown: bodyMarkdown, // Use the full markdown, not truncated version
      };
    } catch (error) {
      logger.warn({
        operation: 'llm_analysis_error',
        emailId: email.id,
        error: (error as Error).message,
        message: 'LLM analysis failed, using fallback',
      });

      // Return result with markdown but no extracted items on LLM failure
      return {
        from: email.from.emailAddress.address,
        subject: email.subject,
        received: email.receivedDateTime,
        message_id: email.id,
        action_items: [],
        questions: [],
        requests: [],
        deadlines: [],
        summary: 'LLM analysis failed',
        body_markdown: bodyMarkdown,
      };
    }
  }

  /**
   * Build LLM prompt for email analysis
   * @param email Email message
   * @param bodyMarkdown Email body already converted to markdown
   * @returns Prompt string
   */
  private buildLLMPrompt(email: GraphMessage, bodyMarkdown: string): string {
    return `Analyze the following email and extract action items, questions, requests, deadlines, and classify the email's intent and tone.

From: ${email.from.emailAddress.address}
Subject: ${email.subject}
Received: ${email.receivedDateTime}

Body:
${bodyMarkdown}

IMPORTANT: If there are NO action items, questions, requests, or deadlines, return EMPTY ARRAYS [] for those fields. Do NOT create placeholder entries like "No action items mentioned".

Respond with JSON in this format:
{
  "intent": "One of: personal, work, newsletter, spam, automated, notification, marketing",
  "tone": "One of: urgent, casual, formal, friendly, neutral, aggressive",
  "action_items": [
    {
      "description": "What needs to be done",
      "priority": "high|medium|low",
      "category": "question|request|task|deadline"
    }
  ],
  "questions": ["List of questions asked"],
  "requests": ["List of requests made"],
  "deadlines": ["List of deadlines mentioned"],
  "summary": "Brief summary of key points"
}`;
  }

  /**
   * Convert email and triage result to markdown content (frontmatter added by EventWriter)
   * Fixed format: Classification, Summary, Action Items, Body, References
   * @param email Email message
   * @param triageResult Triage analysis result
   * @returns Markdown content with references
   */
  private convertEmailToMarkdown(
    email: GraphMessage,
    triageResult: EmailTriageResult
  ): string {
    const lines: string[] = [];

    // 1. Classification (always present)
    lines.push('## Classification', '');
    lines.push(`- **Intent**: ${triageResult.intent || 'unknown'}`);
    lines.push(`- **Tone**: ${triageResult.tone || 'neutral'}`);
    lines.push('');

    // 2. Summary (always present)
    lines.push('## Summary', '');
    if (triageResult.summary && triageResult.summary !== 'LLM analysis failed') {
      lines.push(triageResult.summary);
    } else {
      lines.push('_No summary available_');
    }
    lines.push('');

    // 3. Action Items (always present)
    lines.push('## Action Items', '');
    if (triageResult.action_items.length > 0) {
      for (const item of triageResult.action_items) {
        lines.push(`- [ ] **${item.priority}** (${item.category}): ${item.description}`);
        if (item.deadline) {
          lines.push(`  - Deadline: ${item.deadline}`);
        }
      }
    } else {
      lines.push('_No action items identified_');
    }
    lines.push('');

    // 4. Email Body (always present)
    // Extract URLs and convert to reference-style links
    const { content: bodyWithRefs, references } = this.extractUrlsToReferences(
      triageResult.body_markdown || email.body.content
    );

    lines.push('## Body', '');
    lines.push(bodyWithRefs);
    lines.push('');

    // 5. References (always present)
    lines.push('## References', '');
    if (references.length > 0) {
      references.forEach((url, index) => {
        lines.push(`[${index + 1}]: ${url}`);
      });
    } else {
      lines.push('_No URLs found_');
    }
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Extract URLs from markdown and replace with reference-style links
   * @param markdown Markdown content with inline URLs
   * @returns Object with content (markdown with references) and array of URLs
   */
  private extractUrlsToReferences(markdown: string): { content: string; references: string[] } {
    const urls: string[] = [];
    const urlMap = new Map<string, number>();

    let content = markdown;

    // Extract and replace markdown links [text](url)
    content = content.replace(/\[([^\]]+)\]\(([^\)]+)\)/g, (_match, text, url) => {
      if (!urlMap.has(url)) {
        urls.push(url);
        urlMap.set(url, urls.length);
      }
      const refNum = urlMap.get(url)!;
      return `${text} [${refNum}]`;
    });

    // Extract and replace standalone URLs (http:// or https://)
    content = content.replace(/https?:\/\/[^\s<>)\]]+/g, (url) => {
      if (!urlMap.has(url)) {
        urls.push(url);
        urlMap.set(url, urls.length);
      }
      const refNum = urlMap.get(url)!;
      return `[${refNum}]`;
    });

    // Extract and replace image markdown ![alt](url)
    content = content.replace(/!\[([^\]]*)\]\(([^\)]+)\)/g, (_match, alt, url) => {
      if (!urlMap.has(url)) {
        urls.push(url);
        urlMap.set(url, urls.length);
      }
      const refNum = urlMap.get(url)!;
      return alt ? `[Image: ${alt}] [${refNum}]` : `[Image] [${refNum}]`;
    });

    return { content, references: urls };
  }

  /**
   * Strip URLs from markdown to reduce token count for LLM analysis
   * Keeps link text but removes the URLs which are often very long (especially SafeLinks)
   * @param markdown Markdown content with links
   * @returns Markdown with URLs stripped
   */
  private stripUrlsFromMarkdown(markdown: string): string {
    // Replace markdown links [text](url) with just [text]
    let stripped = markdown.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');

    // Remove standalone URLs (http:// or https://)
    stripped = stripped.replace(/https?:\/\/[^\s)]+/g, '[URL]');

    // Remove image markdown ![alt](url)
    stripped = stripped.replace(/!\[([^\]]*)\]\([^\)]+\)/g, '[Image: $1]');

    return stripped;
  }
}
