import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for list-records tool
export const listRecordsSchema = {
  schema: z.string().default("public").describe("Schema name"),
  table: z.string().describe("Table name"),
  where: z.record(z.any()).optional().describe("Filtering conditions"),
  limit: z.number().optional().describe("Max rows"),
  offset: z.number().optional().describe("Offset")
};

// Handler for list-records tool
export const listRecordsHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { schema, table, where, limit, offset } = params as {
      schema: string;
      table: string;
      where?: Record<string, any>;
      limit?: number;
      offset?: number;
    };

    // Build the query
    let sql = `SELECT * FROM "${schema}"."${table}"`;
    const values = [];
    
    // Add WHERE clause if conditions are provided
    if (where && Object.keys(where).length > 0) {
      const keys = Object.keys(where);
      const clauses = keys.map((k, i) => `"${k}" = $${i + 1}`);
      sql += " WHERE " + clauses.join(" AND ");
      values.push(...keys.map(k => where[k]));
    }
    
    // Add LIMIT and OFFSET if provided
    if (limit !== undefined) sql += ` LIMIT ${limit}`;
    if (offset !== undefined) sql += ` OFFSET ${offset}`;
    
    const result = await pool.query(sql, values);
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          rowCount: result.rowCount,
          rows: result.rows
        }, null, 2)
      }]
    };
  } catch (error) {
    console.error("Error listing records:", error);
    throw new Error(`Failed to list records: ${error}`);
  }
}; 