import { listSecurityAdvisorSchema, listSecurityAdvisorHandler } from "./list-security-advisor.js";
import { listPerformanceAdvisorSchema, listPerformanceAdvisorHandler } from "./list-performance-advisor.js";
import { ToolDefinition } from "../../types.js";

// Export all advisor management tools
export const advisorManagementTools: ToolDefinition[] = [
  {
    name: 'list-security-advisor',
    description: "List security advisor checks and their results for your database",
    schema: listSecurityAdvisorSchema,
    handler: listSecurityAdvisorHandler
  },
  {
    name: 'list-performance-advisor',
    description: "List performance advisor checks and their results for your database",
    schema: listPerformanceAdvisorSchema,
    handler: listPerformanceAdvisorHandler
  }
];

// Export individual tools for direct access
export {
  listSecurityAdvisorSchema,
  listSecurityAdvisorHandler,
  listPerformanceAdvisorSchema,
  listPerformanceAdvisorHandler
}; 