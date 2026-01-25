# Feature Specification: LocalFoundry LLM Integration

**Feature Branch**: `011-localfoundry-integration`
**Created**: 2026-01-25
**Status**: Draft
**Input**: User description: "Add Microsoft LocalFoundry integration to Cerebro MCP, providing text processing capabilities (summarize, clarify, extract) through a local LLM endpoint accessible via MCP tools. Tool naming should use 'local' prefix (e.g., local.summarize). Dashboard should show LocalFoundry availability status. No authentication required - localhost only. OpenAI-compatible Chat Completions API format. Endpoint URL configurable via environment variable."

## Overview

Integrate Microsoft LocalFoundry's local LLM capabilities into Cerebro MCP to provide AI-powered text processing tools accessible through the Model Context Protocol. This enables Claude Code users to leverage local AI models for common text operations (summarization, clarification, extraction) without requiring cloud services or authentication.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Summarize Long Text (Priority: P1)

As a developer using Claude Code, I need to quickly summarize long documents, code files, or text content so that I can understand key points without reading everything in detail.

**Why this priority**: Summarization is the most common text processing need and provides immediate value. It's a straightforward use case that demonstrates the integration works.

**Independent Test**: Can be fully tested by configuring LocalFoundry endpoint, invoking the `local.summarize` tool with a long text input, and verifying a concise summary is returned within acceptable time limits.

**Acceptance Scenarios**:

1. **Given** LocalFoundry is configured and running, **When** I invoke `local.summarize` with a 5000-word document, **Then** I receive a concise summary of 200-300 words highlighting key points
2. **Given** LocalFoundry is configured and running, **When** I invoke `local.summarize` with a 500-line code file, **Then** I receive a summary explaining what the code does in plain language
3. **Given** LocalFoundry endpoint is not running, **When** I invoke `local.summarize`, **Then** I receive a clear error message indicating the endpoint is unreachable

---

### User Story 2 - Clarify Ambiguous Content (Priority: P2)

As a developer reviewing documentation or code, I need to ask specific questions about unclear content so that I can quickly understand confusing sections without extensive research.

**Why this priority**: Clarification adds interactive value beyond basic summarization. It enables Q&A workflows which are valuable but require summarization to work first.

**Independent Test**: Can be tested by invoking `local.clarify` with text content and a specific question, then verifying the response directly answers the question based on the provided content.

**Acceptance Scenarios**:

1. **Given** LocalFoundry is running and I have technical documentation, **When** I invoke `local.clarify` with the text and question "What does this parameter control?", **Then** I receive a targeted answer explaining the parameter
2. **Given** LocalFoundry is running and I have code comments, **When** I invoke `local.clarify` with the text and question "Why is this optimization necessary?", **Then** I receive an explanation of the optimization rationale
3. **Given** the question is unrelated to the provided text, **When** I invoke `local.clarify`, **Then** I receive a response indicating the question cannot be answered from the given context

---

### User Story 3 - Extract Structured Data (Priority: P3)

As a developer working with unstructured text, I need to extract specific information in a structured format (like JSON) so that I can programmatically process the extracted data.

**Why this priority**: Extraction is more complex and serves advanced use cases. It builds on summarization/clarification capabilities and requires a working schema definition system.

**Independent Test**: Can be tested by invoking `local.extract` with text and a schema description, then verifying the response is valid JSON matching the requested schema.

**Acceptance Scenarios**:

1. **Given** LocalFoundry is running and I have meeting notes, **When** I invoke `local.extract` requesting `{attendees: string[], action_items: string[], decisions: string[]}`, **Then** I receive valid JSON with extracted information matching the schema
2. **Given** LocalFoundry is running and I have log files, **When** I invoke `local.extract` requesting `{errors: {timestamp: string, message: string}[]}`, **Then** I receive valid JSON with parsed error entries
3. **Given** the extracted content doesn't match the schema structure, **When** I invoke `local.extract`, **Then** I receive an error or partial extraction with explanation of missing fields

---

### User Story 4 - Monitor LocalFoundry Status (Priority: P2)

As a system administrator or developer, I need to see whether my LocalFoundry endpoint is available and working so that I know if text processing tools will function before attempting to use them.

**Why this priority**: Status visibility prevents frustration from failed tool calls and helps with troubleshooting. It's parallel to other tools and enhances user experience.

**Independent Test**: Can be tested by visiting the Cerebro dashboard at `localhost:3333` and verifying LocalFoundry status card displays current availability, endpoint URL, and model configuration.

**Acceptance Scenarios**:

1. **Given** LocalFoundry is configured and running, **When** I visit the Cerebro dashboard, **Then** I see LocalFoundry status card showing "Available" with endpoint URL and model name
2. **Given** LocalFoundry endpoint is configured but not reachable, **When** I visit the Cerebro dashboard, **Then** I see LocalFoundry status card showing "Unavailable" with error details
3. **Given** LocalFoundry is not configured, **When** I visit the Cerebro dashboard, **Then** I see LocalFoundry status card showing "Not configured" with setup instructions
4. **Given** LocalFoundry status is displayed, **When** I refresh the dashboard, **Then** the status updates to reflect current availability

---

### Edge Cases

- What happens when LocalFoundry endpoint is configured but returns HTTP 500 errors?
- How does the system handle extremely large text inputs (>50,000 characters)?
- What happens when LocalFoundry takes longer than 60 seconds to respond?
- How does system behave when LocalFoundry returns malformed JSON responses?
- What happens when user provides invalid schema format for extraction?
- How does system handle LocalFoundry endpoint that requires authentication (misconfiguration)?
- What happens when LocalFoundry model doesn't support the requested operation?
- How does system behave when network connection is intermittent during request?

## Requirements *(mandatory)*

### Functional Requirements

#### Service Integration

- **FR-001**: System MUST register LocalFoundry as a service named "local" for tool namespacing
- **FR-002**: System MUST configure LocalFoundry integration via environment variables without requiring code changes
- **FR-003**: System MUST support OpenAI-compatible Chat Completions API format (`/v1/chat/completions` endpoint)
- **FR-004**: System MUST operate without authentication when connecting to LocalFoundry endpoint
- **FR-005**: System MUST start successfully even when LocalFoundry endpoint is unreachable or not configured

#### Tool Implementation

- **FR-006**: System MUST provide a `local.summarize` tool that accepts text input and returns concise summaries
- **FR-007**: System MUST provide a `local.clarify` tool that accepts text and a question, returning targeted answers
- **FR-008**: System MUST provide a `local.extract` tool that accepts text and schema description, returning structured JSON
- **FR-009**: All tools MUST use the `local.*` namespace prefix (not `localfoundry.*`)
- **FR-010**: Tools MUST validate input parameters and reject invalid requests with clear error messages
- **FR-011**: Tools MUST timeout after 60 seconds (configurable) and return error if LocalFoundry doesn't respond

#### Dashboard Integration

- **FR-012**: System MUST display LocalFoundry status card on the OAuth dashboard at port 3333
- **FR-013**: Status card MUST show current availability state (Available, Unavailable, Not Configured, Error)
- **FR-014**: Status card MUST display configured endpoint URL when available
- **FR-015**: Status card MUST display configured model name when available
- **FR-016**: Status card MUST NOT display an "Authenticate" button (no OAuth required)
- **FR-017**: Status card MUST check endpoint availability by attempting connection, not just checking configuration

#### Error Handling

- **FR-018**: System MUST provide clear error messages when LocalFoundry endpoint is unreachable
- **FR-019**: System MUST distinguish between endpoint unavailable, timeout, and invalid response errors
- **FR-020**: System MUST gracefully handle malformed responses from LocalFoundry
- **FR-021**: System MUST validate extraction tool JSON responses and handle parse errors
- **FR-022**: System MUST continue serving other MCP services even when LocalFoundry is unavailable

#### Configuration

- **FR-023**: System MUST support configurable endpoint URL via `LOCALFOUNDRY_ENDPOINT` environment variable
- **FR-024**: System MUST support configurable model name via `LOCALFOUNDRY_MODEL` environment variable (default: phi-4)
- **FR-025**: System MUST support configurable timeout via `LOCALFOUNDRY_TIMEOUT` environment variable (default: 60000ms)
- **FR-026**: System MUST document all configuration options in `.env.example` file

### Key Entities

- **LocalFoundry Service**: Represents the LocalFoundry integration service implementing the BaseService interface with name "local", handling service lifecycle, tool registration, and availability checking
- **Chat Completion Request**: Structured request containing model name, message array (system/user roles), and optional parameters (temperature, max_tokens) sent to LocalFoundry endpoint
- **Chat Completion Response**: Structured response from LocalFoundry containing choices array with generated message content
- **Tool Input**: Parameters for each tool including required text field and tool-specific fields (maxLength for summarize, question for clarify, schema for extract)
- **Service Status**: Dashboard representation showing service availability state, endpoint configuration, model info, and health check results

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can successfully summarize a 5000-word document in under 10 seconds (excluding LocalFoundry processing time)
- **SC-002**: Users can ask clarification questions and receive targeted answers within 15 seconds
- **SC-003**: Users can extract structured data matching requested schema with 95% success rate for well-formed inputs
- **SC-004**: Dashboard status accurately reflects LocalFoundry availability within 5 seconds of status change
- **SC-005**: All three tools (`local.summarize`, `local.clarify`, `local.extract`) are discoverable via MCP tool listing
- **SC-006**: System maintains 99% uptime for other services even when LocalFoundry is unavailable
- **SC-007**: 90% of tool invocations complete successfully when LocalFoundry is available
- **SC-008**: Error messages enable users to diagnose configuration issues within 2 minutes
- **SC-009**: Zero authentication failures related to LocalFoundry integration (since no auth is used)
- **SC-010**: Dashboard loads and displays LocalFoundry status within 3 seconds

## Assumptions

- LocalFoundry endpoint is running on the same machine as Cerebro MCP (localhost)
- LocalFoundry uses standard OpenAI-compatible API format
- LocalFoundry model supports general text understanding and generation tasks
- Users have basic knowledge of configuring environment variables
- LocalFoundry processing time is reasonable (under 60 seconds for typical requests)
- Dashboard is accessed via modern web browser supporting HTML5/CSS3
- Users understand that text processing quality depends on the underlying LocalFoundry model
- Network latency to localhost endpoint is negligible (under 10ms)

## Dependencies

- LocalFoundry must be installed and running on localhost
- LocalFoundry must expose an HTTP endpoint compatible with OpenAI Chat Completions API format
- Environment variables must be configurable via `.env` file
- Existing Cerebro MCP service registration infrastructure must support non-OAuth services
- OAuth dashboard must support status cards for non-authenticated services

## Scope

### In Scope

- Integration with LocalFoundry via OpenAI-compatible Chat Completions API
- Three core tools: summarize, clarify, extract
- Dashboard status indicator showing availability
- Environment-based configuration
- Error handling for endpoint unavailability
- Tool timeout configuration
- Basic input validation

### Out of Scope

- Streaming responses from LocalFoundry (future enhancement)
- Multiple model selection (uses single configured model)
- Conversation history management across tool invocations
- Fine-tuning or training LocalFoundry models
- Authentication to LocalFoundry endpoint
- Cloud-based Azure AI Foundry endpoints
- Custom prompt template configuration per user
- Rate limiting or usage quotas
- Caching of LocalFoundry responses
- Batch processing of multiple texts
- Integration with other local LLM providers (Ollama, LM Studio, etc.)

## Non-Functional Requirements

### Performance

- Tool response time should be under 15 seconds total (including LocalFoundry processing)
- Dashboard status check should complete within 5 seconds
- System should handle concurrent tool requests from multiple users
- Memory usage should remain stable with repeated tool invocations

### Reliability

- System must gracefully degrade when LocalFoundry is unavailable
- Failed requests must not crash the MCP server
- Timeout must reliably cancel long-running requests
- Error states must be recoverable without server restart

### Usability

- Error messages must clearly indicate cause (endpoint down, timeout, invalid input, etc.)
- Configuration via environment variables must be documented
- Dashboard status must update without requiring page refresh
- Tool names must follow consistent naming convention with other services

### Maintainability

- Code must follow existing Cerebro MCP service patterns (BaseService, BaseAPIClient)
- Configuration must be centralized in environment variables
- Logging must use structured format consistent with other services
- Tests must cover error cases and edge conditions
