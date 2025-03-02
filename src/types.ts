import { Pool } from "pg";

// Interface for tool handler parameters
export interface ToolHandlerParams {
  pool: Pool;
  params: any;
}

// Interface for tool handler function
export interface ContentItem {
  type: string;
  text: string;
}

export interface ToolHandlerResult {
  content: ContentItem[];
}

export type ToolHandler = (params: ToolHandlerParams) => Promise<ToolHandlerResult>;

// Interface for tool definition
export interface ToolDefinition {
  name: string;
  description: string;
  schema: any;
  handler: ToolHandler;
} 