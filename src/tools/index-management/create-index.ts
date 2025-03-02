import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for create-index tool
export const createIndexSchema = {
  schema: z.string().default("public").describe("Schema name"),
  table: z.string().describe("Table name"),
  columns: z.array(z.string()).describe("Columns to index"),
  indexName: z.string().optional().describe("Custom index name (generated if not provided)"),
  unique: z.boolean().default(false).describe("Whether the index should enforce uniqueness"),
  method: z.enum(["btree", "hash", "gist", "gin", "brin"]).default("btree").describe("Indexing method"),
  whereCondition: z.string().optional().describe("Optional WHERE condition for partial indexes"),
  concurrently: z.boolean().default(true).describe("Create index concurrently to minimize locking")
};

// Handler for create-index tool
export const createIndexHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      schema = "public", 
      table, 
      columns, 
      indexName, 
      unique = false, 
      method = "btree", 
      whereCondition,
      concurrently = true
    } = params as {
      schema: string;
      table: string;
      columns: string[];
      indexName?: string;
      unique?: boolean;
      method?: "btree" | "hash" | "gist" | "gin" | "brin";
      whereCondition?: string;
      concurrently?: boolean;
    };

    // Validate that columns array is not empty
    if (!columns || columns.length === 0) {
      throw new Error("At least one column must be specified for the index");
    }

    // Check if table exists
    const tableExistsQuery = `
      SELECT EXISTS (
        SELECT 1 
        FROM information_schema.tables 
        WHERE table_schema = $1 
        AND table_name = $2
      );
    `;
    const tableExistsResult = await pool.query(tableExistsQuery, [schema, table]);
    
    if (!tableExistsResult.rows[0].exists) {
      throw new Error(`Table "${schema}.${table}" does not exist`);
    }

    // Generate index name if not provided
    const finalIndexName = indexName || `${table}_${columns.join('_')}_idx`;

    // Check if index already exists
    const indexExistsQuery = `
      SELECT EXISTS (
        SELECT 1 
        FROM pg_indexes 
        WHERE schemaname = $1 
        AND indexname = $2
      );
    `;
    const indexExistsResult = await pool.query(indexExistsQuery, [schema, finalIndexName]);
    
    if (indexExistsResult.rows[0].exists) {
      throw new Error(`Index "${schema}.${finalIndexName}" already exists`);
    }

    // Construct the CREATE INDEX SQL statement
    let createSql = `CREATE `;
    
    if (unique) {
      createSql += `UNIQUE `;
    }
    
    if (concurrently) {
      createSql += `INDEX CONCURRENTLY `;
    } else {
      createSql += `INDEX `;
    }
    
    createSql += `"${finalIndexName}" ON "${schema}"."${table}" USING ${method} (`;
    createSql += columns.map(col => `"${col}"`).join(', ');
    createSql += `)`;
    
    if (whereCondition) {
      createSql += ` WHERE ${whereCondition}`;
    }
    
    // Execute the CREATE INDEX statement
    await pool.query(createSql);
    
    // Get the created index details
    const indexDetailsQuery = `
      SELECT 
        schemaname, 
        tablename, 
        indexname, 
        indexdef 
      FROM pg_indexes 
      WHERE schemaname = $1 AND indexname = $2;
    `;
    const indexDetailsResult = await pool.query(indexDetailsQuery, [schema, finalIndexName]);
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          message: `Successfully created index "${schema}.${finalIndexName}"`,
          index: indexDetailsResult.rows[0]
        }, null, 2)
      }]
    };
  } catch (error) {
    console.error("Error creating index:", error);
    throw new Error(`Failed to create index: ${error}`);
  }
};
