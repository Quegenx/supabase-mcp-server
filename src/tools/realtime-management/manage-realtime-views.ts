import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for manage-realtime-views tool
export const manageRealtimeViewsSchema = {
  action: z.enum(["create", "update", "drop", "status"]).describe("Action to perform on the view"),
  viewName: z.enum(["channels"]).describe("Name of the view to manage"),
  customDefinition: z.string().optional().describe("Custom SQL definition for the view (only for create/update actions)")
};

// Handler for manage-realtime-views tool
export const manageRealtimeViewsHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      action,
      viewName,
      customDefinition
    } = params as {
      action: "create" | "update" | "drop" | "status";
      viewName: "channels";
      customDefinition?: string;
    };

    // Check if the realtime schema exists
    const schemaCheckResult = await pool.query(`
      SELECT EXISTS (
        SELECT 1 
        FROM pg_namespace 
        WHERE nspname = 'realtime'
      ) as schema_exists;
    `);

    const realtimeExists = schemaCheckResult.rows[0].schema_exists;

    if (!realtimeExists) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "Realtime is not enabled. Please enable Realtime first using the manage-realtime-status tool."
            }, null, 2)
          }
        ]
      };
    }

    // Check if the realtime.messages table exists
    const tableCheckResult = await pool.query(`
      SELECT EXISTS (
        SELECT 1 
        FROM pg_tables 
        WHERE schemaname = 'realtime' AND tablename = 'messages'
      ) as table_exists;
    `);

    const messagesTableExists = tableCheckResult.rows[0].table_exists;

    if (!messagesTableExists) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "Realtime messages table does not exist. Please enable Realtime first using the manage-realtime-status tool."
            }, null, 2)
          }
        ]
      };
    }

    // Check if the view exists
    const viewCheckResult = await pool.query(`
      SELECT EXISTS (
        SELECT 1 
        FROM pg_views 
        WHERE schemaname = 'realtime' AND viewname = $1
      ) as view_exists;
    `, [viewName]);

    const viewExists = viewCheckResult.rows[0].view_exists;

    // Handle status action
    if (action === "status") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: {
                viewName: viewName,
                exists: viewExists
              }
            }, null, 2)
          }
        ]
      };
    }

    // Handle drop action
    if (action === "drop") {
      if (!viewExists) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                message: `View 'realtime.${viewName}' does not exist, nothing to drop.`
              }, null, 2)
            }
          ]
        };
      }

      await pool.query(`DROP VIEW realtime.${viewName};`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              message: `Successfully dropped view 'realtime.${viewName}'.`
            }, null, 2)
          }
        ]
      };
    }

    // Handle create/update actions
    if (action === "create" || action === "update") {
      if (action === "create" && viewExists) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: `View 'realtime.${viewName}' already exists. Use action 'update' to modify it.`
              }, null, 2)
            }
          ]
        };
      }

      if (action === "update" && !viewExists) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: `View 'realtime.${viewName}' does not exist. Use action 'create' to create it.`
              }, null, 2)
            }
          ]
        };
      }

      // Check the actual structure of the messages table
      const columnsQuery = `
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema = 'realtime' AND table_name = 'messages'
      `;
      
      const columnsResult = await pool.query(columnsQuery);
      const columns = columnsResult.rows.map(row => row.column_name.toLowerCase());
      
      // Default view definitions based on actual table structure
      let viewDefinition = "";
      
      if (viewName === "channels") {
        if (customDefinition) {
          viewDefinition = customDefinition;
        } else {
          // Check if the necessary columns exist
          const hasChannelId = columns.includes('channel_id');
          const hasChannel = columns.includes('channel');
          const hasCreatedAt = columns.includes('created_at');
          const hasMessage = columns.includes('message');
          
          if (hasChannelId) {
            // Original expected structure
            viewDefinition = `
              SELECT DISTINCT channel_id as id, channel_id as name, 'standard' as type, 
                     MIN(created_at) as created_at, MAX(created_at) as updated_at,
                     COUNT(*) as broadcast_count
              FROM realtime.messages
              GROUP BY channel_id
            `;
          } else if (hasChannel) {
            // Alternative structure with 'channel' instead of 'channel_id'
            viewDefinition = `
              SELECT DISTINCT channel as id, channel as name, 'standard' as type, 
                     MIN(created_at) as created_at, MAX(created_at) as updated_at,
                     COUNT(*) as broadcast_count
              FROM realtime.messages
              GROUP BY channel
            `;
          } else {
            // Try to determine a suitable column to use as channel identifier
            // First, check if the message column contains a channel field
            if (hasMessage) {
              // Use JSON extraction if message is JSONB
              viewDefinition = `
                SELECT DISTINCT 
                  COALESCE(message->>'channel', 'default') as id, 
                  COALESCE(message->>'channel', 'default') as name, 
                  'standard' as type,
                  ${hasCreatedAt ? 'MIN(created_at) as created_at, MAX(created_at) as updated_at,' : 'now() as created_at, now() as updated_at,'}
                  COUNT(*) as broadcast_count
                FROM realtime.messages
                GROUP BY COALESCE(message->>'channel', 'default')
              `;
            } else {
              // If we can't find a suitable column, create a simple view with a default channel
              viewDefinition = `
                SELECT 
                  'default' as id, 
                  'default' as name, 
                  'standard' as type,
                  ${hasCreatedAt ? 'MIN(created_at) as created_at, MAX(created_at) as updated_at,' : 'now() as created_at, now() as updated_at,'}
                  COUNT(*) as broadcast_count
                FROM realtime.messages
              `;
            }
          }
        }
      }

      try {
        // Create or replace the view
        await pool.query(`CREATE OR REPLACE VIEW realtime.${viewName} AS ${viewDefinition};`);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                message: `Successfully ${action === "create" ? "created" : "updated"} view 'realtime.${viewName}'.`,
                viewDefinition: viewDefinition.trim()
              }, null, 2)
            }
          ]
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ 
                error: `Failed to ${action} view 'realtime.${viewName}': ${error.message}`,
                attemptedDefinition: viewDefinition.trim()
              }, null, 2)
            }
          ]
        };
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ 
            error: `Invalid action: ${action}. Must be one of: create, update, drop, status.` 
          }, null, 2)
        }
      ]
    };
  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ 
            error: `Failed to manage Realtime view: ${error.message}` 
          }, null, 2)
        }
      ]
    };
  }
}; 