import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for list-indexes tool
export const listIndexesSchema = {
  schema: z.string().optional().describe("Schema name to filter by"),
  table: z.string().optional().describe("Table name to filter by"),
  includeDefinition: z.boolean().default(true).describe("Include the full index definition"),
  includeSize: z.boolean().default(false).describe("Include index size information"),
  concise: z.boolean().default(false).describe("Show indexes with minimal data per index"),
  summarize: z.boolean().default(false).describe("Return a summarized view with counts by schema and type"),
  limit: z.number().default(20).describe("Maximum number of indexes to return (ignored if summarize=true)"),
  offset: z.number().default(0).describe("Offset for pagination (ignored if summarize=true)")
};

// Handler for list-indexes tool
export const listIndexesHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      schema, 
      table, 
      includeDefinition = true,
      includeSize = false,
      concise = false,
      summarize = false,
      limit = 5,
      offset = 0
    } = params as {
      schema?: string;
      table?: string;
      includeDefinition?: boolean;
      includeSize?: boolean;
      concise?: boolean;
      summarize?: boolean;
      limit?: number;
      offset?: number;
    };

    // If summarize is true, return a count of indexes by schema and index type
    if (summarize) {
      let summaryQuery = `
        SELECT 
          schemaname,
          CASE 
            WHEN indexdef LIKE '%UNIQUE INDEX%' THEN 'UNIQUE'
            WHEN indexdef LIKE '%PRIMARY KEY%' THEN 'PRIMARY KEY'
            ELSE regexp_replace(regexp_replace(indexdef, '.* USING ([^ ]+).*', '\\1'), '.*', 'REGULAR')
          END as index_type,
          COUNT(*) as index_count
        FROM 
          pg_indexes
        WHERE 1=1
      `;
      
      const queryParams = [];
      let paramIndex = 1;
      
      // Add schema filter if provided
      if (schema) {
        summaryQuery += ` AND schemaname = $${paramIndex}`;
        queryParams.push(schema);
        paramIndex++;
      }
      
      // Add table filter if provided
      if (table) {
        summaryQuery += ` AND tablename = $${paramIndex}`;
        queryParams.push(table);
        paramIndex++;
      }
      
      summaryQuery += `
        GROUP BY 
          schemaname,
          CASE 
            WHEN indexdef LIKE '%UNIQUE INDEX%' THEN 'UNIQUE'
            WHEN indexdef LIKE '%PRIMARY KEY%' THEN 'PRIMARY KEY'
            ELSE regexp_replace(regexp_replace(indexdef, '.* USING ([^ ]+).*', '\\1'), '.*', 'REGULAR')
          END
        ORDER BY 
          schemaname,
          index_type
      `;
      
      const summaryResult = await pool.query(summaryQuery, queryParams);
      
      // Group by schema
      const indexesBySchema: Record<string, any> = {};
      let totalCount = 0;
      
      summaryResult.rows.forEach(row => {
        const { schemaname, index_type, index_count } = row;
        totalCount += parseInt(index_count);
        
        if (!indexesBySchema[schemaname]) {
          indexesBySchema[schemaname] = {
            total: 0,
            types: {}
          };
        }
        
        indexesBySchema[schemaname].total += parseInt(index_count);
        indexesBySchema[schemaname].types[index_type] = parseInt(index_count);
      });
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            indexes_by_schema: indexesBySchema,
            total_count: totalCount,
            message: "Use schema and table parameters to filter indexes for a specific table"
          }, null, 2)
        }]
      };
    }

    // Get total count for pagination info
    let countQuery = `
      SELECT COUNT(*) as total_count
      FROM pg_indexes
      WHERE 1=1
    `;
    
    const countParams = [];
    let countParamIndex = 1;
    
    // Add schema filter if provided
    if (schema) {
      countQuery += ` AND schemaname = $${countParamIndex}`;
      countParams.push(schema);
      countParamIndex++;
    }
    
    // Add table filter if provided
    if (table) {
      countQuery += ` AND tablename = $${countParamIndex}`;
      countParams.push(table);
      countParamIndex++;
    }
    
    const countResult = await pool.query(countQuery, countParams);
    const totalCount = parseInt(countResult.rows[0].total_count);

    // Build the query
    let sql = `
      SELECT 
        schemaname, 
        tablename, 
        indexname
    `;
    
    if (includeDefinition && !concise) {
      sql += `, indexdef`;
    } else if (concise) {
      sql += `, 
        CASE 
          WHEN indexdef LIKE '%UNIQUE INDEX%' THEN 'UNIQUE'
          WHEN indexdef LIKE '%PRIMARY KEY%' THEN 'PRIMARY KEY'
          ELSE regexp_replace(regexp_replace(indexdef, '.* USING ([^ ]+).*', '\\1'), '.*', 'REGULAR')
        END as index_type,
        regexp_replace(indexdef, '.* ON [^(]+ \\(([^)]+)\\).*', '\\1') as columns
      `;
    }
    
    sql += ` FROM pg_indexes WHERE 1=1`;
    
    const queryParams = [];
    let paramIndex = 1;
    
    // Add schema filter if provided
    if (schema) {
      sql += ` AND schemaname = $${paramIndex}`;
      queryParams.push(schema);
      paramIndex++;
    }
    
    // Add table filter if provided
    if (table) {
      sql += ` AND tablename = $${paramIndex}`;
      queryParams.push(table);
      paramIndex++;
    }
    
    sql += ` ORDER BY schemaname, tablename, indexname`;
    
    // Add limit and offset for pagination if not concise
    if (!concise) {
      sql += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      queryParams.push(limit);
      queryParams.push(offset);
    }
    
    // Execute the query
    const result = await pool.query(sql, queryParams);
    
    // If size information is requested, get it for each index
    if (includeSize && result.rows.length > 0 && !concise) {
      for (const index of result.rows) {
        const sizeQuery = `
          SELECT 
            pg_size_pretty(pg_relation_size('"' || schemaname || '"."' || indexname || '"')) as pretty_size,
            pg_relation_size('"' || schemaname || '"."' || indexname || '"') as size_bytes
          FROM pg_indexes
          WHERE schemaname = $1 AND tablename = $2 AND indexname = $3;
        `;
        
        const sizeResult = await pool.query(sizeQuery, [
          index.schemaname, 
          index.tablename, 
          index.indexname
        ]);
        
        if (sizeResult.rows.length > 0) {
          index.size = sizeResult.rows[0].pretty_size;
          index.size_bytes = parseInt(sizeResult.rows[0].size_bytes);
        }
      }
    }
    
    // If concise mode is enabled, group indexes by schema and table
    if (concise) {
      // Group indexes by schema and table
      const indexesBySchemaAndTable: Record<string, Record<string, any[]>> = {};
      
      result.rows.forEach(index => {
        const { schemaname, tablename, indexname, index_type, columns } = index;
        
        if (!indexesBySchemaAndTable[schemaname]) {
          indexesBySchemaAndTable[schemaname] = {};
        }
        
        if (!indexesBySchemaAndTable[schemaname][tablename]) {
          indexesBySchemaAndTable[schemaname][tablename] = [];
        }
        
        indexesBySchemaAndTable[schemaname][tablename].push({
          name: indexname,
          type: index_type,
          columns: columns
        });
      });
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            indexes_by_schema_and_table: indexesBySchemaAndTable,
            total_count: totalCount,
            message: "This is a concise view. Use schema and table parameters to filter indexes for a specific table."
          }, null, 2)
        }]
      };
    }
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          count: result.rows.length,
          indexes: result.rows,
          pagination: {
            total: totalCount,
            limit,
            offset,
            hasMore: offset + result.rows.length < totalCount
          }
        }, null, 2)
      }]
    };
  } catch (error) {
    console.error("Error listing indexes:", error);
    throw new Error(`Failed to list indexes: ${error}`);
  }
};
