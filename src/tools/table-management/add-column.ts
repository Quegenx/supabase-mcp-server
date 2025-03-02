import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for add-column tool
export const addColumnSchema = {
  schema: z.string().default("public").describe("Schema name"),
  table: z.string().describe("Table name"),
  name: z.string().describe("Column name"),
  type: z.string().describe("Column type"),
  constraints: z.array(z.string()).optional().describe("Column constraints")
};

// Handler for add-column tool
export const addColumnHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { schema, table, name, type, constraints = [] } = params as {
      schema: string;
      table: string;
      name: string;
      type: string;
      constraints?: string[];
    };

    const constraintStr = constraints.length > 0 ? ` ${constraints.join(" ")}` : "";
    const query = `ALTER TABLE "${schema}"."${table}" ADD COLUMN "${name}" ${type}${constraintStr};`;
    
    await pool.query(query);

    return {
      content: [{
        type: "text",
        text: `Successfully added column ${name} to ${schema}.${table}`
      }]
    };
  } catch (error) {
    console.error("Error adding column:", error);
    throw new Error(`Failed to add column: ${error}`);
  }
}; 