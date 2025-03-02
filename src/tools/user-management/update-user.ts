import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for update-user tool
export const updateUserSchema = {
  id: z.string().describe("User ID (UUID)"),
  email: z.string().email().optional().describe("New email address"),
  phone: z.string().optional().describe("New phone number"),
  password: z.string().optional().describe("New password"),
  display_name: z.string().optional().describe("New display name"),
  user_metadata: z.record(z.any()).optional().describe("Additional user metadata to update"),
  email_confirm: z.boolean().optional().describe("Whether to confirm the user's email"),
  phone_confirm: z.boolean().optional().describe("Whether to confirm the user's phone"),
  ban: z.boolean().optional().describe("Whether to ban the user"),
  unban: z.boolean().optional().describe("Whether to unban the user")
};

// Handler for update-user tool
export const updateUserHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      id,
      email,
      phone,
      password,
      display_name,
      user_metadata,
      email_confirm,
      phone_confirm,
      ban,
      unban
    } = params as {
      id: string;
      email?: string;
      phone?: string;
      password?: string;
      display_name?: string;
      user_metadata?: Record<string, any>;
      email_confirm?: boolean;
      phone_confirm?: boolean;
      ban?: boolean;
      unban?: boolean;
    };

    // Check if user exists
    const checkQuery = `
      SELECT id, email, phone, raw_app_meta_data, raw_user_meta_data, banned_until
      FROM auth.users
      WHERE id = $1
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
    const updates: Record<string, any> = {};
    
    // Prepare updates
    if (email !== undefined) {
      updates.email = email;
    }
    
    if (phone !== undefined) {
      updates.phone = phone;
    }
    
    if (password !== undefined) {
      updates.password = password;
    }
    
    // Handle metadata updates
    const currentAppMetadata = user.raw_app_meta_data || {};
    const currentUserMetadata = user.raw_user_meta_data || {};
    
    const updatedAppMetadata = { ...currentAppMetadata };
    const updatedUserMetadata = { ...currentUserMetadata };
    
    // Update display name in app metadata
    if (display_name !== undefined) {
      updatedAppMetadata.display_name = display_name;
    }
    
    // Merge user metadata if provided
    if (user_metadata) {
      Object.assign(updatedUserMetadata, user_metadata);
    }
    
    // Add metadata to updates if changed
    if (JSON.stringify(updatedAppMetadata) !== JSON.stringify(currentAppMetadata)) {
      updates.app_metadata = updatedAppMetadata;
    }
    
    if (JSON.stringify(updatedUserMetadata) !== JSON.stringify(currentUserMetadata)) {
      updates.user_metadata = updatedUserMetadata;
    }
    
    // Handle email confirmation
    if (email_confirm === true) {
      updates.email_confirm = true;
    }
    
    // Handle phone confirmation
    if (phone_confirm === true) {
      updates.phone_confirm = true;
    }
    
    // Handle banning/unbanning
    if (ban === true) {
      // Ban until 2099 (effectively permanent)
      const banUntil = new Date('2099-12-31T23:59:59Z').toISOString();
      
      // Update in database directly
      await pool.query(`
        UPDATE auth.users
        SET banned_until = $1
        WHERE id = $2
      `, [banUntil, id]);
    } else if (unban === true) {
      // Remove ban
      await pool.query(`
        UPDATE auth.users
        SET banned_until = NULL
        WHERE id = $1
      `, [id]);
    }
    
    // If we have updates to apply via Supabase API
    if (Object.keys(updates).length > 0) {
      // Apply updates via SQL since we don't have direct access to Supabase Admin API
      const updateQueries = [];
      const queryParams = [id];
      let paramIndex = 2;
      
      if (updates.email !== undefined) {
        updateQueries.push(`email = $${paramIndex}`);
        queryParams.push(updates.email);
        paramIndex++;
      }
      
      if (updates.phone !== undefined) {
        updateQueries.push(`phone = $${paramIndex}`);
        queryParams.push(updates.phone);
        paramIndex++;
      }
      
      if (updates.password !== undefined) {
        // For password, we need to hash it properly
        // This is a simplified approach - in a real implementation, 
        // you would use the Supabase Admin API or proper password hashing
        updateQueries.push(`encrypted_password = crypt($${paramIndex}, gen_salt('bf'))`);
        queryParams.push(updates.password);
        paramIndex++;
      }
      
      if (updates.app_metadata !== undefined) {
        updateQueries.push(`raw_app_meta_data = $${paramIndex}::jsonb`);
        queryParams.push(JSON.stringify(updates.app_metadata));
        paramIndex++;
      }
      
      if (updates.user_metadata !== undefined) {
        updateQueries.push(`raw_user_meta_data = $${paramIndex}::jsonb`);
        queryParams.push(JSON.stringify(updates.user_metadata));
        paramIndex++;
      }
      
      if (updates.email_confirm === true) {
        updateQueries.push(`email_confirmed_at = COALESCE(email_confirmed_at, now())`);
      }
      
      if (updates.phone_confirm === true) {
        updateQueries.push(`phone_confirmed_at = COALESCE(phone_confirmed_at, now())`);
      }
      
      if (updateQueries.length > 0) {
        const updateQuery = `
          UPDATE auth.users
          SET ${updateQueries.join(', ')}, updated_at = now()
          WHERE id = $1
          RETURNING *
        `;
        
        await pool.query(updateQuery, queryParams);
      }
    }
    
    // Get the updated user
    const updatedUserQuery = `
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
        u.is_sso_user,
        u.banned_until
      FROM auth.users u
      LEFT JOIN auth.identities i ON u.id = i.user_id
      WHERE u.id = $1
      GROUP BY u.id
    `;
    
    const updatedUserResult = await pool.query(updatedUserQuery, [id]);
    
    if (updatedUserResult.rows.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "Failed to retrieve updated user details" }, null, 2)
          }
        ]
      };
    }
    
    const updatedUser = updatedUserResult.rows[0];
    
    // Format the response
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            message: "User updated successfully",
            user: {
              id: updatedUser.id,
              email: updatedUser.email,
              phone: updatedUser.phone,
              display_name: updatedUser.display_name,
              providers: updatedUser.providers || [],
              provider_type: updatedUser.provider_type,
              created_at: updatedUser.created_at,
              last_sign_in_at: updatedUser.last_sign_in_at,
              updated_at: updatedUser.updated_at,
              invited_at: updatedUser.invited_at,
              confirmation_sent_at: updatedUser.confirmation_sent_at,
              confirmed_at: updatedUser.confirmed_at,
              is_sso_user: updatedUser.is_sso_user,
              banned: updatedUser.banned_until !== null
            }
          }, null, 2)
        }
      ]
    };
  } catch (error) {
    console.error("Error updating user:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Failed to update user: ${errorMessage}` }, null, 2)
        }
      ]
    };
  }
}; 