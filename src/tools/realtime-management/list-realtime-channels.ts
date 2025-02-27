import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for list-realtime-channels tool
export const listRealtimeChannelsSchema = {
  channelName: z.string().optional().describe("Channel name pattern to filter by (supports SQL LIKE pattern)"),
  includeDetails: z.boolean().optional().default(true).describe("Include detailed channel information"),
  limit: z.number().optional().default(50).describe("Maximum number of channels to return"),
  offset: z.number().optional().default(0).describe("Offset for pagination")
};

// Interface for Realtime channel information
interface RealtimeChannel {
  id: string;
  name: string;
  type: string;
  created_at: string;
  updated_at: string;
  subscribers_count?: number;
  presence_count?: number;
  broadcast_count?: number;
}

// Handler for list-realtime-channels tool
export const listRealtimeChannelsHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      channelName = "",
      includeDetails = true,
      limit = 5,
      offset = 0
    } = params as {
      channelName?: string;
      includeDetails?: boolean;
      limit?: number;
      offset?: number;
    };

    // Check if the realtime schema exists
    const schemaCheckResult = await pool.query(`
      SELECT EXISTS (
        SELECT 1 
        FROM pg_namespace 
        WHERE nspname = 'realtime'
      ) as schema_exists;
    `);

    if (!schemaCheckResult.rows[0].schema_exists) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ 
              error: "The 'realtime' schema does not exist. Please use the manage-realtime-status tool with action 'enable' to set up Realtime properly." 
            }, null, 2)
          }
        ]
      };
    }

    // Check if the messages table exists
    const messagesTableCheckResult = await pool.query(`
      SELECT EXISTS (
        SELECT 1 
        FROM pg_tables 
        WHERE schemaname = 'realtime' AND tablename = 'messages'
      ) as table_exists;
    `);

    if (!messagesTableCheckResult.rows[0].table_exists) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ 
              error: "The 'realtime.messages' table does not exist. Please use the manage-realtime-status tool with action 'enable' to set up Realtime properly." 
            }, null, 2)
          }
        ]
      };
    }

    // Check if the channels table exists
    const tableCheckResult = await pool.query(`
      SELECT EXISTS (
        SELECT 1 
        FROM pg_tables 
        WHERE schemaname = 'realtime' AND tablename = 'channels'
      ) as table_exists;
    `);

    // Check if the channels view exists
    const viewCheckResult = await pool.query(`
      SELECT EXISTS (
        SELECT 1 
        FROM pg_views 
        WHERE schemaname = 'realtime' AND viewname = 'channels'
      ) as view_exists;
    `);

    if (!tableCheckResult.rows[0].table_exists && !viewCheckResult.rows[0].view_exists) {
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

    // Try to determine the structure of the channels table/view
    let channelsQuery = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'realtime' AND table_name = 'channels'
    `;
    
    const columnsResult = await pool.query(channelsQuery);
    const columns = columnsResult.rows.map(row => row.column_name);
    
    // Build the query based on available columns
    let selectColumns = ['id', 'name'];
    
    if (columns.includes('type')) {
      selectColumns.push('type');
    }
    
    if (columns.includes('created_at')) {
      selectColumns.push('created_at');
    }
    
    if (columns.includes('updated_at')) {
      selectColumns.push('updated_at');
    }
    
    if (includeDetails) {
      if (columns.includes('subscribers_count')) {
        selectColumns.push('subscribers_count');
      }
      
      if (columns.includes('presence_count')) {
        selectColumns.push('presence_count');
      }
      
      if (columns.includes('broadcast_count')) {
        selectColumns.push('broadcast_count');
      }
    }
    
    // Build the query to fetch channels
    let query = `
      SELECT ${selectColumns.join(', ')}
      FROM realtime.channels
    `;

    // Add channel name filter if provided
    const queryParams: any[] = [];
    let paramIndex = 1;

    if (channelName && channelName.trim() !== "") {
      query += ` WHERE name LIKE $${paramIndex}`;
      queryParams.push(`%${channelName}%`);
      paramIndex++;
    }

    // Add ORDER BY clause
    query += ` ORDER BY name`;
    
    // Add LIMIT and OFFSET
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    queryParams.push(limit, offset);
    
    // Execute the query
    const result = await pool.query(query, queryParams);
    
    // Format the result
    const channels: RealtimeChannel[] = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      type: row.type || 'standard',
      created_at: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
      updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
      ...(row.subscribers_count !== undefined && { subscribers_count: parseInt(row.subscribers_count) }),
      ...(row.presence_count !== undefined && { presence_count: parseInt(row.presence_count) }),
      ...(row.broadcast_count !== undefined && { broadcast_count: parseInt(row.broadcast_count) })
    }));
    
    // Return the result
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ channels }, null, 2)
        }
      ]
    };
  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ 
            error: `Failed to list Realtime channels: ${error.message}` 
          }, null, 2)
        }
      ]
    };
  }
}; 