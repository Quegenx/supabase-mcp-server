import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for list-folders tool
export const listFoldersSchema = {
  bucketName: z.string().describe("Bucket name"),
  prefix: z.string().optional().describe("Filter folders by prefix path"),
  includeSubfolders: z.boolean().default(true).describe("Include subfolders in the result")
};

// Define the folder stats interface
interface FolderStats {
  path: string;
  file_count: number;
  subfolder_count: number;
  total_size: number;
  human_readable_size?: string;
}

// Handler for list-folders tool
export const listFoldersHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      bucketName, 
      prefix = "", 
      includeSubfolders = true
    } = params as {
      bucketName: string;
      prefix?: string;
      includeSubfolders?: boolean;
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
    
    // Get all file paths from the bucket
    let pathsQuery = `
      SELECT name FROM storage.objects
      WHERE bucket_id = $1
    `;
    
    const queryParams = [bucketId];
    let paramIndex = 2;
    
    // Add prefix filter if provided
    if (prefix) {
      pathsQuery += ` AND name LIKE $${paramIndex}`;
      queryParams.push(`${prefix}%`);
      paramIndex++;
    }
    
    pathsQuery += ` ORDER BY name`;
    
    const pathsResult = await pool.query(pathsQuery, queryParams);
    
    // Extract folder paths from file paths
    const folderSet = new Set<string>();
    
    pathsResult.rows.forEach(row => {
      const filePath = row.name;
      const pathParts = filePath.split('/');
      
      // Skip the last part (filename)
      pathParts.pop();
      
      if (pathParts.length > 0) {
        // Build folder paths
        let currentPath = "";
        for (let i = 0; i < pathParts.length; i++) {
          currentPath += pathParts[i] + "/";
          
          // If we're only interested in the top-level folder under the prefix,
          // skip adding subfolders
          if (!includeSubfolders && currentPath.startsWith(prefix) && 
              currentPath !== prefix && currentPath.slice(prefix.length).includes('/')) {
            continue;
          }
          
          folderSet.add(currentPath);
        }
      }
    });
    
    // Convert Set to Array and sort
    const folders = Array.from(folderSet).sort();
    
    // Count files in each folder
    const folderStats: FolderStats[] = await Promise.all(
      folders.map(async (folder) => {
        const countQuery = `
          SELECT COUNT(*) as file_count,
                 COALESCE(SUM((metadata->>'size')::numeric), 0)::bigint as total_size
          FROM storage.objects
          WHERE bucket_id = $1 AND name LIKE $2 AND name NOT LIKE $3
        `;
        
        // Count files directly in this folder (not in subfolders)
        // For example, for folder 'images/', count 'images/file.jpg' but not 'images/subfolder/file.jpg'
        const countResult = await pool.query(countQuery, [
          bucketId, 
          `${folder}%`,           // Files starting with this folder
          `${folder}%/%`          // Exclude files in subfolders
        ]);
        
        // Count subfolders
        const subfolderQuery = `
          SELECT COUNT(DISTINCT SUBSTRING(name, LENGTH($1) + 1, POSITION('/' IN SUBSTRING(name, LENGTH($1) + 1)) - 1)) as subfolder_count
          FROM storage.objects
          WHERE bucket_id = $2 AND name LIKE $3 AND POSITION('/' IN SUBSTRING(name, LENGTH($1) + 1)) > 0
        `;
        
        const subfolderResult = await pool.query(subfolderQuery, [folder, bucketId, `${folder}%/%`]);
        
        return {
          path: folder,
          file_count: parseInt(countResult.rows[0].file_count),
          subfolder_count: parseInt(subfolderResult.rows[0].subfolder_count || '0'),
          total_size: parseInt(countResult.rows[0].total_size)
        };
      })
    );
    
    // Format sizes to human-readable format
    folderStats.forEach(folder => {
      if (folder.total_size) {
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let size = folder.total_size;
        let unitIndex = 0;
        
        while (size >= 1024 && unitIndex < units.length - 1) {
          size /= 1024;
          unitIndex++;
        }
        
        folder.human_readable_size = `${size.toFixed(2)} ${units[unitIndex]}`;
      } else {
        folder.human_readable_size = '0 B';
      }
    });
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          bucket: bucketName,
          prefix: prefix,
          count: folders.length,
          folders: folderStats
        }, null, 2)
      }]
    };
  } catch (error) {
    console.error("Error listing folders:", error);
    throw new Error(`Failed to list folders: ${error}`);
  }
};
