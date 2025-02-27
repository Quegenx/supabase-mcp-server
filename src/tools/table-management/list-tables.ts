import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for list-tables tool
export const listTablesSchema = {
  schema: z.string().optional().describe("Optional schema name to filter by"),
  table: z.string().optional().describe("Optional table name to filter by"),
  includeColumns: z.boolean().default(true).describe("Include column information"),
  includeSize: z.boolean().default(false).describe("Include table size information")
};

// Handler for list-tables tool
export const listTablesHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    // Default to public schema unless explicitly specified
    const { schema, table, includeColumns = true, includeSize = false } = params as {
      schema?: string;
      table?: string;
      includeColumns?: boolean;
      includeSize?: boolean;
    };

    // Base query to get tables
    let query = `
      SELECT 
        t.table_schema,
        t.table_name,
        obj_description(pg_class.oid) as description
      FROM information_schema.tables t
      JOIN pg_catalog.pg_class ON pg_class.relname = t.table_name
      JOIN pg_catalog.pg_namespace ON pg_namespace.oid = pg_class.relnamespace AND pg_namespace.nspname = t.table_schema
      WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema')
    `;

    const queryParams = [];
    let paramIndex = 1;

    // Add schema filter - default to 'public' if not specified
    if (schema) {
      // If schema is explicitly provided, use it
      query += ` AND t.table_schema = $${paramIndex}`;
      queryParams.push(schema);
      paramIndex++;
    } else {
      // If no schema is provided, default to 'public'
      query += ` AND t.table_schema = $${paramIndex}`;
      queryParams.push('public');
      paramIndex++;
    }

    // Add table filter if provided
    if (table) {
      query += ` AND t.table_name = $${paramIndex}`;
      queryParams.push(table);
      paramIndex++;
    }

    query += ` ORDER BY t.table_schema, t.table_name`;
    
    const result = await pool.query(query, queryParams);
    
    // If no tables found, return early
    if (result.rows.length === 0) {
      return {
        content: [{
          type: "text",
          text: "No tables found matching the criteria."
        }]
      };
    }

    // Process the results
    const tables = [];
    
    for (const tableRow of result.rows) {
      const tableInfo: any = {
        schema: tableRow.table_schema,
        name: tableRow.table_name,
        description: tableRow.description || null
      };

      // Get column information if requested
      if (includeColumns) {
        // Only include columns if specifically looking at a single table
        // or if includeColumns is explicitly set to true
        if (table || params.includeColumns === true) {
          const columnsQuery = `
            SELECT 
              column_name,
              data_type,
              is_nullable,
              column_default,
              character_maximum_length
            FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = $2
            ORDER BY ordinal_position
          `;
          
          const columnsResult = await pool.query(columnsQuery, [tableRow.table_schema, tableRow.table_name]);
          tableInfo.columns = columnsResult.rows;
        }
      }

      // Get table size information if requested
      if (includeSize) {
        const sizeQuery = `
          SELECT
            pg_size_pretty(pg_total_relation_size('"' || $1 || '"."' || $2 || '"')) as total_size,
            pg_size_pretty(pg_relation_size('"' || $1 || '"."' || $2 || '"')) as table_size,
            pg_size_pretty(pg_total_relation_size('"' || $1 || '"."' || $2 || '"') - pg_relation_size('"' || $1 || '"."' || $2 || '"')) as index_size,
            (SELECT reltuples::bigint FROM pg_class JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace 
             WHERE pg_namespace.nspname = $1 AND pg_class.relname = $2) as estimated_row_count
        `;
        
        const sizeResult = await pool.query(sizeQuery, [tableRow.table_schema, tableRow.table_name]);
        if (sizeResult.rows.length > 0) {
          tableInfo.size = sizeResult.rows[0];
        }
      }

      tables.push(tableInfo);
    }

    // Format the response based on whether we're looking at a single table or multiple
    let responseText;
    if (tables.length === 1 && table) {
      // Single table with detailed information
      responseText = JSON.stringify(tables[0], null, 2);
    } else {
      // For multiple tables, provide a more concise list by default
      const simplifiedTables = tables.map(t => ({
        schema: t.schema,
        name: t.name
      }));
      responseText = JSON.stringify(simplifiedTables, null, 2);
    }

    return {
      content: [{
        type: "text",
        text: responseText
      }]
    };
  } catch (error) {
    console.error("Error listing tables:", error);
    throw new Error(`Failed to list tables: ${error}`);
  }
}; 