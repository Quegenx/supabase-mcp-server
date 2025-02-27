import { listPoliciesSchema, listPoliciesHandler } from "./list-policies.js";
import { createPolicySchema, createPolicyHandler } from "./create-policy.js";
import { updatePolicySchema, updatePolicyHandler } from "./update-policy.js";
import { deletePolicySchema, deletePolicyHandler } from "./delete-policy.js";
import { ToolDefinition } from "../../types.js";

// Export all policy management tools
export const policyManagementTools: ToolDefinition[] = [
  {
    name: 'list-policies',
    description: "List all policies or get details about specific policies",
    schema: listPoliciesSchema,
    handler: listPoliciesHandler
  },
  {
    name: 'create-policy',
    description: "Create a new row-level security policy",
    schema: createPolicySchema,
    handler: createPolicyHandler
  },
  {
    name: 'update-policy',
    description: "Update an existing row-level security policy",
    schema: updatePolicySchema,
    handler: updatePolicyHandler
  },
  {
    name: 'delete-policy',
    description: "Remove a row-level security policy from a table",
    schema: deletePolicySchema,
    handler: deletePolicyHandler
  }
];

// Export individual tools for direct access
export {
  listPoliciesSchema,
  listPoliciesHandler,
  createPolicySchema,
  createPolicyHandler,
  updatePolicySchema,
  updatePolicyHandler,
  deletePolicySchema,
  deletePolicyHandler
}; 