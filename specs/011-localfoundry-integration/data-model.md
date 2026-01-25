# Data Model: LocalFoundry LLM Integration

**Feature**: 011-localfoundry-integration
**Date**: 2026-01-25

## Overview

This document defines the core entities and data structures for the LocalFoundry integration. LocalFoundry is a simpler service compared to OAuth-based integrations, with no token management required. The data model focuses on configuration, API request/response structures, and service state.

---

## Entity Definitions

### 1. LocalFoundryConfig

Configuration for LocalFoundry service connection and behavior.

**Fields**:
- `endpoint`: string (required)
  - Full URL to LocalFoundry Chat Completions API endpoint
  - Example: `"http://localhost:8080/v1/chat/completions"`
  - Must be HTTP or HTTPS URL with protocol
  - Loaded from `LOCALFOUNDRY_ENDPOINT` environment variable

- `model`: string (required)
  - Model identifier to use for all requests
  - Example: `"phi-4"`
  - Default: `"phi-4"` if not specified
  - Loaded from `LOCALFOUNDRY_MODEL` environment variable

- `timeout`: number (required)
  - Request timeout in milliseconds
  - Example: `60000` (60 seconds)
  - Default: `60000` if not specified
  - Loaded from `LOCALFOUNDRY_TIMEOUT` environment variable

**Validation Rules**:
- endpoint must be valid URL format
- endpoint must start with http:// or https://
- model must be non-empty string
- timeout must be positive integer > 0

**State Transitions**: Immutable after loading from environment

**TypeScript Interface**:
```typescript
interface LocalFoundryConfig {
  endpoint: string;
  model: string;
  timeout: number;
}
```

---

### 2. ChatMessage

Individual message in a Chat Completions conversation.

**Fields**:
- `role`: 'system' | 'user' | 'assistant' (required)
  - Message role type following OpenAI convention
  - 'system': Task instructions and behavior guidance
  - 'user': User input or text content
  - 'assistant': LLM-generated response (in response only)

- `content`: string (required)
  - Message text content
  - Can be multi-line with \n characters
  - Maximum length determined by model context window

**Validation Rules**:
- role must be one of: 'system', 'user', 'assistant'
- content must be non-empty string
- content should not exceed reasonable length (e.g., 50,000 characters)

**TypeScript Interface**:
```typescript
interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
```

---

### 3. ChatCompletionRequest

Request payload sent to LocalFoundry Chat Completions API.

**Fields**:
- `model`: string (required)
  - Model identifier from configuration
  - Example: `"phi-4"`

- `messages`: ChatMessage[] (required)
  - Array of conversation messages
  - Typically contains system prompt + user content
  - Minimum 1 message, typically 2 (system + user)

- `temperature`: number (optional)
  - Sampling temperature for randomness
  - Range: 0.0 to 2.0
  - Default: 0.7 (balanced creativity/consistency)

- `max_tokens`: number (optional)
  - Maximum tokens in generated response
  - Prevents excessively long outputs
  - Default: model-specific default (typically 2000-4000)

**Validation Rules**:
- model must match configured model name
- messages array must have at least 1 message
- temperature must be in range [0.0, 2.0] if specified
- max_tokens must be positive integer if specified

**TypeScript Interface**:
```typescript
interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
}
```

---

### 4. ChatCompletionResponse

Response payload received from LocalFoundry Chat Completions API.

**Fields**:
- `id`: string (required)
  - Unique identifier for this completion
  - Example: `"chatcmpl-abc123"`

- `object`: string (required)
  - Object type identifier
  - Value: `"chat.completion"`

- `created`: number (required)
  - Unix timestamp of response creation
  - Seconds since epoch

- `model`: string (required)
  - Model that generated the response
  - Should match request model

- `choices`: ChatCompletionChoice[] (required)
  - Array of completion choices (typically single choice)
  - Each choice contains generated message

- `usage`: TokenUsage (optional)
  - Token count statistics if available
  - Not required for functionality

**Relationships**:
- Contains array of ChatCompletionChoice entities
- May contain TokenUsage entity

**Validation Rules**:
- choices array must have at least 1 choice
- choices[0].message.content must be non-empty string

**TypeScript Interface**:
```typescript
interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: TokenUsage;
}
```

---

### 5. ChatCompletionChoice

Individual completion choice in Chat Completions response.

**Fields**:
- `index`: number (required)
  - Choice index in array (0-based)
  - Typically 0 for single-choice responses

- `message`: ChatMessage (required)
  - Generated message from LLM
  - role will be 'assistant'
  - content contains the actual generated text

- `finish_reason`: string (required)
  - Reason generation stopped
  - Values: 'stop' (natural completion), 'length' (max tokens reached), 'content_filter'

**Validation Rules**:
- index must be non-negative integer
- message.role must be 'assistant'
- message.content must be non-empty
- finish_reason must be valid enum value

**TypeScript Interface**:
```typescript
interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: string;
}
```

---

### 6. TokenUsage

Token usage statistics for a completion (optional).

**Fields**:
- `prompt_tokens`: number
  - Tokens in input prompt

- `completion_tokens`: number
  - Tokens in generated completion

- `total_tokens`: number
  - Sum of prompt_tokens + completion_tokens

**Validation Rules**:
- All fields must be non-negative integers
- total_tokens should equal prompt_tokens + completion_tokens

**TypeScript Interface**:
```typescript
interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}
```

---

### 7. LocalFoundryServiceStatus

Service status information for dashboard display.

**Fields**:
- `serviceName`: 'local' (constant)
  - Service identifier for tool namespacing

- `displayName`: 'LocalFoundry' (constant)
  - Human-readable service name

- `state`: 'available' | 'unavailable' | 'not_configured' (required)
  - Current availability state
  - 'available': Endpoint reachable and responding
  - 'unavailable': Endpoint configured but unreachable
  - 'not_configured': No endpoint configured

- `message`: string (required)
  - Status description for display
  - Examples: "Connected to http://localhost:8080/v1/chat/completions", "Endpoint not reachable"

- `endpoint`: string (optional)
  - Configured endpoint URL
  - Only present when endpoint is configured

- `model`: string (optional)
  - Configured model name
  - Only present when endpoint is configured

- `loginUrl`: '' (constant empty string)
  - No authentication URL needed
  - Required by dashboard interface but unused

**State Transitions**:
- not_configured → available (when endpoint configured and health check passes)
- not_configured → unavailable (when endpoint configured but health check fails)
- available ↔ unavailable (based on periodic health checks)

**Validation Rules**:
- state must be one of defined enum values
- endpoint must be valid URL if present
- loginUrl must always be empty string

**TypeScript Interface**:
```typescript
interface LocalFoundryServiceStatus {
  serviceName: 'local';
  displayName: 'LocalFoundry';
  state: 'available' | 'unavailable' | 'not_configured';
  message: string;
  endpoint?: string;
  model?: string;
  loginUrl: '';
}
```

---

### 8. ToolInput - Summarize

Input parameters for the `local.summarize` tool.

**Fields**:
- `text`: string (required)
  - Text content to summarize
  - Can be long-form document, code file, or any text
  - Recommended max: 50,000 characters

- `maxLength`: number (optional)
  - Maximum summary length in words
  - Example: `300`
  - Default: `300` if not specified

**Validation Rules**:
- text must be non-empty string
- maxLength must be positive integer > 0 if specified
- maxLength should be reasonable (e.g., 50-1000 words)

**TypeScript Interface**:
```typescript
interface SummarizeInput {
  text: string;
  maxLength?: number;
}
```

---

### 9. ToolInput - Clarify

Input parameters for the `local.clarify` tool.

**Fields**:
- `text`: string (required)
  - Context text to answer questions about
  - Can be documentation, code comments, or any reference material

- `question`: string (required)
  - Specific question to answer based on the text
  - Should be clear and focused

**Validation Rules**:
- text must be non-empty string
- question must be non-empty string
- text should contain relevant context for the question

**TypeScript Interface**:
```typescript
interface ClarifyInput {
  text: string;
  question: string;
}
```

---

### 10. ToolInput - Extract

Input parameters for the `local.extract` tool.

**Fields**:
- `text`: string (required)
  - Text to extract structured data from
  - Examples: meeting notes, log files, unstructured documents

- `schema`: string (required)
  - Description of desired JSON structure
  - Example: `"{attendees: string[], action_items: string[], decisions: string[]}"`
  - Can be natural language or JSON schema format

**Validation Rules**:
- text must be non-empty string
- schema must be non-empty string describing desired structure

**TypeScript Interface**:
```typescript
interface ExtractInput {
  text: string;
  schema: string;
}
```

---

## Entity Relationships

```
┌─────────────────────┐
│ LocalFoundryConfig  │
│ (loaded from env)   │
└──────────┬──────────┘
           │
           │ used by
           ▼
┌─────────────────────┐
│ LocalFoundryClient  │
│ (API client)        │
└──────────┬──────────┘
           │
           │ sends
           ▼
┌─────────────────────────┐
│ ChatCompletionRequest   │
│ ├─ model                │
│ └─ messages[]           │
│    └─ ChatMessage       │
│       ├─ role           │
│       └─ content        │
└──────────┬──────────────┘
           │
           │ receives
           ▼
┌─────────────────────────┐
│ ChatCompletionResponse  │
│ ├─ choices[]            │
│ │  └─ ChatCompletionChoice
│ │     └─ message        │
│ │        └─ ChatMessage │
│ └─ usage (optional)     │
│    └─ TokenUsage        │
└─────────────────────────┘


┌─────────────────────┐
│ Tool Inputs         │
│ ├─ SummarizeInput   │
│ ├─ ClarifyInput     │
│ └─ ExtractInput     │
└──────────┬──────────┘
           │
           │ validated & transformed
           ▼
┌─────────────────────┐
│ ChatMessage[]       │
│ (system + user)     │
└──────────┬──────────┘
           │
           │ sent via
           ▼
┌─────────────────────┐
│ LocalFoundryClient  │
└─────────────────────┘


┌─────────────────────────┐
│ LocalFoundryService     │
└──────────┬──────────────┘
           │
           │ provides status
           ▼
┌──────────────────────────┐
│ LocalFoundryServiceStatus│
│ (for dashboard)          │
└──────────────────────────┘
```

---

## Data Flow Examples

### Summarize Tool Flow

1. **User Input**:
```json
{
  "text": "Long document content...",
  "maxLength": 200
}
```

2. **Transform to Chat Messages**:
```json
[
  {
    "role": "system",
    "content": "You are a text summarization assistant. Provide concise summaries highlighting key points. Keep summaries under the requested length."
  },
  {
    "role": "user",
    "content": "Summarize the following text in no more than 200 words:\n\nLong document content..."
  }
]
```

3. **Chat Completion Request**:
```json
{
  "model": "phi-4",
  "messages": [...],
  "temperature": 0.7
}
```

4. **Chat Completion Response**:
```json
{
  "id": "chatcmpl-123",
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "This document discusses... [summary content]"
    }
  }]
}
```

5. **Tool Response**:
```json
{
  "summary": "This document discusses... [summary content]"
}
```

### Dashboard Status Check Flow

1. **Check if endpoint configured**:
```typescript
const endpoint = process.env.LOCALFOUNDRY_ENDPOINT;
if (!endpoint) {
  return { state: 'not_configured', message: 'LOCALFOUNDRY_ENDPOINT not set' };
}
```

2. **Health check request** (OPTIONS or simple GET):
```
HTTP OPTIONS http://localhost:8080/v1/chat/completions
```

3. **Health check success → Available**:
```typescript
{
  serviceName: 'local',
  displayName: 'LocalFoundry',
  state: 'available',
  message: 'Connected to http://localhost:8080/v1/chat/completions',
  endpoint: 'http://localhost:8080/v1/chat/completions',
  model: 'phi-4',
  loginUrl: ''
}
```

4. **Health check failure → Unavailable**:
```typescript
{
  serviceName: 'local',
  displayName: 'LocalFoundry',
  state: 'unavailable',
  message: 'Endpoint http://localhost:8080/v1/chat/completions not reachable',
  endpoint: 'http://localhost:8080/v1/chat/completions',
  model: 'phi-4',
  loginUrl: ''
}
```

---

## Persistence and Storage

**No persistent storage required** for LocalFoundry integration:
- Configuration loaded from environment variables at startup
- No tokens to store (no OAuth)
- No conversation history maintained between tool invocations
- Each tool invocation is stateless

This differs from OAuth services (Microsoft, Slack) which require token storage via BaseTokenStorage.

---

## Validation Summary

| Entity | Key Validations |
|--------|----------------|
| LocalFoundryConfig | Valid URL format, positive timeout |
| ChatMessage | Non-empty content, valid role enum |
| ChatCompletionRequest | Non-empty messages array, model matches config |
| ChatCompletionResponse | Non-empty choices array, valid structure |
| Tool Inputs | Non-empty required fields, reasonable length limits |
| ServiceStatus | Valid state enum, endpoint URL if configured |

---

## Implementation Notes

1. **Type Safety**: All interfaces use TypeScript strict mode for compile-time validation
2. **Runtime Validation**: Tool input schemas enforce validation via JSON Schema
3. **Error Handling**: Invalid data triggers clear error messages with field information
4. **Testing**: Mock entities for predictable unit test behavior
5. **Documentation**: JSDoc comments on interfaces for IDE autocomplete

---

**Data Model Complete**: 2026-01-25
