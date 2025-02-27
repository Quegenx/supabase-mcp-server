import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for create-trigger tool
export const createTriggerSchema = {
  schema: z.string().default("public").describe("Schema name"),
  table: z.string().describe("Table name"),
  name: z.string().describe("Trigger name"),
  timing: z.enum(["BEFORE", "AFTER", "INSTEAD OF"]).describe("Trigger timing (BEFORE, AFTER, INSTEAD OF)"),
  events: z.array(z.enum(["INSERT", "UPDATE", "DELETE", "TRUNCATE"])).describe("Events that trigger the trigger"),
  level: z.enum(["ROW", "STATEMENT"]).default("ROW").describe("Trigger level (ROW or STATEMENT)"),
  functionSchema: z.string().default("public").describe("Schema of the trigger function"),
  functionName: z.string().describe("Name of the trigger function"),
  functionArgs: z.array(z.string()).optional().describe("Arguments to pass to the trigger function"),
  condition: z.string().optional().describe("Optional WHEN condition"),
  referenceOldTable: z.string().optional().describe("Optional OLD TABLE reference name for INSTEAD OF triggers"),
  referenceNewTable: z.string().optional().describe("Optional NEW TABLE reference name for INSTEAD OF triggers"),
  constraintTrigger: z.boolean().default(false).describe("Whether this is a constraint trigger"),
  deferrable: z.boolean().default(false).describe("Whether the constraint trigger is deferrable (only for constraint triggers)"),
  initiallyDeferred: z.boolean().default(false).describe("Whether the constraint trigger is initially deferred (only for constraint triggers)")
};

// Handler for create-trigger tool
export const createTriggerHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      schema = "public",
      table,
      name,
      timing,
      events,
      level = "ROW",
      functionSchema = "public",
      functionName,
      functionArgs,
      condition,
      referenceOldTable,
      referenceNewTable,
      constraintTrigger = false,
      deferrable = false,
      initiallyDeferred = false
    } = params as {
      schema?: string;
      table: string;
      name: string;
      timing: "BEFORE" | "AFTER" | "INSTEAD OF";
      events: ("INSERT" | "UPDATE" | "DELETE" | "TRUNCATE")[];
      level?: "ROW" | "STATEMENT";
      functionSchema?: string;
      functionName: string;
      functionArgs?: string[];
      condition?: string;
      referenceOldTable?: string;
      referenceNewTable?: string;
      constraintTrigger?: boolean;
      deferrable?: boolean;
      initiallyDeferred?: boolean;
    };

    // Validate input
    if (events.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "At least one event must be specified" }, null, 2)
          }
        ]
      };
    }

    if (timing === "INSTEAD OF" && level !== "ROW") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "INSTEAD OF triggers must be ROW level" }, null, 2)
          }
        ]
      };
    }

    if (events.includes("TRUNCATE") && level !== "STATEMENT") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "TRUNCATE triggers must be STATEMENT level" }, null, 2)
          }
        ]
      };
    }

    if (constraintTrigger && timing !== "AFTER") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "Constraint triggers must be AFTER triggers" }, null, 2)
          }
        ]
      };
    }

    // Check if the function exists
    const functionCheckQuery = `
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = $1 AND p.proname = $2
    `;
    const functionCheckResult = await pool.query(functionCheckQuery, [functionSchema, functionName]);
    
    if (functionCheckResult.rows.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: `Function ${functionSchema}.${functionName} does not exist` }, null, 2)
          }
        ]
      };
    }

    // Build the CREATE TRIGGER statement
    let createTriggerSQL = `CREATE `;
    
    if (constraintTrigger) {
      createTriggerSQL += `CONSTRAINT `;
    }
    
    createTriggerSQL += `TRIGGER ${name}
      ${timing} ${events.join(" OR ")} ON ${schema}.${table}
    `;
    
    if (level === "ROW" && !events.includes("TRUNCATE")) {
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
    
    createTriggerSQL += `EXECUTE FUNCTION ${functionSchema}.${functionName}(`;
    
    if (functionArgs && functionArgs.length > 0) {
      createTriggerSQL += functionArgs.join(", ");
    }
    
    createTriggerSQL += `);`;

    // Execute the CREATE TRIGGER statement
    await pool.query(createTriggerSQL);

    // Fetch the created trigger to return its details
    const triggerQuery = `
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
      WHERE n.nspname = $1 AND c.relname = $2 AND t.tgname = $3
    `;

    const result = await pool.query(triggerQuery, [schema, table, name]);

    if (result.rows.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "Trigger was created but could not be retrieved" }, null, 2)
          }
        ]
      };
    }

    const row = result.rows[0];
    const triggerInfo = {
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

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(triggerInfo, null, 2)
        }
      ]
    };
  } catch (error) {
    console.error("Error creating trigger:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Failed to create trigger: ${errorMessage}` }, null, 2)
        }
      ]
    };
  }
}; 