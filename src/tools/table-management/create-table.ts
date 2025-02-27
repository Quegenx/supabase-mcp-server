import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Define the interface for column definitions
interface ColumnDefinition {
  name: string;
  type: string;
  constraints?: string[];
}

// Schema for create-table tool
export const createTableSchema = {
  schema: z.string().default("public").describe("Schema name"),
  table: z.string().describe("Table name"),
  columns: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
      constraints: z.array(z.string()).optional()
    })
  ).describe("Column definitions")
};

// Handler for create-table tool
export const createTableHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { schema, table, columns } = params as {
      schema: string;
      table: string;
      columns: ColumnDefinition[];
    };

    const columnDefs = columns
      .map((col: ColumnDefinition) => {
        const constraints = col.constraints?.join(" ") || "";
        return `"${col.name}" ${col.type} ${constraints}`.trim();
      })
      .join(", ");

    const query = `CREATE TABLE "${schema}"."${table}" (${columnDefs});`;
    await pool.query(query);

    return {
      content: [{
        type: "text",
        text: `Successfully created table ${schema}.${table}`
      }]
    };
  } catch (error) {
    console.error("Error creating table:", error);
    throw new Error(`Failed to create table: ${error}`);
  }
}; 