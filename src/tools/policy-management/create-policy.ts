import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for create-policy tool
export const createPolicySchema = {
  schema: z.string().default("public").describe("Schema name"),
  table: z.string().describe("Table name"),
  name: z.string().describe("Policy name"),
  command: z.enum(["SELECT", "INSERT", "UPDATE", "DELETE", "ALL"]).describe("Command the policy applies to"),
  roles: z.array(z.string()).optional().describe("Roles the policy applies to (empty for PUBLIC)"),
  using: z.string().optional().describe("USING expression for the policy"),
  withCheck: z.string().optional().describe("WITH CHECK expression for the policy"),
  asRestrictive: z.boolean().default(false).describe("Whether the policy is restrictive (default is permissive)")
};

// Handler for create-policy tool
export const createPolicyHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      schema = "public",
      table,
      name,
      command,
      roles,
      using,
      withCheck,
      asRestrictive = false
    } = params as {
      schema?: string;
      table: string;
      name: string;
      command: "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "ALL";
      roles?: string[];
      using?: string;
      withCheck?: string;
      asRestrictive?: boolean;
    };

    // Validate input
    if (!using && !withCheck) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "At least one of USING or WITH CHECK expression must be provided" }, null, 2)
          }
        ]
      };
    }

    // Check if the table exists and has RLS enabled
    const tableCheckQuery = `
      SELECT c.relrowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE n.nspname = $1 AND c.relname = $2
    `;
    
    const tableCheckResult = await pool.query(tableCheckQuery, [schema, table]);
    
    if (tableCheckResult.rows.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: `Table ${schema}.${table} does not exist` }, null, 2)
          }
        ]
      };
    }

    const hasRLS = tableCheckResult.rows[0].relrowsecurity;
    
    if (!hasRLS) {
      // Enable RLS on the table
      const enableRLSQuery = `ALTER TABLE ${schema}.${table} ENABLE ROW LEVEL SECURITY;`;
      await pool.query(enableRLSQuery);
    }

    // Build the CREATE POLICY statement
    let createPolicySQL = `CREATE POLICY ${name} ON ${schema}.${table}`;
    
    // Add FOR clause
    createPolicySQL += ` FOR ${command}`;
    
    // Add TO clause
    if (roles && roles.length > 0) {
      createPolicySQL += ` TO ${roles.join(', ')}`;
    } else {
      createPolicySQL += ` TO PUBLIC`;
    }
    
    // Add AS clause if restrictive
    if (asRestrictive) {
      createPolicySQL += ` AS RESTRICTIVE`;
    }
    
    // Add USING clause if provided
    if (using) {
      createPolicySQL += ` USING (${using})`;
    }
    
    // Add WITH CHECK clause if provided
    if (withCheck) {
      createPolicySQL += ` WITH CHECK (${withCheck})`;
    }
    
    createPolicySQL += `;`;

    // Execute the CREATE POLICY statement
    await pool.query(createPolicySQL);

    // Fetch the created policy to return its details
    const policyQuery = `
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

    const result = await pool.query(policyQuery, [schema, table, name]);

    if (result.rows.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "Policy was created but could not be retrieved" }, null, 2)
          }
        ]
      };
    }

    const row = result.rows[0];
    const policyInfo: {
      name: any;
      schema: any;
      table: any;
      command: any;
      type: any;
      roles: any;
      using_expression: any;
      with_check_expression: any;
      rls_enabled: boolean;
      definition?: string;
    } = {
      name: row.policy_name,
      schema: row.schema_name,
      table: row.table_name,
      command: row.command,
      type: row.policy_type,
      roles: row.roles || 'PUBLIC',
      using_expression: row.using_expression || null,
      with_check_expression: row.with_check_expression || null,
      rls_enabled: true
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
    
    policyInfo.definition = definition;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(policyInfo, null, 2)
        }
      ]
    };
  } catch (error) {
    console.error("Error creating policy:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Failed to create policy: ${errorMessage}` }, null, 2)
        }
      ]
    };
  }
}; 