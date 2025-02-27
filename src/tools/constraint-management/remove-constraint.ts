import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for remove-constraint tool
export const removeConstraintSchema = {
  schema: z.string().default("public").describe("Schema name"),
  table: z.string().describe("Table name"),
  name: z.string().describe("Constraint name"),
  cascade: z.boolean().default(false).describe("Whether to cascade the constraint removal to dependent objects"),
  ifExists: z.boolean().default(true).describe("Do not throw an error if the constraint does not exist")
};

// Handler for remove-constraint tool
export const removeConstraintHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      schema = "public", 
      table, 
      name, 
      cascade = false,
      ifExists = true
    } = params as {
      schema: string;
      table: string;
      name: string;
      cascade?: boolean;
      ifExists?: boolean;
    };

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
        array_agg(kcu.column_name) as columns
      FROM 
        information_schema.table_constraints tc
      LEFT JOIN 
        information_schema.key_column_usage kcu 
        ON tc.constraint_name = kcu.constraint_name 
        AND tc.table_name = kcu.table_name
        AND tc.constraint_schema = kcu.constraint_schema
      WHERE 
        tc.constraint_schema = $1
        AND tc.table_name = $2
        AND tc.constraint_name = $3
      GROUP BY 
        tc.constraint_type;
    `;
    
    const constraintResult = await pool.query(constraintQuery, [schema, table, name]);
    
    if (constraintResult.rows.length === 0) {
      // Check if it might be a NOT NULL constraint
      const notNullQuery = `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = $1
        AND table_name = $2
        AND is_nullable = 'NO'
        AND column_name = $3;
      `;
      
      // Try to extract column name from constraint name (common pattern: table_column_notnull)
      const possibleColumnName = name.replace(`${table}_`, '').replace('_notnull', '');
      const notNullResult = await pool.query(notNullQuery, [schema, table, possibleColumnName]);
      
      if (notNullResult.rows.length > 0) {
        // It's likely a NOT NULL constraint
        const dropNotNullSql = `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${possibleColumnName}" DROP NOT NULL`;
        
        try {
          await pool.query(dropNotNullSql);
          
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                message: `Successfully removed NOT NULL constraint from column "${possibleColumnName}" in table "${schema}.${table}"`,
                constraint: {
                  schema,
                  table,
                  name,
                  type: "NOT NULL",
                  column: possibleColumnName
                }
              }, null, 2)
            }]
          };
        } catch (error) {
          if (ifExists) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  message: `Constraint "${name}" does not exist on table "${schema}.${table}", no action taken`,
                  removed: false
                }, null, 2)
              }]
            };
          } else {
            throw new Error(`Constraint "${name}" does not exist on table "${schema}.${table}"`);
          }
        }
      } else if (ifExists) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              message: `Constraint "${name}" does not exist on table "${schema}.${table}", no action taken`,
              removed: false
            }, null, 2)
          }]
        };
      } else {
        throw new Error(`Constraint "${name}" does not exist on table "${schema}.${table}"`);
      }
    }
    
    // Store constraint details for the response
    const constraintDetails = {
      schema,
      table,
      name,
      type: constraintResult.rows[0].constraint_type,
      columns: constraintResult.rows[0].columns
    };
    
    // Build the ALTER TABLE statement
    let sql = `ALTER TABLE "${schema}"."${table}" DROP CONSTRAINT `;
    
    if (ifExists) {
      sql += `IF EXISTS `;
    }
    
    sql += `"${name}"`;
    
    if (cascade) {
      sql += ` CASCADE`;
    }
    
    // Execute the ALTER TABLE statement
    await pool.query(sql);
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          message: `Successfully removed ${constraintDetails.type} constraint "${name}" from table "${schema}.${table}"`,
          removed: true,
          constraint: constraintDetails
        }, null, 2)
      }]
    };
  } catch (error) {
    console.error("Error removing constraint:", error);
    throw new Error(`Failed to remove constraint: ${error}`);
  }
};
