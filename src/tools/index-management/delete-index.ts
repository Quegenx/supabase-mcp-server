import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for delete-index tool
export const deleteIndexSchema = {
  schema: z.string().default("public").describe("Schema name"),
  indexName: z.string().describe("Index name to delete"),
  concurrently: z.boolean().default(false).describe("Drop index without locking the table for writes"),
  ifExists: z.boolean().default(true).describe("Do not throw an error if the index does not exist")
};

// Handler for delete-index tool
export const deleteIndexHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      schema = "public", 
      indexName, 
      concurrently = false,
      ifExists = true
    } = params as {
      schema: string;
      indexName: string;
      concurrently?: boolean;
      ifExists?: boolean;
    };

    // Check if index exists
    const indexCheckQuery = `
      SELECT tablename, indexdef
      FROM pg_indexes 
      WHERE schemaname = $1 AND indexname = $2;
    `;
    const indexCheckResult = await pool.query(indexCheckQuery, [schema, indexName]);
    
    if (indexCheckResult.rows.length === 0) {
      if (ifExists) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              message: `Index "${schema}.${indexName}" does not exist, no action taken`,
              deleted: false
            }, null, 2)
          }]
        };
      } else {
        throw new Error(`Index "${schema}.${indexName}" does not exist`);
      }
    }
    
    // Store index details for the response
    const indexDetails = indexCheckResult.rows[0];
    
    // Build the DROP INDEX query
    let sql = `DROP INDEX `;
    
    if (concurrently) {
      sql += `CONCURRENTLY `;
    }
    
    if (ifExists) {
      sql += `IF EXISTS `;
    }
    
    sql += `"${schema}"."${indexName}"`;
    
    // Execute the query
    await pool.query(sql);
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          message: `Successfully deleted index "${schema}.${indexName}"`,
          deleted: true,
          indexDetails: {
            schema: schema,
            indexName: indexName,
            tableName: indexDetails.tablename,
            definition: indexDetails.indexdef
          }
        }, null, 2)
      }]
    };
  } catch (error) {
    console.error("Error deleting index:", error);
    throw new Error(`Failed to delete index: ${error}`);
  }
};
