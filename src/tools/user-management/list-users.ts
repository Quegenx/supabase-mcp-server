import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for list-users tool
export const listUsersSchema = {
  search: z.string().optional().describe("Search by email, phone, or UID"),
  provider: z.string().optional().describe("Filter by auth provider (e.g., 'google', 'github', 'email')"),
  sortBy: z.enum(["created_at", "last_sign_in_at", "email", "phone"]).optional().default("created_at").describe("Field to sort by"),
  sortOrder: z.enum(["asc", "desc"]).optional().default("desc").describe("Sort order"),
  limit: z.number().optional().default(50).describe("Maximum number of users to return"),
  offset: z.number().optional().default(0).describe("Number of users to skip")
};

// Define user interface
interface AuthUser {
  id: string;
  email?: string;
  phone?: string;
  display_name?: string;
  providers?: string[];
  provider_type?: string;
  created_at: string;
  last_sign_in_at?: string;
  updated_at?: string;
  invited_at?: string;
  confirmation_sent_at?: string;
  confirmed_at?: string;
  is_sso_user?: boolean;
}

// Handler for list-users tool
export const listUsersHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      search = "",
      provider = "",
      sortBy = "created_at",
      sortOrder = "desc",
      limit = 5,
      offset = 0
    } = params as {
      search?: string;
      provider?: string;
      sortBy?: string;
      sortOrder?: string;
      limit?: number;
      offset?: number;
    };

    // Build the query to fetch users from auth.users table
    let query = `
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
        u.confirmed_at,
        u.is_sso_user
      FROM auth.users u
      LEFT JOIN auth.identities i ON u.id = i.user_id
    `;

    // Add search condition if provided
    const queryParams: any[] = [];
    let paramIndex = 1;
    let whereConditions = [];

    if (search && search.trim() !== "") {
      whereConditions.push(`(
        u.email ILIKE $${paramIndex} OR 
        u.phone ILIKE $${paramIndex} OR 
        u.id::text ILIKE $${paramIndex}
      )`);
      queryParams.push(`%${search}%`);
      paramIndex++;
    }

    // Add provider filter if provided
    if (provider && provider.trim() !== "") {
      whereConditions.push(`i.provider = $${paramIndex}`);
      queryParams.push(provider);
      paramIndex++;
    }

    // Add WHERE clause if we have conditions
    if (whereConditions.length > 0) {
      query += ` WHERE ${whereConditions.join(" AND ")}`;
    }

    // Add GROUP BY clause
    query += ` GROUP BY u.id`;

    // Add ORDER BY clause
    const validSortFields = {
      "created_at": "u.created_at",
      "last_sign_in_at": "u.last_sign_in_at",
      "email": "u.email",
      "phone": "u.phone"
    };

    const sortField = validSortFields[sortBy as keyof typeof validSortFields] || "u.created_at";
    const order = sortOrder === "asc" ? "ASC" : "DESC";
    query += ` ORDER BY ${sortField} ${order}`;

    // Add pagination
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    queryParams.push(limit, offset);

    // Execute the query
    const result = await pool.query(query, queryParams);

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(DISTINCT u.id) as total
      FROM auth.users u
      LEFT JOIN auth.identities i ON u.id = i.user_id
    `;

    if (whereConditions.length > 0) {
      countQuery += ` WHERE ${whereConditions.join(" AND ")}`;
    }

    const countResult = await pool.query(countQuery, queryParams.slice(0, paramIndex - 1));
    const totalCount = parseInt(countResult.rows[0].total);

    // Format the response
    const users: AuthUser[] = result.rows.map(row => ({
      id: row.id,
      email: row.email,
      phone: row.phone,
      display_name: row.display_name,
      providers: row.providers || [],
      provider_type: row.provider_type,
      created_at: row.created_at,
      last_sign_in_at: row.last_sign_in_at,
      updated_at: row.updated_at,
      invited_at: row.invited_at,
      confirmation_sent_at: row.confirmation_sent_at,
      confirmed_at: row.confirmed_at,
      is_sso_user: row.is_sso_user
    }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            users,
            pagination: {
              total: totalCount,
              limit,
              offset,
              hasMore: offset + users.length < totalCount
            }
          }, null, 2)
        }
      ]
    };
  } catch (error) {
    console.error("Error listing users:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Failed to list users: ${errorMessage}` }, null, 2)
        }
      ]
    };
  }
}; 