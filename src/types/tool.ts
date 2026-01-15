/**
 * Tool types for MCP (Model Context Protocol)
 *
 * Defines the structure for MCP tools including their schemas and handlers.
 */

/**
 * JSON Schema definition for tool input parameters
 */
export interface JSONSchema {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  description?: string;
  [key: string]: unknown;
}

/**
 * Input parameters for a tool handler
 */
export type ToolInput = Record<string, unknown>;

/**
 * Output result from a tool handler
 * Can be any serializable value
 */
export type ToolOutput = unknown;

/**
 * Tool handler function signature
 * Takes input parameters and returns a promise with the result
 */
export type ToolHandler<TInput extends ToolInput = ToolInput, TOutput = ToolOutput> = (
  input: TInput
) => Promise<TOutput>;

/**
 * MCP Tool definition
 * Represents a callable tool with name, description, schema, and handler
 */
export interface Tool<TInput extends ToolInput = ToolInput, TOutput = ToolOutput> {
  /** Unique tool name (e.g., "microsoft.list-emails") */
  name: string;

  /** Human-readable description of what the tool does */
  description: string;

  /** JSON Schema for input validation */
  inputSchema: JSONSchema;

  /** Handler function that executes the tool */
  handler: ToolHandler<TInput, TOutput>;
}

/**
 * Tool registration entry
 * Used for dynamic tool loading and discovery
 */
export interface ToolRegistry {
  /** Map of tool name to tool definition */
  tools: Map<string, Tool>;

  /**
   * Register a new tool
   * @param tool Tool definition to register
   * @throws Error if tool with same name already exists
   */
  register(tool: Tool): void;

  /**
   * Get a tool by name
   * @param name Tool name
   * @returns Tool definition or undefined if not found
   */
  get(name: string): Tool | undefined;

  /**
   * List all registered tool names
   * @returns Array of tool names
   */
  list(): string[];
}
