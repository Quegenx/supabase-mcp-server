import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for delete-enumerated-type tool
export const deleteEnumeratedTypeSchema = {
  schema: z.string().default("public").describe("Schema name"),
  name: z.string().describe("Enumerated type name"),
  ifExists: z.boolean().default(true).describe("Whether to ignore if the type doesn't exist"),
  cascade: z.boolean().default(false).describe("Whether to automatically drop objects that depend on this type")
};

// Handler for delete-enumerated-type tool
export const deleteEnumeratedTypeHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      schema = "public",
      name,
      ifExists = true,
      cascade = false
    } = params as {
      schema?: string;
      name: string;
      ifExists?: boolean;
      cascade?: boolean;
    };

    // Get type info before deletion for the response
    const typeInfoQuery = `
      SELECT 
        n.nspname AS schema_name,
        t.typname AS type_name,
        t.oid AS type_oid,
        array_agg(e.enumlabel ORDER BY e.enumsortorder) AS enum_values
      FROM pg_type t
      JOIN pg_namespace n ON t.typnamespace = n.oid
      JOIN pg_enum e ON t.oid = e.enumtypid
      WHERE t.typname = $1
        AND n.nspname = $2
        AND t.typtype = 'e'
      GROUP BY n.nspname, t.typname, t.oid
    `;
    
    const typeInfoResult = await pool.query(typeInfoQuery, [name, schema]);
    
    // Check if the type exists
    if (typeInfoResult.rows.length === 0) {
      if (ifExists) {
        // If type doesn't exist and ifExists is true, return success with a note
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ 
                message: `Enumerated type ${schema}.${name} does not exist, no action taken`,
                exists: false
              }, null, 2)
            }
          ]
        };
      } else {
        // If type doesn't exist and ifExists is false, return error
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: `Enumerated type ${schema}.${name} does not exist` }, null, 2)
            }
          ]
        };
      }
    }

    const typeOid = typeInfoResult.rows[0].type_oid;
    
    // Check for dependencies if cascade is false
    if (!cascade) {
      // Check for columns using this type
      const dependenciesQuery = `
        SELECT 
          n.nspname AS schema_name,
          c.relname AS table_name,
          a.attname AS column_name
        FROM pg_attribute a
        JOIN pg_class c ON a.attrelid = c.oid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE a.atttypid = $1
          AND c.relkind = 'r'
          AND NOT a.attisdropped
      `;
      
      const dependenciesResult = await pool.query(dependenciesQuery, [typeOid]);
      
      if (dependenciesResult.rows.length > 0) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ 
                error: `Cannot drop type ${schema}.${name} because other objects depend on it. Use cascade=true to drop dependent objects as well.`,
                dependencies: dependenciesResult.rows
              }, null, 2)
            }
          ]
        };
      }
    }

    // Build the DROP TYPE statement
    const dropTypeSQL = `DROP TYPE ${ifExists ? 'IF EXISTS' : ''} ${schema}.${name} ${cascade ? 'CASCADE' : 'RESTRICT'};`;

    // Execute the DROP TYPE statement
    await pool.query(dropTypeSQL);

    // Prepare the response
    const typeInfo = {
      schema: typeInfoResult.rows[0].schema_name,
      name: typeInfoResult.rows[0].type_name,
      values: typeInfoResult.rows[0].enum_values
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            message: `Enumerated type ${schema}.${name} deleted successfully`,
            enum_type: typeInfo,
            cascade_applied: cascade
          }, null, 2)
        }
      ]
    };
  } catch (error) {
    console.error("Error deleting enumerated type:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Failed to delete enumerated type: ${errorMessage}` }, null, 2)
        }
      ]
    };
  }
}; 