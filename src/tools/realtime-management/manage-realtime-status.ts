import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for manage-realtime-status tool
export const manageRealtimeStatusSchema = {
  action: z.enum(["enable", "disable", "status"]).describe("Action to perform (enable, disable, or check status)"),
  enableBroadcast: z.boolean().optional().default(true).describe("Enable broadcast feature (only for 'enable' action)"),
  enablePresence: z.boolean().optional().default(true).describe("Enable presence feature (only for 'enable' action)"),
  enableRLS: z.boolean().optional().default(true).describe("Enable Row Level Security for Realtime (only for 'enable' action)")
};

// Handler for manage-realtime-status tool
export const manageRealtimeStatusHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      action,
      enableBroadcast = true,
      enablePresence = true,
      enableRLS = true
    } = params as {
      action: "enable" | "disable" | "status";
      enableBroadcast?: boolean;
      enablePresence?: boolean;
      enableRLS?: boolean;
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

    // Check if the realtime.messages table exists
    let messagesTableExists = false;
    if (realtimeExists) {
      const tableCheckResult = await pool.query(`
        SELECT EXISTS (
          SELECT 1 
          FROM pg_tables 
          WHERE schemaname = 'realtime' AND tablename = 'messages'
        ) as table_exists;
      `);
      messagesTableExists = tableCheckResult.rows[0].table_exists;
    }

    // Check if RLS is enabled on the messages table
    let rlsEnabled = false;
    if (messagesTableExists) {
      const rlsCheckResult = await pool.query(`
        SELECT relrowsecurity 
        FROM pg_class c
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE n.nspname = 'realtime' AND c.relname = 'messages';
      `);
      rlsEnabled = rlsCheckResult.rows[0]?.relrowsecurity || false;
    }

    // Check if the supabase_realtime extension exists
    const extensionCheckResult = await pool.query(`
      SELECT EXISTS (
        SELECT 1 
        FROM pg_extension 
        WHERE extname = 'supabase_realtime'
      ) as extension_exists;
    `);

    const extensionExists = extensionCheckResult.rows[0].extension_exists;

    // Get current status
    const status = {
      realtimeEnabled: realtimeExists && messagesTableExists,
      realtimeSchemaExists: realtimeExists,
      messagesTableExists: messagesTableExists,
      rlsEnabled: rlsEnabled,
      extensionExists: extensionExists
    };

    // If just checking status, return it
    if (action === "status") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: status
            }, null, 2)
          }
        ]
      };
    }

    // If disabling Realtime
    if (action === "disable") {
      if (!realtimeExists) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                message: "Realtime is already disabled.",
                status: status
              }, null, 2)
            }
          ]
        };
      }

      // Start a transaction
      await pool.query('BEGIN');

      try {
        // Drop the realtime schema with cascade to remove all objects
        await pool.query(`DROP SCHEMA IF EXISTS realtime CASCADE;`);
        
        // Drop the extension if it exists
        if (extensionExists) {
          await pool.query(`DROP EXTENSION IF EXISTS supabase_realtime;`);
        }
        
        // Commit the transaction
        await pool.query('COMMIT');
        
        // Get updated status
        const updatedStatus = {
          realtimeEnabled: false,
          realtimeSchemaExists: false,
          messagesTableExists: false,
          rlsEnabled: false,
          extensionExists: false
        };
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                message: "Successfully disabled Realtime.",
                status: updatedStatus
              }, null, 2)
            }
          ]
        };
      } catch (error) {
        // Rollback the transaction in case of error
        await pool.query('ROLLBACK');
        throw error;
      }
    }

    // If enabling Realtime
    if (action === "enable") {
      // Start a transaction
      await pool.query('BEGIN');

      try {
        // Try to create the extension if it doesn't exist
        let extensionCreated = false;
        if (!extensionExists) {
          try {
            await pool.query(`CREATE EXTENSION IF NOT EXISTS supabase_realtime;`);
            extensionCreated = true;
          } catch (extError: any) {
            // If extension creation fails, log it but continue with the rest of the setup
            console.error(`Warning: Could not create supabase_realtime extension: ${extError.message}`);
            // The extension is not critical for basic functionality
          }
        }
        
        // Create the realtime schema if it doesn't exist
        if (!realtimeExists) {
          await pool.query(`CREATE SCHEMA IF NOT EXISTS realtime;`);
        }
        
        // Check the structure of existing messages table if it exists
        let existingColumns: string[] = [];
        if (messagesTableExists) {
          const columnsResult = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_schema = 'realtime' AND table_name = 'messages'
          `);
          existingColumns = columnsResult.rows.map(row => row.column_name.toLowerCase());
        }
        
        // Create the messages table if it doesn't exist
        if (!messagesTableExists) {
          // Check if we can use the standard schema or need a fallback
          try {
            await pool.query(`
              CREATE TABLE IF NOT EXISTS realtime.messages (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                channel_id TEXT NOT NULL,
                message JSONB NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
              );
            `);
          } catch (tableError: any) {
            // If the standard schema fails, try a more basic version
            await pool.query(`
              CREATE TABLE IF NOT EXISTS realtime.messages (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                channel TEXT NOT NULL,
                message JSONB NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
              );
            `);
          }
        }
        
        // Enable or disable RLS on the messages table
        if (enableRLS) {
          await pool.query(`ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;`);
        } else {
          await pool.query(`ALTER TABLE realtime.messages DISABLE ROW LEVEL SECURITY;`);
        }
        
        // Create default policies if RLS is enabled
        if (enableRLS) {
          // Check if policies exist
          const policiesCheckResult = await pool.query(`
            SELECT COUNT(*) as policy_count
            FROM pg_policy p
            JOIN pg_class c ON p.polrelid = c.oid
            JOIN pg_namespace n ON c.relnamespace = n.oid
            WHERE n.nspname = 'realtime' AND c.relname = 'messages';
          `);
          
          const policyCount = parseInt(policiesCheckResult.rows[0].policy_count);
          
          // Create default policies if none exist
          if (policyCount === 0) {
            // Policy for authenticated users to read messages
            await pool.query(`
              CREATE POLICY "Allow authenticated users to read messages" ON realtime.messages
                FOR SELECT
                TO authenticated
                USING (true);
            `);
            
            // Policy for authenticated users to insert messages
            await pool.query(`
              CREATE POLICY "Allow authenticated users to insert messages" ON realtime.messages
                FOR INSERT
                TO authenticated
                WITH CHECK (true);
            `);
          }
        }
        
        // Create channels view if it doesn't exist
        const channelsViewCheckResult = await pool.query(`
          SELECT EXISTS (
            SELECT 1 
            FROM pg_views 
            WHERE schemaname = 'realtime' AND viewname = 'channels'
          ) as view_exists;
        `);
        
        if (!channelsViewCheckResult.rows[0].view_exists) {
          // Check the structure of the messages table to create an appropriate view
          const columnsResult = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_schema = 'realtime' AND table_name = 'messages'
          `);
          const columns = columnsResult.rows.map(row => row.column_name.toLowerCase());
          
          // Determine the appropriate view definition based on table structure
          let viewDefinition = "";
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
          } else if (hasMessage) {
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
          
          await pool.query(`CREATE OR REPLACE VIEW realtime.channels AS ${viewDefinition};`);
        }
        
        // Commit the transaction
        await pool.query('COMMIT');
        
        // Get updated status
        const updatedSchemaCheckResult = await pool.query(`
          SELECT EXISTS (
            SELECT 1 
            FROM pg_namespace 
            WHERE nspname = 'realtime'
          ) as schema_exists;
        `);
        
        const updatedTableCheckResult = await pool.query(`
          SELECT EXISTS (
            SELECT 1 
            FROM pg_tables 
            WHERE schemaname = 'realtime' AND tablename = 'messages'
          ) as table_exists;
        `);
        
        const updatedRlsCheckResult = await pool.query(`
          SELECT relrowsecurity 
          FROM pg_class c
          JOIN pg_namespace n ON c.relnamespace = n.oid
          WHERE n.nspname = 'realtime' AND c.relname = 'messages';
        `);
        
        const updatedExtensionCheckResult = await pool.query(`
          SELECT EXISTS (
            SELECT 1 
            FROM pg_extension 
            WHERE extname = 'supabase_realtime'
          ) as extension_exists;
        `);
        
        const updatedStatus = {
          realtimeEnabled: updatedSchemaCheckResult.rows[0].schema_exists && updatedTableCheckResult.rows[0].table_exists,
          realtimeSchemaExists: updatedSchemaCheckResult.rows[0].schema_exists,
          messagesTableExists: updatedTableCheckResult.rows[0].table_exists,
          rlsEnabled: updatedRlsCheckResult.rows[0]?.relrowsecurity || false,
          extensionExists: updatedExtensionCheckResult.rows[0].extension_exists,
          features: {
            broadcast: enableBroadcast,
            presence: enablePresence,
            rls: enableRLS
          }
        };
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                message: "Successfully enabled Realtime.",
                status: updatedStatus
              }, null, 2)
            }
          ]
        };
      } catch (error) {
        // Rollback the transaction in case of error
        await pool.query('ROLLBACK');
        throw error;
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ 
            error: `Invalid action: ${action}. Must be one of: enable, disable, status.` 
          }, null, 2)
        }
      ]
    };
  } catch (error) {
    console.error("Error managing Realtime status:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Failed to manage Realtime status: ${errorMessage}` }, null, 2)
        }
      ]
    };
  }
}; 