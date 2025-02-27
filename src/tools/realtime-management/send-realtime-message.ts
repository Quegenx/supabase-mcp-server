import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for send-realtime-message tool
export const sendRealtimeMessageSchema = {
  channelId: z.string().describe("Channel ID/name to send the message to"),
  message: z.record(z.any()).describe("Message payload to send (JSON object)"),
  event: z.string().optional().describe("Event name for the message"),
  createChannelIfNotExists: z.boolean().optional().default(true).describe("Whether to create the channel if it doesn't exist")
};

// Handler for send-realtime-message tool
export const sendRealtimeMessageHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      channelId,
      message,
      event,
      createChannelIfNotExists = true
    } = params as {
      channelId: string;
      message: Record<string, any>;
      event?: string;
      createChannelIfNotExists?: boolean;
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
    const channelCheckResult = await pool.query(`
      SELECT EXISTS (
        SELECT 1 
        FROM realtime.messages 
        WHERE channel_id = $1
      ) as channel_exists;
    `, [channelId]);

    const channelExists = channelCheckResult.rows[0].channel_exists;

    if (!channelExists && !createChannelIfNotExists) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: `Channel '${channelId}' does not exist and createChannelIfNotExists is set to false.`
            }, null, 2)
          }
        ]
      };
    }

    // Prepare the message payload
    const finalMessage = { ...message };
    
    // Add event if provided
    if (event) {
      finalMessage.event = event;
    }

    // Insert the message
    const insertResult = await pool.query(`
      INSERT INTO realtime.messages (channel_id, message)
      VALUES ($1, $2)
      RETURNING id, channel_id, message, created_at;
    `, [channelId, JSON.stringify(finalMessage)]);

    const sentMessage = insertResult.rows[0];

    // Get channel details
    let channelDetails = null;
    
    // Check if the channels view exists
    const viewCheckResult = await pool.query(`
      SELECT EXISTS (
        SELECT 1 
        FROM pg_views 
        WHERE schemaname = 'realtime' AND viewname = 'channels'
      ) as view_exists;
    `);

    const channelsViewExists = viewCheckResult.rows[0].view_exists;

    if (channelsViewExists) {
      const detailsResult = await pool.query(`
        SELECT * FROM realtime.channels WHERE id = $1;
      `, [channelId]);

      if (detailsResult.rows.length > 0) {
        channelDetails = detailsResult.rows[0];
      }
    } else {
      // If view doesn't exist, get basic details from messages table
      const detailsResult = await pool.query(`
        SELECT 
          channel_id as id, 
          channel_id as name, 
          'standard' as type, 
          MIN(created_at) as created_at, 
          MAX(created_at) as updated_at,
          COUNT(*) as broadcast_count
        FROM realtime.messages
        WHERE channel_id = $1
        GROUP BY channel_id;
      `, [channelId]);

      if (detailsResult.rows.length > 0) {
        channelDetails = detailsResult.rows[0];
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            message: `Successfully sent message to channel '${channelId}'.`,
            sentMessage: {
              id: sentMessage.id,
              channelId: sentMessage.channel_id,
              payload: sentMessage.message,
              createdAt: sentMessage.created_at
            },
            channel: channelDetails,
            channelCreated: !channelExists && createChannelIfNotExists
          }, null, 2)
        }
      ]
    };
  } catch (error) {
    console.error("Error sending Realtime message:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Failed to send Realtime message: ${errorMessage}` }, null, 2)
        }
      ]
    };
  }
}; 