# Implementation Plan: Add Slack "Save for Later" to cerebro-mcp

## Context

You want to add Slack's built-in **"Save for Later"** functionality to cerebro-mcp. This allows users to:
- View messages they've saved using Slack's native "Save for later" button
- Mark saved messages as complete from within the triage workflow

**Source**: The `slack-mcp-server` repository (~/code/slack-mcp-server) already implements this using undocumented Slack Webclient APIs.

**Key Discovery**: This requires **different authentication** than cerebro-mcp currently uses:
- Current: OAuth tokens (xoxp/xoxb) via official API
- Needed: Browser session tokens (xoxc token + xoxd cookie) for undocumented Webclient APIs

## Two Distinct "Saved" Systems

### 1. Message Shortcuts (Currently in cerebro-mcp)
- **User Action**: Right-click → "More actions" → Custom shortcut
- **Storage**: Local file `.tasks/slack-actions.json`
- **API**: Official Socket Mode (WebSocket)
- **Tools**: `list-message-actions`, `get-message-action`, `delete-message-action`

### 2. Slack's "Save for Later" (What We're Adding)
- **User Action**: Native "Save for later" button (bookmark icon)
- **Storage**: Slack's servers (user's account)
- **API**: Undocumented Webclient APIs (`saved.list`, `saved.update`)
- **Tools to Add**: `list-saved-items`, `mark-saved-item-complete`

## Recommended Approach

Port the saved items implementation from slack-mcp-server (Go) to cerebro-mcp (TypeScript):

**Phase 1**: Add browser session token support (xoxc/xoxd)
**Phase 2**: Create Webclient API client with cookie injection
**Phase 3**: Implement saved.list and saved.update MCP tools
**Phase 4**: Update triage skill to query both systems

**Benefits**:
- ✅ Access to Slack's native "Save for Later" feature
- ✅ Coexists with existing message shortcuts
- ✅ Proven approach from slack-mcp-server
- ✅ TypeScript implementation (matches cerebro-mcp)

**Risks**:
- ⚠️ Undocumented APIs may break without warning
- ⚠️ Requires manual browser token extraction
- ⚠️ Session tokens expire more frequently than OAuth tokens

## Implementation Plan

### Phase 1: Add Browser Session Token Support

#### 1.1. Extend Token Storage

**File**: `~/code/cerebro-mcp/src/services/slack/token-storage.ts`

Add support for xoxc/xoxd tokens alongside existing OAuth tokens:

```typescript
export interface SlackTokens {
  // Existing OAuth tokens
  access_token?: string;
  token_type?: string;
  scope?: string;
  expires_at?: number;

  // NEW: Browser session tokens
  xoxc_token?: string;      // From localStorage
  xoxd_cookie?: string;     // From browser cookie
  session_expires_at?: number;
}
```

Add methods to load from environment:
```typescript
loadFromEnvironment(): SlackTokens {
  const xoxc = process.env.SLACK_XOXC_TOKEN;
  const xoxd = process.env.SLACK_XOXD_COOKIE;

  if (xoxc && xoxd) {
    return {
      xoxc_token: xoxc,
      xoxd_cookie: xoxd,
      session_expires_at: Date.now() + 24 * 60 * 60 * 1000 // 24h estimate
    };
  }

  return this.loadTokens(); // Fall back to OAuth
}

hasWebclientTokens(): boolean {
  const tokens = this.loadTokens();
  return !!(tokens.xoxc_token && tokens.xoxd_cookie);
}
```

#### 1.2. Update Environment Variables

**File**: `~/code/cerebro-mcp/.env.example`

Add documentation:
```bash
# Slack Browser Session Tokens (for "Save for Later" functionality)
# Extract from Slack web app using browser DevTools:
# 1. Open Slack in browser → F12 → Application → Local Storage
# 2. Copy value of "localConfig_v2" → extract xoxc token
# 3. Application → Cookies → Copy "d" cookie value (xoxd)
SLACK_XOXC_TOKEN=xoxc-1234567890-1234567890-1234567890-abcdef
SLACK_XOXD_COOKIE=xoxd-abcdef1234567890
```

### Phase 2: Create Webclient API Client

#### 2.1. New Webclient Client Class

**File**: `~/code/cerebro-mcp/src/services/slack/webclient-api-client.ts` (NEW)

Port the Go implementation to TypeScript:

```typescript
import { logger } from '../../common';
import type { SlackTokenStorage } from './token-storage';

export interface SavedItem {
  itemId: string;          // Channel/DM ID
  itemType: string;
  dateCreated: number;
  dateDue: number;
  dateCompleted: number;
  dateUpdated: number;
  isArchived: boolean;
  dateSnoozedUntil: number;
  ts: string;              // Message timestamp
  state: string;
}

export interface SavedListResponse {
  ok: boolean;
  error?: string;
  savedItems: SavedItem[];
  counts: {
    total: number;
    due: number;
    completed: number;
  };
  responseMetadata?: {
    nextCursor?: string;
  };
}

export class SlackWebclientApiClient {
  private readonly tokenStorage: SlackTokenStorage;
  private workspace?: string;

  constructor(tokenStorage: SlackTokenStorage) {
    this.tokenStorage = tokenStorage;
  }

  /**
   * Initialize workspace domain from auth.test
   */
  async initialize(): Promise<void> {
    // Call auth.test to get workspace domain
    const tokens = this.tokenStorage.loadTokens();
    if (tokens.xoxc_token) {
      const response = await this.postForm('auth.test', {});
      this.workspace = response.team;
    }
  }

  /**
   * List saved items (saved.list)
   */
  async savedList(cursor?: string): Promise<SavedListResponse> {
    const form: Record<string, string> = {};
    if (cursor) {
      form.cursor = cursor;
    }

    const response = await this.postForm('saved.list', form);

    return {
      ok: response.ok,
      error: response.error,
      savedItems: response.saved_items || [],
      counts: response.counts || { total: 0, due: 0, completed: 0 },
      responseMetadata: response.response_metadata,
    };
  }

  /**
   * Mark saved item as complete (saved.update)
   */
  async savedComplete(channel: string, ts: string): Promise<void> {
    const form = {
      item_type: 'message',
      item_id: channel,
      ts,
      date_due: '0',
      mark: 'completed',
      _x_reason: 'manually_mark_completed',
      _x_mode: 'online',
      _x_sonic: 'true',
      _x_app_name: 'client',
    };

    await this.postForm('saved.update', form);
  }

  /**
   * POST to Webclient API with form data
   */
  private async postForm(
    method: string,
    form: Record<string, string>
  ): Promise<any> {
    const tokens = this.tokenStorage.loadTokens();

    if (!tokens.xoxc_token || !tokens.xoxd_cookie) {
      throw new Error('Webclient tokens not configured. Set SLACK_XOXC_TOKEN and SLACK_XOXD_COOKIE.');
    }

    if (!this.workspace) {
      throw new Error('Workspace not initialized. Call initialize() first.');
    }

    const url = `https://${this.workspace}.slack.com/api/${method}`;

    // Add xoxc token to form
    form.token = tokens.xoxc_token;

    const body = new URLSearchParams(form).toString();

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': `d=${tokens.xoxd_cookie}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      body,
    });

    if (!response.ok) {
      throw new Error(`Webclient API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.ok) {
      logger.error({
        operation: 'webclient_api_error',
        method,
        error: data.error,
      });
      throw new Error(`Slack API error: ${data.error}`);
    }

    return data;
  }
}
```

### Phase 3: Add MCP Tools for Saved Items

#### 3.1. Extend SlackService

**File**: `~/code/cerebro-mcp/src/services/slack/slack-service.ts`

Add webclient client and new tools:

```typescript
import { SlackWebclientApiClient } from './webclient-api-client';

export class SlackService implements BaseService {
  // ... existing fields
  private webclientClient?: SlackWebclientApiClient;

  async initialize(): Promise<void> {
    // ... existing initialization

    // Initialize webclient if tokens available
    if (this.tokenStorage.hasWebclientTokens()) {
      this.webclientClient = new SlackWebclientApiClient(this.tokenStorage);
      await this.webclientClient.initialize();
      logger.info({
        operation: 'webclient_init',
        msg: 'Slack Webclient API initialized for saved items',
      });
    }
  }

  getTools(): Tool[] {
    const tools = [
      // ... existing tools
    ];

    // Add saved items tools if webclient available
    if (this.webclientClient) {
      tools.push(
        {
          name: 'list-saved-items',
          description: 'List messages saved using Slack\'s "Save for Later" feature. Returns items saved server-side in your Slack account.',
          inputSchema: {
            type: 'object',
            properties: {
              cursor: {
                type: 'string',
                description: 'Pagination cursor from previous response',
              },
            },
          },
          handler: this.listSavedItems.bind(this),
        },
        {
          name: 'mark-saved-item-complete',
          description: 'Mark a saved item as complete. Requires channel ID and message timestamp from list-saved-items.',
          inputSchema: {
            type: 'object',
            properties: {
              channel: {
                type: 'string',
                description: 'Channel ID (itemId from list-saved-items)',
              },
              ts: {
                type: 'string',
                description: 'Message timestamp (ts from list-saved-items)',
              },
            },
            required: ['channel', 'ts'],
          },
          handler: this.markSavedItemComplete.bind(this),
        }
      );
    }

    return tools;
  }

  /**
   * List saved items handler
   */
  private async listSavedItems(input: Record<string, unknown>): Promise<unknown> {
    if (!this.webclientClient) {
      return {
        error: 'webclient_not_configured',
        message: 'Webclient tokens not configured. Set SLACK_XOXC_TOKEN and SLACK_XOXD_COOKIE.',
      };
    }

    const cursor = input['cursor'] as string | undefined;
    const response = await this.webclientClient.savedList(cursor);

    logger.info({
      operation: 'list_saved_items',
      count: response.savedItems.length,
      total: response.counts.total,
    });

    return {
      success: true,
      items: response.savedItems,
      counts: response.counts,
      nextCursor: response.responseMetadata?.nextCursor,
    };
  }

  /**
   * Mark saved item complete handler
   */
  private async markSavedItemComplete(input: Record<string, unknown>): Promise<unknown> {
    if (!this.webclientClient) {
      return {
        error: 'webclient_not_configured',
        message: 'Webclient tokens not configured.',
      };
    }

    const channel = input['channel'] as string;
    const ts = input['ts'] as string;

    if (!channel || !ts) {
      throw new Error('channel and ts are required');
    }

    await this.webclientClient.savedComplete(channel, ts);

    logger.info({
      operation: 'mark_saved_item_complete',
      channel,
      ts,
    });

    return {
      success: true,
      channel,
      ts,
    };
  }
}
```

### Phase 4: Update Triage Skill

#### 4.1. Extend Triage to Query Both Systems

**File**: `~/cerebro/.claude/skills/triage/SKILL.md`

Update Phase 1 to fetch from both sources:

```markdown
### Phase 1: Gather & Analyze Items

**IMMEDIATELY begin fetching items in parallel:**

1. **Fetch inbox emails:**
   ```
   mcp__cerebro__microsoft_list-emails(folder: "inbox", count: 50)
   ```

2. **Fetch Slack message actions (custom shortcuts):**
   ```
   mcp__cerebro__slack_list-message-actions(processed: false)
   ```

3. **Fetch Slack saved items (native "Save for Later"):**
   ```
   mcp__cerebro__slack_list-saved-items()
   ```

4. **Load triage history:**
   - Read `/home/stuartdavidson/cerebro/context/areas/triage-history.md`
```

Update Phase 3 action handlers:

```markdown
#### Action Handlers

**4. Delete:**
- For email: Move to Archive/Triaged folder
- For Slack message action: Call `slack_delete-message-action(id)`
- For Slack saved item: Call `slack_mark-saved-item-complete(channel, ts)`
- Record to history
```

## Critical Files to Modify

### cerebro-mcp Repository

1. **`src/services/slack/token-storage.ts`**
   - Add `xoxc_token` and `xoxd_cookie` fields
   - Add `loadFromEnvironment()` method
   - Add `hasWebclientTokens()` method

2. **`src/services/slack/webclient-api-client.ts`** (NEW)
   - Create new class for Webclient API
   - Implement `savedList()` and `savedComplete()` methods
   - Handle cookie injection and webclient headers

3. **`src/services/slack/slack-service.ts`**
   - Import `SlackWebclientApiClient`
   - Initialize webclient client if tokens available
   - Add two new MCP tools: `list-saved-items`, `mark-saved-item-complete`
   - Add handler methods

4. **`src/auth-server/oauth-server.ts`**
   - Add `/auth/slack/extract-webclient` route (GET - serves HTML)
   - Add `/auth/slack/save-webclient` route (POST - receives tokens)
   - Add webclient extraction UI to dashboard
   - Integrate with SlackTokenStorage to persist tokens

5. **`.env.example`**
   - Document `SLACK_XOXC_TOKEN` and `SLACK_XOXD_COOKIE` (for manual fallback)

6. **`src/types/slack-saved-items.ts`** (NEW)
   - TypeScript interfaces for `SavedItem` and `SavedListResponse`

### cerebro Repository

1. **`.claude/skills/triage/SKILL.md`**
   - Update Phase 1 to fetch from both Slack systems
   - Update Phase 3 action handlers for saved items
   - Update MCP Tools Used section

## Token Extraction Approaches

### Option A: Automated Extraction via OAuth Dashboard (RECOMMENDED)

Enhance the existing OAuth server (`http://localhost:3333`) to extract webclient tokens automatically:

**Implementation**:

1. **Add new route to OAuth server**: `/auth/slack/extract-webclient`

2. **Serve HTML page with embedded JavaScript** that:
   - Opens a popup/iframe to Slack workspace
   - Injects JavaScript to extract from localStorage and cookies
   - Posts tokens back to OAuth server
   - Stores tokens alongside OAuth tokens

**File**: `~/code/cerebro-mcp/src/auth-server/oauth-server.ts`

Add new handler (after existing Slack callback):

```typescript
private handleSlackWebclientExtract(req: http.IncomingMessage, res: http.ServerResponse): void {
  if (req.method === 'GET') {
    // Serve HTML page with token extraction JavaScript
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head><title>Extract Slack Webclient Tokens</title></head>
      <body>
        <h1>Slack Webclient Token Extraction</h1>
        <p>Click below to open Slack and extract session tokens:</p>
        <button onclick="extractTokens()">Extract Tokens</button>
        <div id="status"></div>
        <script>
          function extractTokens() {
            const workspace = prompt('Enter your Slack workspace name (e.g., "mycompany"):');
            if (!workspace) return;

            const popup = window.open(
              \`https://\${workspace}.slack.com\`,
              'slack',
              'width=800,height=600'
            );

            // Poll for tokens
            const checkInterval = setInterval(() => {
              try {
                const localStorage = popup.localStorage;
                const localConfig = localStorage.getItem('localConfig_v2');

                if (localConfig) {
                  const config = JSON.parse(localConfig);
                  const xoxc = config.token;

                  // Get cookies
                  const cookies = popup.document.cookie.split(';');
                  const dCookie = cookies.find(c => c.trim().startsWith('d='));
                  const xoxd = dCookie ? dCookie.split('=')[1] : null;

                  if (xoxc && xoxd) {
                    // Send to server
                    fetch('/auth/slack/save-webclient', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ xoxc_token: xoxc, xoxd_cookie: xoxd })
                    }).then(() => {
                      document.getElementById('status').innerHTML = '✅ Tokens saved!';
                      clearInterval(checkInterval);
                      popup.close();
                    });
                  }
                }
              } catch (e) {
                // Cross-origin error - user hasn't logged in yet
              }
            }, 1000);
          }
        </script>
      </body>
      </html>
    `);
  }
}

private handleSlackWebclientSave(req: http.IncomingMessage, res: http.ServerResponse): void {
  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const { xoxc_token, xoxd_cookie } = JSON.parse(body);

      // Save to token storage
      const slackService = this.services.get('slack');
      if (slackService) {
        slackService.tokenStorage.saveTokens({
          xoxc_token,
          xoxd_cookie,
          session_expires_at: Date.now() + 24 * 60 * 60 * 1000
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      }
    });
  }
}
```

**Add to dashboard**:
```html
<li>
  <strong>Slack Webclient Tokens:</strong>
  <a href="/auth/slack/extract-webclient">Extract Tokens for "Save for Later"</a>
</li>
```

**Benefits**:
- ✅ One-click token extraction
- ✅ No manual DevTools navigation
- ✅ Tokens automatically stored in `.tokens/slack-tokens.json`
- ✅ User-friendly workflow

**Limitations**:
- ⚠️ May be blocked by Cross-Origin security policies
- ⚠️ Requires popup/iframe access to Slack
- ⚠️ Browser security may prevent localStorage access

### Option B: Manual Extraction (FALLBACK)

If automated extraction is blocked:

1. **Open Slack in Chrome**
2. **Open DevTools** (F12)
3. **Get xoxc token**:
   - Go to: Application → Local Storage → `https://{workspace}.slack.com`
   - Find key: `localConfig_v2`
   - Copy the JSON, extract the `token` field (starts with `xoxc-`)
4. **Get xoxd cookie**:
   - Go to: Application → Cookies → `https://{workspace}.slack.com`
   - Find cookie named `d`
   - Copy the value (starts with `xoxd-`)
5. **Visit OAuth dashboard**:
   - Go to `http://localhost:3333`
   - Find "Slack Webclient Tokens" section
   - Paste tokens into form
   - Click "Save"

### Option C: Browser Extension (FUTURE)

Create a Chrome extension that:
- Adds a "Send to Cerebro" button in Slack
- Extracts and POSTs tokens to `http://localhost:3333/auth/slack/save-webclient`
- One-time installation, automatic updates

## Verification Steps

### Test in cerebro-mcp

1. **Unit Tests**: Create test file `src/services/slack/__tests__/webclient-api-client.test.ts`
   - Mock fetch responses
   - Test savedList() and savedComplete()

2. **Manual Test**:
   ```bash
   # Save a message in Slack using native "Save for later" button
   # Call list-saved-items via MCP
   # Verify item appears
   # Call mark-saved-item-complete with channel and ts
   # Verify item marked complete in Slack
   ```

### Test in cerebro

1. **Triage Workflow**:
   - Save messages in Slack using native button
   - Run `/triage` skill
   - Verify saved items appear in queue
   - Choose "Delete" action
   - Verify item marked complete in Slack

## Alternative Considered

**Use Official Slack API Only**:
- Pros: Stable, supported, no token extraction
- Cons: No "Save for Later" API exists in official API
- Decision: Rejected - functionality not available

**Current approach** is the only way to access Slack's saved items programmatically.

## Success Criteria

1. ✅ Can list saved items via MCP tool
2. ✅ Can mark items complete via MCP tool
3. ✅ Triage skill shows both message shortcuts AND saved items
4. ✅ Tokens loaded from environment variables
5. ✅ Existing OAuth functionality unchanged
6. ✅ Graceful degradation if webclient tokens not configured
