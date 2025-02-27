import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for create-enumerated-type tool
export const createEnumeratedTypeSchema = {
  schema: z.string().default("public").describe("Schema name"),
  name: z.string().describe("Enumerated type name"),
  values: z.array(z.string()).min(1).describe("List of enum values"),
  ifNotExists: z.boolean().default(false).describe("Whether to ignore if the type already exists")
};

// Handler for create-enumerated-type tool
export const createEnumeratedTypeHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      schema = "public",
      name,
      values,
      ifNotExists = false
    } = params as {
      schema?: string;
      name: string;
      values: string[];
      ifNotExists?: boolean;
    };

    // Validate that values array is not empty
    if (!values || values.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "Enum values array cannot be empty" }, null, 2)
          }
        ]
      };
    }

    // Check if the type already exists
    const checkQuery = `
      SELECT 1 
      FROM pg_type t 
      JOIN pg_namespace n ON t.typnamespace = n.oid 
      WHERE t.typname = $1 
        AND n.nspname = $2
        AND t.typtype = 'e'
    `;
    const checkResult = await pool.query(checkQuery, [name, schema]);
    
    if (checkResult.rows.length > 0) {
      if (ifNotExists) {
        // If type exists and ifNotExists is true, return success with a note
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ 
                message: `Enumerated type ${schema}.${name} already exists, no action taken`,
                exists: true
              }, null, 2)
            }
          ]
        };
      } else {
        // If type exists and ifNotExists is false, return error
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: `Enumerated type ${schema}.${name} already exists` }, null, 2)
            }
          ]
        };
      }
    }

    // Prepare values for SQL query - escape single quotes and properly format
    const formattedValues = values.map(value => {
      // Replace single quotes with two single quotes for SQL safety
      const escapedValue = value.replace(/'/g, "''");
      return `'${escapedValue}'`;
    }).join(", ");

    // Build the CREATE TYPE statement
    const createTypeSQL = `CREATE TYPE ${schema}.${name} AS ENUM (${formattedValues});`;

    // Execute the CREATE TYPE statement
    await pool.query(createTypeSQL);

    // Fetch the created type to return its details
    const typeQuery = `
      SELECT 
        n.nspname AS schema_name,
        t.typname AS type_name,
        array_agg(e.enumlabel ORDER BY e.enumsortorder) AS enum_values
      FROM pg_type t
      JOIN pg_namespace n ON t.typnamespace = n.oid
      JOIN pg_enum e ON t.oid = e.enumtypid
      WHERE t.typname = $1
        AND n.nspname = $2
      GROUP BY n.nspname, t.typname
    `;

    const result = await pool.query(typeQuery, [name, schema]);

    if (result.rows.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "Enumerated type was created but could not be retrieved" }, null, 2)
          }
        ]
      };
    }

    const row = result.rows[0];
    const typeInfo = {
      schema: row.schema_name,
      name: row.type_name,
      values: row.enum_values
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            message: `Enumerated type ${schema}.${name} created successfully`,
            enum_type: typeInfo
          }, null, 2)
        }
      ]
    };
  } catch (error) {
    console.error("Error creating enumerated type:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Failed to create enumerated type: ${errorMessage}` }, null, 2)
        }
      ]
    };
  }
}; 