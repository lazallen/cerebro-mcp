/**
 * Error Mapper Tests
 *
 * Tests for error mapping to JSON-RPC format
 */

import { describe, it, expect } from '@jest/globals';
import {
  mapErrorToJSONRPC,
  MCPError,
  ToolNotFoundError,
  ToolValidationError,
  ToolExecutionError,
  AuthenticationRequiredError,
  ToolTimeoutError,
  ServiceNotFoundError,
} from '../error-mapper';

describe('Error Mapper', () => {
  describe('mapErrorToJSONRPC', () => {
    it('should map MCPError to JSON-RPC error', () => {
      const error = new MCPError('Test error', -32000, 'mcp-server', 'test_operation');
      const result = mapErrorToJSONRPC(error);

      expect(result.code).toBe(-32000);
      expect(result.message).toContain('Test error');
    });

    it('should map ToolNotFoundError', () => {
      const error = new ToolNotFoundError('test_tool', ['tool1', 'tool2']);
      const result = mapErrorToJSONRPC(error);

      expect(result.code).toBe(-32000);
      expect(result.message).toContain('Tool');
      expect(result.message).toContain('test_tool');
    });

    it('should map ToolValidationError', () => {
      const error = new ToolValidationError('test_tool', { message: 'Invalid parameter' });
      const result = mapErrorToJSONRPC(error);

      expect(result.code).toBe(-32001);
      expect(result.message).toContain('validation');
    });

    it('should map ToolExecutionError', () => {
      const error = new ToolExecutionError('test_tool', new Error('Execution failed'), 'exec_error');
      const result = mapErrorToJSONRPC(error);

      expect(result.code).toBe(-32002);
      expect(result.message).toContain('Execution');
    });

    it('should map AuthenticationRequiredError', () => {
      const error = new AuthenticationRequiredError('microsoft', 'OAuth token required');
      const result = mapErrorToJSONRPC(error);

      expect(result.code).toBe(-32003);
      expect(result.message).toContain('Authentication');
    });

    it('should map ToolTimeoutError', () => {
      const error = new ToolTimeoutError('test_tool', 5000);
      const result = mapErrorToJSONRPC(error);

      expect(result.code).toBe(-32004);
      expect(result.message).toContain('timed out');
    });

    it('should map ServiceNotFoundError', () => {
      const error = new ServiceNotFoundError('unknown_service', ['service1', 'service2']);
      const result = mapErrorToJSONRPC(error);

      expect(result.code).toBe(-32005);
      expect(result.message).toContain('Service');
    });

    it('should map generic Error objects', () => {
      const error = new Error('Generic error');
      const result = mapErrorToJSONRPC(error);

      expect(result.code).toBe(-32603);
      expect(result.message).toBeDefined();
    });

    it('should map non-Error objects', () => {
      const result = mapErrorToJSONRPC('string error');

      expect(result.code).toBe(-32603);
      expect(result.message).toBeDefined();
    });

    it('should include correlation ID if provided', () => {
      const error = new MCPError('Test error', -32000, 'mcp-server', 'test_op');
      const correlationId = 'test-correlation-123';
      const result = mapErrorToJSONRPC(error, correlationId);

      expect(result.data).toBeDefined();
    });
  });

  describe('Custom Error Classes', () => {
    describe('MCPError', () => {
      it('should create error with code', () => {
        const error = new MCPError('Test message', -32000, 'mcp-server', 'test_op');
        expect(error.message).toBe('Test message');
      });
    });

    describe('ToolNotFoundError', () => {
      it('should include tool name in message', () => {
        const error = new ToolNotFoundError('my_tool', ['other_tool']);
        expect(error.message).toContain('my_tool');
      });
    });

    describe('ToolValidationError', () => {
      it('should include tool name and details', () => {
        const error = new ToolValidationError('my_tool', { missing: 'param1' });
        expect(error.message).toContain('my_tool');
        expect(error.message).toContain('validation');
      });
    });

    describe('AuthenticationRequiredError', () => {
      it('should include service name', () => {
        const error = new AuthenticationRequiredError('slack', 'Token expired');
        expect(error.message).toContain('slack');
      });
    });

    describe('ToolTimeoutError', () => {
      it('should include tool name and timeout duration', () => {
        const error = new ToolTimeoutError('slow_tool', 30000);
        expect(error.message).toContain('slow_tool');
        expect(error.message).toContain('30000');
      });
    });

    describe('ServiceNotFoundError', () => {
      it('should include service name', () => {
        const error = new ServiceNotFoundError('unknown_service', ['service1', 'service2']);
        expect(error.message).toContain('unknown_service');
      });
    });
  });
});
