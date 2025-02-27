import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for create-record tool
export const createRecordSchema = {
  schema: z.string().default("public").describe("Schema name"),
  table: z.string().describe("Table name"),
  record: z.record(z.any()).describe("Record data")
};

// Handler for create-record tool
export const createRecordHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { schema, table, record } = params as {
      schema: string;
      table: string;
      record: Record<string, any>;
    };

    // Ensure record has data
    if (!record || Object.keys(record).length === 0) {
      throw new Error("Record data is required");
    }

    // Build the INSERT query
    const keys = Object.keys(record);
    const columns = keys.map(k => `"${k}"`).join(", ");
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
    const values = keys.map(k => record[k]);
    
    const sql = `INSERT INTO "${schema}"."${table}" (${columns}) VALUES (${placeholders}) RETURNING *;`;
    const result = await pool.query(sql, values);
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          message: `Successfully inserted record into ${schema}.${table}`,
          record: result.rows[0]
        }, null, 2)
      }]
    };
  } catch (error) {
    console.error("Error creating record:", error);
    throw new Error(`Failed to create record: ${error}`);
  }
}; 