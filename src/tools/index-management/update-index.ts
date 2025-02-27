import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for update-index tool
export const updateIndexSchema = {
  schema: z.string().default("public").describe("Schema name"),
  indexName: z.string().describe("Index name to update"),
  newColumns: z.array(z.string()).optional().describe("New columns for the index (if changing columns)"),
  newName: z.string().optional().describe("New name for the index (if renaming)"),
  unique: z.boolean().optional().describe("Whether the index should enforce uniqueness"),
  method: z.enum(["btree", "hash", "gist", "gin", "brin"]).optional().describe("Indexing method"),
  whereCondition: z.string().optional().describe("Optional WHERE condition for partial indexes"),
  concurrently: z.boolean().default(true).describe("Perform operations concurrently to minimize locking")
};

// Handler for update-index tool
export const updateIndexHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      schema = "public", 
      indexName, 
      newColumns,
      newName,
      unique,
      method,
      whereCondition,
      concurrently = true
    } = params as {
      schema: string;
      indexName: string;
      newColumns?: string[];
      newName?: string;
      unique?: boolean;
      method?: "btree" | "hash" | "gist" | "gin" | "brin";
      whereCondition?: string;
      concurrently?: boolean;
    };

    // Check if at least one update parameter is provided
    if (!newColumns && !newName && unique === undefined && !method && whereCondition === undefined) {
      throw new Error("At least one update parameter must be provided");
    }

    // Get current index details
    const indexDetailsQuery = `
      SELECT 
        schemaname, 
        tablename, 
        indexname, 
        indexdef 
      FROM pg_indexes 
      WHERE schemaname = $1 AND indexname = $2;
    `;
    const indexDetailsResult = await pool.query(indexDetailsQuery, [schema, indexName]);
    
    if (indexDetailsResult.rows.length === 0) {
      throw new Error(`Index "${schema}.${indexName}" does not exist`);
    }
    
    const currentIndex = indexDetailsResult.rows[0];
    const tableName = currentIndex.tablename;
    
    // Parse the current index definition to extract information
    const indexDef = currentIndex.indexdef;
    
    // Extract if it's unique
    const isCurrentlyUnique = indexDef.toLowerCase().includes('create unique index');
    const shouldBeUnique = unique !== undefined ? unique : isCurrentlyUnique;
    
    // Extract current method
    const methodRegex = /using\s+(\w+)/i;
    const methodMatch = indexDef.match(methodRegex);
    const currentMethod = methodMatch ? methodMatch[1].toLowerCase() : 'btree';
    const newMethod = method || currentMethod;
    
    // Extract current columns
    const columnsRegex = /\(([^)]+)\)/;
    const columnsMatch = indexDef.match(columnsRegex);
    const currentColumnsStr = columnsMatch ? columnsMatch[1] : '';
    const currentColumns = currentColumnsStr
      .split(',')
      .map((col: string) => col.trim().replace(/^"(.*)"$/, '$1')); // Remove quotes
    
    const columnsToUse = newColumns || currentColumns;
    
    // Extract current WHERE condition
    const whereRegex = /where\s+(.+)$/i;
    const whereMatch = indexDef.match(whereRegex);
    const currentWhere = whereMatch ? whereMatch[1] : undefined;
    const newWhere = whereCondition !== undefined ? whereCondition : currentWhere;
    
    // Determine the new index name
    const finalIndexName = newName || indexName;
    
    // Begin transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Drop the existing index
      let dropSql = `DROP INDEX `;
      if (concurrently) {
        dropSql += `CONCURRENTLY `;
      }
      dropSql += `"${schema}"."${indexName}"`;
      
      await client.query(dropSql);
      
      // Create the new index
      let createSql = `CREATE `;
      
      if (shouldBeUnique) {
        createSql += `UNIQUE `;
      }
      
      if (concurrently) {
        createSql += `INDEX CONCURRENTLY `;
      } else {
        createSql += `INDEX `;
      }
      
      createSql += `"${finalIndexName}" ON "${schema}"."${tableName}" USING ${newMethod} (`;
      createSql += columnsToUse.map((col: string) => `"${col}"`).join(', ');
      createSql += `)`;
      
      if (newWhere) {
        createSql += ` WHERE ${newWhere}`;
      }
      
      await client.query(createSql);
      
      await client.query('COMMIT');
      
      // Get the new index details
      const newIndexDetailsQuery = `
        SELECT 
          schemaname, 
          tablename, 
          indexname, 
          indexdef 
        FROM pg_indexes 
        WHERE schemaname = $1 AND indexname = $2;
      `;
      const newIndexDetailsResult = await pool.query(newIndexDetailsQuery, [schema, finalIndexName]);
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            message: `Successfully updated index "${schema}.${indexName}" to "${schema}.${finalIndexName}"`,
            oldIndex: {
              schema: currentIndex.schemaname,
              tableName: currentIndex.tablename,
              indexName: currentIndex.indexname,
              definition: currentIndex.indexdef
            },
            newIndex: newIndexDetailsResult.rows[0]
          }, null, 2)
        }]
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Error updating index:", error);
    throw new Error(`Failed to update index: ${error}`);
  }
};
