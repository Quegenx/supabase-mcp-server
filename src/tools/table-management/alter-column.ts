import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for alter-column tool
export const alterColumnSchema = {
  schema: z.string().default("public").describe("Schema name"),
  table: z.string().describe("Table name"),
  column: z.string().describe("Column name"),
  type: z.string().optional().describe("New data type"),
  newName: z.string().optional().describe("New column name"),
  setDefault: z.string().optional().describe("Set default value"),
  dropDefault: z.boolean().optional().describe("Drop default value"),
  setNotNull: z.boolean().optional().describe("Set NOT NULL constraint"),
  dropNotNull: z.boolean().optional().describe("Drop NOT NULL constraint")
};

// Handler for alter-column tool
export const alterColumnHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      schema, 
      table, 
      column, 
      type, 
      newName, 
      setDefault, 
      dropDefault, 
      setNotNull, 
      dropNotNull 
    } = params as {
      schema: string;
      table: string;
      column: string;
      type?: string;
      newName?: string;
      setDefault?: string;
      dropDefault?: boolean;
      setNotNull?: boolean;
      dropNotNull?: boolean;
    };

    const alterations = [];
    
    if (type) alterations.push(`ALTER COLUMN "${column}" TYPE ${type}`);
    if (newName) alterations.push(`RENAME COLUMN "${column}" TO "${newName}"`);
    if (setDefault) alterations.push(`ALTER COLUMN "${column}" SET DEFAULT ${setDefault}`);
    if (dropDefault) alterations.push(`ALTER COLUMN "${column}" DROP DEFAULT`);
    if (setNotNull) alterations.push(`ALTER COLUMN "${column}" SET NOT NULL`);
    if (dropNotNull) alterations.push(`ALTER COLUMN "${column}" DROP NOT NULL`);
    
    if (alterations.length === 0) {
      throw new Error("No alterations specified");
    }
    
    const query = `ALTER TABLE "${schema}"."${table}" ${alterations.join(", ")};`;
    await pool.query(query);

    return {
      content: [{
        type: "text",
        text: `Successfully modified column ${column} in ${schema}.${table}`
      }]
    };
  } catch (error) {
    console.error("Error altering column:", error);
    throw new Error(`Failed to alter column: ${error}`);
  }
}; 