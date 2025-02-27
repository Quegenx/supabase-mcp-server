import { createBucketSchema, createBucketHandler } from './create-bucket.js';
import { listBucketsSchema, listBucketsHandler } from './list-buckets.js';
import { deleteBucketSchema, deleteBucketHandler } from './delete-bucket.js';
import { deleteFileSchema, deleteFileHandler } from './delete-file.js';
import { bulkDeleteFilesSchema, bulkDeleteFilesHandler } from './bulk-delete-files.js';
import { listFoldersSchema, listFoldersHandler } from './list-folders.js';
import { ToolDefinition } from '../../types.js';

// Export all storage management tools
export const storageManagementTools: ToolDefinition[] = [
  // Bucket operations
  {
    name: 'create-bucket',
    description: 'Create a new storage bucket',
    schema: createBucketSchema,
    handler: createBucketHandler
  },
  {
    name: 'list-buckets',
    description: 'List all storage buckets',
    schema: listBucketsSchema,
    handler: listBucketsHandler
  },
  {
    name: 'delete-bucket',
    description: 'Delete a storage bucket',
    schema: deleteBucketSchema,
    handler: deleteBucketHandler
  },
  
  // File operations
  {
    name: 'list-folders',
    description: 'List folders in a storage bucket',
    schema: listFoldersSchema,
    handler: listFoldersHandler
  },
  {
    name: 'delete-file',
    description: 'Delete a file from a storage bucket',
    schema: deleteFileSchema,
    handler: deleteFileHandler
  },
  {
    name: 'bulk-delete-files',
    description: 'Delete multiple files or folders from a storage bucket',
    schema: bulkDeleteFilesSchema,
    handler: bulkDeleteFilesHandler
  }
];

// Export individual tools for direct access
export {
  // Bucket operations
  createBucketSchema,
  createBucketHandler,
  listBucketsSchema,
  listBucketsHandler,
  deleteBucketSchema,
  deleteBucketHandler,
  
  // File operations
  listFoldersSchema,
  listFoldersHandler,
  deleteFileSchema,
  deleteFileHandler,
  bulkDeleteFilesSchema,
  bulkDeleteFilesHandler
}; 