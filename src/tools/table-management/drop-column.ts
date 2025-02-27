import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for drop-column tool
export const dropColumnSchema = {
  schema: z.string().default("public").describe("Schema name"),
  table: z.string().describe("Table name"),
  column: z.string().describe("Column name"),
  cascade: z.boolean().default(false).describe("Drop dependent objects too")
};

// Handler for drop-column tool
export const dropColumnHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { schema, table, column, cascade = false } = params as {
      schema: string;
      table: string;
      column: string;
      cascade?: boolean;
    };

    const cascadeClause = cascade ? " CASCADE" : "";
    const query = `ALTER TABLE "${schema}"."${table}" DROP COLUMN "${column}"${cascadeClause};`;
    
    await pool.query(query);

    return {
      content: [{
        type: "text",
        text: `Successfully dropped column ${column} from ${schema}.${table}`
      }]
    };
  } catch (error) {
    console.error("Error dropping column:", error);
    throw new Error(`Failed to drop column: ${error}`);
  }
}; 