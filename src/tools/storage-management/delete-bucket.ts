import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for delete-bucket tool
export const deleteBucketSchema = {
  name: z.string().describe("Bucket name"),
  force: z.boolean().default(false).describe("Force deletion even if bucket contains objects")
};

// Handler for delete-bucket tool
export const deleteBucketHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { name, force = false } = params as {
      name: string;
      force?: boolean;
    };

    // Check if bucket exists
    const checkQuery = `
      SELECT id, (
        SELECT COUNT(*) 
        FROM storage.objects o 
        WHERE o.bucket_id = b.id
      ) as object_count
      FROM storage.buckets b
      WHERE b.name = $1;
    `;
    const checkResult = await pool.query(checkQuery, [name]);
    
    if (checkResult.rows.length === 0) {
      throw new Error(`Bucket "${name}" does not exist`);
    }
    
    const bucketId = checkResult.rows[0].id;
    const objectCount = parseInt(checkResult.rows[0].object_count);
    
    // Check if bucket is empty or force flag is set
    if (objectCount > 0 && !force) {
      throw new Error(`Bucket "${name}" contains ${objectCount} objects. Use force=true to delete anyway.`);
    }
    
    // Begin transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Delete objects first if force is true
      if (force && objectCount > 0) {
        await client.query(
          'DELETE FROM storage.objects WHERE bucket_id = $1',
          [bucketId]
        );
      }
      
      // Delete the bucket
      const result = await client.query(
        'DELETE FROM storage.buckets WHERE id = $1 RETURNING *',
        [bucketId]
      );
      
      await client.query('COMMIT');
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            message: `Successfully deleted bucket "${name}"${objectCount > 0 ? ` and ${objectCount} objects` : ''}`,
            deletedBucket: result.rows[0]
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
    console.error("Error deleting bucket:", error);
    throw new Error(`Failed to delete bucket: ${error}`);
  }
}; 