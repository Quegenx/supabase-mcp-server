import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for update-constraint tool
export const updateConstraintSchema = {
  schema: z.string().default("public").describe("Schema name"),
  table: z.string().describe("Table name"),
  name: z.string().describe("Current constraint name"),
  newName: z.string().optional().describe("New constraint name (if renaming)"),
  validate: z.boolean().optional().describe("Validate a previously NOT VALID constraint"),
  deferrable: z.boolean().optional().describe("Change constraint to be deferrable"),
  notDeferrable: z.boolean().optional().describe("Change constraint to be not deferrable"),
  initiallyDeferred: z.boolean().optional().describe("Change constraint to be initially deferred"),
  initiallyImmediate: z.boolean().optional().describe("Change constraint to be initially immediate")
};

// Handler for update-constraint tool
export const updateConstraintHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      schema = "public", 
      table, 
      name, 
      newName,
      validate,
      deferrable,
      notDeferrable,
      initiallyDeferred,
      initiallyImmediate
    } = params as {
      schema: string;
      table: string;
      name: string;
      newName?: string;
      validate?: boolean;
      deferrable?: boolean;
      notDeferrable?: boolean;
      initiallyDeferred?: boolean;
      initiallyImmediate?: boolean;
    };

    // Check if at least one update parameter is provided
    if (!newName && validate === undefined && deferrable === undefined && 
        notDeferrable === undefined && initiallyDeferred === undefined && 
        initiallyImmediate === undefined) {
      throw new Error("At least one update parameter must be provided");
    }

    // Check if table exists
    const tableExistsQuery = `
      SELECT EXISTS (
        SELECT 1 
        FROM information_schema.tables 
        WHERE table_schema = $1 
        AND table_name = $2
      );
    `;
    const tableExistsResult = await pool.query(tableExistsQuery, [schema, table]);
    
    if (!tableExistsResult.rows[0].exists) {
      throw new Error(`Table "${schema}.${table}" does not exist`);
    }

    // Check if constraint exists and get its type
    const constraintQuery = `
      SELECT 
        tc.constraint_type,
        tc.is_deferrable,
        tc.initially_deferred
      FROM 
        information_schema.table_constraints tc
      WHERE 
        tc.constraint_schema = $1
        AND tc.table_name = $2
        AND tc.constraint_name = $3;
    `;
    
    const constraintResult = await pool.query(constraintQuery, [schema, table, name]);
    
    if (constraintResult.rows.length === 0) {
      throw new Error(`Constraint "${name}" does not exist on table "${schema}.${table}"`);
    }
    
    const constraintType = constraintResult.rows[0].constraint_type;
    const isDeferrable = constraintResult.rows[0].is_deferrable === "YES";
    const isInitiallyDeferred = constraintResult.rows[0].initially_deferred === "YES";
    
    // Begin transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Track changes for the response
      const changes = [];
      
      // Handle VALIDATE for foreign keys
      if (validate === true && constraintType === "FOREIGN KEY") {
        const validateSql = `ALTER TABLE "${schema}"."${table}" VALIDATE CONSTRAINT "${name}"`;
        await client.query(validateSql);
        changes.push("validated constraint");
      }
      
      // Handle deferrable changes
      if ((deferrable === true && !isDeferrable) || 
          (notDeferrable === true && isDeferrable)) {
        
        let deferrableSql = `ALTER TABLE "${schema}"."${table}" ALTER CONSTRAINT "${name}" `;
        
        if (deferrable) {
          deferrableSql += `DEFERRABLE`;
          changes.push("made constraint deferrable");
        } else if (notDeferrable) {
          deferrableSql += `NOT DEFERRABLE`;
          changes.push("made constraint not deferrable");
        }
        
        await client.query(deferrableSql);
      }
      
      // Handle initially deferred/immediate changes
      if ((initiallyDeferred === true && !isInitiallyDeferred) || 
          (initiallyImmediate === true && isInitiallyDeferred)) {
        
        let initialSql = `ALTER TABLE "${schema}"."${table}" ALTER CONSTRAINT "${name}" `;
        
        if (initiallyDeferred) {
          initialSql += `INITIALLY DEFERRED`;
          changes.push("made constraint initially deferred");
        } else if (initiallyImmediate) {
          initialSql += `INITIALLY IMMEDIATE`;
          changes.push("made constraint initially immediate");
        }
        
        await client.query(initialSql);
      }
      
      // Handle renaming
      if (newName) {
        const renameSql = `ALTER TABLE "${schema}"."${table}" RENAME CONSTRAINT "${name}" TO "${newName}"`;
        await client.query(renameSql);
        changes.push(`renamed constraint from "${name}" to "${newName}"`);
      }
      
      await client.query('COMMIT');
      
      // Get updated constraint details
      const updatedName = newName || name;
      const updatedConstraintQuery = `
        SELECT 
          tc.constraint_schema,
          tc.table_name,
          tc.constraint_name,
          tc.constraint_type,
          tc.is_deferrable,
          tc.initially_deferred,
          array_agg(kcu.column_name) as columns
        FROM 
          information_schema.table_constraints tc
        JOIN 
          information_schema.key_column_usage kcu 
          ON tc.constraint_name = kcu.constraint_name 
          AND tc.table_name = kcu.table_name
          AND tc.constraint_schema = kcu.constraint_schema
        WHERE 
          tc.constraint_schema = $1
          AND tc.table_name = $2
          AND tc.constraint_name = $3
        GROUP BY 
          tc.constraint_schema,
          tc.table_name,
          tc.constraint_name,
          tc.constraint_type,
          tc.is_deferrable,
          tc.initially_deferred;
      `;
      
      const updatedConstraintResult = await pool.query(updatedConstraintQuery, [schema, table, updatedName]);
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            message: `Successfully updated constraint "${name}" on table "${schema}.${table}"`,
            changes: changes,
            constraint: updatedConstraintResult.rows[0] || {
              constraint_schema: schema,
              table_name: table,
              constraint_name: updatedName,
              constraint_type: constraintType,
              is_deferrable: deferrable ? "YES" : (notDeferrable ? "NO" : (isDeferrable ? "YES" : "NO")),
              initially_deferred: initiallyDeferred ? "YES" : (initiallyImmediate ? "NO" : (isInitiallyDeferred ? "YES" : "NO"))
            }
          }, null, 2)
        }]
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Error updating constraint:", error);
    throw new Error(`Failed to update constraint: ${error}`);
  }
};
