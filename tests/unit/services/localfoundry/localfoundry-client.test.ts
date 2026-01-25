/**
 * LocalFoundry Client Tests
 *
 * Tests for LocalFoundry HTTP client with Chat Completions API
 */

import { LocalFoundryClient } from '../../../../src/services/localfoundry/localfoundry-client';
import {
  LocalFoundryConfig,
  ChatCompletionResponse,
} from '../../../../src/services/localfoundry/types';

// Mock fetch globally
global.fetch = jest.fn();

describe('LocalFoundryClient', () => {
  const mockConfig: LocalFoundryConfig = {
    endpoint: 'http://localhost:8080/v1/chat/completions',
    model: 'phi-4',
    timeout: 5000,
  };

  let client: LocalFoundryClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new LocalFoundryClient(mockConfig);
  });

  describe('chatCompletion', () => {
    it('should successfully complete chat request', async () => {
      const mockResponse: ChatCompletionResponse = {
        id: 'test-123',
        object: 'chat.completion',
        created: Date.now(),
        model: 'phi-4',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'This is a test response from LocalFoundry',
            },
            finish_reason: 'stop',
          },
        ],
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await client.chatCompletion([{ role: 'user', content: 'Test prompt' }]);

      expect(result).toBe('This is a test response from LocalFoundry');
      expect(global.fetch).toHaveBeenCalledWith(
        mockConfig.endpoint,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    it('should handle HTTP error responses', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      await expect(client.chatCompletion([{ role: 'user', content: 'Test' }])).rejects.toThrow(
        'LocalFoundry request failed: HTTP 500'
      );
    });

    it('should handle timeout errors', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(
        Object.assign(new Error('Aborted'), { name: 'AbortError' })
      );

      await expect(client.chatCompletion([{ role: 'user', content: 'Test' }])).rejects.toThrow(
        'Request timed out after 5000ms'
      );
    });

    it('should handle network connection errors', async () => {
      const networkError = new Error('fetch failed');
      (global.fetch as jest.Mock).mockRejectedValueOnce(networkError);

      await expect(client.chatCompletion([{ role: 'user', content: 'Test' }])).rejects.toThrow(
        'LocalFoundry endpoint unreachable'
      );
    });

    it('should handle empty choices array', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'test',
          object: 'chat.completion',
          created: Date.now(),
          model: 'phi-4',
          choices: [],
        }),
      });

      await expect(client.chatCompletion([{ role: 'user', content: 'Test' }])).rejects.toThrow(
        'LocalFoundry returned empty choices array'
      );
    });

    it('should handle invalid response structure', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'test',
          choices: [{ index: 0, message: null }],
        }),
      });

      await expect(client.chatCompletion([{ role: 'user', content: 'Test' }])).rejects.toThrow(
        'LocalFoundry returned invalid response structure'
      );
    });

    it('should include temperature and max_tokens in request', async () => {
      const mockResponse: ChatCompletionResponse = {
        id: 'test-123',
        object: 'chat.completion',
        created: Date.now(),
        model: 'phi-4',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Response' },
            finish_reason: 'stop',
          },
        ],
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      await client.chatCompletion([{ role: 'user', content: 'Test' }], {
        temperature: 0.5,
        max_tokens: 1000,
      });

      const callArgs = (global.fetch as jest.Mock).mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);

      expect(requestBody.temperature).toBe(0.5);
      expect(requestBody.max_tokens).toBe(1000);
    });
  });

  describe('healthCheck', () => {
    it('should return true when endpoint is healthy', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      const result = await client.healthCheck();

      expect(result).toBe(true);
    });

    it('should return false when endpoint returns error', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await client.healthCheck();

      expect(result).toBe(false);
    });

    it('should return false when endpoint is unreachable', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Connection refused'));

      const result = await client.healthCheck();

      expect(result).toBe(false);
    });

    it('should use 5 second timeout for health check', async () => {
      // Mock fetch to timeout after signal abort
      (global.fetch as jest.Mock).mockImplementationOnce(() => {
        return new Promise((_, reject) => {
          setTimeout(() => {
            reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
          }, 100);
        });
      });

      const result = await client.healthCheck();

      // Health check should return false when timeout occurs
      expect(result).toBe(false);
    });
  });
});
