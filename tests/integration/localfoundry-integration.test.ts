/**
 * LocalFoundry Integration Tests
 *
 * End-to-end tests for LocalFoundry service integration
 */

import { LocalFoundryService } from '../../src/services/localfoundry/localfoundry-service';
import { ServiceConfig } from '../../src/types/service';
import { LocalFoundryConfig } from '../../src/services/localfoundry/types';

// Mock fetch globally
global.fetch = jest.fn();

describe('LocalFoundry Integration', () => {
  const mockServiceConfig: ServiceConfig = {
    name: 'local',
    displayName: 'LocalFoundry',
    apiEndpoint: 'http://localhost:8080/v1/chat/completions',
    oauth: {
      clientId: '',
      clientSecret: '',
      redirectUri: '',
      scopes: [],
      authEndpoint: '',
      tokenEndpoint: '',
    },
    tokenStorePath: './.tokens/test-localfoundry-tokens.json',
  };

  const mockLocalFoundryConfig: LocalFoundryConfig = {
    endpoint: 'http://localhost:8080/v1/chat/completions',
    model: 'phi-4',
    timeout: 5000,
  };

  let service: LocalFoundryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LocalFoundryService(mockServiceConfig, mockLocalFoundryConfig);
  });

  describe('End-to-End Service Lifecycle', () => {
    it('should initialize, use tools, and shutdown successfully', async () => {
      await service.initialize();

      // Mock summarize response
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          id: 'test-1',
          object: 'chat.completion',
          created: Date.now(),
          model: 'phi-4',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'This is a test summary',
              },
              finish_reason: 'stop',
            },
          ],
        }),
      });

      const tools = service.getTools();
      const summarizeTool = tools.find((t) => t.name === 'summarize')!;
      const result = await summarizeTool.handler({ text: 'Long text to summarize' });

      expect(result).toEqual({ summary: 'This is a test summary' });

      await service.shutdown();
    });

    it('should handle service gracefully when endpoint unavailable', async () => {
      // Mock failed health check
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Connection refused'));

      await service.initialize();

      const isAvailable = await service.isAuthenticated();
      // LocalFoundry always returns true (no OAuth required)
      // Health check failures are logged but don't block service
      expect(isAvailable).toBe(true);

      // Service should still be usable even if endpoint is down during initialization
      expect(service.getTools()).toHaveLength(3);
    });
  });

  describe('Tool Integration Scenarios', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should handle full summarization workflow', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          id: 'sum-1',
          object: 'chat.completion',
          created: Date.now(),
          model: 'phi-4',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Summary: The document discusses API design patterns and best practices.',
              },
              finish_reason: 'stop',
            },
          ],
        }),
      });

      const tools = service.getTools();
      const summarizeTool = tools.find((t) => t.name === 'summarize')!;

      const result = await summarizeTool.handler({
        text: 'Very long document about API design patterns, RESTful principles, authentication strategies, and performance optimization...',
        maxLength: 250,
      });

      expect(result.summary).toContain('API design');
      expect(global.fetch).toHaveBeenCalled();
    });

    it('should handle full clarification workflow', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          id: 'clarify-1',
          object: 'chat.completion',
          created: Date.now(),
          model: 'phi-4',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'The middleware handles authentication by validating JWT tokens.',
              },
              finish_reason: 'stop',
            },
          ],
        }),
      });

      const tools = service.getTools();
      const clarifyTool = tools.find((t) => t.name === 'clarify')!;

      const result = await clarifyTool.handler({
        text: 'The authentication middleware validates JWT tokens and checks user permissions...',
        question: 'How does the middleware handle authentication?',
      });

      expect(result.answer).toContain('JWT tokens');
    });

    it('should handle full extraction workflow', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          id: 'extract-1',
          object: 'chat.completion',
          created: Date.now(),
          model: 'phi-4',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  attendees: ['Alice', 'Bob'],
                  decisions: ['Implement feature X'],
                  action_items: ['Alice to write tests'],
                }),
              },
              finish_reason: 'stop',
            },
          ],
        }),
      });

      const tools = service.getTools();
      const extractTool = tools.find((t) => t.name === 'extract')!;

      const result = await extractTool.handler({
        text: 'Meeting on Jan 25: Alice and Bob attended. Decided to implement feature X. Alice will write tests.',
        schema: '{attendees: string[], decisions: string[], action_items: string[]}',
      });

      expect(result.extracted).toHaveProperty('attendees');
      expect(result.extracted.attendees).toEqual(['Alice', 'Bob']);
      expect(result.extracted.decisions).toEqual(['Implement feature X']);
    });

    it('should handle concurrent tool requests', async () => {
      // Mock responses for concurrent requests
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'Summary 1' },
                finish_reason: 'stop',
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'Summary 2' },
                finish_reason: 'stop',
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'Answer to question' },
                finish_reason: 'stop',
              },
            ],
          }),
        });

      const tools = service.getTools();
      const summarizeTool = tools.find((t) => t.name === 'summarize')!;
      const clarifyTool = tools.find((t) => t.name === 'clarify')!;

      // Execute tools concurrently
      const [result1, result2, result3] = await Promise.all([
        summarizeTool.handler({ text: 'Text 1' }),
        summarizeTool.handler({ text: 'Text 2' }),
        clarifyTool.handler({ text: 'Context', question: 'What?' }),
      ]);

      expect(result1.summary).toBe('Summary 1');
      expect(result2.summary).toBe('Summary 2');
      expect(result3.answer).toBe('Answer to question');
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('Error Handling Integration', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should handle endpoint unreachable scenario', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('fetch failed'));

      const tools = service.getTools();
      const summarizeTool = tools.find((t) => t.name === 'summarize')!;

      await expect(summarizeTool.handler({ text: 'Test' })).rejects.toThrow(
        'LocalFoundry endpoint unreachable'
      );
    });

    it('should handle malformed JSON in extract tool', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Not valid JSON {broken' },
              finish_reason: 'stop',
            },
          ],
        }),
      });

      const tools = service.getTools();
      const extractTool = tools.find((t) => t.name === 'extract')!;

      await expect(
        extractTool.handler({ text: 'Test', schema: '{field: string}' })
      ).rejects.toThrow('LocalFoundry returned invalid JSON response');
    });
  });
});
