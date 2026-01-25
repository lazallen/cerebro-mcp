/**
 * LocalFoundry Integration Types
 *
 * Type definitions for LocalFoundry LLM service integration.
 * Based on OpenAI-compatible Chat Completions API format.
 */

/**
 * Chat message role types following OpenAI convention
 */
export type ChatMessageRole = 'system' | 'user' | 'assistant';

/**
 * Individual message in a Chat Completions conversation
 */
export interface ChatMessage {
  /** Message role type */
  role: ChatMessageRole;
  /** Message text content */
  content: string;
}

/**
 * Configuration for LocalFoundry service connection and behavior
 */
export interface LocalFoundryConfig {
  /** Full URL to LocalFoundry Chat Completions API endpoint */
  endpoint: string;
  /** Model identifier to use for all requests (e.g., "phi-4") */
  model: string;
  /** Request timeout in milliseconds */
  timeout: number;
}

/**
 * Request payload sent to LocalFoundry Chat Completions API
 */
export interface ChatCompletionRequest {
  /** Model identifier */
  model: string;
  /** Array of conversation messages */
  messages: ChatMessage[];
  /** Sampling temperature for randomness (0.0 to 2.0) */
  temperature?: number;
  /** Maximum tokens in generated response */
  max_tokens?: number;
}

/**
 * Individual completion choice in Chat Completions response
 */
export interface ChatCompletionChoice {
  /** Choice index (0-based) */
  index: number;
  /** Generated message from LLM */
  message: ChatMessage;
  /** Reason generation stopped ('stop', 'length', 'content_filter') */
  finish_reason: string;
}

/**
 * Token usage statistics for a completion (optional)
 */
export interface TokenUsage {
  /** Tokens in input prompt */
  prompt_tokens: number;
  /** Tokens in generated completion */
  completion_tokens: number;
  /** Sum of prompt_tokens + completion_tokens */
  total_tokens: number;
}

/**
 * Response payload received from LocalFoundry Chat Completions API
 */
export interface ChatCompletionResponse {
  /** Unique identifier for this completion */
  id: string;
  /** Object type identifier ('chat.completion') */
  object: string;
  /** Unix timestamp of response creation */
  created: number;
  /** Model that generated the response */
  model: string;
  /** Array of completion choices */
  choices: ChatCompletionChoice[];
  /** Token count statistics (optional) */
  usage?: TokenUsage;
}

/**
 * Service status information for dashboard display
 */
export interface LocalFoundryServiceStatus {
  /** Service identifier ('local') */
  serviceName: 'local';
  /** Human-readable service name */
  displayName: 'LocalFoundry';
  /** Current availability state */
  state: 'available' | 'unavailable' | 'not_configured';
  /** Status description for display */
  message: string;
  /** Configured endpoint URL (optional) */
  endpoint?: string;
  /** Configured model name (optional) */
  model?: string;
  /** No authentication URL needed (empty string) */
  loginUrl: '';
}

/**
 * Input parameters for the summarize tool
 */
export interface SummarizeInput {
  /** Text content to summarize */
  text: string;
  /** Maximum summary length in words (default: 300) */
  maxLength?: number;
}

/**
 * Input parameters for the clarify tool
 */
export interface ClarifyInput {
  /** Context text to answer questions about */
  text: string;
  /** Specific question to answer based on the text */
  question: string;
}

/**
 * Input parameters for the extract tool
 */
export interface ExtractInput {
  /** Text to extract structured data from */
  text: string;
  /** Description of desired JSON structure */
  schema: string;
}
