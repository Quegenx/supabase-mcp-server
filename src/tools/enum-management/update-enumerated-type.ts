import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for update-enumerated-type tool
export const updateEnumeratedTypeSchema = {
  schema: z.string().default("public").describe("Schema name"),
  name: z.string().describe("Enumerated type name"),
  newName: z.string().optional().describe("New name for the enumerated type (if renaming)"),
  addValues: z.array(z.string()).optional().describe("Values to add to the enum"),
  addBefore: z.string().optional().describe("Existing value to add new values before"),
  addAfter: z.string().optional().describe("Existing value to add new values after"),
  renameValue: z.object({
    from: z.string(),
    to: z.string()
  }).optional().describe("Rename an existing enum value")
};

// Handler for update-enumerated-type tool
export const updateEnumeratedTypeHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      schema = "public",
      name,
      newName,
      addValues,
      addBefore,
      addAfter,
      renameValue
    } = params as {
      schema?: string;
      name: string;
      newName?: string;
      addValues?: string[];
      addBefore?: string;
      addAfter?: string;
      renameValue?: {
        from: string;
        to: string;
      };
    };

    // Check if the type exists
    const checkQuery = `
      SELECT t.oid
      FROM pg_type t 
      JOIN pg_namespace n ON t.typnamespace = n.oid 
      WHERE t.typname = $1 
        AND n.nspname = $2
        AND t.typtype = 'e'
    `;
    const checkResult = await pool.query(checkQuery, [name, schema]);
    
    if (checkResult.rows.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: `Enumerated type ${schema}.${name} does not exist` }, null, 2)
          }
        ]
      };
    }

    const typeOid = checkResult.rows[0].oid;
    const operations = [];

    // Begin a transaction for all operations
    await pool.query('BEGIN');

    try {
      // Handle rename operation
      if (newName && newName !== name) {
        const renameSQL = `ALTER TYPE ${schema}.${name} RENAME TO ${newName};`;
        await pool.query(renameSQL);
        operations.push(`Renamed type from ${name} to ${newName}`);
      }

      // Get current values to validate operations
      const currentValuesQuery = `
        SELECT enumlabel, enumsortorder
        FROM pg_enum
        WHERE enumtypid = $1
        ORDER BY enumsortorder
      `;
      const currentValuesResult = await pool.query(currentValuesQuery, [typeOid]);
      const currentValues = currentValuesResult.rows.map(row => row.enumlabel);
      
      // Handle rename value operation
      if (renameValue) {
        if (!currentValues.includes(renameValue.from)) {
          throw new Error(`Value '${renameValue.from}' does not exist in the enum`);
        }
        
        const renameValueSQL = `
          ALTER TYPE ${schema}.${newName || name} RENAME VALUE '${renameValue.from}' TO '${renameValue.to}';
        `;
        await pool.query(renameValueSQL);
        operations.push(`Renamed value '${renameValue.from}' to '${renameValue.to}'`);
      }

      // Handle add values operation
      if (addValues && addValues.length > 0) {
        // Validate position reference if provided
        if (addBefore && !currentValues.includes(addBefore)) {
          throw new Error(`Reference value '${addBefore}' for BEFORE position does not exist in the enum`);
        }
        
        if (addAfter && !currentValues.includes(addAfter)) {
          throw new Error(`Reference value '${addAfter}' for AFTER position does not exist in the enum`);
        }
        
        // Cannot specify both before and after
        if (addBefore && addAfter) {
          throw new Error("Cannot specify both addBefore and addAfter parameters");
        }
        
        // Add each value one by one
        for (const value of addValues) {
          // Check if value already exists
          if (currentValues.includes(value)) {
            throw new Error(`Value '${value}' already exists in the enum`);
          }
          
          let addValueSQL;
          if (addBefore) {
            addValueSQL = `ALTER TYPE ${schema}.${newName || name} ADD VALUE '${value}' BEFORE '${addBefore}';`;
          } else if (addAfter) {
            addValueSQL = `ALTER TYPE ${schema}.${newName || name} ADD VALUE '${value}' AFTER '${addAfter}';`;
          } else {
            // Default is to add at the end
            addValueSQL = `ALTER TYPE ${schema}.${newName || name} ADD VALUE '${value}';`;
          }
          
          await pool.query(addValueSQL);
          operations.push(`Added value '${value}'`);
          
          // Update current values for subsequent operations
          currentValues.push(value);
        }
      }

      // Commit the transaction
      await pool.query('COMMIT');
    } catch (error) {
      // Rollback the transaction on error
      await pool.query('ROLLBACK');
      throw error;
    }

    // Fetch the updated type to return its details
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

    const result = await pool.query(typeQuery, [newName || name, schema]);

    if (result.rows.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "Enumerated type was updated but could not be retrieved" }, null, 2)
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
            message: `Enumerated type ${schema}.${name} updated successfully`,
            operations,
            enum_type: typeInfo
          }, null, 2)
        }
      ]
    };
  } catch (error) {
    console.error("Error updating enumerated type:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Failed to update enumerated type: ${errorMessage}` }, null, 2)
        }
      ]
    };
  }
}; 