import { tableManagementTools } from './table-management/index.js';
import { storageManagementTools } from './storage-management/index.js';
import { indexManagementTools } from './index-management/index.js';
import { constraintManagementTools } from './constraint-management/index.js';
import { functionManagementTools } from './function-management/index.js';
import { triggerManagementTools } from './trigger-management/index.js';
import { policyManagementTools } from './policy-management/index.js';
import { roleManagementTools } from './role-management/index.js';
import { enumManagementTools } from './enum-management/index.js';
import { publicationManagementTools } from './publication-management/index.js';
import { userManagementTools } from './user-management/index.js';
import { realtimeManagementTools } from './realtime-management/index.js';
import { advisorManagementTools } from './advisor-management/index.js';
import { ToolDefinition } from '../types.js';

// Realtime tool descriptions
const realtimeToolDescriptions: Record<string, string> = {
  list_realtime_policies: "List all Realtime policies or get details about specific policies",
  create_realtime_policy: "Create a new Realtime policy",
  update_realtime_policy: "Update an existing Realtime policy",
  delete_realtime_policy: "Remove a Realtime policy",
  list_realtime_channels: "List all Realtime channels or get details about specific channels",
  manage_realtime_status: "Enable, disable, or check the status of Realtime functionality",
  manage_realtime_channels: "Create, delete, or get details about Realtime channels",
  send_realtime_message: "Send a message to a Realtime channel",
  get_realtime_messages: "Retrieve messages from a Realtime channel",
  manage_realtime_views: "Create, update, drop, or check status of Realtime database views"
};

// Combine all tools from different categories
export const allTools: ToolDefinition[] = [
  ...tableManagementTools,
  ...storageManagementTools,
  ...indexManagementTools,
  ...constraintManagementTools,
  ...functionManagementTools,
  ...triggerManagementTools,
  ...policyManagementTools,
  ...roleManagementTools,
  ...enumManagementTools,
  ...publicationManagementTools,
  ...userManagementTools,
  ...advisorManagementTools,
  ...Object.entries(realtimeManagementTools).map(([name, tool]) => ({
    name,
    description: realtimeToolDescriptions[name] || `Realtime management tool: ${name}`,
    schema: (tool as any).schema,
    handler: (tool as any).handler
  }))
  // Add other tool categories as they are implemented
];

// Export individual tool categories for direct access
export {
  tableManagementTools,
  storageManagementTools,
  indexManagementTools,
  constraintManagementTools,
  functionManagementTools,
  triggerManagementTools,
  policyManagementTools,
  roleManagementTools,
  enumManagementTools,
  publicationManagementTools,
  userManagementTools,
  realtimeManagementTools,
  advisorManagementTools
}; 