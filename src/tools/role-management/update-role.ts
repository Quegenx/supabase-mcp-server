import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for update-role tool
export const updateRoleSchema = {
  name: z.string().describe("Role name to update"),
  newName: z.string().optional().describe("New role name (if renaming)"),
  login: z.boolean().optional().describe("Whether the role can login"),
  superuser: z.boolean().optional().describe("Whether the role is a superuser"),
  createDb: z.boolean().optional().describe("Whether the role can create databases"),
  createRole: z.boolean().optional().describe("Whether the role can create other roles"),
  inherit: z.boolean().optional().describe("Whether the role inherits privileges"),
  replication: z.boolean().optional().describe("Whether the role is a replication role"),
  bypassRls: z.boolean().optional().describe("Whether the role can bypass row-level security"),
  connectionLimit: z.number().optional().describe("Connection limit for the role"),
  password: z.string().optional().describe("New password for the role"),
  encrypted: z.boolean().default(true).describe("Whether the password is encrypted"),
  validUntil: z.string().optional().describe("Date and time after which the role's password is no longer valid"),
  addRoles: z.array(z.string()).optional().describe("Role(s) to add this role as a member of"),
  removeRoles: z.array(z.string()).optional().describe("Role(s) to remove this role from"),
  addMembers: z.array(z.string()).optional().describe("Role(s) to add as members of this role"),
  removeMembers: z.array(z.string()).optional().describe("Role(s) to remove as members of this role"),
  addAdminOption: z.array(z.string()).optional().describe("Grant admin option to this role for specified role(s)"),
  removeAdminOption: z.array(z.string()).optional().describe("Revoke admin option from this role for specified role(s)")
};

// Handler for update-role tool
export const updateRoleHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      name,
      newName,
      login,
      superuser,
      createDb,
      createRole,
      inherit,
      replication,
      bypassRls,
      connectionLimit,
      password,
      encrypted = true,
      validUntil,
      addRoles,
      removeRoles,
      addMembers,
      removeMembers,
      addAdminOption,
      removeAdminOption
    } = params as {
      name: string;
      newName?: string;
      login?: boolean;
      superuser?: boolean;
      createDb?: boolean;
      createRole?: boolean;
      inherit?: boolean;
      replication?: boolean;
      bypassRls?: boolean;
      connectionLimit?: number;
      password?: string;
      encrypted?: boolean;
      validUntil?: string;
      addRoles?: string[];
      removeRoles?: string[];
      addMembers?: string[];
      removeMembers?: string[];
      addAdminOption?: string[];
      removeAdminOption?: string[];
    };

    // Check if the role exists
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

    // Track operations performed
    const operations: {
      renamed?: boolean;
      attributes_updated?: boolean;
      password_updated?: boolean;
      roles_added?: string[];
      roles_removed?: string[];
      members_added?: string[];
      members_removed?: string[];
      admin_option_added?: string[];
      admin_option_removed?: string[];
    } = {};

    // Handle rename operation
    if (newName && newName !== name) {
      const renameSQL = `ALTER ROLE ${name} RENAME TO ${newName};`;
      await pool.query(renameSQL);
      operations.renamed = true;
    }

    // Build the ALTER ROLE statement for attributes
    const attributeUpdates = [];
    
    if (login !== undefined) {
      attributeUpdates.push(login ? 'LOGIN' : 'NOLOGIN');
    }
    
    if (superuser !== undefined) {
      attributeUpdates.push(superuser ? 'SUPERUSER' : 'NOSUPERUSER');
    }
    
    if (createDb !== undefined) {
      attributeUpdates.push(createDb ? 'CREATEDB' : 'NOCREATEDB');
    }
    
    if (createRole !== undefined) {
      attributeUpdates.push(createRole ? 'CREATEROLE' : 'NOCREATEROLE');
    }
    
    if (inherit !== undefined) {
      attributeUpdates.push(inherit ? 'INHERIT' : 'NOINHERIT');
    }
    
    if (replication !== undefined) {
      attributeUpdates.push(replication ? 'REPLICATION' : 'NOREPLICATION');
    }
    
    if (bypassRls !== undefined) {
      attributeUpdates.push(bypassRls ? 'BYPASSRLS' : 'NOBYPASSRLS');
    }
    
    if (connectionLimit !== undefined) {
      attributeUpdates.push(`CONNECTION LIMIT ${connectionLimit}`);
    }
    
    if (validUntil !== undefined) {
      attributeUpdates.push(`VALID UNTIL '${validUntil}'`);
    }
    
    // Execute attribute updates if any
    if (attributeUpdates.length > 0) {
      const alterRoleSQL = `ALTER ROLE ${newName || name} ${attributeUpdates.join(' ')};`;
      await pool.query(alterRoleSQL);
      operations.attributes_updated = true;
    }
    
    // Handle password update separately
    if (password !== undefined) {
      const passwordSQL = encrypted 
        ? `ALTER ROLE ${newName || name} PASSWORD '${password}';`
        : `ALTER ROLE ${newName || name} PASSWORD '${password}' UNENCRYPTED;`;
      await pool.query(passwordSQL);
      operations.password_updated = true;
    }
    
    // Handle role membership changes
    
    // Add role memberships
    if (addRoles && addRoles.length > 0) {
      operations.roles_added = [];
      for (const role of addRoles) {
        const grantSQL = `GRANT ${role} TO ${newName || name};`;
        await pool.query(grantSQL);
        operations.roles_added.push(role);
      }
    }
    
    // Remove role memberships
    if (removeRoles && removeRoles.length > 0) {
      operations.roles_removed = [];
      for (const role of removeRoles) {
        const revokeSQL = `REVOKE ${role} FROM ${newName || name};`;
        await pool.query(revokeSQL);
        operations.roles_removed.push(role);
      }
    }
    
    // Add members to this role
    if (addMembers && addMembers.length > 0) {
      operations.members_added = [];
      for (const member of addMembers) {
        const grantSQL = `GRANT ${newName || name} TO ${member};`;
        await pool.query(grantSQL);
        operations.members_added.push(member);
      }
    }
    
    // Remove members from this role
    if (removeMembers && removeMembers.length > 0) {
      operations.members_removed = [];
      for (const member of removeMembers) {
        const revokeSQL = `REVOKE ${newName || name} FROM ${member};`;
        await pool.query(revokeSQL);
        operations.members_removed.push(member);
      }
    }
    
    // Add admin option
    if (addAdminOption && addAdminOption.length > 0) {
      operations.admin_option_added = [];
      for (const role of addAdminOption) {
        const grantSQL = `GRANT ${role} TO ${newName || name} WITH ADMIN OPTION;`;
        await pool.query(grantSQL);
        operations.admin_option_added.push(role);
      }
    }
    
    // Remove admin option
    if (removeAdminOption && removeAdminOption.length > 0) {
      operations.admin_option_removed = [];
      for (const role of removeAdminOption) {
        // First revoke with admin option, then grant without it
        const revokeSQL = `REVOKE ADMIN OPTION FOR ${role} FROM ${newName || name};`;
        await pool.query(revokeSQL);
        operations.admin_option_removed.push(role);
      }
    }

    // Fetch the updated role to return its details
    const roleQuery = `
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
        ) AS members
      FROM pg_catalog.pg_roles r
      WHERE r.rolname = $1
    `;

    const result = await pool.query(roleQuery, [newName || name]);

    if (result.rows.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "Role was updated but could not be retrieved" }, null, 2)
          }
        ]
      };
    }

    const row = result.rows[0];
    const roleInfo: {
      name: string;
      attributes: {
        is_superuser: boolean;
        inherits_privileges: boolean;
        can_create_roles: boolean;
        can_create_db: boolean;
        can_login: boolean;
        is_replication_role: boolean;
        can_bypass_rls: boolean;
        connection_limit: number;
        valid_until: string | null;
      };
      member_of: string[];
      members: string[];
    } = {
      name: row.role_name,
      attributes: {
        is_superuser: row.is_superuser,
        inherits_privileges: row.inherits_privileges,
        can_create_roles: row.can_create_roles,
        can_create_db: row.can_create_db,
        can_login: row.can_login,
        is_replication_role: row.is_replication_role,
        can_bypass_rls: row.can_bypass_rls,
        connection_limit: row.connection_limit,
        valid_until: row.valid_until ? new Date(row.valid_until).toISOString() : null
      },
      member_of: row.member_of,
      members: row.members
    };

    const response = {
      message: `Role ${name} has been successfully updated`,
      role: roleInfo,
      operations
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
    console.error("Error updating role:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Failed to update role: ${errorMessage}` }, null, 2)
        }
      ]
    };
  }
}; 