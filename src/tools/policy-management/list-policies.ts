import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for list-policies tool
export const listPoliciesSchema = {
  schema: z.string().optional().describe("Schema name to filter by"),
  table: z.string().optional().describe("Table name to filter by"),
  policyName: z.string().optional().describe("Policy name pattern to filter by (supports SQL LIKE pattern)"),
  command: z.string().optional().describe("Filter by command type (SELECT, INSERT, UPDATE, DELETE, ALL)"),
  includeDefinition: z.boolean().default(false).describe("Include policy definition"),
  limit: z.number().default(20).describe("Maximum number of policies to return"),
  offset: z.number().default(0).describe("Offset for pagination"),
  summarize: z.boolean().default(false).describe("Return a summarized view with counts by schema/table"),
  concise: z.boolean().default(false).describe("Show all policies with minimal data per policy"),
  all: z.boolean().default(false).describe("Show all policies without pagination limit")
};

// Handler for list-policies tool
export const listPoliciesHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      schema,
      table,
      policyName,
      command,
      includeDefinition = false,
      limit = 5,
      offset = 0,
      summarize = false,
      concise = false,
      all = false
    } = params as {
      schema?: string;
      table?: string;
      policyName?: string;
      command?: string;
      includeDefinition?: boolean;
      limit?: number;
      offset?: number;
      summarize?: boolean;
      concise?: boolean;
      all?: boolean;
    };

    // If summarize is true, return a count of policies by schema and table
    if (summarize) {
      let summaryQuery = `
        SELECT 
          n.nspname AS schema_name,
          c.relname AS table_name,
          COUNT(*) AS policy_count
        FROM pg_policy p
        JOIN pg_class c ON p.polrelid = c.oid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE true
      `;

      const queryParams = [];
      let paramIndex = 1;

      // Add filters if provided
      if (schema) {
        summaryQuery += ` AND n.nspname = $${paramIndex}`;
        queryParams.push(schema);
        paramIndex++;
      }

      if (table) {
        summaryQuery += ` AND c.relname = $${paramIndex}`;
        queryParams.push(table);
        paramIndex++;
      }

      summaryQuery += ` GROUP BY n.nspname, c.relname ORDER BY n.nspname, c.relname`;
      
      const summaryResult = await pool.query(summaryQuery, queryParams);
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              summary: summaryResult.rows,
              message: "Use more specific filters to see detailed policy information"
            }, null, 2)
          }
        ]
      };
    }

    // If concise is true, return a simplified list of all policies
    if (concise) {
      let query = `
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
          ), ', ') AS roles,
          pg_get_expr(p.polqual, p.polrelid) AS using_expression,
          pg_get_expr(p.polwithcheck, p.polrelid) AS with_check_expression
        FROM pg_policy p
        JOIN pg_class c ON p.polrelid = c.oid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE true
      `;

      const queryParams = [];
      let paramIndex = 1;

      // Add filters if provided
      if (schema) {
        query += ` AND n.nspname = $${paramIndex}`;
        queryParams.push(schema);
        paramIndex++;
      }

      if (table) {
        query += ` AND c.relname = $${paramIndex}`;
        queryParams.push(table);
        paramIndex++;
      }

      if (policyName) {
        query += ` AND p.polname LIKE $${paramIndex}`;
        queryParams.push(policyName);
        paramIndex++;
      }

      if (command) {
        query += ` AND p.polcmd = CASE $${paramIndex}
          WHEN 'SELECT' THEN 'r'
          WHEN 'INSERT' THEN 'a'
          WHEN 'UPDATE' THEN 'w'
          WHEN 'DELETE' THEN 'd'
          WHEN 'ALL' THEN '*'
          ELSE $${paramIndex}
        END`;
        queryParams.push(command);
        paramIndex++;
      }

      query += ` ORDER BY n.nspname, c.relname, p.polname`;
      
      const result = await pool.query(query, queryParams);
      
      // Group policies by schema and table
      const policiesBySchemaAndTable: Record<string, Record<string, any[]>> = {};
      
      result.rows.forEach(row => {
        const { schema_name, table_name, policy_name, command, policy_type, roles, using_expression, with_check_expression } = row;
        
        if (!policiesBySchemaAndTable[schema_name]) {
          policiesBySchemaAndTable[schema_name] = {};
        }
        
        if (!policiesBySchemaAndTable[schema_name][table_name]) {
          policiesBySchemaAndTable[schema_name][table_name] = [];
        }
        
        policiesBySchemaAndTable[schema_name][table_name].push({
          name: policy_name,
          command,
          policy_type,
          roles: roles || 'PUBLIC',
          using_expression: using_expression,
          with_check_expression: with_check_expression
        });
      });
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              policies_by_schema_and_table: policiesBySchemaAndTable,
              total_count: result.rows.length
            }, null, 2)
          }
        ]
      };
    }

    // Build the query to list policies
    let query = `
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
        p.polroles AS role_ids,
        pg_get_expr(p.polqual, p.polrelid) AS using_expression,
        pg_get_expr(p.polwithcheck, p.polrelid) AS with_check_expression,
        array_to_string(array(
          SELECT rolname FROM pg_roles WHERE oid = ANY(p.polroles)
        ), ', ') AS roles
      FROM pg_policy p
      JOIN pg_class c ON p.polrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE true
    `;

    const queryParams = [];
    let paramIndex = 1;

    // Add schema filter if provided
    if (schema) {
      query += ` AND n.nspname = $${paramIndex}`;
      queryParams.push(schema);
      paramIndex++;
    }

    // Add table filter if provided
    if (table) {
      query += ` AND c.relname = $${paramIndex}`;
      queryParams.push(table);
      paramIndex++;
    }

    // Add policy name filter if provided
    if (policyName) {
      query += ` AND p.polname LIKE $${paramIndex}`;
      queryParams.push(policyName);
      paramIndex++;
    }

    // Add command filter if provided
    if (command) {
      query += ` AND p.polcmd = CASE $${paramIndex}
        WHEN 'SELECT' THEN 'r'
        WHEN 'INSERT' THEN 'a'
        WHEN 'UPDATE' THEN 'w'
        WHEN 'DELETE' THEN 'd'
        WHEN 'ALL' THEN '*'
        ELSE $${paramIndex}
      END`;
      queryParams.push(command);
      paramIndex++;
    }

    // Add count query to get total number of policies
    const countQuery = `SELECT COUNT(*) FROM (${query}) AS count_query`;
    const countResult = await pool.query(countQuery, queryParams);
    const totalCount = parseInt(countResult.rows[0].count);

    // If no filters are provided and the total count is high, suggest using filters
    // Skip this check if 'all' is true
    if (!all && !schema && !table && !policyName && !command && totalCount > 50) {
      // Get schema and table counts for guidance
      const schemaCountQuery = `
        SELECT n.nspname AS schema_name, COUNT(*) AS policy_count
        FROM pg_policy p
        JOIN pg_class c ON p.polrelid = c.oid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        GROUP BY n.nspname
        ORDER BY COUNT(*) DESC
      `;
      const schemaResult = await pool.query(schemaCountQuery);
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              message: `Found ${totalCount} policies. Please use filters to narrow down results or use 'concise=true' for a simplified view of all policies.`,
              schemas: schemaResult.rows,
              usage: "Try adding 'schema' parameter to filter by schema name or use 'concise=true' to see all policies"
            }, null, 2)
          }
        ]
      };
    }

    // Add ordering, limit and offset (skip limit if 'all' is true)
    query += ` ORDER BY n.nspname, c.relname, p.polname`;
    
    if (!all) {
      query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      queryParams.push(limit);
      queryParams.push(offset);
    }

    // Execute the query
    const result = await pool.query(query, queryParams);

    // Process the results
    const policies = result.rows.map(row => {
      const policyInfo: any = {
        name: row.policy_name,
        schema: row.schema_name,
        table: row.table_name,
        command: row.command,
        type: row.policy_type,
        roles: row.roles,
        using_expression: row.using_expression || null,
        with_check_expression: row.with_check_expression || null
      };

      if (includeDefinition) {
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
      }

      return policyInfo;
    });

    // Return with pagination info
    const response = {
      policies,
      pagination: {
        total: totalCount,
        limit,
        offset,
        hasMore: offset + policies.length < totalCount
      }
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
    console.error("Error listing policies:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Failed to list policies: ${errorMessage}` }, null, 2)
        }
      ]
    };
  }
}; 