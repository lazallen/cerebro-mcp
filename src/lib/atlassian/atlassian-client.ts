/**
 * AtlassianClient — Confluence REST API v2 client.
 *
 * Uses HTTP Basic auth (email + API token) — no OAuth required.
 * Set ATLASSIAN_BASE_URL, ATLASSIAN_EMAIL, ATLASSIAN_API_TOKEN.
 *
 * Primary use: fetch Confluence page content for enriching reading pack entries
 * triggered by Confluence notification emails.
 */

import TurndownService from 'turndown';
import { logger } from '../../common/logger';

export interface ConfluencePageContent {
  pageId: string;
  title: string;
  version: number;
  lastModifiedAt?: string;
  lastModifiedBy?: string;
  /** Page body converted to Markdown (max 5 000 chars) */
  bodyMarkdown: string;
  /** Direct link to the page */
  webUrl: string;
}

const MAX_BODY_CHARS = 5000;

export class AtlassianClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly turndown: TurndownService;

  constructor(baseUrl: string, email: string, apiToken: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.authHeader = `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`;
    this.turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
    this.turndown.remove(['style', 'script', 'noscript', 'iframe', 'object', 'embed']);
  }

  /**
   * Parse a Confluence page URL and extract the numeric page ID.
   * Handles formats:
   *   .../wiki/spaces/SPACE/pages/12345678/Page+Title
   *   .../wiki/pages/viewpage.action?pageId=12345678
   */
  static parsePageId(url: string): string | null {
    // Standard v2 URL format
    const match = url.match(/\/wiki\/(?:spaces\/[^/]+\/)?pages\/(\d+)/);
    if (match?.[1]) return match[1];

    // Legacy URL format: ?pageId=...
    const legacyMatch = url.match(/[?&]pageId=(\d+)/);
    return legacyMatch?.[1] ?? null;
  }

  /**
   * Fetch a Confluence page's content and metadata.
   * Uses the Confluence REST API v2 endpoint with body in view format (rendered HTML).
   */
  async getPageContent(pageId: string): Promise<ConfluencePageContent> {
    const url = `${this.baseUrl}/wiki/api/v2/pages/${pageId}?body-format=view`;

    logger.info({
      operation: 'atlassian_get_page',
      pageId,
      message: `Fetching Confluence page ${pageId}`,
    });

    const response = await fetch(url, {
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Confluence API error ${response.status} for page ${pageId}: ${body}`);
    }

    const data = (await response.json()) as Record<string, unknown>;

    const bodyHtml = (data['body'] as Record<string, unknown> | undefined)?.['view'] as
      | Record<string, unknown>
      | undefined;
    const rawHtml = (bodyHtml?.['value'] as string) ?? '';
    const bodyMarkdown = this.turndown.turndown(rawHtml).trim().slice(0, MAX_BODY_CHARS);

    const version = data['version'] as Record<string, unknown> | undefined;

    // Build page URL from spaceId — v2 doesn't return a direct web URL
    const spaceId = data['spaceId'] as string | undefined;
    const webUrl = spaceId
      ? `${this.baseUrl}/wiki/spaces/${spaceId}/pages/${pageId}`
      : `${this.baseUrl}/wiki/pages/viewpage.action?pageId=${pageId}`;

    const result: ConfluencePageContent = {
      pageId,
      title: (data['title'] as string) ?? '(unknown)',
      version: (version?.['number'] as number) ?? 0,
      lastModifiedAt: version?.['createdAt'] as string | undefined,
      lastModifiedBy: version?.['authorId'] as string | undefined,
      bodyMarkdown,
      webUrl,
    };

    logger.info({
      operation: 'atlassian_page_fetched',
      pageId,
      title: result.title,
      version: result.version,
      bodyChars: bodyMarkdown.length,
      message: `Fetched Confluence page: ${result.title} (v${result.version})`,
    });

    return result;
  }
}
