import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for update-record tool
export const updateRecordSchema = {
  schema: z.string().default("public").describe("Schema name"),
  table: z.string().describe("Table name"),
  record: z.record(z.any()).describe("New values"),
  where: z.record(z.any()).describe("Filter conditions")
};

// Handler for update-record tool
export const updateRecordHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { schema, table, record, where } = params as {
      schema: string;
      table: string;
      record: Record<string, any>;
      where: Record<string, any>;
    };

    // Ensure record and where have data
    if (!record || Object.keys(record).length === 0) {
      throw new Error("Record data is required");
    }
    
    if (!where || Object.keys(where).length === 0) {
      throw new Error("Where conditions are required");
    }

    // Build the UPDATE query
    const recordKeys = Object.keys(record);
    const setClause = recordKeys.map((k, i) => `"${k}" = $${i + 1}`).join(", ");
    
    const whereKeys = Object.keys(where);
    const whereClause = whereKeys.map((k, i) => `"${k}" = $${i + recordKeys.length + 1}`).join(" AND ");
    
    const values = [...recordKeys.map(k => record[k]), ...whereKeys.map(k => where[k])];
    
    const sql = `UPDATE "${schema}"."${table}" SET ${setClause} WHERE ${whereClause} RETURNING *;`;
    const result = await pool.query(sql, values);
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          message: `Successfully updated ${result.rowCount} record(s) in ${schema}.${table}`,
          updatedRecords: result.rows
        }, null, 2)
      }]
    };
  } catch (error) {
    console.error("Error updating record:", error);
    throw new Error(`Failed to update record: ${error}`);
  }
}; 