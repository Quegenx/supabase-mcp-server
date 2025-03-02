import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for get-realtime-messages tool
export const getRealtimeMessagesSchema = {
  channelId: z.string().describe("Channel ID/name to get messages from"),
  limit: z.number().int().positive().optional().default(50).describe("Maximum number of messages to return"),
  offset: z.number().int().nonnegative().optional().default(0).describe("Number of messages to skip"),
  orderBy: z.enum(["created_at", "id"]).optional().default("created_at").describe("Field to order results by"),
  orderDirection: z.enum(["asc", "desc"]).optional().default("desc").describe("Order direction (newest first by default)"),
  eventFilter: z.string().optional().describe("Filter messages by event name"),
  startDate: z.string().optional().describe("Filter messages created after this date (ISO format)"),
  endDate: z.string().optional().describe("Filter messages created before this date (ISO format)")
};

// Handler for get-realtime-messages tool
export const getRealtimeMessagesHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      channelId,
      limit = 5,
      offset = 0,
      orderBy = "created_at",
      orderDirection = "desc",
      eventFilter,
      startDate,
      endDate
    } = params as {
      channelId: string;
      limit?: number;
      offset?: number;
      orderBy?: "created_at" | "id";
      orderDirection?: "asc" | "desc";
      eventFilter?: string;
      startDate?: string;
      endDate?: string;
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

    // Build the query with filters
    let query = `
      SELECT id, channel_id, message, created_at
      FROM realtime.messages
      WHERE channel_id = $1
    `;
    
    const queryParams = [channelId];
    let paramIndex = 2;
    
    // Add event filter if provided
    if (eventFilter) {
      query += ` AND message->>'event' = $${paramIndex}`;
      queryParams.push(eventFilter);
      paramIndex++;
    }
    
    // Add date filters if provided
    if (startDate) {
      query += ` AND created_at >= $${paramIndex}::timestamptz`;
      queryParams.push(startDate);
      paramIndex++;
    }
    
    if (endDate) {
      query += ` AND created_at <= $${paramIndex}::timestamptz`;
      queryParams.push(endDate);
      paramIndex++;
    }
    
    // Add ordering
    query += ` ORDER BY ${orderBy} ${orderDirection}`;
    
    // Add pagination
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    queryParams.push(limit.toString(), offset.toString());
    
    // Execute the query
    const messagesResult = await pool.query(query, queryParams);
    
    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(*) as total
      FROM realtime.messages
      WHERE channel_id = $1
    `;
    
    const countParams = [channelId];
    paramIndex = 2;
    
    // Add event filter if provided
    if (eventFilter) {
      countQuery += ` AND message->>'event' = $${paramIndex}`;
      countParams.push(eventFilter);
      paramIndex++;
    }
    
    // Add date filters if provided
    if (startDate) {
      countQuery += ` AND created_at >= $${paramIndex}::timestamptz`;
      countParams.push(startDate);
      paramIndex++;
    }
    
    if (endDate) {
      countQuery += ` AND created_at <= $${paramIndex}::timestamptz`;
      countParams.push(endDate);
      paramIndex++;
    }
    
    const countResult = await pool.query(countQuery, countParams);
    const totalCount = parseInt(countResult.rows[0].total);
    
    // Format the messages
    const messages = messagesResult.rows.map(row => ({
      id: row.id,
      channelId: row.channel_id,
      payload: row.message,
      createdAt: row.created_at
    }));
    
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
            messages: messages,
            pagination: {
              total: totalCount,
              limit: limit,
              offset: offset,
              hasMore: offset + messages.length < totalCount
            },
            channel: channelDetails
          }, null, 2)
        }
      ]
    };
  } catch (error) {
    console.error("Error retrieving Realtime messages:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Failed to retrieve Realtime messages: ${errorMessage}` }, null, 2)
        }
      ]
    };
  }
}; 