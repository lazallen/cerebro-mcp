/**
 * Webclient API Client for Slack Save for Later (Feature 020).
 *
 * Accesses Slack's undocumented Webclient API using browser session credentials
 * (xoxc token as form field, xoxd as "d" cookie). No dependency on the OAuth
 * integration — this is a standalone client.
 */

import { logger } from '../../common/logger';
import type { SessionCredentialStorage } from './session-credential-storage';
import type {
  RawSavedListResponse,
  RawSavedItem,
  SavedItem,
  SavedItemCounts,
} from '../../types/slack-saved-items';

/** Maximum number of 429 retries before propagating the error */
const MAX_RETRIES = 1;

/** Fallback wait time if Retry-After header is absent */
const DEFAULT_RETRY_MS = 5000;

export class WebclientApiClient {
  constructor(private readonly credentialStorage: SessionCredentialStorage) {}

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Fetch one page of saved items from saved.list.
   * Includes raw items + counts + next_cursor for pagination.
   */
  async savedList(cursor?: string): Promise<RawSavedListResponse> {
    const workspaceUrl = await this.requireWorkspaceUrl();

    const fields: Record<string, string> = {};
    if (cursor) fields['cursor'] = cursor;

    const raw = await this.postForm(`${workspaceUrl}/api/saved.list`, fields);
    const response = raw as RawSavedListResponse;

    if (!response.ok) {
      this.handleApiError(response.error);
    }

    return response;
  }

  /**
   * Mark a saved item as complete via saved.update.
   */
  async savedUpdate(channelId: string, ts: string): Promise<void> {
    const workspaceUrl = await this.requireWorkspaceUrl();

    const raw = await this.postForm(`${workspaceUrl}/api/saved.update`, {
      channel: channelId,
      ts,
      state: 'completed',
    });

    const response = raw as { ok: boolean; error?: string };
    if (!response.ok) {
      this.handleApiError(response.error);
    }
  }

  /**
   * Fetch the message text and author user ID for a given channel + timestamp.
   * Returns empty strings if the fetch fails (not thrown — caller decides what to do).
   */
  async fetchMessageText(
    channelId: string,
    ts: string
  ): Promise<{ text: string; userName: string }> {
    try {
      const workspaceUrl = await this.requireWorkspaceUrl();

      const raw = await this.postForm(`${workspaceUrl}/api/conversations.history`, {
        channel: channelId,
        latest: ts,
        limit: '1',
        inclusive: 'true',
      });

      const response = raw as {
        ok: boolean;
        messages?: Array<{ text?: string; user?: string }>;
      };

      if (!response.ok || !response.messages || response.messages.length === 0) {
        return { text: '', userName: '' };
      }

      const msg = response.messages[0];
      return {
        text: msg?.text ?? '',
        userName: msg?.user ?? '',
      };
    } catch {
      // Swallow all errors — message text is best-effort
      return { text: '', userName: '' };
    }
  }

  /**
   * Resolve and cache the workspace URL via auth.test.
   * Called on service initialize(); result persisted to credentials file.
   */
  async resolveWorkspaceUrl(): Promise<string> {
    const creds = this.credentialStorage.getCurrent();
    if (!creds) {
      throw new CredentialsNotConfiguredError();
    }

    // Return cached value if available
    if (creds.workspaceUrl) {
      return creds.workspaceUrl;
    }

    // Call auth.test to get workspace URL
    // auth.test uses a different base — we don't know the workspace URL yet
    const raw = await this.postFormRaw('https://slack.com/api/auth.test', {}, creds);
    const response = raw as { ok: boolean; url?: string; error?: string };

    if (!response.ok) {
      this.handleApiError(response.error);
    }

    const workspaceUrl = (response.url ?? '').replace(/\/$/, '');
    if (!workspaceUrl) {
      throw new ApiError('auth.test returned no workspace URL');
    }

    // Cache on credentials
    await this.credentialStorage.updateWorkspaceUrl(workspaceUrl);

    logger.info({
      operation: 'slack_workspace_resolved',
      workspaceUrl,
      message: 'Slack workspace URL resolved and cached',
    });

    return workspaceUrl;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Get workspace URL, throwing if credentials are not configured or expired.
   */
  private async requireWorkspaceUrl(): Promise<string> {
    const creds = this.credentialStorage.getCurrent();
    if (!creds) {
      throw new CredentialsNotConfiguredError();
    }
    if (this.credentialStorage.isExpired()) {
      throw new CredentialsExpiredError();
    }
    return creds.workspaceUrl ?? (await this.resolveWorkspaceUrl());
  }

  /**
   * POST a form-encoded request with xoxc + xoxd injected, with one 429 retry.
   */
  private async postForm(url: string, fields: Record<string, string>): Promise<unknown> {
    const creds = this.credentialStorage.getCurrent();
    if (!creds) {
      throw new CredentialsNotConfiguredError();
    }
    return this.postFormRaw(url, fields, creds);
  }

  /**
   * Low-level POST helper — explicit credentials for bootstrapping (auth.test).
   */
  private async postFormRaw(
    url: string,
    fields: Record<string, string>,
    creds: { xoxcToken: string; xoxdCookie: string }
  ): Promise<unknown> {
    const body = new URLSearchParams({ token: creds.xoxcToken, ...fields });

    let retries = 0;
    while (true) {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: `d=${creds.xoxdCookie}`,
        },
        body: body.toString(),
      });

      if (response.status === 429) {
        if (retries >= MAX_RETRIES) {
          throw new RateLimitedError('Still rate-limited after retry');
        }

        const retryAfter = parseInt(response.headers.get('Retry-After') ?? '5', 10);
        const waitMs = (isNaN(retryAfter) ? 5 : retryAfter) * 1000;

        logger.warn({
          operation: 'slack_api_rate_limited',
          retryAfterMs: waitMs,
          message: `Slack API rate-limited; retrying after ${waitMs}ms`,
        });

        await new Promise((resolve) => setTimeout(resolve, waitMs || DEFAULT_RETRY_MS));
        retries++;
        continue;
      }

      if (!response.ok) {
        throw new ApiError(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response.json();
    }
  }

  /** Map Slack API error strings to typed errors */
  private handleApiError(error: string | undefined): never {
    const errStr = error ?? 'unknown';

    if (errStr === 'not_authed' || errStr === 'invalid_auth' || errStr === 'token_revoked') {
      throw new CredentialsInvalidError(errStr);
    }

    if (errStr === 'ratelimited') {
      throw new RateLimitedError(errStr);
    }

    throw new ApiError(errStr);
  }
}

// ─── Typed Errors ─────────────────────────────────────────────────────────────

export class CredentialsNotConfiguredError extends Error {
  readonly code = 'credentials_not_configured' as const;
  constructor() {
    super('Slack session credentials are not configured. Visit the auth dashboard to set them up.');
  }
}

export class CredentialsExpiredError extends Error {
  readonly code = 'credentials_expired' as const;
  constructor() {
    super('Slack session credentials have expired. Visit the auth dashboard to refresh them.');
  }
}

export class CredentialsInvalidError extends Error {
  readonly code = 'credentials_invalid' as const;
  constructor(slackError: string) {
    super(`Slack session credentials are invalid (${slackError}). Visit the auth dashboard to re-enter them.`);
  }
}

export class RateLimitedError extends Error {
  readonly code = 'rate_limited' as const;
  constructor(message: string) {
    super(`Slack API rate-limited: ${message}. Wait 30–60 seconds and try again.`);
  }
}

export class ApiError extends Error {
  readonly code = 'api_error' as const;
  constructor(message: string) {
    super(`Slack API error: ${message}`);
  }
}

// ─── Mapping helpers (used by SlackSavedItemsService + ingestion task) ────────

export function mapRawItem(
  raw: RawSavedItem,
  messageText: string,
  userId: string
): SavedItem {
  return {
    itemId: raw.item_id,
    itemType: raw.item_type,
    ts: raw.ts,
    state: (raw.state as SavedItem['state']) ?? 'uncompleted',
    dateCreated: raw.date_created,
    dateDue: raw.date_due,
    dateCompleted: raw.date_completed,
    dateUpdated: raw.date_updated,
    dateSnoozedUntil: raw.date_snoozed_until,
    isArchived: raw.is_archived,
    messageText,
    userId,
  };
}

export function mapCounts(raw: RawSavedListResponse['counts']): SavedItemCounts {
  return {
    uncompletedCount: raw.uncompleted_count,
    uncompletedOverdueCount: raw.uncompleted_overdue_count,
    archivedCount: raw.archived_count,
    completedCount: raw.completed_count,
    totalCount: raw.total_count,
  };
}
