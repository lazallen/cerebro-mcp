# Quickstart: LocalFoundry LLM Integration

**Feature**: 011-localfoundry-integration
**Date**: 2026-01-25

## Overview

This quickstart guide demonstrates how to integrate and use LocalFoundry's local LLM capabilities through Cerebro MCP. You'll learn how to configure the service, verify it's running, and use the three core text processing tools.

---

## Prerequisites

1. **LocalFoundry Installed**: Microsoft LocalFoundry running locally
2. **LocalFoundry Endpoint**: Chat Completions API accessible at configured endpoint
3. **Cerebro MCP**: Cerebro MCP server installed and configured

---

## Step 1: Configure LocalFoundry Endpoint

Add LocalFoundry configuration to your `.env` file:

```bash
# LocalFoundry Configuration
LOCALFOUNDRY_ENDPOINT=http://localhost:8080/v1/chat/completions
LOCALFOUNDRY_MODEL=phi-4
LOCALFOUNDRY_TIMEOUT=60000
```

**Configuration Parameters**:
- `LOCALFOUNDRY_ENDPOINT`: Full URL to Chat Completions API (required)
- `LOCALFOUNDRY_MODEL`: Model identifier (default: phi-4)
- `LOCALFOUNDRY_TIMEOUT`: Request timeout in milliseconds (default: 60000)

**Note**: If `LOCALFOUNDRY_ENDPOINT` is not set, the service will not be registered and LocalFoundry tools will not be available.

---

## Step 2: Start LocalFoundry

Ensure LocalFoundry is running and accessible at the configured endpoint:

```bash
# Test endpoint connectivity (example using curl)
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "phi-4",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

Expected response: JSON with `choices` array containing generated message.

---

## Step 3: Start Cerebro MCP

Start the Cerebro MCP server:

```bash
npm start
```

The server will:
1. Load environment variables from `.env`
2. Register LocalFoundry service if `LOCALFOUNDRY_ENDPOINT` is configured
3. Expose LocalFoundry tools via MCP protocol
4. Display LocalFoundry status on dashboard at https://localhost:3333

---

## Step 4: Verify LocalFoundry Status

Visit the OAuth dashboard to check LocalFoundry status:

```
https://localhost:3333
```

You should see a **LocalFoundry** status card showing:
- **Status**: Available (green) / Unavailable (red) / Not Configured (yellow)
- **Endpoint**: Configured endpoint URL
- **Model**: Configured model name
- **Note**: No authentication button (LocalFoundry requires no OAuth)

**Status Indicators**:
- ✅ **Available**: Endpoint reachable and responding
- ❌ **Unavailable**: Endpoint configured but unreachable
- ⚠️ **Not Configured**: `LOCALFOUNDRY_ENDPOINT` not set

---

## Step 5: Use LocalFoundry Tools

LocalFoundry provides three text processing tools accessible through MCP:

### Tool 1: local.summarize

Summarize long text content concisely.

**Example Request**:
```json
{
  "tool": "local.summarize",
  "input": {
    "text": "Long document content to summarize... (5000 words)",
    "maxLength": 300
  }
}
```

**Example Response**:
```json
{
  "summary": "This document discusses the implementation of a new authentication system using OAuth 2.0. Key points include token-based authentication, refresh token handling, and security best practices. The system supports multiple identity providers and includes comprehensive error handling."
}
```

**Use Cases**:
- Summarize long documents, code files, or meeting notes
- Extract key points from technical documentation
- Create concise overviews of verbose content

---

### Tool 2: local.clarify

Answer specific questions about provided text content.

**Example Request**:
```json
{
  "tool": "local.clarify",
  "input": {
    "text": "The timeout parameter controls how long the system waits for a response before aborting the request. Default value is 60000 milliseconds (60 seconds). This can be configured via the LOCALFOUNDRY_TIMEOUT environment variable.",
    "question": "What does the timeout parameter control?"
  }
}
```

**Example Response**:
```json
{
  "answer": "The timeout parameter controls how long the system waits for a response before aborting the request. It defaults to 60000 milliseconds (60 seconds) and can be configured using the LOCALFOUNDRY_TIMEOUT environment variable."
}
```

**Use Cases**:
- Ask questions about code comments or documentation
- Clarify ambiguous sections of technical specifications
- Get targeted explanations without reading entire documents

---

### Tool 3: local.extract

Extract structured data from unstructured text as JSON.

**Example Request**:
```json
{
  "tool": "local.extract",
  "input": {
    "text": "Meeting on Jan 25, 2026. Attendees: John Smith, Sarah Johnson. Discussion: New API design. Decisions: Use REST over GraphQL. Action items: John to draft spec by Friday, Sarah to review security requirements.",
    "schema": "{attendees: string[], decisions: string[], action_items: string[]}"
  }
}
```

**Example Response**:
```json
{
  "extracted": {
    "attendees": ["John Smith", "Sarah Johnson"],
    "decisions": ["Use REST over GraphQL"],
    "action_items": [
      "John to draft spec by Friday",
      "Sarah to review security requirements"
    ]
  }
}
```

**Use Cases**:
- Parse meeting notes into structured action items
- Extract error information from log files
- Convert unstructured data into JSON for programmatic processing

---

## Integration Patterns

### Pattern 1: Summarization Workflow

Use case: Summarize a large code file before reviewing.

```typescript
// Read code file
const codeContent = await fs.readFile('src/large-service.ts', 'utf-8');

// Summarize with LocalFoundry
const result = await mcpClient.callTool('local.summarize', {
  text: codeContent,
  maxLength: 200
});

console.log('Code Summary:', result.summary);
// Output: "This service handles user authentication and authorization..."
```

---

### Pattern 2: Documentation Q&A

Use case: Answer questions about documentation without reading entire doc.

```typescript
// Load documentation
const docs = await fs.readFile('docs/api-reference.md', 'utf-8');

// Ask specific question
const result = await mcpClient.callTool('local.clarify', {
  text: docs,
  question: 'How do I authenticate API requests?'
});

console.log('Answer:', result.answer);
// Output: "API requests are authenticated using Bearer tokens..."
```

---

### Pattern 3: Log Parsing

Use case: Extract structured error information from log files.

```typescript
// Read log file
const logContent = await fs.readFile('logs/error.log', 'utf-8');

// Extract errors as JSON
const result = await mcpClient.callTool('local.extract', {
  text: logContent,
  schema: '{errors: {timestamp: string, level: string, message: string}[]}'
});

console.log('Extracted Errors:', JSON.stringify(result.extracted, null, 2));
// Output: Structured JSON with parsed error entries
```

---

### Pattern 4: Batch Processing

Use case: Summarize multiple documents in sequence.

```typescript
const documents = [
  'doc1.txt',
  'doc2.txt',
  'doc3.txt'
];

const summaries = [];

for (const docPath of documents) {
  const content = await fs.readFile(docPath, 'utf-8');

  const result = await mcpClient.callTool('local.summarize', {
    text: content,
    maxLength: 150
  });

  summaries.push({
    document: docPath,
    summary: result.summary
  });
}

console.log('Batch Summaries:', summaries);
```

---

## Error Handling Examples

### Error 1: Endpoint Unreachable

**Scenario**: LocalFoundry endpoint is configured but not running.

**Error Response**:
```json
{
  "error": {
    "code": "ENDPOINT_UNREACHABLE",
    "message": "LocalFoundry endpoint unreachable at http://localhost:8080/v1/chat/completions",
    "details": "Connection refused (ECONNREFUSED)"
  }
}
```

**Resolution**:
1. Check if LocalFoundry is running
2. Verify endpoint URL in `.env` is correct
3. Check network connectivity to localhost

---

### Error 2: Request Timeout

**Scenario**: LocalFoundry takes too long to process large text.

**Error Response**:
```json
{
  "error": {
    "code": "REQUEST_TIMEOUT",
    "message": "Request timed out after 60000ms",
    "details": "Consider reducing text length or increasing LOCALFOUNDRY_TIMEOUT"
  }
}
```

**Resolution**:
1. Reduce input text length
2. Increase `LOCALFOUNDRY_TIMEOUT` in `.env`
3. Check LocalFoundry performance and resource usage

---

### Error 3: Invalid JSON Response (Extract Tool)

**Scenario**: LocalFoundry returns invalid JSON for extract tool.

**Error Response**:
```json
{
  "error": {
    "code": "INVALID_JSON",
    "message": "LocalFoundry returned invalid JSON response",
    "details": "Unexpected token in JSON at position 42"
  }
}
```

**Resolution**:
1. Simplify schema description for clearer instructions
2. Provide more explicit extraction instructions in schema
3. Check if text contains sufficient information for schema

---

### Error 4: Service Not Configured

**Scenario**: `LOCALFOUNDRY_ENDPOINT` not set in environment.

**Error Response**:
```json
{
  "error": {
    "code": "SERVICE_NOT_CONFIGURED",
    "message": "LocalFoundry service not available",
    "details": "LOCALFOUNDRY_ENDPOINT environment variable not set"
  }
}
```

**Resolution**:
1. Add `LOCALFOUNDRY_ENDPOINT` to `.env` file
2. Restart Cerebro MCP server
3. Verify configuration in dashboard at https://localhost:3333

---

## Performance Tips

### Tip 1: Optimize Text Length

- **Summarize**: Works best with 1000-10000 words
- **Clarify**: Provide focused context (500-5000 words)
- **Extract**: Keep text under 10000 words for best performance

### Tip 2: Adjust Temperature (Future Enhancement)

Currently uses default temperature (0.7). Future versions may allow per-tool temperature configuration for more/less creative outputs.

### Tip 3: Use Specific Prompts

For `local.clarify`, ask specific, focused questions rather than broad queries:
- ✅ Good: "What does the timeout parameter control?"
- ❌ Poor: "Tell me about this code"

For `local.extract`, provide clear schema descriptions:
- ✅ Good: "{attendees: string[], decisions: string[], action_items: string[]}"
- ❌ Poor: "extract information"

### Tip 4: Monitor Dashboard Status

Before running large batch operations, check dashboard to ensure LocalFoundry is available. This prevents failed requests and wasted processing time.

---

## Testing Your Integration

### Test 1: Basic Connectivity

```bash
# Test summarize tool with simple text
curl http://localhost:3334/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "local.summarize",
      "arguments": {
        "text": "Test text for summarization",
        "maxLength": 50
      }
    },
    "id": 1
  }'
```

### Test 2: Dashboard Status Check

```bash
# Open dashboard in browser
open https://localhost:3333

# Look for LocalFoundry status card
# Status should show "Available" with endpoint URL and model name
```

### Test 3: Error Handling

```bash
# Stop LocalFoundry service temporarily
# Try calling summarize tool
# Verify clear error message about endpoint unreachable
```

---

## Troubleshooting

### Issue: Tools Not Available

**Symptoms**: `local.summarize`, `local.clarify`, `local.extract` not listed in tool inventory.

**Checklist**:
- [ ] `LOCALFOUNDRY_ENDPOINT` is set in `.env`
- [ ] Cerebro MCP server was restarted after adding config
- [ ] No syntax errors in `.env` file
- [ ] Check server logs for "LocalFoundry service registered" message

---

### Issue: Dashboard Shows "Unavailable"

**Symptoms**: Dashboard status card shows red "Unavailable" state.

**Checklist**:
- [ ] LocalFoundry is running (check with `ps` or Task Manager)
- [ ] Endpoint URL is correct (check with `curl` test)
- [ ] No firewall blocking localhost connections
- [ ] LocalFoundry is listening on configured port

---

### Issue: Slow Responses

**Symptoms**: Tool calls take longer than expected (>60s timeout).

**Checklist**:
- [ ] LocalFoundry has sufficient CPU/GPU resources
- [ ] Input text is not excessively long (>50000 characters)
- [ ] Model is loaded and warmed up in LocalFoundry
- [ ] No other processes consuming LocalFoundry resources

---

## Next Steps

1. **Explore Tool Combinations**: Chain summarize → clarify for progressive document understanding
2. **Integrate with Workflows**: Use LocalFoundry tools in automated CI/CD pipelines
3. **Monitor Performance**: Track tool response times and adjust timeout as needed
4. **Provide Feedback**: Report issues or feature requests to improve LocalFoundry integration

---

## Additional Resources

- **Feature Specification**: [spec.md](./spec.md)
- **Implementation Plan**: [plan.md](./plan.md)
- **Data Model**: [data-model.md](./data-model.md)
- **API Contracts**: [contracts/](./contracts/)
- **Research Notes**: [research.md](./research.md)

---

**Quickstart Guide Complete**: 2026-01-25
