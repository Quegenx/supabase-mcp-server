import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for list-functions tool
export const listFunctionsSchema = {
  schema: z.string().optional().describe("Schema name to filter by"),
  name: z.string().optional().describe("Function name pattern to filter by (supports SQL LIKE pattern)"),
  includeSource: z.boolean().default(false).describe("Include function source code (warning: can be large)"),
  includeArguments: z.boolean().default(true).describe("Include function arguments"),
  limit: z.number().default(20).describe("Maximum number of functions to return"),
  offset: z.number().default(0).describe("Offset for pagination"),
  excludeAggregates: z.boolean().default(false).describe("Exclude aggregate functions"),
  concise: z.boolean().default(false).describe("Show all functions with minimal data per function"),
  super_concise: z.boolean().default(false).describe("Show only function counts by schema and type, no individual functions"),
  all: z.boolean().default(false).describe("Show all functions without pagination limit"),
  summarize: z.boolean().default(false).describe("Return a summarized view with counts by schema")
};

// Handler for list-functions tool
export const listFunctionsHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      schema,
      name,
      includeSource = false,
      includeArguments = true,
      limit = 5,
      offset = 0,
      excludeAggregates = false,
      concise = false,
      super_concise = false,
      all = false,
      summarize = false
    } = params as {
      schema?: string;
      name?: string;
      includeSource?: boolean;
      includeArguments?: boolean;
      limit?: number;
      offset?: number;
      excludeAggregates?: boolean;
      concise?: boolean;
      super_concise?: boolean;
      all?: boolean;
      summarize?: boolean;
    };

    // If super_concise is true, return a detailed count of functions by schema and type
    if (super_concise) {
      const superConciseQuery = `
        SELECT 
          n.nspname AS schema_name,
          CASE p.prokind
            WHEN 'f' THEN 'function'
            WHEN 'p' THEN 'procedure'
            WHEN 'a' THEN 'aggregate'
            WHEN 'w' THEN 'window'
            ELSE p.prokind::text
          END AS function_type,
          COUNT(*) AS count,
          array_agg(p.proname ORDER BY p.proname) AS function_names
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
        ${schema ? 'AND n.nspname = $1' : ''}
        ${name ? `AND p.proname LIKE ${schema ? '$2' : '$1'}` : ''}
        ${excludeAggregates ? 'AND p.prokind != \'a\'' : ''}
        GROUP BY n.nspname, p.prokind
        ORDER BY n.nspname, p.prokind
      `;
      
      const queryParams = [];
      if (schema) queryParams.push(schema);
      if (name) queryParams.push(name);
      
      const result = await pool.query(superConciseQuery, queryParams);
      
      // Group by schema
      const functionsBySchema: Record<string, any> = {};
      let totalCount = 0;
      
      result.rows.forEach(row => {
        const { schema_name, function_type, count, function_names } = row;
        totalCount += parseInt(count);
        
        if (!functionsBySchema[schema_name]) {
          functionsBySchema[schema_name] = {
            total: 0,
            types: {}
          };
        }
        
        functionsBySchema[schema_name].total += parseInt(count);
        functionsBySchema[schema_name].types[function_type] = {
          count: parseInt(count),
          examples: function_names.slice(0, 5) // Show just a few examples
        };
      });
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              functions_by_schema: functionsBySchema,
              total_count: totalCount,
              message: "This is a super concise view. Use 'schema' parameter to filter by schema or 'concise=true' to see all functions in a given schema."
            }, null, 2)
          }
        ]
      };
    }

    // If summarize is true, return a count of functions by schema
    if (summarize) {
      const summaryQuery = `
        SELECT 
          n.nspname AS schema_name,
          COUNT(*) AS function_count,
          COUNT(*) FILTER (WHERE p.prokind = 'f') AS regular_functions,
          COUNT(*) FILTER (WHERE p.prokind = 'p') AS procedures,
          COUNT(*) FILTER (WHERE p.prokind = 'a') AS aggregates,
          COUNT(*) FILTER (WHERE p.prokind = 'w') AS window_functions
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
        ${schema ? 'AND n.nspname = $1' : ''}
        GROUP BY n.nspname
        ORDER BY n.nspname
      `;
      
      const summaryResult = await pool.query(summaryQuery, schema ? [schema] : []);
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              summary: summaryResult.rows,
              message: "Use more specific filters to see detailed function information"
            }, null, 2)
          }
        ]
      };
    }

    // If concise is true, return a simplified list of all functions
    if (concise) {
      let query = `
        SELECT 
          n.nspname AS schema_name,
          p.proname AS function_name,
          pg_get_function_result(p.oid) AS return_type,
          CASE
            WHEN p.prokind = 'f' THEN 'function'
            WHEN p.prokind = 'p' THEN 'procedure'
            WHEN p.prokind = 'a' THEN 'aggregate'
            WHEN p.prokind = 'w' THEN 'window'
            ELSE p.prokind::text
          END AS function_type,
          CASE
            WHEN p.provolatile = 'i' THEN 'IMMUTABLE'
            WHEN p.provolatile = 's' THEN 'STABLE'
            WHEN p.provolatile = 'v' THEN 'VOLATILE'
          END AS volatility,
          pg_get_function_identity_arguments(p.oid) AS function_arguments
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      `;

      const queryParams = [];
      let paramIndex = 1;

      // Add schema filter if provided
      if (schema) {
        query += ` AND n.nspname = $${paramIndex}`;
        queryParams.push(schema);
        paramIndex++;
      }

      // Add name filter if provided
      if (name) {
        query += ` AND p.proname LIKE $${paramIndex}`;
        queryParams.push(name);
        paramIndex++;
      }

      // Exclude aggregate functions if requested
      if (excludeAggregates) {
        query += ` AND p.prokind != 'a'`;
      }

      query += ` ORDER BY n.nspname, p.proname`;
      
      const result = await pool.query(query, queryParams);
      
      // If there are too many functions and no schema filter, suggest using super_concise
      if (!schema && result.rows.length > 100) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                message: `Found ${result.rows.length} functions. This is too many to display at once.`,
                suggestion: "Use 'super_concise=true' to see a summary by schema and type, or filter by schema with 'schema=your_schema_name'."
              }, null, 2)
            }
          ]
        };
      }
      
      // Group functions by schema
      const functionsBySchema: Record<string, any[]> = {};
      
      result.rows.forEach(row => {
        const { schema_name, function_name, return_type, function_type, volatility, function_arguments } = row;
        
        if (!functionsBySchema[schema_name]) {
          functionsBySchema[schema_name] = [];
        }
        
        functionsBySchema[schema_name].push({
          name: function_name,
          return_type,
          type: function_type,
          volatility,
          arguments: function_arguments
        });
      });
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              functions_by_schema: functionsBySchema,
              total_count: result.rows.length
            }, null, 2)
          }
        ]
      };
    }

    // Build the query
    let query = `
      SELECT 
        n.nspname AS schema_name,
        p.proname AS function_name,
        pg_get_function_identity_arguments(p.oid) AS function_arguments,
        pg_get_function_result(p.oid) AS return_type,
        CASE
          WHEN p.prokind = 'f' THEN 'function'
          WHEN p.prokind = 'p' THEN 'procedure'
          WHEN p.prokind = 'a' THEN 'aggregate'
          WHEN p.prokind = 'w' THEN 'window'
          ELSE p.prokind::text
        END AS function_type,
        CASE
          WHEN p.provolatile = 'i' THEN 'IMMUTABLE'
          WHEN p.provolatile = 's' THEN 'STABLE'
          WHEN p.provolatile = 'v' THEN 'VOLATILE'
        END AS volatility,
        p.proparallel = 'S' AS is_parallel_safe,
        p.proleakproof AS is_leakproof,
        p.prosecdef AS security_definer,
        p.procost AS estimated_cost,
        p.prorows AS estimated_rows
    `;

    if (includeSource) {
      // Only include source if explicitly requested
      query += `,
        CASE
          WHEN p.prokind = 'a' THEN NULL
          ELSE pg_get_functiondef(p.oid)
        END AS function_definition
      `;
    }

    query += `
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
    `;

    const queryParams = [];
    let paramIndex = 1;

    // Add schema filter if provided
    if (schema) {
      query += ` AND n.nspname = $${paramIndex}`;
      queryParams.push(schema);
      paramIndex++;
    }

    // Add name filter if provided
    if (name) {
      query += ` AND p.proname LIKE $${paramIndex}`;
      queryParams.push(name);
      paramIndex++;
    }

    // Exclude aggregate functions if requested
    if (excludeAggregates) {
      query += ` AND p.prokind != 'a'`;
    }

    // Add count query to get total number of functions
    const countQuery = `SELECT COUNT(*) FROM (${query}) AS count_query`;
    const countResult = await pool.query(countQuery, queryParams);
    const totalCount = parseInt(countResult.rows[0].count);

    // If no filters are provided and the total count is high, suggest using filters
    // Skip this check if 'all' is true
    if (!all && !schema && !name && totalCount > 100) {
      // Get schema counts for guidance
      const schemaCountQuery = `
        SELECT n.nspname AS schema_name, COUNT(*) AS function_count
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
        GROUP BY n.nspname
        ORDER BY COUNT(*) DESC
      `;
      const schemaResult = await pool.query(schemaCountQuery);
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              message: `Found ${totalCount} functions. Please use filters to narrow down results.`,
              suggestions: [
                "Use 'super_concise=true' for a high-level overview by schema and type",
                "Use 'schema=your_schema_name' to filter by schema",
                "Use 'name=pattern%' to search for functions by name"
              ],
              schemas: schemaResult.rows
            }, null, 2)
          }
        ]
      };
    }

    // Add ordering, limit and offset (skip limit if 'all' is true)
    query += ` ORDER BY n.nspname, p.proname`;
    
    if (!all) {
      query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      queryParams.push(limit);
      queryParams.push(offset);
    }

    // Execute the query
    const result = await pool.query(query, queryParams);

    // Process the results
    const functions = result.rows.map(row => {
      const functionInfo: any = {
        schema: row.schema_name,
        name: row.function_name,
        return_type: row.return_type,
        type: row.function_type,
        volatility: row.volatility,
        is_parallel_safe: row.is_parallel_safe,
        is_leakproof: row.is_leakproof,
        security_definer: row.security_definer,
        estimated_cost: row.estimated_cost,
        estimated_rows: row.estimated_rows
      };

      if (includeArguments) {
        functionInfo.arguments = row.function_arguments;
      }

      if (includeSource && row.function_definition) {
        functionInfo.source = row.function_definition;
      }

      return functionInfo;
    });

    // Return with pagination info
    const response = {
      functions,
      pagination: {
        total: totalCount,
        limit,
        offset,
        hasMore: offset + functions.length < totalCount
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
    console.error("Error listing functions:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Failed to list functions: ${errorMessage}` }, null, 2)
        }
      ]
    };
  }
}; 