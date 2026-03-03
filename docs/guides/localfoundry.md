# LocalFoundry Integration

LocalFoundry provides local LLM text processing without cloud services or authentication requirements. It connects to a locally-running model endpoint (e.g., LM Studio, Ollama with OpenAI-compatible API).

## Table of Contents

- [Configuration](#configuration)
- [Available Tools](#available-tools)
- [Dashboard Status](#dashboard-status)
- [Usage Examples](#usage-examples)

---

## Configuration

Add to your `.env` file:

```bash
# Required
LOCALFOUNDRY_ENDPOINT=http://localhost:8080/v1/chat/completions

# Optional
LOCALFOUNDRY_MODEL=phi-4          # Model name (default: phi-4)
LOCALFOUNDRY_TIMEOUT=60000        # Request timeout in ms (default: 60000)
```

The endpoint must implement the OpenAI-compatible `/v1/chat/completions` API. LocalFoundry (LM Studio default) uses `http://localhost:1234/v1/chat/completions`.

---

## Available Tools

### `local.summarize`

Summarizes long text content concisely.

**Parameters:**
```typescript
{
  text: string,          // Text to summarize (up to 50K chars)
  maxLength?: number     // Max summary length in words (default: 300)
}
```

### `local.clarify`

Answers a specific question about provided text.

**Parameters:**
```typescript
{
  text: string,          // Context text
  question: string       // Specific question to answer
}
```

### `local.extract`

Extracts structured JSON data from unstructured text.

**Parameters:**
```typescript
{
  text: string,          // Text to extract from
  schema: string         // Desired JSON structure description
}
```

---

## Dashboard Status

Visit `https://localhost:3333/` to see the LocalFoundry status card:
- **Available**: Endpoint responding correctly
- **Unavailable**: Endpoint configured but not reachable
- **Not Configured**: `LOCALFOUNDRY_ENDPOINT` not set

No authentication button is shown — LocalFoundry uses direct localhost access, not OAuth.

---

## Usage Examples

**Summarize a long document:**
```
> Summarize this document: [paste text]
```
Uses `local.summarize` automatically.

**Answer questions about content:**
```
> What does the timeout parameter control in this config? [paste config]
```
Uses `local.clarify`.

**Extract structured data:**
```
> Extract attendees, decisions, and action items from this meeting note: [paste note]
```
Uses `local.extract`, returns JSON.

---

## Role in the Triage Pipeline

LocalFoundry is the primary enrichment tier in the policy pipeline:

- **Stage 2 (Local enrichment)**: Every `pending` triage event is sent to LocalFoundry (phi-4-mini or equivalent) for intent classification
- The LLM classifies intent (`ACTION_REQUIRED`, `FYI`, `NEWSLETTER`, etc.) and returns a confidence score
- If confidence is below the `claudeRecommendThreshold` (default 0.60), a `claude_approval` queue item is created to optionally escalate to Claude

See [policy-engine.md](policy-engine.md) and [architecture/triage-pipeline.md](../architecture/triage-pipeline.md) for details.

---

## Windows Ink Integration

LocalFoundry also provides handwriting cleanup for OneNote ink recognition. See [onenote-windows-ink.md](onenote-windows-ink.md) for details.
