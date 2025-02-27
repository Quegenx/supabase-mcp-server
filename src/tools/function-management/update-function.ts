import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for update-function tool
export const updateFunctionSchema = {
  schema: z.string().default("public").describe("Schema name"),
  name: z.string().describe("Function name"),
  newName: z.string().optional().describe("New function name (if renaming)"),
  arguments: z.string().describe("Function arguments with types (e.g., 'arg1 int, arg2 text')"),
  returns: z.string().describe("Return type (e.g., 'int', 'text', 'table(id int, name text)')"),
  language: z.string().default("plpgsql").describe("Function language (e.g., 'plpgsql', 'sql')"),
  body: z.string().describe("Function body/definition"),
  volatility: z.enum(["IMMUTABLE", "STABLE", "VOLATILE"]).default("VOLATILE").describe("Function volatility"),
  strict: z.boolean().default(false).describe("Whether the function is strict (returns NULL if any argument is NULL)"),
  securityDefiner: z.boolean().default(false).describe("Whether the function executes with the privileges of the owner"),
  leakproof: z.boolean().default(false).describe("Whether the function has no side effects"),
  parallel: z.enum(["UNSAFE", "RESTRICTED", "SAFE"]).default("UNSAFE").describe("Parallel execution safety"),
  cost: z.number().optional().describe("Estimated execution cost"),
  rows: z.number().optional().describe("Estimated number of rows returned (for set-returning functions)")
};

// Handler for update-function tool
export const updateFunctionHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      schema = "public",
      name,
      newName,
      arguments: args,
      returns,
      language = "plpgsql",
      body,
      volatility = "VOLATILE",
      strict = false,
      securityDefiner = false,
      leakproof = false,
      parallel = "UNSAFE",
      cost,
      rows
    } = params as {
      schema?: string;
      name: string;
      newName?: string;
      arguments: string;
      returns: string;
      language?: string;
      body: string;
      volatility?: "IMMUTABLE" | "STABLE" | "VOLATILE";
      strict?: boolean;
      securityDefiner?: boolean;
      leakproof?: boolean;
      parallel?: "UNSAFE" | "RESTRICTED" | "SAFE";
      cost?: number;
      rows?: number;
    };

    // Check if the function exists
    const checkQuery = `
      SELECT 1 
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = $1 AND p.proname = $2
    `;
    
    const checkResult = await pool.query(checkQuery, [schema, name]);
    
    if (checkResult.rows.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: `Function ${schema}.${name} does not exist.` }, null, 2)
          }
        ]
      };
    }

    // If renaming, use ALTER FUNCTION to rename
    if (newName && newName !== name) {
      const renameQuery = `ALTER FUNCTION ${schema}.${name}(${args}) RENAME TO ${newName};`;
      await pool.query(renameQuery);
    }

    // Update the function definition
    const functionName = newName || name;
    
    let updateFunctionSQL = `
      CREATE OR REPLACE FUNCTION ${schema}.${functionName}(${args})
      RETURNS ${returns}
      LANGUAGE ${language}
      ${volatility}
      ${strict ? 'STRICT' : ''}
      ${securityDefiner ? 'SECURITY DEFINER' : ''}
      ${leakproof ? 'LEAKPROOF' : ''}
      PARALLEL ${parallel}
    `;

    // Add optional parameters if provided
    if (cost !== undefined) {
      updateFunctionSQL += `\nCOST ${cost}`;
    }

    if (rows !== undefined) {
      updateFunctionSQL += `\nROWS ${rows}`;
    }

    // Add function body
    updateFunctionSQL += `\nAS $function$\n${body}\n$function$;`;

    // Execute the CREATE OR REPLACE FUNCTION statement
    await pool.query(updateFunctionSQL);

    // Fetch the updated function to return its details
    const functionQuery = `
      SELECT 
        n.nspname AS schema_name,
        p.proname AS function_name,
        pg_get_function_identity_arguments(p.oid) AS function_arguments,
        pg_get_function_result(p.oid) AS return_type,
        l.lanname AS language,
        CASE
          WHEN p.provolatile = 'i' THEN 'IMMUTABLE'
          WHEN p.provolatile = 's' THEN 'STABLE'
          WHEN p.provolatile = 'v' THEN 'VOLATILE'
        END AS volatility,
        p.proisstrict AS is_strict,
        p.prosecdef AS security_definer,
        p.proleakproof AS is_leakproof,
        CASE
          WHEN p.proparallel = 'u' THEN 'UNSAFE'
          WHEN p.proparallel = 'r' THEN 'RESTRICTED'
          WHEN p.proparallel = 's' THEN 'SAFE'
        END AS parallel,
        p.procost AS cost,
        p.prorows AS rows,
        pg_get_functiondef(p.oid) AS function_definition
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      JOIN pg_language l ON p.prolang = l.oid
      WHERE n.nspname = $1 AND p.proname = $2
    `;

    const result = await pool.query(functionQuery, [schema, functionName]);

    if (result.rows.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "Function was updated but could not be retrieved." }, null, 2)
          }
        ]
      };
    }

    const functionInfo = {
      schema: result.rows[0].schema_name,
      name: result.rows[0].function_name,
      arguments: result.rows[0].function_arguments,
      return_type: result.rows[0].return_type,
      language: result.rows[0].language,
      volatility: result.rows[0].volatility,
      is_strict: result.rows[0].is_strict,
      security_definer: result.rows[0].security_definer,
      is_leakproof: result.rows[0].is_leakproof,
      parallel: result.rows[0].parallel,
      cost: result.rows[0].cost,
      rows: result.rows[0].rows,
      source: result.rows[0].function_definition
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(functionInfo, null, 2)
        }
      ]
    };
  } catch (error) {
    console.error("Error updating function:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Failed to update function: ${errorMessage}` }, null, 2)
        }
      ]
    };
  }
}; 