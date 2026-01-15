# Cerebro MCP TypeScript Constitution

A TypeScript implementation of the Cerebro MCP multi-service server, providing Model Context Protocol integration with Microsoft 365, Slack, and extensible service architecture.

## Core Principles

### I. TypeScript-First Development
- **Strong typing throughout**: All code must use TypeScript with strict mode enabled
- **No implicit any**: All types must be explicitly defined
- **Interface-driven design**: Define interfaces before implementation
- **Type safety at boundaries**: API responses, tool handlers, and service integrations must have explicit types
- **Generic type parameters**: Use generics for reusable components (API clients, token storage, etc.)

### II. Skyscanner Production Standards Compliance
- **All code must meet Skyscanner production standards** across applicable domains:
  - Code Quality and Style (TypeScript/JavaScript standards)
  - API design (RESTful APIs, error handling, versioning)
  - Security and Privacy (authentication, token storage, secrets management)
  - Observability (logging, monitoring, error tracking)
  - Build, Test and Deploy (CI/CD pipelines, testing requirements)
  - Operational Maturity (service reliability, documentation)
- **Reference standards explicitly**: When implementing features, cite relevant production standards
- **Standards validation**: All PRs must demonstrate compliance with applicable standards

### III. Test-First Development (NON-NEGOTIABLE)
- **TDD mandatory**: Tests written → User approved → Tests fail → Implementation → Tests pass
- **Red-Green-Refactor**: Strictly enforced cycle
- **Coverage requirements**:
  - Unit tests: All business logic, utilities, and helpers
  - Integration tests: API clients, OAuth flows, MCP protocol handlers
  - E2E tests: Complete tool execution flows
- **Test modes**: Support mock/test mode for all external services (Microsoft Graph, Slack API)
- **No implementation without tests**: Code without tests will not be merged

### IV. Modular Service Architecture
- **Service isolation**: Each service (Microsoft, Slack, future services) must be independently:
  - Loadable/unloadable
  - Testable in isolation
  - Documented with clear APIs
  - Versioned independently
- **Base abstractions**: Common functionality extracted to reusable base classes:
  - `BaseAPIClient<T>` for API interactions
  - `BaseTokenStorage` for OAuth token management
  - `BaseService` for service lifecycle
- **Tool namespacing**: All tools automatically namespaced by service (e.g., `microsoft.list-emails`)
- **Dynamic service loading**: Services discovered and loaded at runtime

### V. OAuth & Security Standards
- **Unified authentication server**: Single OAuth server handles all service authentications
- **Secure token storage**: Tokens encrypted at rest in user's home directory
- **Token lifecycle management**: Automatic refresh with expiry buffer (5 minutes)
- **HTTPS enforcement**: Production mode requires HTTPS for OAuth callbacks
- **Secrets management**: No credentials in code; environment variables only
- **Scopes principle of least privilege**: Request minimal OAuth scopes needed

### VI. API Client Patterns
- **Pagination handling**: Automatic following of `@odata.nextLink` or service-specific pagination
- **Error handling**: Typed errors with context (HTTP status, service name, operation)
- **Rate limiting awareness**: Implement backoff strategies for rate-limited APIs
- **Request retry logic**: Automatic retry with exponential backoff for transient failures
- **Timeout configuration**: Configurable request timeouts per service
- **Mock mode support**: All API clients support test/mock mode for CI/CD

### VII. MCP Protocol Compliance
- **Protocol adherence**: Strict compliance with MCP specification
- **Tool schemas**: All tools define JSON schemas for input validation
- **Error responses**: Standard MCP error format for all failures
- **Capability negotiation**: Proper server capabilities announcement
- **Request handlers**: Implement all required MCP protocol methods
- **Tool discovery**: Dynamic tool listing based on loaded services

### VIII. Observability & Debugging
- **Structured logging**: Use structured logger (e.g., pino, winston) with levels: debug, info, warn, error
- **Request tracing**: Log all API requests with correlation IDs
- **Tool execution tracking**: Log tool invocations with input/output/duration
- **Error context**: All errors include service name, operation, and relevant context
- **Debug mode**: Environment flag for verbose logging
- **Performance metrics**: Track and log API response times, token refresh times

### IX. Configuration Management
- **Environment-based**: All configuration via environment variables
- **Service-specific config**: Each service has isolated configuration
- **Sensible defaults**: Provide defaults where possible (e.g., auth server port 3333)
- **Validation on startup**: Validate all required configuration before server starts
- **Configuration schema**: TypeScript interfaces for all config objects
- **No hardcoded values**: URLs, ports, paths must be configurable

### X. Documentation Standards
- **README per service**: Each service has comprehensive README with:
  - Purpose and features
  - Setup instructions (OAuth app registration, scopes)
  - Available tools and examples
  - Configuration requirements
- **API documentation**: All public APIs documented with TSDoc
- **Tool documentation**: Each tool includes description, parameters, examples
- **Architecture docs**: Maintain docs/architecture.md with system design
- **CHANGELOG**: Track all changes following Keep a Changelog format

## Skyscanner Production Standards Integration

### Code Quality & Style
- **ESLint configuration**: Use Skyscanner's TypeScript ESLint rules
- **Prettier formatting**: Consistent code formatting across project
- **Import organization**: Structured import order (external, internal, relative)
- **Naming conventions**:
  - PascalCase for classes and interfaces
  - camelCase for functions and variables
  - UPPER_SNAKE_CASE for constants
  - kebab-case for file names

### Security & Privacy
- **Dependency scanning**: Automated vulnerability scanning in CI/CD
- **SAST tools**: Static analysis security testing (e.g., SonarQube)
- **No secrets in code**: Use environment variables + secrets management
- **Token encryption**: Encrypt sensitive data at rest
- **Input validation**: Validate and sanitize all external inputs
- **OAuth best practices**: Follow OAuth 2.0 security best current practices

### Build, Test & Deploy
- **CI/CD pipeline**: Automated builds, tests, and deployments
- **Test stages**: Unit → Integration → E2E
- **Build artifacts**: Generate distributable artifacts (npm package, Docker image)
- **Semantic versioning**: Follow semver for releases
- **Automated releases**: Use conventional commits + semantic-release

### Observability
- **Structured logging**: JSON-formatted logs with standard fields
- **Log levels**: Appropriate use of debug/info/warn/error levels
- **Correlation IDs**: Track requests across service boundaries
- **Health checks**: Implement /health endpoint for monitoring
- **Metrics**: Expose service metrics (tool invocations, API latency, errors)

### API Design
- **RESTful patterns**: Follow REST principles where applicable
- **Error handling**: Consistent error response format
- **Versioning strategy**: API version in URL or headers
- **Rate limiting**: Handle and communicate rate limits
- **Idempotency**: POST operations should be idempotent where possible

## TypeScript Migration Strategy

### Phase 1: Foundation
1. Set up TypeScript project structure with strict mode
2. Define core interfaces (Tool, Service, APIClient, TokenStorage)
3. Implement base classes with proper typing
4. Set up testing framework (Jest/Vitest) with TypeScript support
5. Configure ESLint, Prettier, and pre-commit hooks

### Phase 2: Core Services
1. Implement unified auth server with type safety
2. Migrate Microsoft 365 service:
   - Type Microsoft Graph API responses
   - Implement email, calendar, folder, rules tools
   - Add comprehensive tests
3. Migrate Slack service:
   - Type Slack API responses
   - Implement channels, threads, canvases tools
   - Add comprehensive tests

### Phase 3: MCP Server
1. Implement MCP protocol handlers with types
2. Dynamic service loading and tool registration
3. Tool namespacing and routing
4. Complete E2E tests

### Phase 4: Production Readiness
1. Documentation (README, API docs, architecture)
2. CI/CD pipeline setup
3. Observability integration (logging, metrics)
4. Security scanning and hardening
5. Performance testing and optimization

## Development Workflow

### Feature Development
1. **Spec first**: Create feature spec in `specs/XXX-feature-name/spec.md`
2. **Plan approval**: Create implementation plan, get approval
3. **Tests first**: Write failing tests
4. **Implementation**: Implement to make tests pass
5. **Standards check**: Verify Skyscanner production standards compliance
6. **Documentation**: Update relevant docs
7. **Review**: PR review checks tests, types, standards, docs

### Tool Addition
1. Define tool schema (name, description, inputSchema)
2. Create handler type signature
3. Write unit tests for handler
4. Implement handler
5. Add integration test with mock API
6. Update service index to export tool
7. Document in service README

### Service Addition
1. Create service directory structure
2. Implement service-specific config
3. Implement API client extending BaseAPIClient
4. Implement token storage extending BaseTokenStorage
5. Implement OAuth flow
6. Create tools with handlers
7. Add comprehensive tests
8. Document in service README
9. Register service in main index

## Quality Gates

### Pre-commit
- ESLint passes (no errors)
- Prettier formatting applied
- TypeScript compilation successful (no errors, no warnings with strict mode)

### Pre-PR
- All tests pass (unit + integration)
- Code coverage > 80%
- No security vulnerabilities (npm audit)
- Documentation updated

### PR Review Checklist
- [ ] TypeScript strict mode compliance
- [ ] All types explicitly defined (no `any`)
- [ ] Tests written and passing
- [ ] Skyscanner production standards verified
- [ ] Error handling appropriate
- [ ] Logging added for key operations
- [ ] Documentation updated
- [ ] No secrets or credentials in code
- [ ] Security implications considered

## Technology Stack

### Core Dependencies
- **Runtime**: Node.js 18+ (LTS)
- **Language**: TypeScript 5.x (strict mode)
- **MCP**: @modelcontextprotocol/sdk
- **HTTP**: Built-in Node.js https/http modules
- **Testing**: Jest or Vitest with TypeScript support
- **Logging**: pino (structured logging)
- **Linting**: ESLint with TypeScript plugin
- **Formatting**: Prettier

### Development Dependencies
- **Type Checking**: tsc with strict mode
- **Testing**: @types/jest or @types/vitest
- **Security**: npm audit, Snyk
- **Git Hooks**: husky + lint-staged

## Governance

### Constitution Authority
- This constitution supersedes all other practices and guidelines
- All code, PRs, and reviews must verify compliance
- Complexity or deviations must be explicitly justified and approved
- When production standards conflict with project needs, document the exception

### Amendment Process
1. Propose amendment with rationale
2. Document impact on existing code
3. Team approval required
4. Update version and last amended date
5. Create migration plan if needed

### Enforcement
- CI/CD pipeline enforces quality gates
- PR reviews verify standards compliance
- Regular audits of codebase against standards
- Team retrospectives to refine processes

### References
- **Production Standards**: /tmp/production-standards/docs/standards/
- **SpecKit Templates**: .specify/templates/
- **Original Python Project**: ~/code/cerebro-mcp
- **MCP Specification**: https://spec.modelcontextprotocol.io/

---

**Version**: 1.0.0
**Ratified**: 2026-01-15
**Last Amended**: 2026-01-15
