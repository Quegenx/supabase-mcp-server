import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for delete-role tool
export const deleteRoleSchema = {
  name: z.string().describe("Role name to delete"),
  ifExists: z.boolean().default(true).describe("Whether to ignore if the role doesn't exist"),
  cascade: z.boolean().default(false).describe("Whether to automatically drop objects owned by the role and revoke privileges")
};

// Handler for delete-role tool
export const deleteRoleHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      name,
      ifExists = true,
      cascade = false
    } = params as {
      name: string;
      ifExists?: boolean;
      cascade?: boolean;
    };

    // Check if the role exists before deletion (if ifExists is false)
    if (!ifExists) {
      const checkQuery = `SELECT 1 FROM pg_roles WHERE rolname = $1`;
      const checkResult = await pool.query(checkQuery, [name]);
      
      if (checkResult.rows.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: `Role ${name} does not exist` }, null, 2)
            }
          ]
        };
      }
    }

    // Get role info before deletion for the response
    const roleInfoQuery = `
      SELECT 
        r.rolname AS role_name,
        r.rolsuper AS is_superuser,
        r.rolinherit AS inherits_privileges,
        r.rolcreaterole AS can_create_roles,
        r.rolcreatedb AS can_create_db,
        r.rolcanlogin AS can_login,
        r.rolreplication AS is_replication_role,
        r.rolbypassrls AS can_bypass_rls,
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
        ) AS members
      FROM pg_catalog.pg_roles r
      WHERE r.rolname = $1
    `;
    
    const roleInfoResult = await pool.query(roleInfoQuery, [name]);
    
    // Check for dependencies if cascade is false
    if (!cascade) {
      // Check for owned objects
      const ownedObjectsQuery = `
        SELECT 
          c.relname AS name,
          n.nspname AS schema,
          CASE c.relkind
            WHEN 'r' THEN 'table'
            WHEN 'v' THEN 'view'
            WHEN 'm' THEN 'materialized view'
            WHEN 'i' THEN 'index'
            WHEN 'S' THEN 'sequence'
            WHEN 'f' THEN 'foreign table'
            ELSE c.relkind::text
          END AS type
        FROM pg_class c
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE c.relowner = (SELECT oid FROM pg_roles WHERE rolname = $1)
        LIMIT 5
      `;
      
      const ownedObjectsResult = await pool.query(ownedObjectsQuery, [name]);
      
      if (ownedObjectsResult.rows.length > 0) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ 
                error: `Role ${name} owns database objects. Use cascade=true to automatically drop these objects or reassign ownership first.`,
                owned_objects_sample: ownedObjectsResult.rows,
                total_owned_objects: ownedObjectsResult.rows.length >= 5 ? '5+ (showing first 5)' : ownedObjectsResult.rows.length
              }, null, 2)
            }
          ]
        };
      }
      
      // Check for role memberships
      if (roleInfoResult.rows.length > 0 && roleInfoResult.rows[0].members.length > 0) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ 
                error: `Role ${name} has members. Use cascade=true to automatically remove these memberships or remove them manually first.`,
                members: roleInfoResult.rows[0].members
              }, null, 2)
            }
          ]
        };
      }
    }

    // If cascade is true, we need to handle dependencies
    if (cascade) {
      // Reassign owned objects to the current user
      const reassignQuery = `REASSIGN OWNED BY ${name} TO CURRENT_USER;`;
      await pool.query(reassignQuery);
      
      // Drop owned objects
      const dropOwnedQuery = `DROP OWNED BY ${name};`;
      await pool.query(dropOwnedQuery);
    }

    // Build the DROP ROLE statement
    const dropRoleSQL = `DROP ROLE ${ifExists ? 'IF EXISTS' : ''} ${name};`;

    // Execute the DROP ROLE statement
    await pool.query(dropRoleSQL);

    // Prepare the response
    const roleInfo = roleInfoResult.rows.length > 0 
      ? {
          name: roleInfoResult.rows[0].role_name,
          attributes: {
            is_superuser: roleInfoResult.rows[0].is_superuser,
            inherits_privileges: roleInfoResult.rows[0].inherits_privileges,
            can_create_roles: roleInfoResult.rows[0].can_create_roles,
            can_create_db: roleInfoResult.rows[0].can_create_db,
            can_login: roleInfoResult.rows[0].can_login,
            is_replication_role: roleInfoResult.rows[0].is_replication_role,
            can_bypass_rls: roleInfoResult.rows[0].can_bypass_rls
          },
          member_of: roleInfoResult.rows[0].member_of,
          members: roleInfoResult.rows[0].members
        }
      : {
          name
        };

    const response = {
      message: `Role ${name} has been successfully deleted`,
      role: roleInfo,
      cascade_applied: cascade
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
    console.error("Error deleting role:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Failed to delete role: ${errorMessage}` }, null, 2)
        }
      ]
    };
  }
}; 