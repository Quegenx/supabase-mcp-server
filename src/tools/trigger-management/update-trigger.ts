import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for update-trigger tool
export const updateTriggerSchema = {
  schema: z.string().default("public").describe("Schema name"),
  table: z.string().describe("Table name"),
  name: z.string().describe("Current trigger name"),
  newName: z.string().optional().describe("New trigger name (if renaming)"),
  enable: z.boolean().optional().describe("Enable the trigger"),
  disable: z.boolean().optional().describe("Disable the trigger"),
  recreate: z.boolean().default(false).describe("Whether to recreate the trigger with new properties (requires additional parameters)"),
  // Parameters for recreating the trigger
  timing: z.enum(["BEFORE", "AFTER", "INSTEAD OF"]).optional().describe("Trigger timing (BEFORE, AFTER, INSTEAD OF)"),
  events: z.array(z.enum(["INSERT", "UPDATE", "DELETE", "TRUNCATE"])).optional().describe("Events that trigger the trigger"),
  level: z.enum(["ROW", "STATEMENT"]).optional().describe("Trigger level (ROW or STATEMENT)"),
  functionSchema: z.string().optional().describe("Schema of the trigger function"),
  functionName: z.string().optional().describe("Name of the trigger function"),
  functionArgs: z.array(z.string()).optional().describe("Arguments to pass to the trigger function"),
  condition: z.string().optional().describe("Optional WHEN condition"),
  referenceOldTable: z.string().optional().describe("Optional OLD TABLE reference name for INSTEAD OF triggers"),
  referenceNewTable: z.string().optional().describe("Optional NEW TABLE reference name for INSTEAD OF triggers"),
  constraintTrigger: z.boolean().optional().describe("Whether this is a constraint trigger"),
  deferrable: z.boolean().optional().describe("Whether the constraint trigger is deferrable (only for constraint triggers)"),
  initiallyDeferred: z.boolean().optional().describe("Whether the constraint trigger is initially deferred (only for constraint triggers)")
};

// Handler for update-trigger tool
export const updateTriggerHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      schema = "public",
      table,
      name,
      newName,
      enable,
      disable,
      recreate = false,
      // Parameters for recreating the trigger
      timing,
      events,
      level,
      functionSchema,
      functionName,
      functionArgs,
      condition,
      referenceOldTable,
      referenceNewTable,
      constraintTrigger,
      deferrable,
      initiallyDeferred
    } = params as {
      schema?: string;
      table: string;
      name: string;
      newName?: string;
      enable?: boolean;
      disable?: boolean;
      recreate?: boolean;
      timing?: "BEFORE" | "AFTER" | "INSTEAD OF";
      events?: ("INSERT" | "UPDATE" | "DELETE" | "TRUNCATE")[];
      level?: "ROW" | "STATEMENT";
      functionSchema?: string;
      functionName?: string;
      functionArgs?: string[];
      condition?: string;
      referenceOldTable?: string;
      referenceNewTable?: string;
      constraintTrigger?: boolean;
      deferrable?: boolean;
      initiallyDeferred?: boolean;
    };

    // Check if the trigger exists
    const checkQuery = `
      SELECT 
        t.tgname AS trigger_name,
        n.nspname AS schema_name,
        c.relname AS table_name,
        pg_get_triggerdef(t.oid) AS trigger_definition,
        CASE
          WHEN t.tgtype & (1<<0) THEN 'ROW'
          ELSE 'STATEMENT'
        END AS trigger_level,
        CASE
          WHEN t.tgtype & (1<<1) THEN 'BEFORE'
          WHEN t.tgtype & (1<<6) THEN 'INSTEAD OF'
          ELSE 'AFTER'
        END AS trigger_timing,
        CASE
          WHEN t.tgtype & (1<<2) THEN true
          ELSE false
        END AS trigger_on_insert,
        CASE
          WHEN t.tgtype & (1<<3) THEN true
          ELSE false
        END AS trigger_on_delete,
        CASE
          WHEN t.tgtype & (1<<4) THEN true
          ELSE false
        END AS trigger_on_update,
        CASE
          WHEN t.tgtype & (1<<5) THEN true
          ELSE false
        END AS trigger_on_truncate,
        p.proname AS function_name,
        np.nspname AS function_schema,
        t.tgenabled AS trigger_enabled
      FROM pg_trigger t
      JOIN pg_class c ON t.tgrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      JOIN pg_proc p ON t.tgfoid = p.oid
      JOIN pg_namespace np ON p.pronamespace = np.oid
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

    const triggerInfo = checkResult.rows[0];
    let updatedTrigger;

    // Handle enable/disable operations
    if (enable === true && disable === true) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "Cannot both enable and disable a trigger" }, null, 2)
          }
        ]
      };
    }

    if (enable === true) {
      const enableSQL = `ALTER TABLE ${schema}.${table} ENABLE TRIGGER ${name};`;
      await pool.query(enableSQL);
    } else if (disable === true) {
      const disableSQL = `ALTER TABLE ${schema}.${table} DISABLE TRIGGER ${name};`;
      await pool.query(disableSQL);
    }

    // Handle rename operation
    if (newName && newName !== name) {
      const renameSQL = `ALTER TRIGGER ${name} ON ${schema}.${table} RENAME TO ${newName};`;
      await pool.query(renameSQL);
    }

    // Handle recreate operation
    if (recreate) {
      // Validate required parameters for recreation
      if (!timing || !events || !events.length || !functionName) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ 
                error: "Recreating a trigger requires timing, events, and functionName parameters" 
              }, null, 2)
            }
          ]
        };
      }

      // Drop the existing trigger
      const dropSQL = `DROP TRIGGER ${name} ON ${schema}.${table};`;
      await pool.query(dropSQL);

      // Build the CREATE TRIGGER statement for the new trigger
      const triggerNameToUse = newName || name;
      const functionSchemaToUse = functionSchema || triggerInfo.function_schema;
      const levelToUse = level || triggerInfo.trigger_level;

      let createTriggerSQL = `CREATE `;
      
      if (constraintTrigger) {
        createTriggerSQL += `CONSTRAINT `;
      }
      
      createTriggerSQL += `TRIGGER ${triggerNameToUse}
        ${timing} ${events.join(" OR ")} ON ${schema}.${table}
      `;
      
      if (levelToUse === "ROW" && !events.includes("TRUNCATE")) {
        createTriggerSQL += `FOR EACH ROW `;
      } else {
        createTriggerSQL += `FOR EACH STATEMENT `;
      }
      
      if (referenceOldTable) {
        createTriggerSQL += `REFERENCING OLD TABLE AS ${referenceOldTable} `;
      }
      
      if (referenceNewTable) {
        createTriggerSQL += `REFERENCING NEW TABLE AS ${referenceNewTable} `;
      }
      
      if (constraintTrigger) {
        if (deferrable) {
          createTriggerSQL += `DEFERRABLE `;
          if (initiallyDeferred) {
            createTriggerSQL += `INITIALLY DEFERRED `;
          } else {
            createTriggerSQL += `INITIALLY IMMEDIATE `;
          }
        }
      }
      
      if (condition) {
        createTriggerSQL += `WHEN (${condition}) `;
      }
      
      createTriggerSQL += `EXECUTE FUNCTION ${functionSchemaToUse}.${functionName}(`;
      
      if (functionArgs && functionArgs.length > 0) {
        createTriggerSQL += functionArgs.join(", ");
      }
      
      createTriggerSQL += `);`;

      // Execute the CREATE TRIGGER statement
      await pool.query(createTriggerSQL);
    }

    // Fetch the updated trigger to return its details
    const updatedTriggerName = newName || name;
    const updatedTriggerQuery = `
      SELECT 
        t.tgname AS trigger_name,
        n.nspname AS schema_name,
        c.relname AS table_name,
        pg_get_triggerdef(t.oid) AS trigger_definition,
        CASE
          WHEN t.tgtype & (1<<0) THEN 'ROW'
          ELSE 'STATEMENT'
        END AS trigger_level,
        CASE
          WHEN t.tgtype & (1<<1) THEN 'BEFORE'
          WHEN t.tgtype & (1<<6) THEN 'INSTEAD OF'
          ELSE 'AFTER'
        END AS trigger_timing,
        CASE
          WHEN t.tgtype & (1<<2) THEN true
          ELSE false
        END AS trigger_on_insert,
        CASE
          WHEN t.tgtype & (1<<3) THEN true
          ELSE false
        END AS trigger_on_delete,
        CASE
          WHEN t.tgtype & (1<<4) THEN true
          ELSE false
        END AS trigger_on_update,
        CASE
          WHEN t.tgtype & (1<<5) THEN true
          ELSE false
        END AS trigger_on_truncate,
        p.proname AS function_name,
        np.nspname AS function_schema,
        t.tgenabled AS trigger_enabled
      FROM pg_trigger t
      JOIN pg_class c ON t.tgrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      JOIN pg_proc p ON t.tgfoid = p.oid
      JOIN pg_namespace np ON p.pronamespace = np.oid
      WHERE n.nspname = $1 AND c.relname = $2 AND t.tgname = $3 AND NOT t.tgisinternal
    `;

    const updatedResult = await pool.query(updatedTriggerQuery, [schema, table, updatedTriggerName]);

    if (updatedResult.rows.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "Trigger was updated but could not be retrieved" }, null, 2)
          }
        ]
      };
    }

    const row = updatedResult.rows[0];
    updatedTrigger = {
      name: row.trigger_name,
      schema: row.schema_name,
      table: row.table_name,
      level: row.trigger_level,
      timing: row.trigger_timing,
      events: {
        insert: row.trigger_on_insert,
        delete: row.trigger_on_delete,
        update: row.trigger_on_update,
        truncate: row.trigger_on_truncate
      },
      function: {
        name: row.function_name,
        schema: row.function_schema
      },
      enabled: row.trigger_enabled === 'O',
      definition: row.trigger_definition
    };

    const response = {
      message: `Trigger ${name} on table ${schema}.${table} has been successfully updated`,
      trigger: updatedTrigger,
      operations: {
        renamed: newName ? true : false,
        enabled: enable === true,
        disabled: disable === true,
        recreated: recreate
      }
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
    console.error("Error updating trigger:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Failed to update trigger: ${errorMessage}` }, null, 2)
        }
      ]
    };
  }
}; 