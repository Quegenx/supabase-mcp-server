import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for delete-file tool
export const deleteFileSchema = {
  bucketName: z.string().describe("Bucket name"),
  path: z.string().describe("File path within the bucket")
};

// Handler for delete-file tool
export const deleteFileHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { bucketName, path } = params as {
      bucketName: string;
      path: string;
    };

    // Check if bucket exists
    const bucketQuery = `
      SELECT id FROM storage.buckets
      WHERE name = $1;
    `;
    const bucketResult = await pool.query(bucketQuery, [bucketName]);
    
    if (bucketResult.rows.length === 0) {
      throw new Error(`Bucket "${bucketName}" does not exist`);
    }
    
    const bucketId = bucketResult.rows[0].id;
    
    // Check if file exists
    const fileQuery = `
      SELECT id, name, metadata FROM storage.objects
      WHERE bucket_id = $1 AND name = $2;
    `;
    const fileResult = await pool.query(fileQuery, [bucketId, path]);
    
    if (fileResult.rows.length === 0) {
      throw new Error(`File "${path}" does not exist in bucket "${bucketName}"`);
    }
    
    const fileInfo = fileResult.rows[0];
    
    // Delete the file
    const deleteQuery = `
      DELETE FROM storage.objects
      WHERE id = $1
      RETURNING id, name;
    `;
    const result = await pool.query(deleteQuery, [fileInfo.id]);
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          message: `Successfully deleted file "${path}" from bucket "${bucketName}"`,
          deletedFile: {
            id: fileInfo.id,
            name: fileInfo.name,
            size: fileInfo.metadata?.size || 'unknown',
            mimetype: fileInfo.metadata?.mimetype || 'unknown'
          }
        }, null, 2)
      }]
    };
  } catch (error) {
    console.error("Error deleting file:", error);
    throw new Error(`Failed to delete file: ${error}`);
  }
}; 