/**
 * LocalFoundry Service Tests
 *
 * Tests for LocalFoundry service lifecycle and tool implementations
 */

import { LocalFoundryService } from '../../../../src/services/localfoundry/localfoundry-service';
import { LocalFoundryClient } from '../../../../src/services/localfoundry/localfoundry-client';
import { ServiceConfig } from '../../../../src/types/service';
import { LocalFoundryConfig } from '../../../../src/services/localfoundry/types';

// Mock the client module
jest.mock('../../../../src/services/localfoundry/localfoundry-client');

describe('LocalFoundryService', () => {
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
    tokenStorePath: './.tokens/localfoundry-tokens.json',
  };

  const mockLocalFoundryConfig: LocalFoundryConfig = {
    endpoint: 'http://localhost:8080/v1/chat/completions',
    model: 'phi-4',
    timeout: 60000,
  };

  let service: LocalFoundryService;
  let mockClient: jest.Mocked<LocalFoundryClient>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock client instance
    mockClient = {
      chatCompletion: jest.fn(),
      healthCheck: jest.fn(),
    } as any;

    // Mock the constructor to return our mock client
    (LocalFoundryClient as jest.Mock).mockImplementation(() => mockClient);

    service = new LocalFoundryService(mockServiceConfig, mockLocalFoundryConfig);
  });

  describe('Service Lifecycle', () => {
    it('should initialize successfully', async () => {
      await expect(service.initialize()).resolves.not.toThrow();
      expect(service.name).toBe('local');
    });

    it('should return correct service config', () => {
      expect(service.config).toEqual(mockServiceConfig);
      expect(service.name).toBe('local');
    });

    it('should shutdown gracefully', async () => {
      await expect(service.shutdown()).resolves.not.toThrow();
    });
  });

  describe('Tool Registration', () => {
    it('should register three tools', () => {
      const tools = service.getTools();

      expect(tools).toHaveLength(3);
      expect(tools.map((t) => t.name)).toEqual(['summarize', 'clarify', 'extract']);
    });

    it('should have proper tool schemas', () => {
      const tools = service.getTools();

      const summarizeTool = tools.find((t) => t.name === 'summarize');
      expect(summarizeTool).toBeDefined();
      expect(summarizeTool!.inputSchema.required).toContain('text');
      expect(summarizeTool!.inputSchema.properties).toHaveProperty('maxLength');

      const clarifyTool = tools.find((t) => t.name === 'clarify');
      expect(clarifyTool).toBeDefined();
      expect(clarifyTool!.inputSchema.required).toEqual(['text', 'question']);

      const extractTool = tools.find((t) => t.name === 'extract');
      expect(extractTool).toBeDefined();
      expect(extractTool!.inputSchema.required).toEqual(['text', 'schema']);
    });
  });

  describe('isAuthenticated', () => {
    it('should return true when health check passes', async () => {
      mockClient.healthCheck.mockResolvedValueOnce(true);

      const result = await service.isAuthenticated();

      expect(result).toBe(true);
      expect(mockClient.healthCheck).toHaveBeenCalled();
    });

    it('should return false when health check fails', async () => {
      mockClient.healthCheck.mockResolvedValueOnce(false);

      const result = await service.isAuthenticated();

      expect(result).toBe(false);
    });

    it('should return false when health check throws error', async () => {
      mockClient.healthCheck.mockRejectedValueOnce(new Error('Connection failed'));

      const result = await service.isAuthenticated();

      expect(result).toBe(false);
    });
  });

  describe('Summarize Tool', () => {
    it('should summarize text successfully', async () => {
      mockClient.chatCompletion.mockResolvedValueOnce('This is a concise summary of the text.');

      const tools = service.getTools();
      const summarizeTool = tools.find((t) => t.name === 'summarize')!;

      const result = await summarizeTool.handler({
        text: 'Long document content that needs to be summarized...',
        maxLength: 200,
      });

      expect(result).toEqual({ summary: 'This is a concise summary of the text.' });
      expect(mockClient.chatCompletion).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({ role: 'user', content: expect.stringContaining('Summarize') }),
        ])
      );
    });

    it('should use default maxLength of 300', async () => {
      mockClient.chatCompletion.mockResolvedValueOnce('Summary text');

      const tools = service.getTools();
      const summarizeTool = tools.find((t) => t.name === 'summarize')!;

      await summarizeTool.handler({ text: 'Test text' });

      expect(mockClient.chatCompletion).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            content: expect.stringContaining('no more than 300 words'),
          }),
        ])
      );
    });

    it('should validate text input is required', async () => {
      const tools = service.getTools();
      const summarizeTool = tools.find((t) => t.name === 'summarize')!;

      await expect(summarizeTool.handler({ maxLength: 200 })).rejects.toThrow(
        'text must be a non-empty string'
      );
    });

    it('should validate text length limit', async () => {
      const tools = service.getTools();
      const summarizeTool = tools.find((t) => t.name === 'summarize')!;

      const longText = 'a'.repeat(51000);
      await expect(summarizeTool.handler({ text: longText })).rejects.toThrow(
        'exceeds maximum allowed length of 50000'
      );
    });

    it('should validate maxLength is positive number', async () => {
      const tools = service.getTools();
      const summarizeTool = tools.find((t) => t.name === 'summarize')!;

      await expect(summarizeTool.handler({ text: 'Test', maxLength: -10 })).rejects.toThrow(
        'maxLength must be a positive number'
      );
    });

    it('should propagate client errors', async () => {
      mockClient.chatCompletion.mockRejectedValueOnce(new Error('Request timed out after 5000ms'));

      const tools = service.getTools();
      const summarizeTool = tools.find((t) => t.name === 'summarize')!;

      await expect(summarizeTool.handler({ text: 'Test text' })).rejects.toThrow(
        'Request timed out'
      );
    });
  });

  describe('Clarify Tool', () => {
    it('should answer questions about text successfully', async () => {
      mockClient.chatCompletion.mockResolvedValueOnce(
        'The timeout parameter controls how long the system waits for a response.'
      );

      const tools = service.getTools();
      const clarifyTool = tools.find((t) => t.name === 'clarify')!;

      const result = await clarifyTool.handler({
        text: 'Documentation about timeout parameter...',
        question: 'What does the timeout parameter control?',
      });

      expect(result).toEqual({
        answer: 'The timeout parameter controls how long the system waits for a response.',
      });
      expect(mockClient.chatCompletion).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'system',
            content: expect.stringContaining('Q&A assistant'),
          }),
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('Question:'),
          }),
        ])
      );
    });

    it('should validate both text and question are required', async () => {
      const tools = service.getTools();
      const clarifyTool = tools.find((t) => t.name === 'clarify')!;

      await expect(clarifyTool.handler({ text: 'Test' })).rejects.toThrow(
        'question must be a non-empty string'
      );

      await expect(clarifyTool.handler({ question: 'What?' })).rejects.toThrow(
        'text must be a non-empty string'
      );
    });

    it('should validate text length limit', async () => {
      const tools = service.getTools();
      const clarifyTool = tools.find((t) => t.name === 'clarify')!;

      const longText = 'a'.repeat(51000);
      await expect(clarifyTool.handler({ text: longText, question: 'What?' })).rejects.toThrow(
        'exceeds maximum allowed length of 50000'
      );
    });

    it('should validate question length limit', async () => {
      const tools = service.getTools();
      const clarifyTool = tools.find((t) => t.name === 'clarify')!;

      const longQuestion = 'a'.repeat(501);
      await expect(clarifyTool.handler({ text: 'Test', question: longQuestion })).rejects.toThrow(
        'exceeds maximum allowed length of 500'
      );
    });
  });

  describe('Extract Tool', () => {
    it('should extract structured data as JSON successfully', async () => {
      const mockJsonResponse = JSON.stringify({
        attendees: ['John', 'Sarah'],
        decisions: ['Use REST API'],
        action_items: ['John to draft spec'],
      });

      mockClient.chatCompletion.mockResolvedValueOnce(mockJsonResponse);

      const tools = service.getTools();
      const extractTool = tools.find((t) => t.name === 'extract')!;

      const result = await extractTool.handler({
        text: 'Meeting notes: John and Sarah attended. Decided on REST API. Action: John drafts spec.',
        schema: '{attendees: string[], decisions: string[], action_items: string[]}',
      });

      expect(result.extracted).toEqual({
        attendees: ['John', 'Sarah'],
        decisions: ['Use REST API'],
        action_items: ['John to draft spec'],
      });
    });

    it('should handle invalid JSON response', async () => {
      mockClient.chatCompletion.mockResolvedValueOnce('This is not JSON');

      const tools = service.getTools();
      const extractTool = tools.find((t) => t.name === 'extract')!;

      await expect(
        extractTool.handler({
          text: 'Test text',
          schema: '{field: string}',
        })
      ).rejects.toThrow('LocalFoundry returned invalid JSON response');
    });

    it('should validate text and schema are required', async () => {
      const tools = service.getTools();
      const extractTool = tools.find((t) => t.name === 'extract')!;

      await expect(extractTool.handler({ text: 'Test' })).rejects.toThrow(
        'schema must be a non-empty string'
      );

      await expect(extractTool.handler({ schema: '{field: string}' })).rejects.toThrow(
        'text must be a non-empty string'
      );
    });

    it('should validate text length limit', async () => {
      const tools = service.getTools();
      const extractTool = tools.find((t) => t.name === 'extract')!;

      const longText = 'a'.repeat(51000);
      await expect(
        extractTool.handler({ text: longText, schema: '{field: string}' })
      ).rejects.toThrow('exceeds maximum allowed length of 50000');
    });

    it('should validate schema length limit', async () => {
      const tools = service.getTools();
      const extractTool = tools.find((t) => t.name === 'extract')!;

      const longSchema = 'a'.repeat(2001);
      await expect(extractTool.handler({ text: 'Test', schema: longSchema })).rejects.toThrow(
        'exceeds maximum allowed length of 2000'
      );
    });

    it('should include extraction system prompt', async () => {
      mockClient.chatCompletion.mockResolvedValueOnce('{"key": "value"}');

      const tools = service.getTools();
      const extractTool = tools.find((t) => t.name === 'extract')!;

      await extractTool.handler({
        text: 'Test text',
        schema: '{key: string}',
      });

      expect(mockClient.chatCompletion).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'system',
            content: expect.stringContaining('ONLY valid JSON'),
          }),
        ])
      );
    });
  });
});
