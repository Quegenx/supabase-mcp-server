import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for update-policy tool
export const updatePolicySchema = {
  schema: z.string().default("public").describe("Schema name"),
  table: z.string().describe("Table name"),
  name: z.string().describe("Current policy name"),
  newName: z.string().optional().describe("New policy name (if renaming)"),
  command: z.enum(["SELECT", "INSERT", "UPDATE", "DELETE", "ALL"]).optional().describe("Command the policy applies to"),
  roles: z.array(z.string()).optional().describe("Roles the policy applies to (empty for PUBLIC)"),
  using: z.string().optional().describe("USING expression for the policy"),
  withCheck: z.string().optional().describe("WITH CHECK expression for the policy"),
  asRestrictive: z.boolean().optional().describe("Whether the policy is restrictive (default is permissive)"),
  recreate: z.boolean().default(false).describe("Whether to recreate the policy with new properties")
};

// Handler for update-policy tool
export const updatePolicyHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      schema = "public",
      table,
      name,
      newName,
      command,
      roles,
      using,
      withCheck,
      asRestrictive,
      recreate = false
    } = params as {
      schema?: string;
      table: string;
      name: string;
      newName?: string;
      command?: "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "ALL";
      roles?: string[];
      using?: string;
      withCheck?: string;
      asRestrictive?: boolean;
      recreate?: boolean;
    };

    // Check if the policy exists
    const checkQuery = `
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
        pg_get_expr(p.polqual, p.polrelid) AS using_expression,
        pg_get_expr(p.polwithcheck, p.polrelid) AS with_check_expression,
        array_to_string(array(
          SELECT rolname FROM pg_roles WHERE oid = ANY(p.polroles)
        ), ', ') AS roles
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

    const policyInfo = checkResult.rows[0];
    let updatedPolicy: {
      name: any;
      schema: any;
      table: any;
      command: any;
      type: any;
      roles: any;
      using_expression: any;
      with_check_expression: any;
      definition?: string;
    };
    const operations = {
      renamed: false,
      recreated: false
    };

    // Handle rename operation
    if (newName && newName !== name) {
      const renameSQL = `ALTER POLICY ${name} ON ${schema}.${table} RENAME TO ${newName};`;
      await pool.query(renameSQL);
      operations.renamed = true;
    }

    // Handle recreate operation
    if (recreate) {
      // Drop the existing policy
      const dropSQL = `DROP POLICY ${name} ON ${schema}.${table};`;
      await pool.query(dropSQL);

      // Build the CREATE POLICY statement for the new policy
      const policyNameToUse = newName || name;
      const commandToUse = command || policyInfo.command;
      const usingExprToUse = using !== undefined ? using : policyInfo.using_expression;
      const withCheckExprToUse = withCheck !== undefined ? withCheck : policyInfo.with_check_expression;
      const isRestrictive = asRestrictive !== undefined ? asRestrictive : (policyInfo.policy_type === 'RESTRICTIVE');
      
      let createPolicySQL = `CREATE POLICY ${policyNameToUse} ON ${schema}.${table}`;
      
      // Add FOR clause
      createPolicySQL += ` FOR ${commandToUse}`;
      
      // Add TO clause
      if (roles && roles.length > 0) {
        createPolicySQL += ` TO ${roles.join(', ')}`;
      } else if (policyInfo.roles) {
        createPolicySQL += ` TO ${policyInfo.roles}`;
      } else {
        createPolicySQL += ` TO PUBLIC`;
      }
      
      // Add AS clause if restrictive
      if (isRestrictive) {
        createPolicySQL += ` AS RESTRICTIVE`;
      }
      
      // Add USING clause if provided
      if (usingExprToUse) {
        createPolicySQL += ` USING (${usingExprToUse})`;
      }
      
      // Add WITH CHECK clause if provided
      if (withCheckExprToUse) {
        createPolicySQL += ` WITH CHECK (${withCheckExprToUse})`;
      }
      
      createPolicySQL += `;`;

      // Execute the CREATE POLICY statement
      await pool.query(createPolicySQL);
      operations.recreated = true;
    }

    // Fetch the updated policy to return its details
    const updatedPolicyName = newName || name;
    const updatedPolicyQuery = `
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
        pg_get_expr(p.polqual, p.polrelid) AS using_expression,
        pg_get_expr(p.polwithcheck, p.polrelid) AS with_check_expression,
        array_to_string(array(
          SELECT rolname FROM pg_roles WHERE oid = ANY(p.polroles)
        ), ', ') AS roles
      FROM pg_policy p
      JOIN pg_class c ON p.polrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE n.nspname = $1 AND c.relname = $2 AND p.polname = $3
    `;

    const updatedResult = await pool.query(updatedPolicyQuery, [schema, table, updatedPolicyName]);

    if (updatedResult.rows.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "Policy was updated but could not be retrieved" }, null, 2)
          }
        ]
      };
    }

    const row = updatedResult.rows[0];
    updatedPolicy = {
      name: row.policy_name,
      schema: row.schema_name,
      table: row.table_name,
      command: row.command,
      type: row.policy_type,
      roles: row.roles || 'PUBLIC',
      using_expression: row.using_expression || null,
      with_check_expression: row.with_check_expression || null
    };

    // Construct a readable policy definition
    let definition = `POLICY ${row.policy_name} ON ${row.schema_name}.${row.table_name}\n`;
    definition += `  FOR ${row.command}\n`;
    definition += `  TO ${row.roles || 'PUBLIC'}\n`;
    
    if (row.policy_type === 'RESTRICTIVE') {
      definition += `  AS RESTRICTIVE\n`;
    }
    
    if (row.using_expression) {
      definition += `  USING (${row.using_expression})\n`;
    }
    
    if (row.with_check_expression) {
      definition += `  WITH CHECK (${row.with_check_expression})`;
    }
    
    updatedPolicy.definition = definition;

    const response = {
      message: `Policy ${name} on table ${schema}.${table} has been successfully updated`,
      policy: updatedPolicy,
      operations
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
    console.error("Error updating policy:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Failed to update policy: ${errorMessage}` }, null, 2)
        }
      ]
    };
  }
}; 