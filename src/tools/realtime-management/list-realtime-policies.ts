import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for list-realtime-policies tool
export const listRealtimePoliciesSchema = {
  includeDefinition: z.boolean().optional().default(true).describe("Include policy definition"),
  policyName: z.string().optional().describe("Policy name pattern to filter by (supports SQL LIKE pattern)"),
  limit: z.number().optional().default(50).describe("Maximum number of policies to return"),
  offset: z.number().optional().default(0).describe("Offset for pagination")
};

// Interface for Realtime policy information
interface RealtimePolicy {
  name: string;
  schema: string;
  table: string;
  action: string;
  roles: string[];
  command: string;
  definition: string;
  check_expression?: string;
  using_expression?: string;
  created_at: string;
}

// Handler for list-realtime-policies tool
export const listRealtimePoliciesHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      includeDefinition = true,
      policyName = "",
      limit = 5,
      offset = 0
    } = params as {
      includeDefinition?: boolean;
      policyName?: string;
      limit?: number;
      offset?: number;
    };

    // Build the query to fetch policies for the realtime.messages table
    let query = `
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
        p.polqual::text as using_expression,
        p.polwithcheck::text as check_expression,
        pg_catalog.pg_get_expr(p.polqual, p.polrelid) as using_definition,
        pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) as check_definition,
        CASE
          WHEN p.polpermissive THEN 'PERMISSIVE'
          ELSE 'RESTRICTIVE'
        END as action,
        p.polcreated as created_at
      FROM pg_policy p
      JOIN pg_class c ON p.polrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE n.nspname = 'realtime' AND c.relname = 'messages'
    `;

    // Add policy name filter if provided
    const queryParams: any[] = [];
    let paramIndex = 1;

    if (policyName && policyName.trim() !== "") {
      query += ` AND p.polname LIKE $${paramIndex}`;
      queryParams.push(`%${policyName}%`);
      paramIndex++;
    }

    // Add ORDER BY clause
    query += ` ORDER BY p.polname`;

    // Add pagination
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    queryParams.push(limit, offset);

    // Execute the query
    const result = await pool.query(query, queryParams);

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(*) as total
      FROM pg_policy p
      JOIN pg_class c ON p.polrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE n.nspname = 'realtime' AND c.relname = 'messages'
    `;

    if (policyName && policyName.trim() !== "") {
      countQuery += ` AND p.polname LIKE $1`;
    }

    const countResult = await pool.query(countQuery, policyName ? [`%${policyName}%`] : []);
    const totalCount = parseInt(countResult.rows[0].total);

    // Format the response
    const policies: RealtimePolicy[] = result.rows.map(row => {
      // Create policy definition string
      let definition = `CREATE POLICY "${row.name}" ON realtime.messages\n`;
      definition += `  FOR ${row.command}\n`;
      
      if (row.roles && row.roles.length > 0 && row.roles[0] !== '') {
        definition += `  TO ${row.roles.join(', ')}\n`;
      } else {
        definition += `  TO PUBLIC\n`;
      }
      
      if (row.using_expression) {
        definition += `  USING (${row.using_definition})\n`;
      }
      
      if (row.check_expression) {
        definition += `  WITH CHECK (${row.check_definition})\n`;
      }
      
      definition += `;`;

      return {
        name: row.name,
        schema: row.schema,
        table: row.table,
        action: row.action,
        roles: row.roles && row.roles[0] !== '' ? row.roles : ['PUBLIC'],
        command: row.command,
        definition: definition,
        using_expression: row.using_definition,
        check_expression: row.check_definition,
        created_at: row.created_at
      };
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            policies: includeDefinition 
              ? policies 
              : policies.map(({ definition, ...rest }) => rest),
            pagination: {
              total: totalCount,
              limit,
              offset,
              hasMore: offset + policies.length < totalCount
            }
          }, null, 2)
        }
      ]
    };
  } catch (error) {
    console.error("Error listing Realtime policies:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Failed to list Realtime policies: ${errorMessage}` }, null, 2)
        }
      ]
    };
  }
}; 