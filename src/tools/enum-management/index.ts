import { listEnumeratedTypesSchema, listEnumeratedTypesHandler } from "./list-enumerated-types.js";
import { createEnumeratedTypeSchema, createEnumeratedTypeHandler } from "./create-enumerated-type.js";
import { updateEnumeratedTypeSchema, updateEnumeratedTypeHandler } from "./update-enumerated-type.js";
import { deleteEnumeratedTypeSchema, deleteEnumeratedTypeHandler } from "./delete-enumerated-type.js";
import { ToolDefinition } from "../../types.js";

// Export all enumerated type management tools
export const enumManagementTools: ToolDefinition[] = [
  {
    name: 'list-enumerated-types',
    description: "List all enumerated types or get details about specific enumerated types",
    schema: listEnumeratedTypesSchema,
    handler: listEnumeratedTypesHandler
  },
  {
    name: 'create-enumerated-type',
    description: "Create a new enumerated type",
    schema: createEnumeratedTypeSchema,
    handler: createEnumeratedTypeHandler
  },
  {
    name: 'update-enumerated-type',
    description: "Update an existing enumerated type",
    schema: updateEnumeratedTypeSchema,
    handler: updateEnumeratedTypeHandler
  },
  {
    name: 'delete-enumerated-type',
    description: "Remove an enumerated type from the database",
    schema: deleteEnumeratedTypeSchema,
    handler: deleteEnumeratedTypeHandler
  }
];

// Export individual tools for direct access
export {
  listEnumeratedTypesSchema,
  listEnumeratedTypesHandler,
  createEnumeratedTypeSchema,
  createEnumeratedTypeHandler,
  updateEnumeratedTypeSchema,
  updateEnumeratedTypeHandler,
  deleteEnumeratedTypeSchema,
  deleteEnumeratedTypeHandler
}; 