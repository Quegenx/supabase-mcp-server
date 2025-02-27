import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for delete-realtime-policy tool
export const deleteRealtimePolicySchema = {
  name: z.string().describe("Policy name to delete"),
  ifExists: z.boolean().optional().default(true).describe("Whether to ignore if the policy doesn't exist")
};

// Handler for delete-realtime-policy tool
export const deleteRealtimePolicyHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      name,
      ifExists = true
    } = params as {
      name: string;
      ifExists?: boolean;
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
      if (ifExists) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ 
                message: `Policy '${name}' does not exist on the realtime.messages table. No action taken.` 
              }, null, 2)
            }
          ]
        };
      } else {
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
    }

    const existingPolicy = policyCheckResult.rows[0];

    // Build the DROP POLICY statement
    let dropPolicyQuery = `DROP POLICY "${name}" ON realtime.messages`;
    
    if (ifExists) {
      dropPolicyQuery += ` IF EXISTS`;
    }
    
    // Execute the DROP POLICY statement
    await pool.query(dropPolicyQuery);
    
    // Create policy definition string for display (of the deleted policy)
    let definition = `CREATE POLICY "${existingPolicy.name}" ON realtime.messages\n`;
    
    if (existingPolicy.action === 'RESTRICTIVE') {
      definition += `  AS RESTRICTIVE\n`;
    }
    
    definition += `  FOR ${existingPolicy.command}\n`;
    
    if (existingPolicy.roles && existingPolicy.roles.length > 0 && existingPolicy.roles[0] !== '') {
      definition += `  TO ${existingPolicy.roles.join(', ')}\n`;
    } else {
      definition += `  TO PUBLIC\n`;
    }
    
    if (existingPolicy.using_expression) {
      definition += `  USING (${existingPolicy.using_expression})\n`;
    }
    
    if (existingPolicy.check_expression) {
      definition += `  WITH CHECK (${existingPolicy.check_expression})\n`;
    }
    
    definition += `;`;
    
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            message: `Successfully deleted Realtime policy '${name}'.`,
            deletedPolicy: {
              name: existingPolicy.name,
              schema: existingPolicy.schema,
              table: existingPolicy.table,
              command: existingPolicy.command,
              roles: existingPolicy.roles && existingPolicy.roles[0] !== '' ? existingPolicy.roles : ['PUBLIC'],
              action: existingPolicy.action,
              using_expression: existingPolicy.using_expression,
              check_expression: existingPolicy.check_expression,
              definition
            }
          }, null, 2)
        }
      ]
    };
  } catch (error) {
    console.error("Error deleting Realtime policy:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Failed to delete Realtime policy: ${errorMessage}` }, null, 2)
        }
      ]
    };
  }
}; 