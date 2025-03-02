import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for delete-user tool
export const deleteUserSchema = {
  id: z.string().describe("User ID (UUID)"),
  soft_delete: z.boolean().optional().default(true).describe("Whether to soft delete the user (keeping records) or hard delete")
};

// Handler for delete-user tool
export const deleteUserHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      id,
      soft_delete = true
    } = params as {
      id: string;
      soft_delete?: boolean;
    };

    // Check if user exists and get details before deletion
    const checkQuery = `
      SELECT 
        u.id,
        u.email,
        u.phone,
        u.raw_app_meta_data->>'display_name' as display_name,
        string_to_array(string_agg(DISTINCT i.provider, ',') FILTER (WHERE i.provider IS NOT NULL), ',') as providers,
        COALESCE(
          (array_agg(DISTINCT i.provider) FILTER (WHERE i.provider IS NOT NULL))[1],
          'email'
        ) as provider_type,
        u.created_at,
        u.last_sign_in_at,
        u.updated_at,
        u.invited_at,
        u.confirmation_sent_at,
        u.email_confirmed_at as confirmed_at,
        u.is_sso_user
      FROM auth.users u
      LEFT JOIN auth.identities i ON u.id = i.user_id
      WHERE u.id = $1
      GROUP BY u.id
    `;
    
    const checkResult = await pool.query(checkQuery, [id]);
    
    if (checkResult.rows.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: `User with ID '${id}' not found` }, null, 2)
          }
        ]
      };
    }

    const user = checkResult.rows[0];

    // Start a transaction
    await pool.query('BEGIN');
    
    try {
      // Delete user's sessions
      await pool.query(`
        DELETE FROM auth.sessions
        WHERE user_id = $1
      `, [id]);
      
      // Delete user's refresh tokens
      await pool.query(`
        DELETE FROM auth.refresh_tokens
        WHERE user_id = $1
      `, [id]);
      
      if (soft_delete) {
        // Soft delete - anonymize user data but keep the record
        const anonymizedEmail = `deleted_${id}@deleted.user`;
        const anonymizedPhone = null;
        
        await pool.query(`
          UPDATE auth.users
          SET 
            email = $2,
            phone = $3,
            raw_user_meta_data = '{"deleted": true}'::jsonb,
            raw_app_meta_data = '{"deleted": true}'::jsonb,
            encrypted_password = NULL,
            email_confirmed_at = NULL,
            phone_confirmed_at = NULL,
            confirmation_token = NULL,
            recovery_token = NULL,
            reauthentication_token = NULL,
            is_anonymous = true,
            updated_at = now()
          WHERE id = $1
        `, [id, anonymizedEmail, anonymizedPhone]);
        
        // Delete identities (OAuth connections)
        await pool.query(`
          DELETE FROM auth.identities
          WHERE user_id = $1
        `, [id]);
      } else {
        // Hard delete - completely remove the user
        await pool.query(`
          DELETE FROM auth.identities
          WHERE user_id = $1
        `, [id]);
        
        await pool.query(`
          DELETE FROM auth.users
          WHERE id = $1
        `, [id]);
      }
      
      // Commit the transaction
      await pool.query('COMMIT');
      
      // Format the response
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              message: `User ${soft_delete ? 'soft' : 'hard'} deleted successfully`,
              deleted_user: {
                id: user.id,
                email: user.email,
                phone: user.phone,
                display_name: user.display_name,
                providers: user.providers || [],
                provider_type: user.provider_type,
                created_at: user.created_at,
                last_sign_in_at: user.last_sign_in_at,
                updated_at: user.updated_at,
                invited_at: user.invited_at,
                confirmation_sent_at: user.confirmation_sent_at,
                confirmed_at: user.confirmed_at,
                is_sso_user: user.is_sso_user
              }
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      // Rollback the transaction in case of error
      await pool.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error("Error deleting user:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Failed to delete user: ${errorMessage}` }, null, 2)
        }
      ]
    };
  }
}; 