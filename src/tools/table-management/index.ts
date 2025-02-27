import { createTableSchema, createTableHandler } from './create-table.js';
import { listTablesSchema, listTablesHandler } from './list-tables.js';
import { dropTableSchema, dropTableHandler } from './drop-table.js';
import { renameTableSchema, renameTableHandler } from './rename-table.js';
import { addColumnSchema, addColumnHandler } from './add-column.js';
import { dropColumnSchema, dropColumnHandler } from './drop-column.js';
import { alterColumnSchema, alterColumnHandler } from './alter-column.js';
import { listRecordsSchema, listRecordsHandler } from './list-records.js';
import { createRecordSchema, createRecordHandler } from './create-record.js';
import { updateRecordSchema, updateRecordHandler } from './update-record.js';
import { deleteRecordSchema, deleteRecordHandler } from './delete-record.js';
import { ToolDefinition } from '../../types.js';

// Export all table management tools
export const tableManagementTools: ToolDefinition[] = [
  // Table operations
  {
    name: 'create-table',
    description: 'Create a new table',
    schema: createTableSchema,
    handler: createTableHandler
  },
  {
    name: 'list-tables',
    description: 'List all tables or get details about a specific table',
    schema: listTablesSchema,
    handler: listTablesHandler
  },
  {
    name: 'drop-table',
    description: 'Remove a table from the database',
    schema: dropTableSchema,
    handler: dropTableHandler
  },
  {
    name: 'rename-table',
    description: 'Rename a table in the database',
    schema: renameTableSchema,
    handler: renameTableHandler
  },
  
  // Column operations
  {
    name: 'add-column',
    description: 'Add a new column to a table',
    schema: addColumnSchema,
    handler: addColumnHandler
  },
  {
    name: 'drop-column',
    description: 'Remove a column from a table',
    schema: dropColumnSchema,
    handler: dropColumnHandler
  },
  {
    name: 'alter-column',
    description: 'Modify a column\'s definition',
    schema: alterColumnSchema,
    handler: alterColumnHandler
  },
  
  // Record operations
  {
    name: 'list-records',
    description: 'Fetch records from a table',
    schema: listRecordsSchema,
    handler: listRecordsHandler
  },
  {
    name: 'create-record',
    description: 'Insert a new record into a table',
    schema: createRecordSchema,
    handler: createRecordHandler
  },
  {
    name: 'update-record',
    description: 'Update existing records in a table',
    schema: updateRecordSchema,
    handler: updateRecordHandler
  },
  {
    name: 'delete-record',
    description: 'Delete records from a table',
    schema: deleteRecordSchema,
    handler: deleteRecordHandler
  }
];

// Export individual tools for direct access
export { 
  // Table operations
  createTableSchema, 
  createTableHandler,
  listTablesSchema,
  listTablesHandler,
  dropTableSchema,
  dropTableHandler,
  renameTableSchema,
  renameTableHandler,
  
  // Column operations
  addColumnSchema,
  addColumnHandler,
  dropColumnSchema,
  dropColumnHandler,
  alterColumnSchema,
  alterColumnHandler,
  
  // Record operations
  listRecordsSchema,
  listRecordsHandler,
  createRecordSchema,
  createRecordHandler,
  updateRecordSchema,
  updateRecordHandler,
  deleteRecordSchema,
  deleteRecordHandler
}; 