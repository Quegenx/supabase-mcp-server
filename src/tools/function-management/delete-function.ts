import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for delete-function tool
export const deleteFunctionSchema = {
  schema: z.string().default("public").describe("Schema name"),
  name: z.string().describe("Function name"),
  arguments: z.string().describe("Function arguments with types (e.g., 'arg1 int, arg2 text')"),
  cascade: z.boolean().default(false).describe("Whether to cascade the deletion to dependent objects"),
  ifExists: z.boolean().default(true).describe("Whether to ignore if the function doesn't exist")
};

// Handler for delete-function tool
export const deleteFunctionHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      schema = "public",
      name,
      arguments: args,
      cascade = false,
      ifExists = true
    } = params as {
      schema?: string;
      name: string;
      arguments: string;
      cascade?: boolean;
      ifExists?: boolean;
    };

    // Check if the function exists before deletion (if ifExists is false)
    if (!ifExists) {
      const checkQuery = `
        SELECT 1 
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = $1 AND p.proname = $2
      `;
      
      const checkResult = await pool.query(checkQuery, [schema, name]);
      
      if (checkResult.rows.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: `Function ${schema}.${name} does not exist.` }, null, 2)
            }
          ]
        };
      }
    }

    // Build the DROP FUNCTION statement
    const dropFunctionSQL = `
      DROP FUNCTION ${ifExists ? 'IF EXISTS' : ''} ${schema}.${name}(${args})
      ${cascade ? 'CASCADE' : 'RESTRICT'}
    `;

    // Execute the DROP FUNCTION statement
    await pool.query(dropFunctionSQL);

    const result = {
      message: `Function ${schema}.${name}(${args}) has been successfully deleted.`,
      schema,
      name,
      arguments: args,
      cascade
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  } catch (error) {
    console.error("Error deleting function:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Failed to delete function: ${errorMessage}` }, null, 2)
        }
      ]
    };
  }
}; 