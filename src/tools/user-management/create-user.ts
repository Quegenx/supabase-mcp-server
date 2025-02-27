import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for create-user tool
export const createUserSchema = {
  email: z.string().email().optional().describe("User's email address"),
  phone: z.string().optional().describe("User's phone number"),
  password: z.string().optional().describe("User's password"),
  display_name: z.string().optional().describe("User's display name"),
  user_metadata: z.record(z.any()).optional().describe("Additional user metadata"),
  email_confirm: z.boolean().optional().default(false).describe("Whether to automatically confirm the user's email"),
  phone_confirm: z.boolean().optional().default(false).describe("Whether to automatically confirm the user's phone"),
  invite: z.boolean().optional().default(false).describe("Whether to send an invitation email")
};

// Handler for create-user tool
export const createUserHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      email,
      phone,
      password,
      display_name,
      user_metadata = {},
      email_confirm = false,
      phone_confirm = false,
      invite = false
    } = params as {
      email?: string;
      phone?: string;
      password?: string;
      display_name?: string;
      user_metadata?: Record<string, any>;
      email_confirm?: boolean;
      phone_confirm?: boolean;
      invite?: boolean;
    };

    // Validate input - either email or phone must be provided
    if (!email && !phone) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ 
              error: "Either email or phone must be provided" 
            }, null, 2)
          }
        ]
      };
    }

    // Check if user already exists
    let existingUserQuery = 'SELECT id FROM auth.users WHERE ';
    const queryParams = [];
    
    if (email) {
      existingUserQuery += 'email = $1';
      queryParams.push(email);
    } else {
      existingUserQuery += 'phone = $1';
      queryParams.push(phone);
    }
    
    const existingUser = await pool.query(existingUserQuery, queryParams);
    
    if (existingUser.rows.length > 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ 
              error: `User with this ${email ? 'email' : 'phone'} already exists` 
            }, null, 2)
          }
        ]
      };
    }

    // Start a transaction
    await pool.query('BEGIN');
    
    try {
      // Prepare metadata
      const appMetadata: Record<string, any> = {};
      if (display_name) {
        appMetadata.display_name = display_name;
      }
      
      // Generate UUID for the user
      const userIdResult = await pool.query('SELECT gen_random_uuid() as id');
      const userId = userIdResult.rows[0].id;
      
      // Current timestamp
      const now = new Date().toISOString();
      
      // Insert the user
      const insertUserQuery = `
        INSERT INTO auth.users (
          id,
          email,
          phone,
          encrypted_password,
          email_confirmed_at,
          phone_confirmed_at,
          raw_app_meta_data,
          raw_user_meta_data,
          created_at,
          updated_at,
          confirmation_sent_at,
          is_sso_user
        ) VALUES (
          $1, $2, $3, 
          ${password ? 'crypt($4, gen_salt(\'bf\'))' : 'NULL'},
          ${email_confirm ? '$5' : 'NULL'},
          ${phone_confirm ? '$6' : 'NULL'},
          $7,
          $8,
          $9,
          $9,
          ${invite ? '$10' : 'NULL'},
          false
        )
        RETURNING *
      `;
      
      const insertParams = [
        userId,
        email || null,
        phone || null
      ];
      
      if (password) {
        insertParams.push(password);
      }
      
      insertParams.push(
        email_confirm ? now : null,
        phone_confirm ? now : null,
        JSON.stringify(appMetadata),
        JSON.stringify(user_metadata),
        now,
        invite ? now : null
      );
      
      const insertResult = await pool.query(insertUserQuery, insertParams);
      
      if (insertResult.rows.length === 0) {
        throw new Error('Failed to insert user');
      }
      
      const createdUser = insertResult.rows[0];
      
      // If using email auth, create an identity record
      if (email) {
        await pool.query(`
          INSERT INTO auth.identities (
            id,
            user_id,
            identity_data,
            provider,
            created_at,
            updated_at
          ) VALUES (
            $1,
            $1,
            $2,
            'email',
            $3,
            $3
          )
        `, [
          userId,
          JSON.stringify({ sub: userId, email }),
          now
        ]);
      }
      
      // Commit the transaction
      await pool.query('COMMIT');
      
      // Format the response
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              message: "User created successfully",
              user: {
                id: createdUser.id,
                email: createdUser.email,
                phone: createdUser.phone,
                display_name: appMetadata.display_name,
                created_at: createdUser.created_at,
                updated_at: createdUser.updated_at,
                email_confirmed_at: createdUser.email_confirmed_at,
                phone_confirmed_at: createdUser.phone_confirmed_at,
                last_sign_in_at: createdUser.last_sign_in_at,
                invited_at: invite ? now : null
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
    console.error("Error creating user:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Failed to create user: ${errorMessage}` }, null, 2)
        }
      ]
    };
  }
}; 