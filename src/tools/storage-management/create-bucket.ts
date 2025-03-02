import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for create-bucket tool
export const createBucketSchema = {
  name: z.string().describe("Bucket name"),
  public: z.boolean().default(false).describe("Whether the bucket is publicly accessible"),
  fileSizeLimit: z.number().optional().describe("Maximum file size in bytes"),
  allowedMimeTypes: z.array(z.string()).optional().describe("List of allowed MIME types")
};

// Handler for create-bucket tool
export const createBucketHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { name, public: isPublic, fileSizeLimit, allowedMimeTypes } = params as {
      name: string;
      public: boolean;
      fileSizeLimit?: number;
      allowedMimeTypes?: string[];
    };

    // Check if bucket already exists
    const checkQuery = `
      SELECT EXISTS (
        SELECT 1 FROM storage.buckets WHERE name = $1
      );
    `;
    const checkResult = await pool.query(checkQuery, [name]);
    if (checkResult.rows[0].exists) {
      throw new Error(`Bucket "${name}" already exists`);
    }

    // Build the query - now including id field
    let sql = `
      INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
    `;
    
    const values = [
      name, // Using name as the id
      name, 
      isPublic, 
      fileSizeLimit || null, 
      allowedMimeTypes ? allowedMimeTypes : null
    ];
    
    const result = await pool.query(sql, values);
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          message: `Successfully created bucket "${name}"`,
          bucket: result.rows[0]
        }, null, 2)
      }]
    };
  } catch (error) {
    console.error("Error creating bucket:", error);
    throw new Error(`Failed to create bucket: ${error}`);
  }
}; 