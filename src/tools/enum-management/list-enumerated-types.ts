import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for list-enumerated-types tool
export const listEnumeratedTypesSchema = {
  schema: z.string().optional().describe("Schema name to filter by"),
  typeName: z.string().optional().describe("Enumerated type name pattern to filter by (supports SQL LIKE pattern)"),
  includeValues: z.boolean().default(true).describe("Include the enum values in the results"),
  includeSize: z.boolean().default(false).describe("Include size information about the enum types"),
  limit: z.number().default(50).describe("Maximum number of enum types to return"),
  offset: z.number().default(0).describe("Offset for pagination")
};

// Handler for list-enumerated-types tool
export const listEnumeratedTypesHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      schema,
      typeName,
      includeValues = true,
      includeSize = false,
      limit = 5,
      offset = 0
    } = params as {
      schema?: string;
      typeName?: string;
      includeValues?: boolean;
      includeSize?: boolean;
      limit?: number;
      offset?: number;
    };

    // Build the query to list enum types
    let query = `
      SELECT 
        n.nspname AS schema_name,
        t.typname AS type_name,
        t.oid AS type_oid,
        array_agg(e.enumlabel ORDER BY e.enumsortorder) AS enum_values
      FROM pg_type t
      JOIN pg_namespace n ON t.typnamespace = n.oid
      JOIN pg_enum e ON t.oid = e.enumtypid
      WHERE t.typtype = 'e'
    `;

    const queryParams = [];
    let paramIndex = 1;

    // Add schema filter if provided
    if (schema) {
      query += ` AND n.nspname = $${paramIndex}`;
      queryParams.push(schema);
      paramIndex++;
    }

    // Add type name filter if provided
    if (typeName) {
      query += ` AND t.typname LIKE $${paramIndex}`;
      queryParams.push(typeName);
      paramIndex++;
    }

    // Group by to aggregate enum values
    query += ` GROUP BY n.nspname, t.typname, t.oid`;

    // Add count query to get total number of enum types
    const countQuery = `SELECT COUNT(*) FROM (${query}) AS count_query`;
    const countResult = await pool.query(countQuery, queryParams);
    const totalCount = parseInt(countResult.rows[0].count);

    // Add ordering, limit and offset
    query += ` ORDER BY n.nspname, t.typname LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    queryParams.push(limit);
    queryParams.push(offset);

    // Execute the query
    const result = await pool.query(query, queryParams);

    // Process the results
    const enumTypes = await Promise.all(result.rows.map(async row => {
      const enumInfo: any = {
        schema: row.schema_name,
        name: row.type_name
      };

      if (includeValues) {
        enumInfo.values = row.enum_values;
      }

      if (includeSize) {
        // Get size information
        const sizeQuery = `
          SELECT pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size
          FROM pg_class c
          JOIN pg_type t ON t.typrelid = c.oid
          WHERE t.oid = $1
        `;
        try {
          const sizeResult = await pool.query(sizeQuery, [row.type_oid]);
          if (sizeResult.rows.length > 0) {
            enumInfo.size = sizeResult.rows[0].total_size;
          }
        } catch (error) {
          // If size query fails, just skip size information
          console.error("Error getting enum type size:", error);
        }
      }

      // Get usage information - tables using this enum type
      const usageQuery = `
        SELECT 
          n.nspname AS schema_name,
          c.relname AS table_name,
          a.attname AS column_name
        FROM pg_attribute a
        JOIN pg_class c ON a.attrelid = c.oid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE a.atttypid = $1
          AND c.relkind = 'r'
          AND NOT a.attisdropped
        LIMIT 10
      `;
      
      const usageResult = await pool.query(usageQuery, [row.type_oid]);
      if (usageResult.rows.length > 0) {
        enumInfo.used_in = usageResult.rows.map(usage => ({
          schema: usage.schema_name,
          table: usage.table_name,
          column: usage.column_name
        }));
      }

      return enumInfo;
    }));

    // Return with pagination info
    const response = {
      enum_types: enumTypes,
      pagination: {
        total: totalCount,
        limit,
        offset,
        hasMore: offset + enumTypes.length < totalCount
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
    console.error("Error listing enumerated types:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Failed to list enumerated types: ${errorMessage}` }, null, 2)
        }
      ]
    };
  }
}; 