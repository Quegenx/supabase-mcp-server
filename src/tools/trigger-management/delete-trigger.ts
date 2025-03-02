import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for delete-trigger tool
export const deleteTriggerSchema = {
  schema: z.string().default("public").describe("Schema name"),
  table: z.string().describe("Table name"),
  name: z.string().describe("Trigger name"),
  ifExists: z.boolean().default(true).describe("Whether to ignore if the trigger doesn't exist"),
  cascade: z.boolean().default(false).describe("Whether to cascade the deletion to dependent objects")
};

// Handler for delete-trigger tool
export const deleteTriggerHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      schema = "public",
      table,
      name,
      ifExists = true,
      cascade = false
    } = params as {
      schema?: string;
      table: string;
      name: string;
      ifExists?: boolean;
      cascade?: boolean;
    };

    // Check if the trigger exists before deletion (if ifExists is false)
    if (!ifExists) {
      const checkQuery = `
        SELECT 1 
        FROM pg_trigger t
        JOIN pg_class c ON t.tgrelid = c.oid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE n.nspname = $1 AND c.relname = $2 AND t.tgname = $3 AND NOT t.tgisinternal
      `;
      
      const checkResult = await pool.query(checkQuery, [schema, table, name]);
      
      if (checkResult.rows.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: `Trigger ${name} on table ${schema}.${table} does not exist` }, null, 2)
            }
          ]
        };
      }
    }

    // Get trigger info before deletion for the response
    const triggerInfoQuery = `
      SELECT 
        t.tgname AS trigger_name,
        n.nspname AS schema_name,
        c.relname AS table_name
      FROM pg_trigger t
      JOIN pg_class c ON t.tgrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE n.nspname = $1 AND c.relname = $2 AND t.tgname = $3 AND NOT t.tgisinternal
    `;
    
    const triggerInfoResult = await pool.query(triggerInfoQuery, [schema, table, name]);
    
    // Build the DROP TRIGGER statement
    const dropTriggerSQL = `
      DROP TRIGGER ${ifExists ? 'IF EXISTS' : ''} ${name} ON ${schema}.${table}
      ${cascade ? 'CASCADE' : 'RESTRICT'}
    `;

    // Execute the DROP TRIGGER statement
    await pool.query(dropTriggerSQL);

    // Prepare the response
    const triggerInfo = triggerInfoResult.rows.length > 0 
      ? {
          name: triggerInfoResult.rows[0].trigger_name,
          schema: triggerInfoResult.rows[0].schema_name,
          table: triggerInfoResult.rows[0].table_name
        }
      : {
          name,
          schema,
          table
        };

    const response = {
      message: `Trigger ${name} on table ${schema}.${table} has been successfully deleted`,
      trigger: triggerInfo,
      cascade
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  } catch (error) {
    console.error("Error deleting trigger:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Failed to delete trigger: ${errorMessage}` }, null, 2)
        }
      ]
    };
  }
}; 