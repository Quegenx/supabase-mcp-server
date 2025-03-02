import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for bulk-delete-files tool
export const bulkDeleteFilesSchema = {
  bucketName: z.string().describe("Bucket name"),
  prefix: z.string().describe("Prefix path to delete (e.g., 'folder/' to delete all files in a folder)"),
  recursive: z.boolean().default(true).describe("Whether to recursively delete files in subfolders")
};

// Handler for bulk-delete-files tool
export const bulkDeleteFilesHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { bucketName, prefix, recursive = true } = params as {
      bucketName: string;
      prefix: string;
      recursive?: boolean;
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
    
    // Build the query to find files to delete
    let findFilesQuery = `
      SELECT id, name FROM storage.objects
      WHERE bucket_id = $1
    `;
    
    const queryParams = [bucketId];
    let paramIndex = 2;
    
    if (recursive) {
      // For recursive delete, match any file that starts with the prefix
      findFilesQuery += ` AND name LIKE $${paramIndex}`;
      queryParams.push(`${prefix}%`);
    } else {
      // For non-recursive delete, only match files directly in the folder (no subfolders)
      // This regex matches files that are directly in the specified folder
      // For example, if prefix is 'folder/', it matches 'folder/file.txt' but not 'folder/subfolder/file.txt'
      findFilesQuery += ` AND name ~ $${paramIndex}`;
      // The regex pattern: starts with prefix, followed by any character except '/' until the end of the string
      queryParams.push(`^${prefix}[^/]+$`);
    }
    
    // Find files to delete
    const filesToDeleteResult = await pool.query(findFilesQuery, queryParams);
    const filesToDelete = filesToDeleteResult.rows;
    
    if (filesToDelete.length === 0) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            message: `No files found with prefix "${prefix}" in bucket "${bucketName}"`,
            deletedCount: 0,
            deletedFiles: []
          }, null, 2)
        }]
      };
    }
    
    // Extract file IDs for deletion
    const fileIds = filesToDelete.map(file => file.id);
    
    // Delete the files in a single query
    const deleteQuery = `
      DELETE FROM storage.objects
      WHERE id = ANY($1::uuid[])
      RETURNING id, name;
    `;
    
    const deleteResult = await pool.query(deleteQuery, [fileIds]);
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          message: `Successfully deleted ${deleteResult.rowCount} files with prefix "${prefix}" from bucket "${bucketName}"`,
          deletedCount: deleteResult.rowCount,
          deletedFiles: deleteResult.rows.map(row => row.name)
        }, null, 2)
      }]
    };
  } catch (error) {
    console.error("Error bulk deleting files:", error);
    throw new Error(`Failed to bulk delete files: ${error}`);
  }
};
