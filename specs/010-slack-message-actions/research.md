# Research: Slack Message Actions Endpoint

## Overview

Research findings for implementing Slack message shortcut webhook handling with signature verification.

---

## Decision 1: Slack Signature Verification

**Decision**: Use Node.js `crypto.timingSafeEqual` with HMAC-SHA256

**Rationale**:
- Slack's documented verification method uses HMAC-SHA256
- `timingSafeEqual` prevents timing attacks
- Built into Node.js crypto module - no external dependencies
- Well-documented pattern in Slack's official docs

**Alternatives Considered**:
- Third-party library (e.g., `@slack/events-api`): Rejected - adds unnecessary dependency for simple verification
- Simple string comparison: Rejected - vulnerable to timing attacks

**Implementation**:
```typescript
import crypto from 'crypto';

function verifySlackSignature(
  signingSecret: string,
  timestamp: string,
  body: string,
  signature: string
): boolean {
  // Check timestamp freshness (5-minute window)
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;
  if (parseInt(timestamp, 10) < fiveMinutesAgo) {
    return false;
  }

  const sigBasestring = `v0:${timestamp}:${body}`;
  const mySignature = 'v0=' + crypto
    .createHmac('sha256', signingSecret)
    .update(sigBasestring, 'utf8')
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(mySignature, 'utf8'),
    Buffer.from(signature, 'utf8')
  );
}
```

---

## Decision 2: File-Based Storage Strategy

**Decision**: JSON file with atomic writes using temp file + rename

**Rationale**:
- Simple implementation for low-volume use case
- Atomic rename prevents partial writes/corruption
- No external database dependency
- Easy to inspect/debug during development

**Alternatives Considered**:
- SQLite: Rejected - overkill for simple key-value storage
- In-memory only: Rejected - data lost on restart
- Redis: Rejected - requires external service

**Implementation Pattern**:
```typescript
import { writeFileSync, renameSync, readFileSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';

// Atomic write pattern
function saveActions(actions: StoredMessageAction[]): void {
  const tempPath = `${storagePath}.tmp`;
  writeFileSync(tempPath, JSON.stringify(actions, null, 2));
  renameSync(tempPath, storagePath);
}
```

---

## Decision 3: URL-Encoded Body Parsing

**Decision**: Use Node.js `querystring.parse` for URL-encoded body

**Rationale**:
- Slack sends `application/x-www-form-urlencoded` content type
- Payload is JSON string inside `payload` field
- Built into Node.js - no external dependency
- Must preserve raw body for signature verification

**Alternatives Considered**:
- Express body-parser: Rejected - not using Express
- Manual parsing: More error-prone than built-in module

**Implementation**:
```typescript
import querystring from 'querystring';

// Parse after signature verification
const parsed = querystring.parse(rawBody);
const payload = JSON.parse(parsed.payload as string);
```

---

## Decision 4: Storage Location

**Decision**: `.tasks/slack-actions.json` in project root

**Rationale**:
- Follows pattern of `.tokens/` for token storage
- Hidden directory (`.tasks/`) keeps root clean
- Within project scope for easy backup/inspection
- Can be added to `.gitignore`

**Alternatives Considered**:
- User home directory: Rejected - harder to find, less portable
- `/tmp/`: Rejected - may be cleared on reboot
- Alongside tokens (`.tokens/`): Rejected - different concern (runtime data vs auth)

---

## Decision 5: UUID Generation

**Decision**: Use Node.js `crypto.randomUUID()`

**Rationale**:
- Built into Node.js 14.17+ (we require 18+)
- Cryptographically secure
- No external dependency
- Standard UUID v4 format

**Alternatives Considered**:
- `uuid` package: Rejected - adds dependency for built-in functionality
- Timestamp-based IDs: Rejected - potential collisions, not as clean

---

## Decision 6: MCP Tool Location

**Decision**: Add tools to existing `SlackService` class

**Rationale**:
- Tools are Slack-related, belong in Slack service
- Follows established pattern (`slack.tool-name`)
- Shares authentication context
- Keeps service cohesive

**Alternatives Considered**:
- New separate service: Rejected - would fragment Slack functionality
- Standalone tools: Rejected - doesn't follow service pattern

---

## Open Questions (Resolved)

| Question | Resolution |
|----------|------------|
| Should signature verification be in oauth-server or separate module? | Separate utility in `src/common/slack-signature.ts` for testability |
| Should storage class be in common or slack service? | In `src/services/slack/` since it's Slack-specific |
| What HTTP status for invalid signature? | 401 Unauthorized (standard for auth failures) |
| What HTTP status for malformed payload? | 400 Bad Request |
| Should we log payloads? | Log metadata only (action type, channel), not message content |

---

## References

- [Verifying requests from Slack](https://api.slack.com/authentication/verifying-requests-from-slack)
- [Slack message shortcuts](https://api.slack.com/interactivity/shortcuts/using#message_shortcuts)
- [Interaction payloads](https://api.slack.com/reference/interaction-payloads)
- [Node.js crypto.timingSafeEqual](https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b)
