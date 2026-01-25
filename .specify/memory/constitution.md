# Cerebro MCP Constitution

## Core Principles

### I. Documentation-First
Every feature implementation MUST include comprehensive documentation updates:
- **README Updates**: New features must be documented in the main README with usage examples
- **API Documentation**: All tools and endpoints must have clear input/output schemas documented
- **Configuration Documentation**: Environment variables and configuration options must be added to .env.example with descriptions
- **Integration Guides**: Complex features must include quickstart guides showing common use cases
- **Breaking Changes**: Any breaking changes must be prominently documented with migration paths

### II. Service Architecture
Follow established patterns for consistency:
- **BaseService Interface**: All services implement BaseService with initialize(), getTools(), isAuthenticated(), shutdown()
- **Configuration via Environment**: All service configuration through environment variables, never hardcoded
- **Structured Logging**: Use pino logger with structured data (operation, service, context fields)
- **Error Handling**: Clear error messages distinguishing between network, timeout, validation, and API errors
- **Type Safety**: TypeScript strict mode with no `any` types except where absolutely necessary

### III. Testing Standards
Quality gates for production readiness:
- **Unit Tests**: Test individual components (services, clients, handlers) in isolation with mocks
- **Integration Tests**: Test end-to-end flows with real service interactions where possible
- **Coverage**: Maintain 80% code coverage threshold (configured in jest.config.js)
- **Error Path Testing**: Test failure scenarios (timeouts, network errors, invalid input)
- **Type Validation**: Test input validation and schema compliance

### IV. MCP Tool Design
Tools are the primary user interface:
- **Tool Naming**: Use service namespace prefix (e.g., `microsoft.send-email`, `local.summarize`)
- **Input Schemas**: JSON Schema validation with clear descriptions and examples
- **Error Messages**: User-friendly error messages that guide troubleshooting
- **Timeouts**: Configurable timeouts with reasonable defaults (60s for LLM operations)
- **Independence**: Each tool should be independently testable and documentable

### V. Dashboard Integration
OAuth dashboard provides service visibility:
- **Status Cards**: All services display status card showing availability and configuration
- **State Indicators**: Clear visual indicators (Connected, Available, Unavailable, Error)
- **Configuration Display**: Show relevant config (endpoint URLs, model names) without exposing secrets
- **No Auth Services**: Services without OAuth should not show authentication buttons
- **Real Health Checks**: Status reflects actual connectivity, not just configuration presence

## Development Workflow

### Feature Implementation Process
1. **Specification**: Create feature spec with user stories, requirements, success criteria
2. **Planning**: Generate implementation plan with tech stack, architecture, file structure
3. **Research**: Document technical decisions and alternatives considered
4. **Design**: Define data models, API contracts, integration patterns
5. **Implementation**: Build feature following established patterns
6. **Documentation**: Update README, configuration examples, API docs
7. **Testing**: Write comprehensive unit and integration tests
8. **Validation**: Verify TypeScript compilation, linting, coverage thresholds

### Code Quality Gates
- **TypeScript Compilation**: Zero type errors required
- **ESLint**: All code must pass linting with project rules
- **Prettier**: Consistent code formatting enforced
- **Test Coverage**: 80% minimum coverage for new code
- **Build Success**: Clean build output in dist/ directory

### Documentation Requirements (MANDATORY)
For every feature implementation:
- **README**: Add feature description, configuration instructions, and usage examples
- **.env.example**: Document all new environment variables with descriptions and example values
- **Inline Documentation**: JSDoc comments on all public interfaces and complex logic
- **Quickstart Guide**: For complex features, provide quickstart.md with step-by-step integration
- **Breaking Changes**: Clearly document any changes that affect existing functionality

## Security & Privacy

### Credentials Management
- **No Hardcoded Secrets**: All credentials via environment variables
- **Token Storage**: OAuth tokens stored securely in .tokens/ directory (gitignored)
- **Localhost Only**: Local services (like LocalFoundry) should only accept localhost connections
- **No Logging Secrets**: Never log tokens, API keys, or sensitive data

### Error Handling
- **User-Safe Error Messages**: Don't expose internal paths, stack traces, or sensitive data to users
- **Structured Error Logging**: Log errors with operation context for debugging
- **Graceful Degradation**: Services should fail gracefully without crashing the server
- **Clear Error Categories**: Distinguish network, authentication, validation, and timeout errors

## Governance

### Constitution Authority
- This constitution supersedes informal practices and conventions
- All feature implementations must comply with documented principles
- Amendments require rationale and should be documented in git history
- Use .specify/ workflow tools for consistent feature development

### Quality Enforcement
- All PRs must verify compliance with constitution principles
- Code reviews must check for documentation completeness
- Complexity must be justified - prefer simple solutions
- Automated checks (linting, type checking, tests) are non-negotiable gates

**Version**: 1.0.0 | **Ratified**: 2026-01-25 | **Last Amended**: 2026-01-25
