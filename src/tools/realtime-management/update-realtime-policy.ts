import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for update-realtime-policy tool
export const updateRealtimePolicySchema = {
  name: z.string().describe("Current policy name"),
  newName: z.string().optional().describe("New policy name (if renaming)"),
  command: z.enum(["SELECT", "INSERT", "UPDATE", "DELETE", "ALL"]).optional().describe("Command the policy applies to"),
  roles: z.array(z.string()).optional().describe("Roles the policy applies to (empty for PUBLIC)"),
  using: z.string().optional().describe("USING expression for the policy"),
  withCheck: z.string().optional().describe("WITH CHECK expression for the policy"),
  asRestrictive: z.boolean().optional().describe("Whether the policy is restrictive (default is permissive)"),
  recreate: z.boolean().optional().default(true).describe("Whether to recreate the policy with new properties")
};

// Handler for update-realtime-policy tool
export const updateRealtimePolicyHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      name,
      newName,
      command,
      roles,
      using,
      withCheck,
      asRestrictive,
      recreate = true
    } = params as {
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
    const policyCheckResult = await pool.query(`
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

    if (policyCheckResult.rows.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ 
              error: `Policy '${name}' does not exist on the realtime.messages table.` 
            }, null, 2)
          }
        ]
      };
    }

    const existingPolicy = policyCheckResult.rows[0];

    // If only renaming the policy and not recreating
    if (newName && !recreate) {
      // Check if a policy with the new name already exists
      const newNameCheckResult = await pool.query(`
        SELECT EXISTS (
          SELECT 1 
          FROM pg_policy p
          JOIN pg_class c ON p.polrelid = c.oid
          JOIN pg_namespace n ON c.relnamespace = n.oid
          WHERE n.nspname = 'realtime' AND c.relname = 'messages' AND p.polname = $1
        ) as policy_exists;
      `, [newName]);

      if (newNameCheckResult.rows[0].policy_exists) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ 
                error: `A policy named '${newName}' already exists on the realtime.messages table.` 
              }, null, 2)
            }
          ]
        };
      }

      // Rename the policy
      await pool.query(`ALTER POLICY "${name}" ON realtime.messages RENAME TO "${newName}";`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              message: `Successfully renamed Realtime policy from '${name}' to '${newName}'.`,
              policy: {
                name: newName,
                schema: existingPolicy.schema,
                table: existingPolicy.table,
                command: existingPolicy.command,
                roles: existingPolicy.roles && existingPolicy.roles[0] !== '' ? existingPolicy.roles : ['PUBLIC'],
                action: existingPolicy.action,
                using_expression: existingPolicy.using_expression,
                check_expression: existingPolicy.check_expression
              }
            }, null, 2)
          }
        ]
      };
    }

    // For recreating the policy with new properties
    if (recreate) {
      // Start a transaction
      await pool.query('BEGIN');

      try {
        // Drop the existing policy
        await pool.query(`DROP POLICY "${name}" ON realtime.messages;`);

        // Build the CREATE POLICY statement
        const policyName = newName || name;
        let createPolicyQuery = `CREATE POLICY "${policyName}" ON realtime.messages`;
        
        // Add policy type (permissive/restrictive)
        if (asRestrictive !== undefined) {
          if (asRestrictive) {
            createPolicyQuery += ` AS RESTRICTIVE`;
          }
        } else if (existingPolicy.action === 'RESTRICTIVE') {
          createPolicyQuery += ` AS RESTRICTIVE`;
        }
        
        // Add command
        const policyCommand = command || existingPolicy.command;
        createPolicyQuery += ` FOR ${policyCommand}`;
        
        // Add roles
        const policyRoles = roles !== undefined ? roles : 
          (existingPolicy.roles && existingPolicy.roles[0] !== '' ? existingPolicy.roles : []);
        
        if (policyRoles && policyRoles.length > 0) {
          createPolicyQuery += ` TO ${policyRoles.join(', ')}`;
        } else {
          createPolicyQuery += ` TO PUBLIC`;
        }
        
        // Add USING expression
        const policyUsing = using !== undefined ? using : existingPolicy.using_expression;
        if (policyUsing) {
          createPolicyQuery += ` USING (${policyUsing})`;
        }
        
        // Add WITH CHECK expression
        const policyWithCheck = withCheck !== undefined ? withCheck : existingPolicy.check_expression;
        if (policyWithCheck) {
          createPolicyQuery += ` WITH CHECK (${policyWithCheck})`;
        }
        
        // Execute the CREATE POLICY statement
        await pool.query(createPolicyQuery);
        
        // Commit the transaction
        await pool.query('COMMIT');
        
        // Fetch the updated policy details
        const updatedPolicyResult = await pool.query(`
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
        `, [policyName]);
        
        if (updatedPolicyResult.rows.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ 
                  error: "Policy was updated but could not be retrieved. This is unexpected." 
                }, null, 2)
              }
            ]
          };
        }
        
        const updatedPolicy = updatedPolicyResult.rows[0];
        
        // Create policy definition string for display
        let definition = `CREATE POLICY "${updatedPolicy.name}" ON realtime.messages\n`;
        
        if (updatedPolicy.action === 'RESTRICTIVE') {
          definition += `  AS RESTRICTIVE\n`;
        }
        
        definition += `  FOR ${updatedPolicy.command}\n`;
        
        if (updatedPolicy.roles && updatedPolicy.roles.length > 0 && updatedPolicy.roles[0] !== '') {
          definition += `  TO ${updatedPolicy.roles.join(', ')}\n`;
        } else {
          definition += `  TO PUBLIC\n`;
        }
        
        if (updatedPolicy.using_expression) {
          definition += `  USING (${updatedPolicy.using_expression})\n`;
        }
        
        if (updatedPolicy.check_expression) {
          definition += `  WITH CHECK (${updatedPolicy.check_expression})\n`;
        }
        
        definition += `;`;
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                message: `Successfully updated Realtime policy '${name}'${newName ? ` to '${newName}'` : ''}.`,
                policy: {
                  name: updatedPolicy.name,
                  schema: updatedPolicy.schema,
                  table: updatedPolicy.table,
                  command: updatedPolicy.command,
                  roles: updatedPolicy.roles && updatedPolicy.roles[0] !== '' ? updatedPolicy.roles : ['PUBLIC'],
                  action: updatedPolicy.action,
                  using_expression: updatedPolicy.using_expression,
                  check_expression: updatedPolicy.check_expression,
                  definition
                }
              }, null, 2)
            }
          ]
        };
      } catch (error) {
        // Rollback the transaction in case of error
        await pool.query('ROLLBACK');
        throw error;
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ 
            error: "No update operation was specified. Set 'recreate' to true or provide 'newName' to rename the policy." 
          }, null, 2)
        }
      ]
    };
  } catch (error) {
    console.error("Error updating Realtime policy:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Failed to update Realtime policy: ${errorMessage}` }, null, 2)
        }
      ]
    };
  }
}; 