import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import pkg from "pg";
import * as dotenv from 'dotenv';
import { allTools } from "./tools/index.js";
import { ToolHandlerParams } from "./types.js";

// Load environment variables (as fallback)
dotenv.config();

const { Pool } = pkg;

// Prioritize command line argument over environment variable
const connectionString = process.argv[2] || process.env.DATABASE_URL;

if (!connectionString) {
  console.error("No database connection string provided. Please provide it as a command line argument or set DATABASE_URL in .env file.");
  process.exit(1);
}

console.error("Starting server with connection:", connectionString);

// Create PostgreSQL pool with SSL required
const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

// Create an MCP server instance with explicit capabilities.
const server = new McpServer(
  { name: "postgres-tools", version: "1.0.0" },
  {
    capabilities: {
      resources: {
        templates: [
          // Database structure resources
          "postgres://tables",
          "postgres://columns",
          "postgres://indexes",
          "postgres://constraints",
          "postgres://functions",
          "postgres://triggers",
          "postgres://policies",
          "postgres://roles",
          "postgres://enums",
          "postgres://publications",
          "postgres://storage",
          "postgres://realtime",
          "postgres://users",
          "postgres://advisor"
        ]
      },
      tools: {
        // Include only the core tools directly
        query: {},
        list_tables: {}
      }
    }
  }
);

// ----------------- Core Resource and Tools -----------------

// --------- Database Structure Resources ---------

// Resource to list all tables
server.resource(
  "tables",
  "postgres://tables",
  async (uri) => {
    try {
      const query = `
        SELECT 
          table_schema,
          table_name,
          (
            SELECT json_agg(column_name::text)
            FROM information_schema.columns c
            WHERE c.table_schema = t.table_schema
              AND c.table_name = t.table_name
          ) as columns
        FROM information_schema.tables t
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY table_schema, table_name;
      `;
      const result = await pool.query(query);
      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify(result.rows, null, 2)
        }]
      };
    } catch (error) {
      console.error("Error fetching tables:", error);
      throw new Error(`Failed to fetch tables: ${error}`);
    }
  }
);

// Resource to list all columns
server.resource(
  "columns",
  "postgres://columns",
  async (uri) => {
    try {
      const query = `
        SELECT 
          table_schema,
          table_name,
          column_name,
          data_type,
          is_nullable,
          column_default,
          character_maximum_length,
          numeric_precision,
          numeric_scale
        FROM information_schema.columns
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY table_schema, table_name, ordinal_position;
      `;
      const result = await pool.query(query);
      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify(result.rows, null, 2)
        }]
      };
    } catch (error) {
      console.error("Error fetching columns:", error);
      throw new Error(`Failed to fetch columns: ${error}`);
    }
  }
);

// Resource to list all indexes
server.resource(
  "indexes",
  "postgres://indexes",
  async (uri) => {
    try {
      const query = `
        SELECT
          ns.nspname AS schema_name,
          idx.indrelid::regclass AS table_name,
          i.relname AS index_name,
          idx.indisunique AS is_unique,
          idx.indisprimary AS is_primary,
          am.amname AS index_type,
          array_to_string(array_agg(a.attname), ', ') AS column_names
        FROM
          pg_index idx
          JOIN pg_class i ON i.oid = idx.indexrelid
          JOIN pg_am am ON i.relam = am.oid
          JOIN pg_namespace ns ON ns.oid = i.relnamespace
          JOIN pg_attribute a ON a.attrelid = idx.indrelid AND a.attnum = ANY(idx.indkey)
        WHERE
          ns.nspname NOT IN ('pg_catalog', 'information_schema')
        GROUP BY
          schema_name, table_name, index_name, is_unique, is_primary, index_type
        ORDER BY
          schema_name, table_name, index_name;
      `;
      const result = await pool.query(query);
      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify(result.rows, null, 2)
        }]
      };
    } catch (error) {
      console.error("Error fetching indexes:", error);
      throw new Error(`Failed to fetch indexes: ${error}`);
    }
  }
);

// Resource to list all constraints
server.resource(
  "constraints",
  "postgres://constraints",
  async (uri) => {
    try {
      const query = `
        SELECT
          ns.nspname AS schema_name,
          rel.relname AS table_name,
          con.conname AS constraint_name,
          CASE
            WHEN con.contype = 'c' THEN 'CHECK'
            WHEN con.contype = 'f' THEN 'FOREIGN KEY'
            WHEN con.contype = 'p' THEN 'PRIMARY KEY'
            WHEN con.contype = 'u' THEN 'UNIQUE'
            WHEN con.contype = 't' THEN 'TRIGGER'
            WHEN con.contype = 'x' THEN 'EXCLUSION'
            ELSE 'UNKNOWN'
          END AS constraint_type,
          CASE
            WHEN con.contype = 'f' THEN
              (SELECT nspname FROM pg_namespace WHERE oid = ref_rel.relnamespace) || '.' || ref_rel.relname
            ELSE NULL
          END AS referenced_table,
          pg_get_constraintdef(con.oid) AS definition
        FROM
          pg_constraint con
          JOIN pg_class rel ON rel.oid = con.conrelid
          JOIN pg_namespace ns ON ns.oid = rel.relnamespace
          LEFT JOIN pg_class ref_rel ON ref_rel.oid = con.confrelid
        WHERE
          ns.nspname NOT IN ('pg_catalog', 'information_schema')
        ORDER BY
          schema_name, table_name, constraint_name;
      `;
      const result = await pool.query(query);
      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify(result.rows, null, 2)
        }]
      };
    } catch (error) {
      console.error("Error fetching constraints:", error);
      throw new Error(`Failed to fetch constraints: ${error}`);
    }
  }
);

// Resource to list all functions
server.resource(
  "functions",
  "postgres://functions",
  async (uri) => {
    try {
      const query = `
        SELECT
          n.nspname AS schema_name,
          p.proname AS function_name,
          pg_get_function_arguments(p.oid) AS arguments,
          CASE
            WHEN p.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype THEN 'trigger'
            ELSE pg_get_function_result(p.oid)
          END AS return_type,
          p.prosrc AS function_body,
          l.lanname AS language
        FROM
          pg_proc p
          LEFT JOIN pg_namespace n ON n.oid = p.pronamespace
          LEFT JOIN pg_language l ON l.oid = p.prolang
        WHERE
          n.nspname NOT IN ('pg_catalog', 'information_schema')
        ORDER BY
          schema_name, function_name;
      `;
      const result = await pool.query(query);
      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify(result.rows, null, 2)
        }]
      };
    } catch (error) {
      console.error("Error fetching functions:", error);
      throw new Error(`Failed to fetch functions: ${error}`);
    }
  }
);

// Resource to list all triggers
server.resource(
  "triggers",
  "postgres://triggers",
  async (uri) => {
    try {
      const query = `
        SELECT
          n.nspname AS schema_name,
          c.relname AS table_name,
          t.tgname AS trigger_name,
          pg_get_triggerdef(t.oid) AS trigger_definition,
          CASE
            WHEN t.tgenabled = 'O' THEN 'ENABLED'
            WHEN t.tgenabled = 'D' THEN 'DISABLED'
            WHEN t.tgenabled = 'R' THEN 'REPLICA'
            WHEN t.tgenabled = 'A' THEN 'ALWAYS'
            ELSE 'UNKNOWN'
          END AS status
        FROM
          pg_trigger t
          JOIN pg_class c ON t.tgrelid = c.oid
          JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE
          n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND NOT t.tgisinternal
        ORDER BY
          schema_name, table_name, trigger_name;
      `;
      const result = await pool.query(query);
      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify(result.rows, null, 2)
        }]
      };
    } catch (error) {
      console.error("Error fetching triggers:", error);
      throw new Error(`Failed to fetch triggers: ${error}`);
    }
  }
);

// Resource to list all policies
server.resource(
  "policies",
  "postgres://policies",
  async (uri) => {
    try {
      const query = `
        SELECT
          n.nspname AS schema_name,
          c.relname AS table_name,
          p.polname AS policy_name,
          p.polcmd AS command,
          p.polpermissive AS permissive,
          pg_get_expr(p.polqual, p.polrelid) AS using_expression,
          pg_get_expr(p.polwithcheck, p.polrelid) AS with_check_expression,
          ARRAY(
            SELECT rolname
            FROM pg_roles
            WHERE oid = ANY(p.polroles)
          ) AS roles
        FROM
          pg_policy p
          JOIN pg_class c ON p.polrelid = c.oid
          JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE
          n.nspname NOT IN ('pg_catalog', 'information_schema')
        ORDER BY
          schema_name, table_name, policy_name;
      `;
      const result = await pool.query(query);
      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify(result.rows, null, 2)
        }]
      };
    } catch (error) {
      console.error("Error fetching policies:", error);
      throw new Error(`Failed to fetch policies: ${error}`);
    }
  }
);

// Resource to list all roles
server.resource(
  "roles",
  "postgres://roles",
  async (uri) => {
    try {
      const query = `
        SELECT
          r.rolname AS role_name,
          r.rolsuper AS is_superuser,
          r.rolinherit AS inherits,
          r.rolcreaterole AS can_create_roles,
          r.rolcreatedb AS can_create_db,
          r.rolcanlogin AS can_login,
          r.rolreplication AS is_replication,
          r.rolbypassrls AS bypass_rls,
          r.rolconnlimit AS connection_limit,
          r.rolvaliduntil AS valid_until,
          ARRAY(
            SELECT b.rolname
            FROM pg_auth_members m
            JOIN pg_roles b ON m.roleid = b.oid
            WHERE m.member = r.oid
          ) AS member_of
        FROM
          pg_roles r
        WHERE
          r.rolname NOT LIKE 'pg_%'
        ORDER BY
          role_name;
      `;
      const result = await pool.query(query);
      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify(result.rows, null, 2)
        }]
      };
    } catch (error) {
      console.error("Error fetching roles:", error);
      throw new Error(`Failed to fetch roles: ${error}`);
    }
  }
);

// Resource to list all enums
server.resource(
  "enums",
  "postgres://enums",
  async (uri) => {
    try {
      const query = `
        SELECT
          n.nspname AS schema_name,
          t.typname AS enum_name,
          array_agg(e.enumlabel ORDER BY e.enumsortorder) AS enum_values
        FROM
          pg_type t
          JOIN pg_enum e ON t.oid = e.enumtypid
          JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE
          n.nspname NOT IN ('pg_catalog', 'information_schema')
        GROUP BY
          schema_name, enum_name
        ORDER BY
          schema_name, enum_name;
      `;
      const result = await pool.query(query);
      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify(result.rows, null, 2)
        }]
      };
    } catch (error) {
      console.error("Error fetching enums:", error);
      throw new Error(`Failed to fetch enums: ${error}`);
    }
  }
);

// Resource to list all publications
server.resource(
  "publications",
  "postgres://publications",
  async (uri) => {
    try {
      const query = `
        SELECT
          p.pubname AS publication_name,
          p.pubowner::regrole AS owner,
          p.pubinsert AS insert,
          p.pubupdate AS update,
          p.pubdelete AS delete,
          p.pubtruncate AS truncate,
          array_agg(DISTINCT schemaname || '.' || tablename) AS tables
        FROM
          pg_publication p
          LEFT JOIN pg_publication_tables pt ON p.pubname = pt.pubname
        GROUP BY
          p.pubname, p.pubowner, p.pubinsert, p.pubupdate, p.pubdelete, p.pubtruncate
        ORDER BY
          publication_name;
      `;
      const result = await pool.query(query);
      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify(result.rows, null, 2)
        }]
      };
    } catch (error) {
      console.error("Error fetching publications:", error);
      throw new Error(`Failed to fetch publications: ${error}`);
    }
  }
);

// Resource to list storage information
server.resource(
  "storage",
  "postgres://storage",
  async (uri) => {
    try {
      const query = `
        SELECT
          nspname AS schema_name,
          relname AS table_name,
          pg_size_pretty(pg_total_relation_size(C.oid)) AS total_size,
          pg_size_pretty(pg_relation_size(C.oid)) AS table_size,
          pg_size_pretty(pg_total_relation_size(C.oid) - pg_relation_size(C.oid)) AS index_size,
          pg_stat_get_numscans(C.oid) AS sequential_scans,
          pg_stat_get_tuples_inserted(C.oid) AS rows_inserted,
          pg_stat_get_tuples_updated(C.oid) AS rows_updated,
          pg_stat_get_tuples_deleted(C.oid) AS rows_deleted,
          pg_stat_get_live_tuples(C.oid) AS live_rows,
          pg_stat_get_dead_tuples(C.oid) AS dead_rows
        FROM
          pg_class C
          LEFT JOIN pg_namespace N ON (N.oid = C.relnamespace)
        WHERE
          nspname NOT IN ('pg_catalog', 'information_schema')
          AND C.relkind = 'r'
        ORDER BY
          pg_total_relation_size(C.oid) DESC;
      `;
      const result = await pool.query(query);
      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify(result.rows, null, 2)
        }]
      };
    } catch (error) {
      console.error("Error fetching storage information:", error);
      throw new Error(`Failed to fetch storage information: ${error}`);
    }
  }
);

// Resource to list realtime configuration
server.resource(
  "realtime",
  "postgres://realtime",
  async (uri) => {
    try {
      const query = `
        WITH realtime_tables AS (
          SELECT
            n.nspname AS schema_name,
            c.relname AS table_name,
            EXISTS (
              SELECT 1 FROM pg_trigger t
              WHERE t.tgrelid = c.oid
              AND t.tgname LIKE 'supabase_realtime%'
            ) AS has_realtime_triggers,
            EXISTS (
              SELECT 1 FROM pg_publication_tables pt
              WHERE pt.schemaname = n.nspname
              AND pt.tablename = c.relname
              AND pt.pubname LIKE 'supabase_realtime%'
            ) AS in_realtime_publication
          FROM
            pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE
            c.relkind = 'r'
            AND n.nspname NOT IN ('pg_catalog', 'information_schema')
        )
        SELECT
          schema_name,
          table_name,
          has_realtime_triggers,
          in_realtime_publication,
          (has_realtime_triggers AND in_realtime_publication) AS realtime_enabled
        FROM
          realtime_tables
        ORDER BY
          schema_name, table_name;
      `;
      const result = await pool.query(query);
      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify(result.rows, null, 2)
        }]
      };
    } catch (error) {
      console.error("Error fetching realtime configuration:", error);
      throw new Error(`Failed to fetch realtime configuration: ${error}`);
    }
  }
);

// Resource to list database users
server.resource(
  "users",
  "postgres://users",
  async (uri) => {
    try {
      const query = `
        SELECT
          r.rolname AS username,
          r.rolsuper AS is_superuser,
          r.rolcreatedb AS can_create_db,
          r.rolcanlogin AS can_login,
          r.rolvaliduntil AS valid_until,
          r.rolconnlimit AS connection_limit,
          array_agg(DISTINCT g.rolname) FILTER (WHERE g.rolname IS NOT NULL) AS member_of,
          array_agg(DISTINCT d.datname) FILTER (WHERE d.datname IS NOT NULL) AS databases
        FROM
          pg_roles r
          LEFT JOIN pg_auth_members m ON m.member = r.oid
          LEFT JOIN pg_roles g ON g.oid = m.roleid
          LEFT JOIN pg_db_role_setting rs ON rs.setrole = r.oid
          LEFT JOIN pg_database d ON d.oid = rs.setdatabase
        WHERE
          r.rolcanlogin = true
        GROUP BY
          r.rolname, r.rolsuper, r.rolcreatedb, r.rolcanlogin, r.rolvaliduntil, r.rolconnlimit
        ORDER BY
          username;
      `;
      const result = await pool.query(query);
      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify(result.rows, null, 2)
        }]
      };
    } catch (error) {
      console.error("Error fetching users:", error);
      throw new Error(`Failed to fetch users: ${error}`);
    }
  }
);

// Resource to list advisor recommendations
server.resource(
  "advisor",
  "postgres://advisor",
  async (uri) => {
    try {
      const query = `
        WITH missing_indexes AS (
          SELECT
            schemaname AS schema_name,
            relname AS table_name,
            seq_scan AS sequential_scans,
            idx_scan AS index_scans,
            seq_scan - idx_scan AS potential_improvement,
            'Consider adding an index to tables with high sequential scans' AS recommendation
          FROM
            pg_stat_user_tables
          WHERE
            seq_scan > idx_scan
            AND seq_scan > 100
          ORDER BY
            potential_improvement DESC
          LIMIT 5
        ),
        bloated_tables AS (
          SELECT
            nspname AS schema_name,
            relname AS table_name,
            pg_size_pretty(pg_total_relation_size(C.oid)) AS total_size,
            CASE
              WHEN n_dead_tup > 0 THEN round(100 * n_dead_tup / (n_live_tup + n_dead_tup), 2)
              ELSE 0
            END AS dead_tuple_percentage,
            'Consider running VACUUM on tables with high dead tuple percentage' AS recommendation
          FROM
            pg_class C
            JOIN pg_namespace N ON (N.oid = C.relnamespace)
            JOIN pg_stat_user_tables psut ON psut.relname = C.relname
          WHERE
            nspname NOT IN ('pg_catalog', 'information_schema')
            AND C.relkind = 'r'
            AND n_dead_tup > 10000
          ORDER BY
            dead_tuple_percentage DESC
          LIMIT 5
        ),
        unused_indexes AS (
          SELECT
            schemaname AS schema_name,
            relname AS table_name,
            indexrelname AS index_name,
            idx_scan AS scans,
            pg_size_pretty(pg_relation_size(i.indexrelid)) AS index_size,
            'Consider dropping unused indexes to save space and improve write performance' AS recommendation
          FROM
            pg_stat_user_indexes ui
            JOIN pg_index i ON ui.indexrelid = i.indexrelid
          WHERE
            idx_scan < 50
            AND NOT indisunique
            AND pg_relation_size(i.indexrelid) > 1024 * 1024 * 5 -- 5MB
          ORDER BY
            idx_scan, pg_relation_size(i.indexrelid) DESC
          LIMIT 5
        )
        SELECT * FROM missing_indexes
        UNION ALL
        SELECT * FROM bloated_tables
        UNION ALL
        SELECT * FROM unused_indexes;
      `;
      const result = await pool.query(query);
      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify(result.rows, null, 2)
        }]
      };
    } catch (error) {
      console.error("Error fetching advisor recommendations:", error);
      throw new Error(`Failed to fetch advisor recommendations: ${error}`);
    }
  }
);

// Register only the essential query tool directly
server.tool(
  "query",
  "Execute a SQL query",
  {
    sql: z.string().min(1).describe("SQL query to execute"),
    params: z.array(z.any()).optional().describe("Query parameters"),
    limit: z.number().optional().describe("Maximum number of rows to return (default: 100)")
  },
  async ({ sql, params = [], limit = 100 }) => {
    try {
      const result = await pool.query(sql, params);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            command: result.command,
            rowCount: result.rowCount,
            rows: result.rows.slice(0, limit || 100)
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error("Error executing query:", error);
      throw new Error(`Failed to execute query: ${error}`);
    }
  }
);

// Register list_tables tool
server.tool(
  "list_tables",
  "List all tables or get details about a specific table",
  {
    schema: z.string().optional().describe("Optional schema name to filter by"),
    table: z.string().optional().describe("Optional table name to filter by"),
    includeColumns: z.boolean().optional().default(true).describe("Include column information"),
    includeSize: z.boolean().optional().default(false).describe("Include table size information")
  },
  async ({ schema, table, includeColumns = true, includeSize = false }) => {
    try {
      let query = `
        SELECT 
          table_schema,
          table_name
      `;
      
      if (includeColumns) {
        query += `,
          (
            SELECT json_agg(json_build_object(
              'name', column_name,
              'type', data_type,
              'nullable', is_nullable
            ))
            FROM information_schema.columns c
            WHERE c.table_schema = t.table_schema
              AND c.table_name = t.table_name
          ) as columns
        `;
      }
      
      if (includeSize) {
        query += `,
          pg_size_pretty(pg_total_relation_size(
            (table_schema || '.' || table_name)::regclass
          )) as total_size
        `;
      }
      
      query += `
        FROM information_schema.tables t
        WHERE table_type = 'BASE TABLE'
          AND table_schema NOT IN ('pg_catalog', 'information_schema')
      `;
      
      if (schema) {
        query += ` AND table_schema = $1`;
      }
      
      if (table) {
        query += ` AND table_name ${schema ? '= $2' : '= $1'}`;
      }
      
      query += ` ORDER BY table_schema, table_name`;
      
      const params = [];
      if (schema) params.push(schema);
      if (table) params.push(table);
      
      const result = await pool.query(query, params);
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify(result.rows, null, 2)
        }]
      };
    } catch (error) {
      console.error("Error listing tables:", error);
      throw new Error(`Failed to list tables: ${error}`);
    }
  }
);

// Register all tools from allTools
allTools.forEach(tool => {
  server.tool(
    tool.name,
    tool.description,
    tool.schema,
    async (args: Record<string, unknown>, extra: any) => {
      try {
        const result = await tool.handler({ pool, params: args });
        // Transform the content to match the expected MCP format
        return {
          content: result.content.map(item => {
            if (item.type === 'text') {
              return {
                type: "text" as const,
                text: item.text
              };
            } else if (item.type === 'image' && 'data' in item && 'mimeType' in item) {
              return {
                type: "image" as const,
                data: String((item as any).data),
                mimeType: String((item as any).mimeType)
              };
            } else if (item.type === 'resource' && 'uri' in item) {
              return {
                type: "resource" as const,
                resource: {
                  uri: String((item as any).uri),
                  text: item.text,
                  mimeType: (item as any).mimeType ? String((item as any).mimeType) : undefined
                }
              };
            }
            // Default fallback
            return {
              type: "text" as const,
              text: item.text || JSON.stringify(item)
            };
          })
        };
      } catch (error) {
        console.error(`Error executing tool ${tool.name}:`, error);
        throw new Error(`Failed to execute tool ${tool.name}: ${error}`);
      }
    }
  );
});

// ----------------- Start the Server -----------------

async function main() {
  try {
    const client = await pool.connect();
    console.error("Successfully connected to PostgreSQL");
    client.release();
  } catch (error) {
    console.error("Failed to connect to PostgreSQL:", error);
    process.exit(1);
  }
  const transport = new StdioServerTransport();
  try {
    await server.connect(transport);
    console.error("PostgreSQL MCP Server running on stdio");
    process.stdin.resume();
  } catch (error) {
    console.error("Failed to start server:", error);
    await cleanup();
  }
}

async function cleanup() {
  try {
    await pool.end();
    console.error("PostgreSQL connection pool closed");
  } catch (error) {
    console.error("Error closing PostgreSQL connection pool:", error);
  }
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  cleanup();
});

main().catch((error) => {
  console.error("Fatal error:", error);
  cleanup();
});
