import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for delete-policy tool
export const deletePolicySchema = {
  schema: z.string().default("public").describe("Schema name"),
  table: z.string().describe("Table name"),
  name: z.string().describe("Policy name"),
  ifExists: z.boolean().default(true).describe("Whether to ignore if the policy doesn't exist")
};

// Handler for delete-policy tool
export const deletePolicyHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      schema = "public",
      table,
      name,
      ifExists = true
    } = params as {
      schema?: string;
      table: string;
      name: string;
      ifExists?: boolean;
    };

    // Check if the policy exists before deletion (if ifExists is false)
    if (!ifExists) {
      const checkQuery = `
        SELECT 1 
        FROM pg_policy p
        JOIN pg_class c ON p.polrelid = c.oid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE n.nspname = $1 AND c.relname = $2 AND p.polname = $3
      `;
      
      const checkResult = await pool.query(checkQuery, [schema, table, name]);
      
      if (checkResult.rows.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: `Policy ${name} on table ${schema}.${table} does not exist` }, null, 2)
            }
          ]
        };
      }
    }

    // Get policy info before deletion for the response
    const policyInfoQuery = `
      SELECT 
        p.polname AS policy_name,
        n.nspname AS schema_name,
        c.relname AS table_name,
        CASE p.polcmd
          WHEN 'r' THEN 'SELECT'
          WHEN 'a' THEN 'INSERT'
          WHEN 'w' THEN 'UPDATE'
          WHEN 'd' THEN 'DELETE'
          WHEN '*' THEN 'ALL'
        END AS command,
        CASE p.polpermissive
          WHEN true THEN 'PERMISSIVE'
          ELSE 'RESTRICTIVE'
        END AS policy_type,
        array_to_string(array(
          SELECT rolname FROM pg_roles WHERE oid = ANY(p.polroles)
        ), ', ') AS roles
      FROM pg_policy p
      JOIN pg_class c ON p.polrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE n.nspname = $1 AND c.relname = $2 AND p.polname = $3
    `;
    
    const policyInfoResult = await pool.query(policyInfoQuery, [schema, table, name]);
    
    // Build the DROP POLICY statement
    const dropPolicySQL = `DROP POLICY ${ifExists ? 'IF EXISTS' : ''} ${name} ON ${schema}.${table};`;

    // Execute the DROP POLICY statement
    await pool.query(dropPolicySQL);

    // Check if there are any remaining policies on the table
    const remainingPoliciesQuery = `
      SELECT COUNT(*) 
      FROM pg_policy p
      JOIN pg_class c ON p.polrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE n.nspname = $1 AND c.relname = $2
    `;
    
    const remainingPoliciesResult = await pool.query(remainingPoliciesQuery, [schema, table]);
    const remainingPoliciesCount = parseInt(remainingPoliciesResult.rows[0].count);

    // Prepare the response
    const policyInfo = policyInfoResult.rows.length > 0 
      ? {
          name: policyInfoResult.rows[0].policy_name,
          schema: policyInfoResult.rows[0].schema_name,
          table: policyInfoResult.rows[0].table_name,
          command: policyInfoResult.rows[0].command,
          type: policyInfoResult.rows[0].policy_type,
          roles: policyInfoResult.rows[0].roles || 'PUBLIC'
        }
      : {
          name,
          schema,
          table
        };

    const response = {
      message: `Policy ${name} on table ${schema}.${table} has been successfully deleted`,
      policy: policyInfo,
      remaining_policies_count: remainingPoliciesCount
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
    console.error("Error deleting policy:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Failed to delete policy: ${errorMessage}` }, null, 2)
        }
      ]
    };
  }
}; 