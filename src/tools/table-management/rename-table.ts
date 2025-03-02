import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for rename-table tool
export const renameTableSchema = {
  schema: z.string().default("public").describe("Schema name"),
  table: z.string().describe("Current table name"),
  newName: z.string().describe("New table name"),
  checkExists: z.boolean().default(true).describe("Check if the table exists before renaming")
};

// Handler for rename-table tool
export const renameTableHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { schema, table, newName, checkExists = true } = params as {
      schema: string;
      table: string;
      newName: string;
      checkExists?: boolean;
    };

    // Check if source table exists
    if (checkExists) {
      const checkSourceQuery = `
        SELECT EXISTS (
          SELECT 1 
          FROM information_schema.tables 
          WHERE table_schema = $1 
          AND table_name = $2
        );
      `;
      const checkSourceResult = await pool.query(checkSourceQuery, [schema, table]);
      if (!checkSourceResult.rows[0].exists) {
        throw new Error(`Source table "${schema}"."${table}" does not exist`);
      }

      // Check if target table name already exists
      const checkTargetQuery = `
        SELECT EXISTS (
          SELECT 1 
          FROM information_schema.tables 
          WHERE table_schema = $1 
          AND table_name = $2
        );
      `;
      const checkTargetResult = await pool.query(checkTargetQuery, [schema, newName]);
      if (checkTargetResult.rows[0].exists) {
        throw new Error(`Target table name "${schema}"."${newName}" already exists`);
      }
    }

    // Execute the rename operation
    const query = `ALTER TABLE "${schema}"."${table}" RENAME TO "${newName}";`;
    await pool.query(query);

    return {
      content: [{
        type: "text",
        text: `Successfully renamed table ${schema}.${table} to ${schema}.${newName}`
      }]
    };
  } catch (error) {
    console.error("Error renaming table:", error);
    throw new Error(`Failed to rename table: ${error}`);
  }
}; 