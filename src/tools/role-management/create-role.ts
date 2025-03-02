import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for create-role tool
export const createRoleSchema = {
  name: z.string().describe("Role name"),
  login: z.boolean().optional().describe("Whether the role can login"),
  superuser: z.boolean().optional().describe("Whether the role is a superuser"),
  createDb: z.boolean().optional().describe("Whether the role can create databases"),
  createRole: z.boolean().optional().describe("Whether the role can create other roles"),
  inherit: z.boolean().optional().describe("Whether the role inherits privileges"),
  replication: z.boolean().optional().describe("Whether the role is a replication role"),
  bypassRls: z.boolean().optional().describe("Whether the role can bypass row-level security"),
  connectionLimit: z.number().optional().describe("Connection limit for the role"),
  password: z.string().optional().describe("Password for the role"),
  encrypted: z.boolean().default(true).describe("Whether the password is encrypted"),
  validUntil: z.string().optional().describe("Date and time after which the role's password is no longer valid"),
  inRole: z.array(z.string()).optional().describe("Role(s) that this role will be a member of"),
  role: z.array(z.string()).optional().describe("Role(s) that will be members of this role"),
  admin: z.array(z.string()).optional().describe("Role(s) that will be members of this role with admin option")
};

// Handler for create-role tool
export const createRoleHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      name,
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
      inRole,
      role,
      admin
    } = params as {
      name: string;
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
      inRole?: string[];
      role?: string[];
      admin?: string[];
    };

    // Check if the role already exists
    const checkQuery = `SELECT 1 FROM pg_roles WHERE rolname = $1`;
    const checkResult = await pool.query(checkQuery, [name]);
    
    if (checkResult.rows.length > 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: `Role ${name} already exists` }, null, 2)
          }
        ]
      };
    }

    // Build the CREATE ROLE statement
    let createRoleSQL = `CREATE ROLE ${name}`;
    
    // Add login option
    if (login !== undefined) {
      createRoleSQL += login ? ' LOGIN' : ' NOLOGIN';
    }
    
    // Add superuser option
    if (superuser !== undefined) {
      createRoleSQL += superuser ? ' SUPERUSER' : ' NOSUPERUSER';
    }
    
    // Add createdb option
    if (createDb !== undefined) {
      createRoleSQL += createDb ? ' CREATEDB' : ' NOCREATEDB';
    }
    
    // Add createrole option
    if (createRole !== undefined) {
      createRoleSQL += createRole ? ' CREATEROLE' : ' NOCREATEROLE';
    }
    
    // Add inherit option
    if (inherit !== undefined) {
      createRoleSQL += inherit ? ' INHERIT' : ' NOINHERIT';
    }
    
    // Add replication option
    if (replication !== undefined) {
      createRoleSQL += replication ? ' REPLICATION' : ' NOREPLICATION';
    }
    
    // Add bypassrls option
    if (bypassRls !== undefined) {
      createRoleSQL += bypassRls ? ' BYPASSRLS' : ' NOBYPASSRLS';
    }
    
    // Add connection limit
    if (connectionLimit !== undefined) {
      createRoleSQL += ` CONNECTION LIMIT ${connectionLimit}`;
    }
    
    // Add password
    if (password !== undefined) {
      if (encrypted) {
        createRoleSQL += ` PASSWORD '${password}'`;
      } else {
        createRoleSQL += ` PASSWORD '${password}' UNENCRYPTED`;
      }
    }
    
    // Add valid until
    if (validUntil !== undefined) {
      createRoleSQL += ` VALID UNTIL '${validUntil}'`;
    }
    
    // Add in role
    if (inRole && inRole.length > 0) {
      createRoleSQL += ` IN ROLE ${inRole.join(', ')}`;
    }
    
    // Add role
    if (role && role.length > 0) {
      createRoleSQL += ` ROLE ${role.join(', ')}`;
    }
    
    // Add admin
    if (admin && admin.length > 0) {
      createRoleSQL += ` ADMIN ${admin.join(', ')}`;
    }
    
    createRoleSQL += `;`;

    // Execute the CREATE ROLE statement
    await pool.query(createRoleSQL);

    // Fetch the created role to return its details
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

    const result = await pool.query(roleQuery, [name]);

    if (result.rows.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "Role was created but could not be retrieved" }, null, 2)
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

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(roleInfo, null, 2)
        }
      ]
    };
  } catch (error) {
    console.error("Error creating role:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Failed to create role: ${errorMessage}` }, null, 2)
        }
      ]
    };
  }
}; 