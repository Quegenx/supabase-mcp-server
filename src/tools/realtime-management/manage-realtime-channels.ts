import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for manage-realtime-channels tool
export const manageRealtimeChannelsSchema = {
  action: z.enum(["create", "delete", "details"]).describe("Action to perform on the channel"),
  channelId: z.string().describe("Channel ID/name to manage"),
  channelType: z.enum(["broadcast", "presence", "standard"]).optional().default("standard").describe("Type of channel (only for create action)"),
  metadata: z.record(z.any()).optional().describe("Additional metadata for the channel (only for create action)")
};

// Handler for manage-realtime-channels tool
export const manageRealtimeChannelsHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      action,
      channelId,
      channelType = "standard",
      metadata = {}
    } = params as {
      action: "create" | "delete" | "details";
      channelId: string;
      channelType?: "broadcast" | "presence" | "standard";
      metadata?: Record<string, any>;
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

    // Check if the channel exists
    const columnsResult = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'realtime' AND table_name = 'messages'
    `);
    const columns = columnsResult.rows.map(row => row.column_name.toLowerCase());
    
    const hasChannelId = columns.includes('channel_id');
    const hasChannel = columns.includes('channel');
    
    let channelCheckQuery = "";
    if (hasChannelId) {
      channelCheckQuery = `
        SELECT EXISTS (
          SELECT 1 
          FROM realtime.messages 
          WHERE channel_id = $1
        ) as channel_exists;
      `;
    } else if (hasChannel) {
      channelCheckQuery = `
        SELECT EXISTS (
          SELECT 1 
          FROM realtime.messages 
          WHERE channel = $1
        ) as channel_exists;
      `;
    } else {
      channelCheckQuery = `
        SELECT EXISTS (
          SELECT 1 
          FROM realtime.messages 
          WHERE message->>'channel' = $1
        ) as channel_exists;
      `;
    }
    
    const channelCheckResult = await pool.query(channelCheckQuery, [channelId]);
    const channelExists = channelCheckResult.rows[0].channel_exists;

    // Get channel details if it exists
    let channelDetails = null;
    if (channelExists) {
      // Check if the channels view exists
      const viewCheckResult = await pool.query(`
        SELECT EXISTS (
          SELECT 1 
          FROM pg_views 
          WHERE schemaname = 'realtime' AND viewname = 'channels'
        ) as view_exists;
      `);

      const channelsViewExists = viewCheckResult.rows[0].view_exists;

      if (!channelsViewExists) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "The 'realtime.channels' view does not exist. Please use the manage-realtime-status tool with action 'enable' to set up Realtime properly."
              }, null, 2)
            }
          ]
        };
      }

      // Get details from the view
      try {
        const detailsResult = await pool.query(`
          SELECT * FROM realtime.channels WHERE id = $1;
        `, [channelId]);

        if (detailsResult.rows.length > 0) {
          channelDetails = detailsResult.rows[0];
        }
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: `Failed to get channel details: ${error.message}`
              }, null, 2)
            }
          ]
        };
      }
    }

    // Handle different actions
    if (action === "details") {
      if (!channelExists) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: `Channel '${channelId}' does not exist.`
              }, null, 2)
            }
          ]
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              channel: channelDetails
            }, null, 2)
          }
        ]
      };
    }

    if (action === "delete") {
      if (!channelExists) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                message: `Channel '${channelId}' does not exist, nothing to delete.`
              }, null, 2)
            }
          ]
        };
      }

      // Check the structure of the messages table to determine how to delete
      const columnsResult = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema = 'realtime' AND table_name = 'messages'
      `);
      const columns = columnsResult.rows.map(row => row.column_name.toLowerCase());
      
      const hasChannelId = columns.includes('channel_id');
      const hasChannel = columns.includes('channel');
      
      // Delete based on table structure
      if (hasChannelId) {
        await pool.query(`
          DELETE FROM realtime.messages
          WHERE channel_id = $1;
        `, [channelId]);
      } else if (hasChannel) {
        await pool.query(`
          DELETE FROM realtime.messages
          WHERE channel = $1;
        `, [channelId]);
      } else {
        // If neither column exists, try to delete based on the channel in the message
        await pool.query(`
          DELETE FROM realtime.messages
          WHERE message->>'channel' = $1;
        `, [channelId]);
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              message: `Successfully deleted channel '${channelId}'.`,
              deletedChannel: channelDetails
            }, null, 2)
          }
        ]
      };
    }

    if (action === "create") {
      // Check if the channels view exists first
      const viewCheckResult = await pool.query(`
        SELECT EXISTS (
          SELECT 1 
          FROM pg_views 
          WHERE schemaname = 'realtime' AND viewname = 'channels'
        ) as view_exists;
      `);

      const channelsViewExists = viewCheckResult.rows[0].view_exists;

      if (!channelsViewExists) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "The 'realtime.channels' view does not exist. Please use the manage-realtime-status tool with action 'enable' to set up Realtime properly."
              }, null, 2)
            }
          ]
        };
      }

      // Check the structure of the messages table to determine how to insert
      const columnsResult = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema = 'realtime' AND table_name = 'messages'
      `);
      const columns = columnsResult.rows.map(row => row.column_name.toLowerCase());
      
      const hasChannelId = columns.includes('channel_id');
      const hasChannel = columns.includes('channel');
      
      // Prepare the message payload
      const metadataJson = JSON.stringify({
        type: channelType,
        metadata: metadata,
        system: true,
        event: "channel_created"
      });

      // Insert based on table structure
      if (hasChannelId) {
        await pool.query(`
          INSERT INTO realtime.messages (channel_id, message)
          VALUES ($1, $2);
        `, [channelId, metadataJson]);
      } else if (hasChannel) {
        await pool.query(`
          INSERT INTO realtime.messages (channel, message)
          VALUES ($1, $2);
        `, [channelId, metadataJson]);
      } else {
        // If neither column exists, try to embed the channel in the message
        const messageWithChannel = JSON.stringify({
          ...JSON.parse(metadataJson),
          channel: channelId
        });
        
        await pool.query(`
          INSERT INTO realtime.messages (message)
          VALUES ($1);
        `, [messageWithChannel]);
      }

      // Get the newly created channel details
      let newChannelDetails;
      
      const detailsResult = await pool.query(`
        SELECT * FROM realtime.channels WHERE id = $1;
      `, [channelId]);

      if (detailsResult.rows.length > 0) {
        newChannelDetails = detailsResult.rows[0];
      }

      // Add metadata to the response
      if (newChannelDetails) {
        newChannelDetails.metadata = metadata;
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              message: `Successfully created channel '${channelId}'.`,
              channel: newChannelDetails
            }, null, 2)
          }
        ]
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ 
            error: `Invalid action: ${action}. Must be one of: create, delete, details.` 
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
            error: `Failed to manage Realtime channel: ${error.message}` 
          }, null, 2)
        }
      ]
    };
  }
}; 