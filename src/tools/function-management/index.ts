import { listFunctionsSchema, listFunctionsHandler } from "./list-functions.js";
import { createFunctionSchema, createFunctionHandler } from "./create-function.js";
import { updateFunctionSchema, updateFunctionHandler } from "./update-function.js";
import { deleteFunctionSchema, deleteFunctionHandler } from "./delete-function.js";
import { ToolDefinition } from "../../types.js";

// Export all function management tools
export const functionManagementTools: ToolDefinition[] = [
  {
    name: 'list-functions',
    description: "List all functions or get details about specific functions",
    schema: listFunctionsSchema,
    handler: listFunctionsHandler
  },
  {
    name: 'create-function',
    description: "Create a new database function",
    schema: createFunctionSchema,
    handler: createFunctionHandler
  },
  {
    name: 'update-function',
    description: "Update an existing database function",
    schema: updateFunctionSchema,
    handler: updateFunctionHandler
  },
  {
    name: 'delete-function',
    description: "Remove a function from the database",
    schema: deleteFunctionSchema,
    handler: deleteFunctionHandler
  }
];

// Export individual tools for direct access
export {
  listFunctionsSchema,
  listFunctionsHandler,
  createFunctionSchema,
  createFunctionHandler,
  updateFunctionSchema,
  updateFunctionHandler,
  deleteFunctionSchema,
  deleteFunctionHandler
}; 