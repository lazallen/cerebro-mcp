# Testing Guide

This document describes the testing setup, conventions, and best practices for the Cerebro MCP project.

## Overview

The project uses **Jest** as the testing framework with TypeScript support. Tests are co-located with source code in `__tests__` directories and follow a consistent naming convention.

## Test Structure

```
src/
├── common/
│   └── __tests__/
│       └── config.test.ts
├── mcp-server/
│   └── __tests__/
│       ├── error-mapper.test.ts
│       ├── mcp-server.test.ts
│       └── service-registration.test.ts
└── services/
    ├── microsoft/
    │   └── __tests__/
    │       └── microsoft-service.test.ts
    └── slack/
        └── __tests__/
            └── slack-service.test.ts
```

## Running Tests

### All Tests
```bash
npm test
```

### Watch Mode (Re-run on file changes)
```bash
npm test:watch
```

### Coverage Report
```bash
npm test:coverage
```

### Specific Test File
```bash
npm test -- src/mcp-server/__tests__/error-mapper.test.ts
```

### Tests Matching Pattern
```bash
npm test -- --testNamePattern="should map MCPError"
```

### Specific Test Suite
```bash
npm test -- error-mapper
```

## Coverage Requirements

The project enforces the following coverage thresholds:

- **Statements**: 80%
- **Branches**: 80%
- **Functions**: 80%
- **Lines**: 80%

These are configured in `jest.config.js` and are verified on every test run.

## Test Categories

### Unit Tests (40 tests)

#### 1. Error Mapper Tests (16 tests)
**File**: `src/mcp-server/__tests__/error-mapper.test.ts`

Tests the error mapping system that converts internal errors to JSON-RPC format errors. Covers:
- MCPError base class mapping
- Tool-specific error types (ToolNotFoundError, ToolValidationError, ToolTimeoutError)
- Service errors (ServiceNotFoundError, AuthenticationRequiredError)
- Generic error handling
- Correlation ID propagation

**Key Scenarios**:
- Error code mapping correctness
- Message formatting
- Data payload attachment
- Non-Error object handling

#### 2. Service Registration Tests (10 tests)
**File**: `src/mcp-server/__tests__/service-registration.test.ts`

Tests the service registration logic for conditional service setup based on environment variables. Covers:
- Microsoft 365 credential validation
- Slack credential validation
- Service registration flow
- Multi-service scenarios

**Key Scenarios**:
- Checking for required credentials
- Registering services when credentials exist
- Skipping services with missing credentials
- Handling multiple services simultaneously

#### 3. MCP Server Tests (6 tests)
**File**: `src/mcp-server/__tests__/mcp-server.test.ts`

Tests the main MCP server initialization and integration with the service registry. Covers:
- Server instantiation
- Registry integration
- Tool handling flow
- Service management capabilities

**Key Scenarios**:
- Server creation without errors
- Registry availability
- Tool execution pipeline

#### 4. Config Tests (8 tests)
**File**: `src/common/__tests__/config.test.ts`

Tests configuration loading and validation of environment variables. Covers:
- Required environment variable validation
- Default value application
- Environment variable reading
- Case sensitivity handling

**Key Scenarios**:
- Detecting missing required variables
- Applying sensible defaults
- Environment variable overrides
- Comprehensive error messages

## Writing Tests

### Test File Naming
- Use `*.test.ts` extension
- Place in `__tests__` directory next to the module being tested
- Name matches the module: `foo.ts` → `__tests__/foo.test.ts`

### Test Structure
```typescript
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { MyFunction } from '../my-module';

describe('MyFunction', () => {
  describe('when given valid input', () => {
    it('should return expected result', () => {
      const result = MyFunction('valid-input');
      expect(result).toBe('expected');
    });
  });

  describe('when given invalid input', () => {
    it('should throw an error', () => {
      expect(() => MyFunction('invalid')).toThrow();
    });
  });
});
```

### Best Practices

1. **Use descriptive test names**: 
   - ✅ `it('should return false when credentials are missing')`
   - ❌ `it('works')`

2. **Organize with describe blocks**: Group related tests logically

3. **Setup and cleanup with beforeEach/afterEach**:
   ```typescript
   beforeEach(() => {
     process.env.MY_VAR = 'test-value';
   });

   afterEach(() => {
     delete process.env.MY_VAR;
   });
   ```

4. **Use mocks for external dependencies**:
   ```typescript
   const mockRegistry = {
     register: jest.fn(),
     get: jest.fn(),
   } as unknown as ServiceRegistry;
   ```

5. **Test one thing per test**: Keep tests focused and independent

6. **Use type-safe mocks**: Cast mocks as `any` or proper type to avoid TypeScript errors

## Mocking

### Mocking Functions
```typescript
const mockFn = jest.fn();
const mockFnWithReturn = jest.fn().mockReturnValue('value');
const mockFnWithPromise = jest.fn().mockResolvedValue({ data: 'result' });
```

### Mocking Environment Variables
```typescript
beforeEach(() => {
  process.env.MY_VAR = 'test-value';
});

afterEach(() => {
  delete process.env.MY_VAR;
});
```

### Spying on Methods
```typescript
jest.spyOn(obj, 'method').mockReturnValue('mocked');
```

## Debugging Tests

### Run Single Test File
```bash
npm test -- error-mapper.test.ts
```

### Run with Verbose Output
```bash
npm test -- --verbose
```

### Debug in VSCode
Add to `.vscode/launch.json`:
```json
{
  "type": "node",
  "request": "launch",
  "name": "Jest Debug",
  "program": "${workspaceFolder}/node_modules/.bin/jest",
  "args": ["--runInBand"],
  "console": "integratedTerminal"
}
```

## CI/CD Integration

Tests run automatically on:
- Every commit (via Husky pre-commit hook)
- Pull requests
- Before build

Ensure all tests pass before pushing:
```bash
npm test && npm run lint
```

## Common Issues

### Tests Timing Out
If tests take longer than 10 seconds:
```typescript
jest.setTimeout(20000); // In test file
```

### Module Not Found
Ensure imports use correct relative paths (no path aliases in tests).

### Type Errors in Tests
Use `as unknown as TypeName` to cast mocks:
```typescript
const mockRegistry = {
  // ...
} as unknown as ServiceRegistry;
```

## Coverage

### Viewing Coverage Report
```bash
npm test:coverage
open coverage/lcov-report/index.html
```

### Improving Coverage
1. Identify untested lines: `coverage/lcov-report/index.html`
2. Write tests for those code paths
3. Re-run coverage to verify

## Future Testing

Plans for expanded test coverage:
- Integration tests for end-to-end flows
- Performance benchmarks
- Load testing for concurrent operations
- E2E tests with real OAuth flows (in test environment)
