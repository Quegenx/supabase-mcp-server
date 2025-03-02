import { createIndexSchema, createIndexHandler } from "./create-index.js";
import { listIndexesSchema, listIndexesHandler } from "./list-indexes.js";
import { deleteIndexSchema, deleteIndexHandler } from "./delete-index.js";
import { updateIndexSchema, updateIndexHandler } from "./update-index.js";
import { ToolDefinition } from "../../types.js";

export const indexManagementTools: ToolDefinition[] = [
  {
    name: "create_index",
    description: "Create a new index on a table",
    schema: createIndexSchema,
    handler: createIndexHandler
  },
  {
    name: "list_indexes",
    description: "List all indexes or get details about specific indexes",
    schema: listIndexesSchema,
    handler: listIndexesHandler
  },
  {
    name: "delete_index",
    description: "Remove an index from the database",
    schema: deleteIndexSchema,
    handler: deleteIndexHandler
  },
  {
    name: "update_index",
    description: "Update an existing index (by recreating it)",
    schema: updateIndexSchema,
    handler: updateIndexHandler
  }
];
