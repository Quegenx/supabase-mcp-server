import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for drop-table tool
export const dropTableSchema = {
  schema: z.string().default("public").describe("Schema name"),
  table: z.string().describe("Table name"),
  cascade: z.boolean().default(false).describe("Drop dependent objects too"),
  ifExists: z.boolean().default(true).describe("Only drop if the table exists")
};

// Handler for drop-table tool
export const dropTableHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { schema, table, cascade = false, ifExists = true } = params as {
      schema: string;
      table: string;
      cascade?: boolean;
      ifExists?: boolean;
    };

    // Check if table exists first (if ifExists is false)
    if (!ifExists) {
      const checkQuery = `
        SELECT EXISTS (
          SELECT 1 
          FROM information_schema.tables 
          WHERE table_schema = $1 
          AND table_name = $2
        );
      `;
      const checkResult = await pool.query(checkQuery, [schema, table]);
      if (!checkResult.rows[0].exists) {
        throw new Error(`Table "${schema}"."${table}" does not exist`);
      }
    }

    // Build the DROP TABLE query
    const ifExistsClause = ifExists ? "IF EXISTS" : "";
    const cascadeClause = cascade ? "CASCADE" : "";
    const query = `DROP TABLE ${ifExistsClause} "${schema}"."${table}" ${cascadeClause};`;
    
    await pool.query(query);

    return {
      content: [{
        type: "text",
        text: `Successfully dropped table ${schema}.${table}${cascade ? " and all dependent objects" : ""}`
      }]
    };
  } catch (error) {
    console.error("Error dropping table:", error);
    throw new Error(`Failed to drop table: ${error}`);
  }
}; 