# Implementation Plan: Project Foundation & Base Architecture

**Branch**: `001-project-foundation` | **Date**: 2026-01-15 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-001-project-foundation/spec.md`

## Summary

Set up TypeScript project foundation with base architecture for the Cerebro MCP TypeScript server. This includes TypeScript strict mode configuration, core interfaces and abstract base classes (BaseAPIClient, BaseTokenStorage, BaseService), testing infrastructure with mock mode support, structured logging, configuration management via environment variables, and code quality tooling (ESLint, Prettier, pre-commit hooks).

Technical approach: Mirror the Python reference project's architecture in TypeScript with strong typing throughout, implementing the same modular service pattern but with strict TypeScript interfaces and generic type parameters for reusability and type safety.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 18+ (LTS)
**Primary Dependencies**: @modelcontextprotocol/sdk, pino (logging), dotenv (env vars)
**Storage**: File system (JSON token storage in `~/.cerebro-tokens/`)
**Testing**: Jest with TypeScript support, ts-jest
**Target Platform**: Node.js CLI/server (Linux, macOS, Windows compatible)
**Project Type**: Single CLI/server project with modular service architecture
**Performance Goals**: Server startup < 5 seconds, test suite < 10 seconds with mock mode
**Constraints**: Strict TypeScript (no `any`), 80%+ test coverage, zero linter errors
**Scale/Scope**: Multi-service MCP server supporting 2+ OAuth services (Microsoft, Slack) with extensibility for more

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

✅ **I. TypeScript-First Development**: Using TypeScript 5.x with strict mode, all interfaces defined before implementation
✅ **II. Skyscanner Production Standards**: Will comply with code quality, security, testing, and observability standards
✅ **III. Test-First Development (NON-NEGOTIABLE)**: Jest configured with mock mode support, TDD cycle enforced
✅ **IV. Modular Service Architecture**: Base abstractions designed for service isolation and extensibility
✅ **V. OAuth & Security Standards**: Token storage with encryption, environment-based secrets
✅ **VIII. Observability & Debugging**: Structured logging with pino, correlation IDs planned
✅ **IX. Configuration Management**: Environment variables with validation, .env.example provided
✅ **X. Documentation Standards**: TSDoc for all public APIs, README per component

**Compliance**: All constitutional principles satisfied for this foundation phase.

## Project Structure

### Documentation (this feature)

```text
specs/001-001-project-foundation/
├── plan.md              # This file
├── spec.md              # Feature specification
└── tasks.md             # Generated after implementation plan approval
```

### Source Code (repository root)

```text
src/
├── types/               # TypeScript interfaces and types
│   ├── tool.ts         # Tool, ToolHandler interfaces
│   ├── service.ts      # ServiceConfig, BaseService interface
│   ├── api.ts          # APIResponse<T>, APIError types
│   ├── token.ts        # TokenData, OAuth types
│   └── index.ts        # Barrel export
│
├── common/              # Shared base classes and utilities
│   ├── base-api-client.ts       # BaseAPIClient<T> abstract class
│   ├── base-token-storage.ts    # BaseTokenStorage abstract class
│   ├── base-service.ts          # BaseService abstract class
│   ├── logger.ts                # Structured logging setup (pino)
│   ├── config.ts                # Global config with validation
│   └── index.ts                 # Barrel export
│
├── utils/               # Helper functions
│   ├── file-utils.ts   # File operations (token storage, permissions)
│   ├── validation.ts   # Environment variable validation
│   └── index.ts        # Barrel export
│
└── index.ts             # Main entry point (placeholder for future MCP server)

tests/
├── unit/                # Unit tests for individual components
│   ├── common/
│   │   ├── base-api-client.test.ts
│   │   ├── base-token-storage.test.ts
│   │   └── logger.test.ts
│   └── utils/
│       ├── file-utils.test.ts
│       └── validation.test.ts
│
├── integration/         # Integration tests
│   └── mock-service.test.ts  # Test with demo service implementation
│
└── fixtures/            # Test fixtures and mock data
    └── mock-tokens.json

.github/                 # GitHub configuration (future)
├── workflows/           # CI/CD pipelines (future)
└── CODEOWNERS          # Code ownership (future)

.husky/                  # Git hooks
└── pre-commit          # Lint and format checks

.vscode/                 # VS Code settings (optional)
└── settings.json       # TypeScript and ESLint config

# Root configuration files
├── package.json         # Dependencies and scripts
├── tsconfig.json        # TypeScript strict mode config
├── tsconfig.build.json  # Build-specific TypeScript config
├── jest.config.js       # Jest configuration
├── .eslintrc.js         # ESLint rules (TypeScript)
├── .prettierrc          # Prettier formatting
├── .env.example         # Example environment variables
├── .gitignore           # Git ignore patterns
└── README.md            # Project documentation
```

**Structure Decision**: Single project structure chosen as this is a Node.js CLI/server application. The modular architecture is achieved through clear separation in `src/types/`, `src/common/`, and future `src/services/` directory. This matches the Python reference architecture but with TypeScript's stronger typing system.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations detected. All constitutional requirements are met for this foundation phase.
