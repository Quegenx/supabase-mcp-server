import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Pool } from "pg";
import { allTools } from "./tools/index.js";
import { tableManagementTools } from './tools/table-management/index.js';
import { storageManagementTools } from './tools/storage-management/index.js';
import { indexManagementTools } from './tools/index-management/index.js';
import { constraintManagementTools } from './tools/constraint-management/index.js';
import { functionManagementTools } from './tools/function-management/index.js';
import { triggerManagementTools } from './tools/trigger-management/index.js';
import { policyManagementTools } from './tools/policy-management/index.js';
import { roleManagementTools } from './tools/role-management/index.js';
import { enumManagementTools } from './tools/enum-management/index.js';
import { publicationManagementTools } from './tools/publication-management/index.js';
import { userManagementTools } from './tools/user-management/index.js';
import { realtimeManagementTools } from './tools/realtime-management/index.js';
import { advisorManagementTools } from './tools/advisor-management/index.js';
import { ToolDefinition, ToolHandlerResult } from "./types.js";

// Define tool categories for better organization
const toolCategories = {
  TABLE: 'table',
  STORAGE: 'storage',
  INDEX: 'index',
  CONSTRAINT: 'constraint',
  FUNCTION: 'function',
  TRIGGER: 'trigger',
  POLICY: 'policy',
  ROLE: 'role',
  ENUM: 'enum',
  PUBLICATION: 'publication',
  USER: 'user',
  REALTIME: 'realtime',
  QUERY: 'query',
  ADVISOR: 'advisor'
};

// Map category names to their respective tool arrays
const categoryToolMap = {
  [toolCategories.TABLE]: tableManagementTools,
  [toolCategories.STORAGE]: storageManagementTools,
  [toolCategories.INDEX]: indexManagementTools,
  [toolCategories.CONSTRAINT]: constraintManagementTools,
  [toolCategories.FUNCTION]: functionManagementTools,
  [toolCategories.TRIGGER]: triggerManagementTools,
  [toolCategories.POLICY]: policyManagementTools,
  [toolCategories.ROLE]: roleManagementTools,
  [toolCategories.ENUM]: enumManagementTools,
  [toolCategories.PUBLICATION]: publicationManagementTools,
  [toolCategories.USER]: userManagementTools,
  [toolCategories.ADVISOR]: advisorManagementTools,
  // Realtime tools are handled differently due to their structure
};

// Track which categories have been loaded
const loadedCategories = new Set<string>();

/**
 * Convert our internal ToolHandlerResult to the format expected by MCP SDK
 */
function convertToMcpResponse(result: ToolHandlerResult): any {
  if (!result.content) {
    return { content: [] };
  }
  
  // Convert our content items to the format expected by MCP SDK
  const mcpContent = result.content.map(item => {
    if (item.type === 'text') {
      return {
        type: 'text',
        text: item.text
      };
    }
    // Add other content types if needed
    return item;
  });
  
  return { content: mcpContent };
}

/**
 * Register optimized tools with the MCP server
 * This approach:
 * 1. Registers category discovery tools
 * 2. Implements lazy loading of tool categories
 * 3. Optimizes response data
 */
export function registerOptimizedTools(server: McpServer, pool: Pool): void {
  // Register the category discovery tool
  server.tool(
    "discover_tool_categories",
    "Get a list of available tool categories to help narrow down which tools you need",
    {},
    async () => {
      const categories = Object.values(toolCategories);
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            available_categories: categories,
            message: "Use load_category_tools to load tools from a specific category"
          }, null, 2)
        }]
      };
    }
  );

  // Register the category loader tool
  server.tool(
    "load_category_tools",
    "Load all tools from a specific category",
    {
      category: z.string().describe("The category of tools to load (e.g., table, storage, index)")
    },
    async ({ category }) => {
      const normalizedCategory = category.toLowerCase();
      
      if (!Object.values(toolCategories).includes(normalizedCategory)) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: "Invalid category",
              available_categories: Object.values(toolCategories)
            }, null, 2)
          }]
        };
      }

      // If category is already loaded, just return success
      if (loadedCategories.has(normalizedCategory)) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              message: `Tools from category '${normalizedCategory}' are already loaded and available`
            }, null, 2)
          }]
        };
      }

      // Load the tools for this category
      if (normalizedCategory === toolCategories.REALTIME) {
        // Handle realtime tools specially due to their different structure
        Object.entries(realtimeManagementTools).forEach(([name, tool]) => {
          const description = name.includes('realtime') 
            ? `Realtime management tool: ${name}`
            : `Tool for managing realtime features: ${name}`;
            
          // @ts-ignore - Type compatibility issues between our tool handler and MCP SDK
          server.tool(
            name,
            description,
            (tool as any).schema,
            async (params: any) => {
              const result = await (tool as any).handler({ pool, params });
              return convertToMcpResponse(optimizeResponse(result));
            }
          );
        });
      } else if (normalizedCategory === toolCategories.QUERY) {
        // The query tool is registered separately
        server.tool(
          "query",
          "Execute a SQL query",
          {
            sql: z.string().min(1).describe("SQL query to execute"),
            params: z.array(z.any()).optional().describe("Query parameters")
          },
          async ({ sql, params = [] }) => {
            try {
              const result = await pool.query(sql, params);
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({
                    command: result.command,
                    rowCount: result.rowCount,
                    rows: result.rows.slice(0, 100) // Limit to 100 rows to reduce token usage
                  }, null, 2)
                }]
              };
            } catch (error) {
              console.error("Error executing query:", error);
              throw new Error(`Failed to execute query: ${error}`);
            }
          }
        );
      } else {
        // Register all tools in the category
        const tools = categoryToolMap[normalizedCategory];
        if (tools) {
          tools.forEach(tool => {
            // @ts-ignore - Type compatibility issues between our tool handler and MCP SDK
            server.tool(
              tool.name,
              tool.description,
              tool.schema,
              async (params: any) => {
                const result = await tool.handler({ pool, params });
                return convertToMcpResponse(optimizeResponse(result));
              }
            );
          });
        }
      }

      // Mark this category as loaded
      loadedCategories.add(normalizedCategory);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            message: `Successfully loaded tools from category '${normalizedCategory}'`,
            loaded_categories: Array.from(loadedCategories)
          }, null, 2)
        }]
      };
    }
  );

  // Register a tool to get information about loaded categories
  server.tool(
    "get_loaded_categories",
    "Get information about which tool categories are currently loaded",
    {},
    async () => {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            loaded_categories: Array.from(loadedCategories),
            available_categories: Object.values(toolCategories)
          }, null, 2)
        }]
      };
    }
  );

  // Register a few essential tools that are always available
  registerEssentialTools(server, pool);
}

/**
 * Register a small set of essential tools that are always available
 * without needing to load a category first
 */
function registerEssentialTools(server: McpServer, pool: Pool): void {
  // Register the query tool as it's universally useful
  server.tool(
    "query",
    "Execute a SQL query",
    {
      sql: z.string().min(1).describe("SQL query to execute"),
      params: z.array(z.any()).optional().describe("Query parameters"),
      limit: z.number().optional().describe("Maximum number of rows to return (default: 100)")
    },
    async ({ sql, params = [], limit = 100 }) => {
      try {
        const result = await pool.query(sql, params);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              command: result.command,
              rowCount: result.rowCount,
              rows: result.rows.slice(0, limit) // Limit rows to reduce token usage
            }, null, 2)
          }]
        };
      } catch (error) {
        console.error("Error executing query:", error);
        throw new Error(`Failed to execute query: ${error}`);
      }
    }
  );

  // List tables tool is frequently needed
  const listTablesTools = tableManagementTools.find(tool => tool.name === 'list-tables');
  if (listTablesTools) {
    // @ts-ignore - Type compatibility issues between our tool handler and MCP SDK
    server.tool(
      listTablesTools.name,
      listTablesTools.description,
      listTablesTools.schema,
      async (params: any) => {
        const result = await listTablesTools.handler({ pool, params });
        return convertToMcpResponse(optimizeResponse(result));
      }
    );
  }
}

/**
 * Optimize the response data to reduce token usage
 */
function optimizeResponse(result: ToolHandlerResult): ToolHandlerResult {
  if (!result.content || result.content.length === 0) {
    return result;
  }

  // Process each content item
  const optimizedContent = result.content.map(item => {
    if (item.type !== 'text' || !item.text) {
      return item;
    }

    try {
      // Try to parse as JSON to optimize
      const data = JSON.parse(item.text);
      
      // If it's an array with more than 100 items, truncate it
      if (Array.isArray(data) && data.length > 100) {
        const optimized = {
          total_items: data.length,
          items: data.slice(0, 100),
          note: `Showing first 100 of ${data.length} items to reduce token usage`
        };
        return {
          type: 'text',
          text: JSON.stringify(optimized, null, 2)
        };
      }
      
      // If it's an object with rows property that's an array, limit it
      if (data && typeof data === 'object' && Array.isArray(data.rows) && data.rows.length > 100) {
        data.total_rows = data.rows.length;
        data.rows = data.rows.slice(0, 100);
        data.note = `Showing first 100 of ${data.total_rows} rows to reduce token usage`;
        return {
          type: 'text',
          text: JSON.stringify(data, null, 2)
        };
      }
      
      // Return the original item if no optimization was applied
      return item;
    } catch (e) {
      // If it's not valid JSON, return the original item
      return item;
    }
  });

  return {
    content: optimizedContent
  };
} 