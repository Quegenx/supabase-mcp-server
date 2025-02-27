import { listRealtimePoliciesHandler, listRealtimePoliciesSchema } from "./list-realtime-policies.js";
import { createRealtimePolicyHandler, createRealtimePolicySchema } from "./create-realtime-policy.js";
import { updateRealtimePolicyHandler, updateRealtimePolicySchema } from "./update-realtime-policy.js";
import { deleteRealtimePolicyHandler, deleteRealtimePolicySchema } from "./delete-realtime-policy.js";
import { listRealtimeChannelsHandler, listRealtimeChannelsSchema } from "./list-realtime-channels.js";
import { manageRealtimeStatusHandler, manageRealtimeStatusSchema } from "./manage-realtime-status.js";
import { manageRealtimeChannelsHandler, manageRealtimeChannelsSchema } from "./manage-realtime-channels.js";
import { sendRealtimeMessageHandler, sendRealtimeMessageSchema } from "./send-realtime-message.js";
import { getRealtimeMessagesHandler, getRealtimeMessagesSchema } from "./get-realtime-messages.js";
import { manageRealtimeViewsHandler, manageRealtimeViewsSchema } from "./manage-realtime-views.js";

export const realtimeManagementTools = {
  "list_realtime_policies": {
    schema: listRealtimePoliciesSchema,
    handler: listRealtimePoliciesHandler
  },
  "create_realtime_policy": {
    schema: createRealtimePolicySchema,
    handler: createRealtimePolicyHandler
  },
  "update_realtime_policy": {
    schema: updateRealtimePolicySchema,
    handler: updateRealtimePolicyHandler
  },
  "delete_realtime_policy": {
    schema: deleteRealtimePolicySchema,
    handler: deleteRealtimePolicyHandler
  },
  "list_realtime_channels": {
    schema: listRealtimeChannelsSchema,
    handler: listRealtimeChannelsHandler
  },
  "manage_realtime_status": {
    schema: manageRealtimeStatusSchema,
    handler: manageRealtimeStatusHandler
  },
  "manage_realtime_channels": {
    schema: manageRealtimeChannelsSchema,
    handler: manageRealtimeChannelsHandler
  },
  "send_realtime_message": {
    schema: sendRealtimeMessageSchema,
    handler: sendRealtimeMessageHandler
  },
  "get_realtime_messages": {
    schema: getRealtimeMessagesSchema,
    handler: getRealtimeMessagesHandler
  },
  "manage_realtime_views": {
    schema: manageRealtimeViewsSchema,
    handler: manageRealtimeViewsHandler
  }
}; 