import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for list-triggers tool
export const listTriggersSchema = {
  schema: z.string().optional().describe("Schema name to filter by"),
  table: z.string().optional().describe("Table name to filter by"),
  triggerName: z.string().optional().describe("Trigger name pattern to filter by (supports SQL LIKE pattern)"),
  includeDefinition: z.boolean().default(true).describe("Include trigger definition"),
  limit: z.number().default(50).describe("Maximum number of triggers to return"),
  offset: z.number().default(0).describe("Offset for pagination")
};

// Handler for list-triggers tool
export const listTriggersHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      schema,
      table,
      triggerName,
      includeDefinition = true,
      limit = 5,
      offset = 0
    } = params as {
      schema?: string;
      table?: string;
      triggerName?: string;
      includeDefinition?: boolean;
      limit?: number;
      offset?: number;
    };

    // Build the query to list triggers
    let query = `
      SELECT 
        t.tgname AS trigger_name,
        n.nspname AS schema_name,
        c.relname AS table_name,
        pg_get_triggerdef(t.oid) AS trigger_definition,
        CASE
          WHEN (t.tgtype & (1<<0))::boolean THEN 'ROW'
          ELSE 'STATEMENT'
        END AS trigger_level,
        CASE
          WHEN (t.tgtype & (1<<1))::boolean THEN 'BEFORE'
          WHEN (t.tgtype & (1<<6))::boolean THEN 'INSTEAD OF'
          ELSE 'AFTER'
        END AS trigger_timing,
        (t.tgtype & (1<<2))::boolean AS trigger_on_insert,
        (t.tgtype & (1<<3))::boolean AS trigger_on_delete,
        (t.tgtype & (1<<4))::boolean AS trigger_on_update,
        (t.tgtype & (1<<5))::boolean AS trigger_on_truncate,
        p.proname AS function_name,
        np.nspname AS function_schema,
        t.tgenabled AS trigger_enabled
      FROM pg_trigger t
      JOIN pg_class c ON t.tgrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      JOIN pg_proc p ON t.tgfoid = p.oid
      JOIN pg_namespace np ON p.pronamespace = np.oid
      WHERE NOT t.tgisinternal
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

    // Add trigger name filter if provided
    if (triggerName) {
      query += ` AND t.tgname LIKE $${paramIndex}`;
      queryParams.push(triggerName);
      paramIndex++;
    }

    // Add count query to get total number of triggers
    const countQuery = `SELECT COUNT(*) FROM (${query}) AS count_query`;
    const countResult = await pool.query(countQuery, queryParams);
    const totalCount = parseInt(countResult.rows[0].count);

    // Add ordering, limit and offset
    query += ` ORDER BY n.nspname, c.relname, t.tgname LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    queryParams.push(limit);
    queryParams.push(offset);

    // Execute the query
    const result = await pool.query(query, queryParams);

    // Process the results
    const triggers = result.rows.map(row => {
      const triggerInfo: any = {
        name: row.trigger_name,
        schema: row.schema_name,
        table: row.table_name,
        level: row.trigger_level,
        timing: row.trigger_timing,
        events: {
          insert: row.trigger_on_insert,
          delete: row.trigger_on_delete,
          update: row.trigger_on_update,
          truncate: row.trigger_on_truncate
        },
        function: {
          name: row.function_name,
          schema: row.function_schema
        },
        enabled: row.trigger_enabled === 'O' // 'O' means enabled, 'D' means disabled
      };

      if (includeDefinition) {
        triggerInfo.definition = row.trigger_definition;
      }

      return triggerInfo;
    });

    // Return with pagination info
    const response = {
      triggers,
      pagination: {
        total: totalCount,
        limit,
        offset,
        hasMore: offset + triggers.length < totalCount
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
    console.error("Error listing triggers:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Failed to list triggers: ${errorMessage}` }, null, 2)
        }
      ]
    };
  }
}; 