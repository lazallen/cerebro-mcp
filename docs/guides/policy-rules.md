# Policy Rules — YAML Reference

The policy YAML is the only thing you need to change to alter how events are classified and actioned. No code changes required.

## Table of Contents

- [File Structure](#file-structure)
- [Defaults Block](#defaults-block)
- [Rule Structure](#rule-structure)
- [Predicate DSL](#predicate-dsl)
- [Action Types](#action-types)
- [Intent & Classification Values](#intent--classification-values)
- [Priority Tiers](#priority-tiers)
- [Addressable Fields](#addressable-fields)
- [Examples](#examples)

---

## File Structure

```yaml
id: default-triage          # Policy identifier (used in audit logs)
version: 1.0.0              # Bump when making breaking changes

defaults:
  approvalThreshold: 0.75
  # ... (see Defaults Block)

rules:
  - id: newsletter-auto-archive
    priority: 900
    # ... (see Rule Structure)
```

The policy is loaded from the path set by `policyDir` in `heartbeat-config.json`. The default filename is `default-triage.yaml`.

---

## Defaults Block

```yaml
defaults:
  # Confidence threshold — events below this may get an ASK_HUMAN safety gate
  approvalThreshold: 0.75

  # Confidence threshold — events below this get a claude_approval queue item
  claudeRecommendThreshold: 0.60

  # Risk assigned to events where intent stays UNKNOWN after enrichment
  unknownIntentRisk: MEDIUM   # LOW | MEDIUM | HIGH

  # Semantic category name → source system label string
  # For Outlook these become Outlook category names
  categories:
    newsletter: "ReadLater/Newsletter"
    receipt: "Records/Receipt"
    spamCandidate: "SpamCandidate"
    triageAction: "Triage/Action"
    triageFYI: "Triage/FYI"
    scheduling: "Triage/Scheduling"
    approvalRequest: "Triage/Approval"

  # Semantic folder name → human-readable Outlook folder name
  folders:
    archive: "Archive"
    inbox: "Inbox"

  # These senders bypass bulk/automated detection (prioritySender: true)
  senderAllowlist:
    - "boss@company.com"

  # Emails from these domains are auto-classified SPAM candidate
  senderBlocklistDomains:
    - "spam-domain.example"

  conflictResolution:
    # When ASK_HUMAN is in the action list, suppress MOVE/ARCHIVE
    askHumanBlocksMoveToArchive: true
```

---

## Rule Structure

```yaml
- id: my-rule-id          # Unique string identifier — used in audit trace
  priority: 500           # Higher number = evaluated first
  when: <Predicate>       # See Predicate DSL below
  setClassification:
    intent: ACTION_REQUIRED
    urgency: THIS_WEEK
    risk: MEDIUM
    confidence: 0.85
    rationale:
      - "Human-readable reason logged to audit trail"
  actions:
    - type: CREATE_TASK
    - type: CATEGORY
      name: "${defaults.categories.triageAction}"
  terminal: true          # true = stop evaluating further rules after this one
```

All fields are required except `setClassification` (omit to leave classification unchanged) and action parameters like `name`, `folder`, `question`.

---

## Predicate DSL

### Leaf operators

```yaml
# Equality
when:
  field: "source"
  op: eq
  value: "email"

# Inequality
when:
  field: "signals.isAutomated"
  op: neq
  value: true

# Case-insensitive substring
when:
  field: "title"
  op: contains
  value: "invoice"

# Regex (prefix with (?i) for case-insensitive)
when:
  field: "title"
  op: matches
  value: "(?i)receipt|invoice|payment"

# Value in a list
when:
  field: "extracted.intent"
  op: in
  value: ["ACTION_REQUIRED", "APPROVAL_REQUEST"]

# Sender domain in a list
when:
  field: "author"
  op: domain_in
  value: ["github.com", "notifications.github.com"]

# Numeric comparison (also: lte)
when:
  field: "extracted.confidence"
  op: gte
  value: 0.75
```

Missing fields always evaluate to `false` — they never throw.

### Compound operators

```yaml
# AND — all children must match
when:
  all:
    - field: "signals.isBulk"
      op: eq
      value: true
    - field: "signals.isAutomated"
      op: eq
      value: true

# OR — at least one child must match
when:
  any:
    - field: "signals.hasUnsubscribe"
      op: eq
      value: true
    - field: "extracted.intent"
      op: eq
      value: "NEWSLETTER"

# NOT
when:
  not:
    field: "signals.prioritySender"
    op: eq
    value: true
```

Compound operators short-circuit: `all` stops on first false; `any` stops on first true.

### Nesting

```yaml
when:
  all:
    - field: "signals.mentionsMoney"
      op: eq
      value: true
    - any:
        - field: "title"
          op: matches
          value: "(?i)receipt|invoice"
        - field: "snippet"
          op: matches
          value: "(?i)total amount|payment received"
```

---

## Action Types

| Type | Description | Parameters |
|------|-------------|------------|
| `CATEGORY` | Apply a category/tag to the source item | `name` (string) |
| `MOVE` | Move item to a folder | `folder` (semantic name from `defaults.folders`) |
| `FLAG` | Flag the item | `flagStatus` (`flagged` \| `unflagged`) |
| `CREATE_TASK` | Create an Obsidian task note in `system/artifacts/tasks/` | `template` (optional) |
| `CREATE_READING_PACK` | Append to today's reading pack in `system/artifacts/reading-packs/` | `template` (optional) |
| `DRAFT_REPLY` | Create a draft reply (stub — not yet sent) | `template`, `requiresApproval` |
| `ASK_HUMAN` | Create a human queue item requiring a decision | `question` (string shown to user) |
| `LABEL` | Add a label string (source-specific) | `name` (string) |

All actions include an idempotency key (`event:<id>:action:<type>:policy:<id>@<version>:v1`). Running the pipeline twice on the same event produces the same keys — duplicate actions are detected and skipped.

---

## Intent & Classification Values

### Intent types

| Intent | Meaning |
|--------|---------|
| `ACTION_REQUIRED` | Recipient needs to do something |
| `APPROVAL_REQUEST` | Someone needs a decision or sign-off |
| `SCHEDULING` | Meeting invite, calendar coordination |
| `DELEGATABLE` | Can be forwarded/delegated |
| `FYI` | Informational only — no action needed |
| `NEWSLETTER` | Bulk/automated marketing or digest |
| `RECEIPT` | Transaction confirmation, invoice |
| `SPAM` | Unwanted/unsolicited |
| `UNKNOWN` | Engine cannot determine intent |

### Urgency levels

| Level | Meaning |
|-------|---------|
| `NOW` | Needs attention immediately |
| `THIS_WEEK` | Should be handled before end of week |
| `SOMEDAY` | No time pressure |

### Risk levels

| Level | Effect |
|-------|--------|
| `HIGH` | Safety gate may add `ASK_HUMAN` even if a rule didn't |
| `MEDIUM` | Logged in audit trail |
| `LOW` | No additional gates |

---

## Priority Tiers

Rules are evaluated in descending priority order. First matching terminal rule wins.

| Priority range | Intended use |
|---------------|--------------|
| 1100+ | Hard filters (blocklist domains, strong spam signals) |
| 900–1099 | Automated/bulk mail (newsletters, receipts) |
| 700–899 | Scheduling and coordination |
| 600–699 | Approval requests |
| 500–599 | Action required |
| 300–499 | FYI / informational |
| 100–299 | Delegatable / low priority |
| 0–99 | Fallback (catch-all, usually adds ASK_HUMAN) |

When adding a custom rule, choose a priority that fits its specificity. More specific rules should have higher priority than broader ones.

---

## Addressable Fields

These are the fields you can use in `when` predicates:

### Core event fields

| Field | Type | Description |
|-------|------|-------------|
| `source` | string | `email` \| `calendar` \| `slack` \| `journal` \| `other` |
| `status` | string | `pending` \| `enriched` \| `evaluated` \| `actioned` |
| `title` | string | Subject line or event title |
| `author` | string | Sender email address or author identifier |
| `snippet` | string | Short body preview (typically first 500 chars) |
| `receivedAt` | string | ISO 8601 timestamp |
| `passCount` | number | Number of evaluation passes this event has had |

### Signal fields (`signals.*`)

| Field | Type | Set when |
|-------|------|---------|
| `signals.isAutomated` | boolean | Sent by an automated system (no-reply, notifications) |
| `signals.isBulk` | boolean | Mass-sent to many recipients |
| `signals.hasUnsubscribe` | boolean | Contains unsubscribe link |
| `signals.hasAttachments` | boolean | Has file attachments |
| `signals.mentionsMoney` | boolean | Contains monetary amounts or payment language |
| `signals.mentionsMeeting` | boolean | Contains meeting/calendar language |
| `signals.asksForAction` | boolean | Contains action-requesting language |
| `signals.prioritySender` | boolean | Sender is in `defaults.senderAllowlist` |

### Extracted fields (`extracted.*`)

These are populated after LLM enrichment runs:

| Field | Type | Description |
|-------|------|-------------|
| `extracted.intent` | IntentType | LLM-classified intent |
| `extracted.confidence` | number | LLM confidence 0.0–1.0 |
| `extracted.urgency` | UrgencyLevel | LLM-classified urgency |
| `extracted.summary` | string | LLM-generated summary |
| `extracted.llmTier` | string | `local` \| `claude` \| `none` |

### Human answer fields (`humanAnswers.*`)

When a human resolves an `ask_human` item, the answer is injected as `humanAnswers.<eventId>` for re-evaluation:

```yaml
when:
  field: "humanAnswers.20260219-email-a1b2"
  op: eq
  value: "ACTION_REQUIRED"
```

---

## Examples

### Route GitHub notifications to a folder

```yaml
- id: github-notifications
  priority: 950
  when:
    all:
      - field: "author"
        op: domain_in
        value: ["github.com", "notifications.github.com"]
      - field: "signals.isAutomated"
        op: eq
        value: true
  setClassification:
    intent: FYI
    urgency: SOMEDAY
    risk: LOW
    confidence: 0.95
    rationale:
      - "GitHub automated notification."
  actions:
    - type: CATEGORY
      name: "Dev/GitHub"
    - type: MOVE
      folder: "Archive"
  terminal: true
```

### Escalate high-urgency keywords immediately

```yaml
- id: urgent-keywords
  priority: 620
  when:
    any:
      - field: "title"
        op: matches
        value: "(?i)urgent|asap|critical|emergency|immediate"
      - field: "snippet"
        op: matches
        value: "(?i)urgent|asap|critical|needs your attention immediately"
  setClassification:
    intent: ACTION_REQUIRED
    urgency: NOW
    risk: HIGH
    confidence: 0.88
    rationale:
      - "Urgency keyword detected in subject or body."
  actions:
    - type: FLAG
      flagStatus: flagged
    - type: ASK_HUMAN
      question: "Urgent keyword detected. Is this genuinely urgent?"
  terminal: true
```

### Re-evaluate after human confirms intent

```yaml
- id: human-confirmed-action
  priority: 510
  when:
    field: "humanAnswers.{{ eventId }}"
    op: eq
    value: "ACTION_REQUIRED"
  setClassification:
    intent: ACTION_REQUIRED
    urgency: THIS_WEEK
    risk: MEDIUM
    confidence: 0.95
    rationale:
      - "Human confirmed action required."
  actions:
    - type: CREATE_TASK
  terminal: true
```

> Note: `humanAnswers` field names use the literal event ID, not a template variable. In practice, write a rule that matches a known event ID pattern, or use the fallback catch-all to handle the general case.
