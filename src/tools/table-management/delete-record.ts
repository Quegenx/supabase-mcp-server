import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for delete-record tool
export const deleteRecordSchema = {
  schema: z.string().default("public").describe("Schema name"),
  table: z.string().describe("Table name"),
  where: z.record(z.any()).describe("Filter conditions")
};

// Handler for delete-record tool
export const deleteRecordHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { schema, table, where } = params as {
      schema: string;
      table: string;
      where: Record<string, any>;
    };

    // Ensure where has data
    if (!where || Object.keys(where).length === 0) {
      throw new Error("Where conditions are required");
    }

    // Build the DELETE query
    const keys = Object.keys(where);
    const whereClause = keys.map((k, i) => `"${k}" = $${i + 1}`).join(" AND ");
    const values = keys.map(k => where[k]);
    
    const sql = `DELETE FROM "${schema}"."${table}" WHERE ${whereClause} RETURNING *;`;
    const result = await pool.query(sql, values);
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          message: `Successfully deleted ${result.rowCount} record(s) from ${schema}.${table}`,
          deletedRecords: result.rows
        }, null, 2)
      }]
    };
  } catch (error) {
    console.error("Error deleting record:", error);
    throw new Error(`Failed to delete record: ${error}`);
  }
}; 