import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for create-realtime-policy tool
export const createRealtimePolicySchema = {
  name: z.string().describe("Policy name"),
  command: z.enum(["SELECT", "INSERT", "UPDATE", "DELETE", "ALL"]).describe("Command the policy applies to"),
  roles: z.array(z.string()).optional().describe("Roles the policy applies to (empty for PUBLIC)"),
  using: z.string().optional().describe("USING expression for the policy"),
  withCheck: z.string().optional().describe("WITH CHECK expression for the policy"),
  asRestrictive: z.boolean().optional().default(false).describe("Whether the policy is restrictive (default is permissive)")
};

// Handler for create-realtime-policy tool
export const createRealtimePolicyHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      name,
      command,
      roles = [],
      using,
      withCheck,
      asRestrictive = false
    } = params as {
      name: string;
      command: "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "ALL";
      roles?: string[];
      using?: string;
      withCheck?: string;
      asRestrictive?: boolean;
    };

    // Check if the realtime schema and messages table exist
    const schemaCheckResult = await pool.query(`
      SELECT EXISTS (
        SELECT 1 
        FROM pg_namespace 
        WHERE nspname = 'realtime'
      ) as schema_exists;
    `);

    if (!schemaCheckResult.rows[0].schema_exists) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ 
              error: "The 'realtime' schema does not exist. Realtime must be enabled in your Supabase project." 
            }, null, 2)
          }
        ]
      };
    }

    const tableCheckResult = await pool.query(`
      SELECT EXISTS (
        SELECT 1 
        FROM pg_tables 
        WHERE schemaname = 'realtime' AND tablename = 'messages'
      ) as table_exists;
    `);

    if (!tableCheckResult.rows[0].table_exists) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ 
              error: "The 'realtime.messages' table does not exist. Realtime must be enabled in your Supabase project." 
            }, null, 2)
          }
        ]
      };
    }

    // Check if policy with the same name already exists
    const policyCheckResult = await pool.query(`
      SELECT EXISTS (
        SELECT 1 
        FROM pg_policy p
        JOIN pg_class c ON p.polrelid = c.oid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE n.nspname = 'realtime' AND c.relname = 'messages' AND p.polname = $1
      ) as policy_exists;
    `, [name]);

    if (policyCheckResult.rows[0].policy_exists) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ 
              error: `A policy named '${name}' already exists on the realtime.messages table.` 
            }, null, 2)
          }
        ]
      };
    }

    // Build the CREATE POLICY statement
    let createPolicyQuery = `CREATE POLICY "${name}" ON realtime.messages`;
    
    // Add policy type (permissive/restrictive)
    if (asRestrictive) {
      createPolicyQuery += ` AS RESTRICTIVE`;
    }
    
    // Add command
    createPolicyQuery += ` FOR ${command}`;
    
    // Add roles
    if (roles && roles.length > 0) {
      createPolicyQuery += ` TO ${roles.join(', ')}`;
    } else {
      createPolicyQuery += ` TO PUBLIC`;
    }
    
    // Add USING expression
    if (using) {
      createPolicyQuery += ` USING (${using})`;
    }
    
    // Add WITH CHECK expression
    if (withCheck) {
      createPolicyQuery += ` WITH CHECK (${withCheck})`;
    }
    
    // Execute the CREATE POLICY statement
    await pool.query(createPolicyQuery);
    
    // Fetch the created policy details
    const policyResult = await pool.query(`
      SELECT 
        p.polname as name,
        n.nspname as schema,
        c.relname as table,
        CASE
          WHEN p.polcmd = 'r' THEN 'SELECT'
          WHEN p.polcmd = 'a' THEN 'INSERT'
          WHEN p.polcmd = 'w' THEN 'UPDATE'
          WHEN p.polcmd = 'd' THEN 'DELETE'
          WHEN p.polcmd = '*' THEN 'ALL'
        END as command,
        ARRAY(
          SELECT rolname 
          FROM pg_roles 
          WHERE oid = ANY(p.polroles)
        ) as roles,
        pg_catalog.pg_get_expr(p.polqual, p.polrelid) as using_expression,
        pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) as check_expression,
        CASE
          WHEN p.polpermissive THEN 'PERMISSIVE'
          ELSE 'RESTRICTIVE'
        END as action
      FROM pg_policy p
      JOIN pg_class c ON p.polrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE n.nspname = 'realtime' AND c.relname = 'messages' AND p.polname = $1
    `, [name]);
    
    if (policyResult.rows.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ 
              error: "Policy was created but could not be retrieved. This is unexpected." 
            }, null, 2)
          }
        ]
      };
    }
    
    const policy = policyResult.rows[0];
    
    // Create policy definition string for display
    let definition = `CREATE POLICY "${policy.name}" ON realtime.messages\n`;
    
    if (policy.action === 'RESTRICTIVE') {
      definition += `  AS RESTRICTIVE\n`;
    }
    
    definition += `  FOR ${policy.command}\n`;
    
    if (policy.roles && policy.roles.length > 0 && policy.roles[0] !== '') {
      definition += `  TO ${policy.roles.join(', ')}\n`;
    } else {
      definition += `  TO PUBLIC\n`;
    }
    
    if (policy.using_expression) {
      definition += `  USING (${policy.using_expression})\n`;
    }
    
    if (policy.check_expression) {
      definition += `  WITH CHECK (${policy.check_expression})\n`;
    }
    
    definition += `;`;
    
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            message: `Successfully created Realtime policy '${name}'.`,
            policy: {
              name: policy.name,
              schema: policy.schema,
              table: policy.table,
              command: policy.command,
              roles: policy.roles && policy.roles[0] !== '' ? policy.roles : ['PUBLIC'],
              action: policy.action,
              using_expression: policy.using_expression,
              check_expression: policy.check_expression,
              definition
            }
          }, null, 2)
        }
      ]
    };
  } catch (error) {
    console.error("Error creating Realtime policy:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Failed to create Realtime policy: ${errorMessage}` }, null, 2)
        }
      ]
    };
  }
}; 