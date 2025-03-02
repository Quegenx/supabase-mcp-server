import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for list-buckets tool
export const listBucketsSchema = {
  includeDetails: z.boolean().default(true).describe("Include detailed information about each bucket")
};

// Handler for list-buckets tool
export const listBucketsHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { includeDetails = true } = params as {
      includeDetails?: boolean;
    };

    // Build the query
    let sql = `
      SELECT 
        b.name,
        b.id,
        b.public,
        b.created_at,
        b.updated_at
    `;
    
    // Add additional details if requested
    if (includeDetails) {
      sql += `,
        b.file_size_limit,
        b.allowed_mime_types,
        (
          SELECT COUNT(*) 
          FROM storage.objects o 
          WHERE o.bucket_id = b.id
        ) as object_count,
        (
          SELECT COALESCE(SUM((o.metadata->>'size')::numeric), 0)::bigint
          FROM storage.objects o 
          WHERE o.bucket_id = b.id
        ) as total_size
      `;
    }
    
    sql += `
      FROM storage.buckets b
      ORDER BY b.name;
    `;
    
    const result = await pool.query(sql);
    
    // Format the response
    const buckets = result.rows.map(bucket => {
      if (includeDetails && bucket.total_size) {
        // Convert bytes to human-readable format
        const size = parseInt(bucket.total_size);
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let formattedSize = size;
        let unitIndex = 0;
        
        while (formattedSize >= 1024 && unitIndex < units.length - 1) {
          formattedSize /= 1024;
          unitIndex++;
        }
        
        bucket.human_readable_size = `${formattedSize.toFixed(2)} ${units[unitIndex]}`;
      }
      
      return bucket;
    });
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          count: buckets.length,
          buckets: buckets
        }, null, 2)
      }]
    };
  } catch (error) {
    console.error("Error listing buckets:", error);
    throw new Error(`Failed to list buckets: ${error}`);
  }
}; 