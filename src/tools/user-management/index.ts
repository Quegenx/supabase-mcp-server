import { listUsersHandler, listUsersSchema } from "./list-users.js";
import { createUserHandler, createUserSchema } from "./create-user.js";
import { updateUserHandler, updateUserSchema } from "./update-user.js";
import { deleteUserHandler, deleteUserSchema } from "./delete-user.js";

// Export all user management tools
export const userManagementTools = [
  {
    name: "list_users",
    description: "List all users or search for specific users in Supabase Auth",
    schema: listUsersSchema,
    handler: listUsersHandler
  },
  {
    name: "create_user",
    description: "Create a new user in Supabase Auth",
    schema: createUserSchema,
    handler: createUserHandler
  },
  {
    name: "update_user",
    description: "Update an existing user in Supabase Auth",
    schema: updateUserSchema,
    handler: updateUserHandler
  },
  {
    name: "delete_user",
    description: "Delete a user from Supabase Auth",
    schema: deleteUserSchema,
    handler: deleteUserHandler
  }
];

// Export individual tools for direct access
export { listUsersSchema, listUsersHandler };
export { createUserSchema, createUserHandler };
export { updateUserSchema, updateUserHandler };
export { deleteUserSchema, deleteUserHandler }; 