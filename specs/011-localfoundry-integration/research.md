# Research: LocalFoundry LLM Integration

**Feature**: 011-localfoundry-integration
**Date**: 2026-01-25
**Status**: Complete

## Overview

This document captures technical research and decisions for integrating Microsoft LocalFoundry's local LLM capabilities into Cerebro MCP. Research focused on API compatibility, service architecture patterns, tool design, and dashboard integration.

---

## Research Areas

### 1. OpenAI Chat Completions API Format

**Decision**: Use OpenAI-compatible `/v1/chat/completions` endpoint format

**Rationale**:
- LocalFoundry implements OpenAI-compatible API for seamless integration
- Standard format ensures compatibility with existing LLM tooling ecosystem
- Well-documented schema reduces implementation complexity
- No custom protocol development needed

**API Request Format**:
```json
{
  "model": "phi-4",
  "messages": [
    {"role": "system", "content": "System instructions"},
    {"role": "user", "content": "User prompt"}
  ],
  "temperature": 0.7,
  "max_tokens": 2000
}
```

**API Response Format**:
```json
{
  "id": "chatcmpl-123",
  "object": "chat.completion",
  "created": 1706198400,
  "model": "phi-4",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Generated response text"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 50,
    "completion_tokens": 100,
    "total_tokens": 150
  }
}
```

**Alternatives Considered**:
- Custom LocalFoundry-specific protocol - Rejected: unnecessary complexity
- Streaming API with Server-Sent Events - Rejected: out of scope for v1
- Anthropic Claude API format - Rejected: not LocalFoundry's native format

**References**:
- OpenAI Chat Completions API: https://platform.openai.com/docs/api-reference/chat
- LocalFoundry documentation (assumes OpenAI compatibility)

---

### 2. Service Architecture Pattern

**Decision**: Extend BaseService interface with minimal token storage

**Rationale**:
- Maintains consistency with existing Microsoft and Slack services
- BaseService interface provides standard lifecycle hooks (initialize, shutdown)
- ServiceRegistry automatically handles tool namespacing and registration
- Enables future OAuth integration if needed (e.g., cloud Azure AI Foundry)

**Implementation Pattern**:
```typescript
export class LocalFoundryService implements BaseService {
  readonly name = 'local';
  readonly config: ServiceConfig;
  private client: LocalFoundryClient;

  async initialize(): Promise<void> {
    // Verify endpoint availability
    // Initialize HTTP client
  }

  getTools(): Tool[] {
    return [
      { name: 'summarize', ... },
      { name: 'clarify', ... },
      { name: 'extract', ... }
    ];
  }

  async isAuthenticated(): Promise<boolean> {
    // Check endpoint reachability
    return this.client.isAvailable();
  }

  async shutdown(): Promise<void> {
    // Cleanup resources
  }
}
```

**Alternatives Considered**:
- Standalone tool functions without service wrapper - Rejected: breaks consistency
- Shared generic LLM service for multiple providers - Rejected: premature abstraction
- Direct integration without BaseService - Rejected: loses lifecycle management

**Best Practices from Existing Services**:
- MicrosoftService: OAuth flow, token refresh, API pagination
- SlackService: Socket Mode, action handlers, message formatting
- Common patterns: structured logging, error extraction, timeout handling

---

### 3. HTTP Client Implementation

**Decision**: Create simple HTTP client extending BaseAPIClient patterns

**Rationale**:
- BaseAPIClient provides request/response infrastructure and timeout handling
- LocalFoundry requires simpler client than OAuth services (no token refresh)
- Reuse error extraction and logging patterns
- Support test mode via USE_TEST_MODE environment variable

**Client Implementation**:
```typescript
export class LocalFoundryClient {
  private endpoint: string;
  private model: string;
  private timeout: number;

  async chatCompletion(messages: ChatMessage[]): Promise<string> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, messages }),
      signal: AbortSignal.timeout(this.timeout)
    });

    if (!response.ok) {
      throw new Error(`LocalFoundry request failed: ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }

  async healthCheck(): Promise<boolean> {
    // Quick connectivity check
  }
}
```

**Alternatives Considered**:
- Full BaseAPIClient extension with OAuth methods - Rejected: unnecessary overhead
- Third-party OpenAI SDK - Rejected: adds dependency for simple use case
- Axios or other HTTP library - Rejected: Node.js fetch is sufficient

**Error Handling Strategy**:
- Network errors (ECONNREFUSED) → "LocalFoundry endpoint unreachable"
- Timeout errors → "LocalFoundry request timed out after {timeout}ms"
- HTTP 500 errors → "LocalFoundry returned server error"
- Malformed JSON → "LocalFoundry returned invalid response"

---

### 4. Tool Design and Prompt Engineering

**Decision**: Use system prompts to guide LLM behavior for each tool

**Rationale**:
- System prompts provide clear task instructions without user intervention
- Different system prompts per tool enable specialized behavior
- User content separated from task instructions improves output quality
- JSON schema extraction can be enforced via system prompt

**Tool Implementations**:

#### Tool 1: local.summarize
```typescript
{
  name: 'summarize',
  description: 'Summarize text content concisely',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Text to summarize' },
      maxLength: { type: 'number', description: 'Max words (default 300)' }
    },
    required: ['text']
  },
  handler: async (input) => {
    const messages = [
      {
        role: 'system',
        content: 'You are a text summarization assistant. Provide concise summaries highlighting key points. Keep summaries under the requested length.'
      },
      {
        role: 'user',
        content: `Summarize the following text in no more than ${maxLength} words:\n\n${text}`
      }
    ];
    return await client.chatCompletion(messages);
  }
}
```

#### Tool 2: local.clarify
```typescript
{
  name: 'clarify',
  description: 'Answer questions about provided text',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Context text' },
      question: { type: 'string', description: 'Question to answer' }
    },
    required: ['text', 'question']
  },
  handler: async (input) => {
    const messages = [
      {
        role: 'system',
        content: 'You are a Q&A assistant. Answer questions based only on the provided text. If the answer is not in the text, say so clearly.'
      },
      {
        role: 'user',
        content: `Text:\n${text}\n\nQuestion: ${question}`
      }
    ];
    return await client.chatCompletion(messages);
  }
}
```

#### Tool 3: local.extract
```typescript
{
  name: 'extract',
  description: 'Extract structured data from text as JSON',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Text to extract from' },
      schema: { type: 'string', description: 'JSON schema description' }
    },
    required: ['text', 'schema']
  },
  handler: async (input) => {
    const messages = [
      {
        role: 'system',
        content: 'You are a data extraction assistant. Extract information matching the requested schema and return ONLY valid JSON. No explanations, just JSON.'
      },
      {
        role: 'user',
        content: `Extract data matching this schema:\n${schema}\n\nFrom this text:\n${text}\n\nReturn only valid JSON.`
      }
    ];
    const response = await client.chatCompletion(messages);
    return JSON.parse(response); // Validate JSON
  }
}
```

**Alternatives Considered**:
- Single generic "chat" tool - Rejected: less user-friendly, requires manual prompting
- Function calling / tool use API - Rejected: not available in phi-4 model
- Fine-tuned models per task - Rejected: out of scope, requires training infrastructure

**Best Practices**:
- Keep system prompts concise and task-focused
- Separate instructions from user content in message roles
- Validate JSON responses from extract tool
- Set reasonable temperature (0.7) for balance of creativity/consistency

---

### 5. Dashboard Status Card Integration

**Decision**: Add LocalFoundry status card to OAuth dashboard without authentication button

**Rationale**:
- Consistent UX with other services (Microsoft, Slack)
- Users need visibility into LocalFoundry availability before using tools
- No OAuth flow needed, so simplified card design
- Health check provides real-time status

**Status Card Implementation**:
```typescript
interface LocalFoundryStatus {
  serviceName: 'local';
  displayName: 'LocalFoundry';
  state: 'available' | 'unavailable' | 'not_configured';
  message: string;
  endpoint?: string;
  model?: string;
  loginUrl: ''; // No authentication required
}
```

**Status States**:
- **available**: Endpoint responds to health check (HTTP 200)
- **unavailable**: Endpoint configured but unreachable (connection error)
- **not_configured**: LOCALFOUNDRY_ENDPOINT not set in environment

**Display Details**:
- Service name: "LocalFoundry"
- Status badge: Green (available) / Red (unavailable) / Yellow (not configured)
- Endpoint URL: Display configured endpoint for verification
- Model name: Show configured model (default: phi-4)
- No authentication button (localhost service requires no auth)

**Dashboard Update Pattern**:
```typescript
private async checkLocalFoundryStatus(): Promise<ServiceStatus> {
  const endpoint = process.env.LOCALFOUNDRY_ENDPOINT;

  if (!endpoint) {
    return {
      serviceName: 'local',
      displayName: 'LocalFoundry',
      state: 'not_configured',
      message: 'LOCALFOUNDRY_ENDPOINT not configured',
      loginUrl: ''
    };
  }

  try {
    const isAvailable = await localFoundryService.isAuthenticated();
    return {
      serviceName: 'local',
      displayName: 'LocalFoundry',
      state: isAvailable ? 'available' : 'unavailable',
      message: isAvailable
        ? `Connected to ${endpoint}`
        : `Endpoint ${endpoint} not reachable`,
      endpoint,
      model: process.env.LOCALFOUNDRY_MODEL || 'phi-4',
      loginUrl: ''
    };
  } catch (error) {
    return {
      serviceName: 'local',
      displayName: 'LocalFoundry',
      state: 'unavailable',
      message: `Error: ${error.message}`,
      loginUrl: ''
    };
  }
}
```

**Alternatives Considered**:
- Command-line status check tool - Rejected: dashboard provides better UX
- Real-time WebSocket status updates - Rejected: polling is sufficient
- No status display - Rejected: users need visibility for troubleshooting

---

### 6. Configuration and Environment Variables

**Decision**: Use environment variables for all LocalFoundry configuration

**Rationale**:
- Consistent with existing service configuration patterns
- Enables different configurations per deployment environment
- No code changes needed to update endpoint or model
- Documented in .env.example for easy setup

**Configuration Variables**:
```bash
# LocalFoundry Configuration
LOCALFOUNDRY_ENDPOINT=http://localhost:8080/v1/chat/completions
LOCALFOUNDRY_MODEL=phi-4
LOCALFOUNDRY_TIMEOUT=60000
```

**Variable Descriptions**:
- `LOCALFOUNDRY_ENDPOINT`: Full URL to Chat Completions API endpoint (required for service registration)
- `LOCALFOUNDRY_MODEL`: Model name to use for all requests (default: phi-4)
- `LOCALFOUNDRY_TIMEOUT`: Request timeout in milliseconds (default: 60000)

**Configuration Loading Pattern**:
```typescript
export interface LocalFoundryConfig {
  endpoint: string;
  model: string;
  timeout: number;
}

export function loadLocalFoundryConfig(): LocalFoundryConfig | null {
  const endpoint = process.env.LOCALFOUNDRY_ENDPOINT;

  if (!endpoint) {
    logger.info('LocalFoundry not configured - skipping service registration');
    return null;
  }

  return {
    endpoint,
    model: process.env.LOCALFOUNDRY_MODEL || 'phi-4',
    timeout: getEnvInt('LOCALFOUNDRY_TIMEOUT', 60000)
  };
}
```

**Service Registration Pattern**:
```typescript
function registerServices(): void {
  // ... existing services ...

  const localFoundryConfig = loadLocalFoundryConfig();
  if (localFoundryConfig) {
    const localFoundryService = new LocalFoundryService(localFoundryConfig);
    registry.registerService(localFoundryService);
    logger.info('LocalFoundry service registered');
  }
}
```

**Alternatives Considered**:
- Configuration file (JSON/YAML) - Rejected: env vars are simpler
- Hardcoded localhost URL - Rejected: reduces flexibility for testing
- Auto-discovery of LocalFoundry port - Rejected: adds unnecessary complexity

---

### 7. Error Handling and Timeout Strategy

**Decision**: Implement 60-second timeout with clear error messages

**Rationale**:
- LocalFoundry may take time processing large texts (especially summarization)
- Timeout prevents hanging requests and provides user feedback
- Configurable timeout allows adjustment per deployment
- Distinct error types enable better troubleshooting

**Timeout Implementation**:
```typescript
async chatCompletion(messages: ChatMessage[]): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), this.timeout);

  try {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, messages }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${this.timeout}ms`);
    }

    throw error;
  }
}
```

**Error Categories**:
1. **Connection Errors** (ECONNREFUSED, ENOTFOUND)
   - Message: "LocalFoundry endpoint unreachable at {endpoint}"
   - Cause: LocalFoundry not running or wrong URL

2. **Timeout Errors** (AbortError)
   - Message: "Request timed out after {timeout}ms"
   - Cause: Large text processing or slow model

3. **HTTP Errors** (400, 500, etc.)
   - Message: "LocalFoundry returned error: {status} - {body}"
   - Cause: Invalid request or server error

4. **Parse Errors** (JSON.parse failure)
   - Message: "LocalFoundry returned invalid response format"
   - Cause: Malformed API response

**Alternatives Considered**:
- Retry logic with exponential backoff - Rejected: adds complexity, long delays
- Streaming responses to avoid timeout - Rejected: out of scope for v1
- Different timeouts per tool - Rejected: single timeout is simpler

---

### 8. Testing Strategy

**Decision**: Unit tests for each component, integration tests for end-to-end flow

**Rationale**:
- Jest framework already configured with 80% coverage requirement
- Unit tests validate tool logic, error handling, configuration loading
- Integration tests verify actual API calls and service lifecycle
- Mock HTTP responses for predictable unit test behavior

**Test Coverage Plan**:

#### Unit Tests:
```typescript
// localfoundry-service.test.ts
- Service initialization with valid config
- Service initialization with missing config
- Tool registration and namespacing
- isAuthenticated() health check
- Shutdown cleanup

// localfoundry-client.test.ts
- Successful API request/response
- Network error handling (ECONNREFUSED)
- Timeout handling
- HTTP error status codes (400, 500)
- Malformed JSON response handling

// tools.test.ts
- summarize tool with valid text
- summarize tool with maxLength parameter
- clarify tool with question answering
- extract tool with valid schema
- extract tool with invalid JSON response
- Input validation for required fields
```

#### Integration Tests:
```typescript
// localfoundry-integration.test.ts
- Full service lifecycle (initialize → use tools → shutdown)
- Dashboard status check with mock endpoint
- Concurrent tool requests
- Service registration in ServiceRegistry
- MCP tool exposure and invocation
```

**Mock Patterns**:
```typescript
// Mock HTTP server for tests
class MockLocalFoundryServer {
  createMockResponse(prompt: string): ChatCompletionResponse {
    return {
      id: 'test-123',
      object: 'chat.completion',
      created: Date.now(),
      model: 'phi-4',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: `Mock response for: ${prompt.substring(0, 50)}`
        },
        finish_reason: 'stop'
      }]
    };
  }
}
```

**Alternatives Considered**:
- Real LocalFoundry endpoint for tests - Rejected: requires external dependency
- Snapshot testing for responses - Rejected: LLM outputs are non-deterministic
- E2E tests with actual MCP client - Rejected: unit/integration tests are sufficient

---

## Summary of Decisions

| Area | Decision | Key Rationale |
|------|----------|---------------|
| API Format | OpenAI Chat Completions | Standard format, no custom protocol needed |
| Service Architecture | Extend BaseService | Consistency with existing services |
| HTTP Client | Simple fetch-based client | No OAuth complexity needed |
| Tool Design | Three specialized tools with system prompts | User-friendly, task-specific behavior |
| Dashboard | Status card without auth button | Visibility into availability |
| Configuration | Environment variables | Consistent with project patterns |
| Error Handling | 60s timeout with clear messages | User feedback and troubleshooting |
| Testing | Jest unit + integration tests | 80% coverage requirement |

---

## Implementation Readiness

All technical unknowns have been resolved. Ready to proceed with Phase 1 (Design & Contracts).

**Next Steps**:
1. Phase 1: Create data-model.md defining entities
2. Phase 1: Generate API contracts in contracts/ directory
3. Phase 1: Write quickstart.md with integration examples
4. Phase 1: Update CLAUDE.md agent context
5. Phase 2: Generate tasks.md with implementation breakdown (separate command)

---

**Research Complete**: 2026-01-25
