import { listRolesSchema, listRolesHandler } from "./list-roles.js";
import { createRoleSchema, createRoleHandler } from "./create-role.js";
import { updateRoleSchema, updateRoleHandler } from "./update-role.js";
import { deleteRoleSchema, deleteRoleHandler } from "./delete-role.js";
import { ToolDefinition } from "../../types.js";

// Export all role management tools
export const roleManagementTools: ToolDefinition[] = [
  {
    name: 'list-roles',
    description: "List all roles or get details about specific roles",
    schema: listRolesSchema,
    handler: listRolesHandler
  },
  {
    name: 'create-role',
    description: "Create a new database role",
    schema: createRoleSchema,
    handler: createRoleHandler
  },
  {
    name: 'update-role',
    description: "Update an existing database role",
    schema: updateRoleSchema,
    handler: updateRoleHandler
  },
  {
    name: 'delete-role',
    description: "Remove a role from the database",
    schema: deleteRoleSchema,
    handler: deleteRoleHandler
  }
];

// Export individual tools for direct access
export {
  listRolesSchema,
  listRolesHandler,
  createRoleSchema,
  createRoleHandler,
  updateRoleSchema,
  updateRoleHandler,
  deleteRoleSchema,
  deleteRoleHandler
}; 