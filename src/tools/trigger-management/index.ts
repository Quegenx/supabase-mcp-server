import { listTriggersSchema, listTriggersHandler } from "./list-triggers.js";
import { createTriggerSchema, createTriggerHandler } from "./create-trigger.js";
import { updateTriggerSchema, updateTriggerHandler } from "./update-trigger.js";
import { deleteTriggerSchema, deleteTriggerHandler } from "./delete-trigger.js";
import { ToolDefinition } from "../../types.js";

// Export all trigger management tools
export const triggerManagementTools: ToolDefinition[] = [
  {
    name: 'list-triggers',
    description: "List all triggers or get details about specific triggers",
    schema: listTriggersSchema,
    handler: listTriggersHandler
  },
  {
    name: 'create-trigger',
    description: "Create a new database trigger",
    schema: createTriggerSchema,
    handler: createTriggerHandler
  },
  {
    name: 'update-trigger',
    description: "Update an existing database trigger",
    schema: updateTriggerSchema,
    handler: updateTriggerHandler
  },
  {
    name: 'delete-trigger',
    description: "Remove a trigger from the database",
    schema: deleteTriggerSchema,
    handler: deleteTriggerHandler
  }
];

// Export individual tools for direct access
export {
  listTriggersSchema,
  listTriggersHandler,
  createTriggerSchema,
  createTriggerHandler,
  updateTriggerSchema,
  updateTriggerHandler,
  deleteTriggerSchema,
  deleteTriggerHandler
}; 