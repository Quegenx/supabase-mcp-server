import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for list-roles tool
export const listRolesSchema = {
  roleName: z.string().optional().describe("Role name pattern to filter by (supports SQL LIKE pattern)"),
  includeSystemRoles: z.boolean().default(false).describe("Include system roles in the results"),
  includeAttributes: z.boolean().default(true).describe("Include detailed role attributes"),
  includeMemberships: z.boolean().default(true).describe("Include role memberships information"),
  limit: z.number().default(50).describe("Maximum number of roles to return"),
  offset: z.number().default(0).describe("Offset for pagination")
};

// Handler for list-roles tool
export const listRolesHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      roleName,
      includeSystemRoles = false,
      includeAttributes = true,
      includeMemberships = true,
      limit = 5,
      offset = 0
    } = params as {
      roleName?: string;
      includeSystemRoles?: boolean;
      includeAttributes?: boolean;
      includeMemberships?: boolean;
      limit?: number;
      offset?: number;
    };

    // Build the query to list roles
    let query = `
      SELECT 
        r.rolname AS role_name,
        r.rolsuper AS is_superuser,
        r.rolinherit AS inherits_privileges,
        r.rolcreaterole AS can_create_roles,
        r.rolcreatedb AS can_create_db,
        r.rolcanlogin AS can_login,
        r.rolreplication AS is_replication_role,
        r.rolbypassrls AS can_bypass_rls,
        r.rolconnlimit AS connection_limit,
        r.rolvaliduntil AS valid_until,
        ARRAY(
          SELECT b.rolname 
          FROM pg_catalog.pg_auth_members m 
          JOIN pg_catalog.pg_roles b ON (m.roleid = b.oid) 
          WHERE m.member = r.oid
        ) AS member_of,
        ARRAY(
          SELECT b.rolname 
          FROM pg_catalog.pg_auth_members m 
          JOIN pg_catalog.pg_roles b ON (m.member = b.oid) 
          WHERE m.roleid = r.oid
        ) AS members,
        r.oid
      FROM pg_catalog.pg_roles r
      WHERE true
    `;

    const queryParams = [];
    let paramIndex = 1;

    // Add role name filter if provided
    if (roleName) {
      query += ` AND r.rolname LIKE $${paramIndex}`;
      queryParams.push(roleName);
      paramIndex++;
    }

    // Exclude system roles if specified
    if (!includeSystemRoles) {
      query += ` AND r.oid > 16384`; // OIDs below this are typically system roles
    }

    // Add count query to get total number of roles
    const countQuery = `SELECT COUNT(*) FROM (${query}) AS count_query`;
    const countResult = await pool.query(countQuery, queryParams);
    const totalCount = parseInt(countResult.rows[0].count);

    // Add ordering, limit and offset
    query += ` ORDER BY r.rolname LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    queryParams.push(limit);
    queryParams.push(offset);

    // Execute the query
    const result = await pool.query(query, queryParams);

    // Process the results
    const roles = await Promise.all(result.rows.map(async row => {
      const roleInfo: any = {
        name: row.role_name
      };

      if (includeAttributes) {
        roleInfo.attributes = {
          is_superuser: row.is_superuser,
          inherits_privileges: row.inherits_privileges,
          can_create_roles: row.can_create_roles,
          can_create_db: row.can_create_db,
          can_login: row.can_login,
          is_replication_role: row.is_replication_role,
          can_bypass_rls: row.can_bypass_rls,
          connection_limit: row.connection_limit,
          valid_until: row.valid_until ? new Date(row.valid_until).toISOString() : null
        };
      }

      if (includeMemberships) {
        roleInfo.member_of = row.member_of;
        roleInfo.members = row.members;
      }

      // Get role config if attributes are included
      if (includeAttributes) {
        const configQuery = `
          SELECT unnest(setconfig) AS config
          FROM pg_db_role_setting
          WHERE setrole = $1 AND setdatabase = 0
        `;
        const configResult = await pool.query(configQuery, [row.oid]);
        
        if (configResult.rows.length > 0) {
          roleInfo.attributes.config = configResult.rows.map(r => r.config);
        }
      }

      return roleInfo;
    }));

    // Return with pagination info
    const response = {
      roles,
      pagination: {
        total: totalCount,
        limit,
        offset,
        hasMore: offset + roles.length < totalCount
      }
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  } catch (error) {
    console.error("Error listing roles:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Failed to list roles: ${errorMessage}` }, null, 2)
        }
      ]
    };
  }
}; 