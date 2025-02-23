import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import pkg from "pg";
import * as dotenv from 'dotenv';

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
// The original capabilities are preserved and we add additional ones.
const server = new McpServer(
  { name: "postgres-tools", version: "1.0.0" },
  {
    capabilities: {
      resources: {
        templates: ["postgres://tables"]
      },
      tools: {
        // (The base capabilities are defined via your server.tool calls below)
      }
    }
  }
);

// ----------------- Original Endpoints -----------------

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

// Tool to execute SQL query
server.tool(
  "query",
  "Execute a SQL query",
  {
    sql: z.string().min(1).describe("SQL query to execute"),
    params: z.array(z.any()).optional().describe("Query parameters")
  },
  async ({ sql, params = [] }) => {
    try {
      const result = await pool.query(sql, params);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            command: result.command,
            rowCount: result.rowCount,
            rows: result.rows
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error("Error executing query:", error);
      throw new Error(`Failed to execute query: ${error}`);
    }
  }
);

// Tool to create a new table
server.tool(
  "create-table",
  "Create a new table",
  {
    schema: z.string().default("public").describe("Schema name"),
    table: z.string().describe("Table name"),
    columns: z.array(
      z.object({
        name: z.string(),
        type: z.string(),
        constraints: z.array(z.string()).optional()
      })
    ).describe("Column definitions")
  },
  async ({ schema, table, columns }) => {
    try {
      const columnDefs = columns
        .map(col => {
          const constraints = col.constraints?.join(" ") || "";
          return `"${col.name}" ${col.type} ${constraints}`.trim();
        })
        .join(", ");
      const query = `CREATE TABLE "${schema}"."${table}" (${columnDefs});`;
      await pool.query(query);
      return {
        content: [{
          type: "text",
          text: `Successfully created table ${schema}.${table}`
        }]
      };
    } catch (error) {
      console.error("Error creating table:", error);
      throw new Error(`Failed to create table: ${error}`);
    }
  }
);

// Tool to drop a table
server.tool(
  "drop-table",
  "Remove a table",
  {
    schema: z.string().default("public").describe("Schema name"),
    table: z.string().describe("Table name"),
    cascade: z.boolean().default(false).describe("Drop dependent objects too")
  },
  async ({ schema, table, cascade }) => {
    try {
      const query = `DROP TABLE "${schema}"."${table}"${cascade ? " CASCADE" : ""};`;
      await pool.query(query);
      return {
        content: [{
          type: "text",
          text: `Successfully dropped table ${schema}.${table}`
        }]
      };
    } catch (error) {
      console.error("Error dropping table:", error);
      throw new Error(`Failed to drop table: ${error}`);
    }
  }
);

// Tool to rename a table
server.tool(
  "rename-table",
  "Rename a table",
  {
    schema: z.string().default("public").describe("Schema name"),
    table: z.string().describe("Current table name"),
    newName: z.string().describe("New table name")
  },
  async ({ schema, table, newName }) => {
    try {
      const query = `ALTER TABLE "${schema}"."${table}" RENAME TO "${newName}";`;
      await pool.query(query);
      return {
        content: [{
          type: "text",
          text: `Successfully renamed table ${schema}.${table} to ${schema}.${newName}`
        }]
      };
    } catch (error) {
      console.error("Error renaming table:", error);
      throw new Error(`Failed to rename table: ${error}`);
    }
  }
);

// Tool to add a column
server.tool(
  "add-column",
  "Add a new column to a table",
  {
    schema: z.string().default("public").describe("Schema name"),
    table: z.string().describe("Table name"),
    name: z.string().describe("Column name"),
    type: z.string().describe("Column type"),
    constraints: z.array(z.string()).optional().describe("Column constraints")
  },
  async ({ schema, table, name, type, constraints }) => {
    try {
      const constraintStr = constraints ? ` ${constraints.join(" ")}` : "";
      const query = `ALTER TABLE "${schema}"."${table}" ADD COLUMN "${name}" ${type}${constraintStr};`;
      await pool.query(query);
      return {
        content: [{
          type: "text",
          text: `Successfully added column ${name} to ${schema}.${table}`
        }]
      };
    } catch (error) {
      console.error("Error adding column:", error);
      throw new Error(`Failed to add column: ${error}`);
    }
  }
);

// Tool to drop a column
server.tool(
  "drop-column",
  "Remove a column from a table",
  {
    schema: z.string().default("public").describe("Schema name"),
    table: z.string().describe("Table name"),
    column: z.string().describe("Column name"),
    cascade: z.boolean().default(false).describe("Drop dependent objects too")
  },
  async ({ schema, table, column, cascade }) => {
    try {
      const query = `ALTER TABLE "${schema}"."${table}" DROP COLUMN "${column}"${cascade ? " CASCADE" : ""};`;
      await pool.query(query);
      return {
        content: [{
          type: "text",
          text: `Successfully dropped column ${column} from ${schema}.${table}`
        }]
      };
    } catch (error) {
      console.error("Error dropping column:", error);
      throw new Error(`Failed to drop column: ${error}`);
    }
  }
);

// Tool to alter a column
server.tool(
  "alter-column",
  "Modify a column's definition",
  {
    schema: z.string().default("public").describe("Schema name"),
    table: z.string().describe("Table name"),
    column: z.string().describe("Column name"),
    type: z.string().optional().describe("New data type"),
    newName: z.string().optional().describe("New column name"),
    setDefault: z.string().optional().describe("Set default value"),
    dropDefault: z.boolean().optional().describe("Drop default value"),
    setNotNull: z.boolean().optional().describe("Set NOT NULL constraint"),
    dropNotNull: z.boolean().optional().describe("Drop NOT NULL constraint")
  },
  async ({ schema, table, column, type, newName, setDefault, dropDefault, setNotNull, dropNotNull }) => {
    try {
      const alterations = [];
      if (type) alterations.push(`ALTER COLUMN "${column}" TYPE ${type}`);
      if (newName) alterations.push(`RENAME COLUMN "${column}" TO "${newName}"`);
      if (setDefault) alterations.push(`ALTER COLUMN "${column}" SET DEFAULT ${setDefault}`);
      if (dropDefault) alterations.push(`ALTER COLUMN "${column}" DROP DEFAULT`);
      if (setNotNull) alterations.push(`ALTER COLUMN "${column}" SET NOT NULL`);
      if (dropNotNull) alterations.push(`ALTER COLUMN "${column}" DROP NOT NULL`);
      if (alterations.length === 0) throw new Error("No alterations specified");
      const query = `ALTER TABLE "${schema}"."${table}" ${alterations.join(", ")};`;
      await pool.query(query);
      return {
        content: [{
          type: "text",
          text: `Successfully modified column ${column} in ${schema}.${table}`
        }]
      };
    } catch (error) {
      console.error("Error altering column:", error);
      throw new Error(`Failed to alter column: ${error}`);
    }
  }
);

// Tool to describe a specific table
server.tool(
  "view-tables",
  "Get detailed information about a table",
  {
    schema: z.string().default("public").describe("Schema name"),
    table: z.string().describe("Table name")
  },
  async ({ schema, table }) => {
    try {
      const query = `
        SELECT 
          column_name,
          data_type,
          character_maximum_length,
          column_default,
          is_nullable
        FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name = $2
        ORDER BY ordinal_position;
      `;
      const result = await pool.query(query, [schema, table]);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(result.rows, null, 2)
        }]
      };
    } catch (error) {
      console.error("Error describing table:", error);
      throw new Error(`Failed to describe table: ${error}`);
    }
  }
);

// Tool to view table columns with detailed information
server.tool(
  "view-columns",
  "View detailed column information for a table",
  {
    schema: z.string().default("public").describe("Schema name"),
    table: z.string().describe("Table name")
  },
  async ({ schema, table }) => {
    try {
      const columnQuery = `
        SELECT 
          c.column_name,
          c.data_type,
          c.character_maximum_length,
          c.numeric_precision,
          c.numeric_scale,
          c.is_nullable,
          c.column_default,
          c.is_identity,
          (
            SELECT json_agg(DISTINCT pc.contype) 
            FROM pg_constraint pc 
            JOIN pg_class rel ON rel.oid = pc.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(pc.conkey)
            WHERE nsp.nspname = c.table_schema
              AND rel.relname = c.table_name
              AND att.attname = c.column_name
          ) as constraints,
          (
            SELECT json_agg(json_build_object(
              'foreign_schema', nsp.nspname,
              'foreign_table', rel2.relname,
              'foreign_column', att2.attname
            ))
            FROM pg_constraint pc 
            JOIN pg_class rel ON rel.oid = pc.conrelid
            JOIN pg_class rel2 ON rel2.oid = pc.confrelid
            JOIN pg_namespace nsp ON nsp.oid = rel2.relnamespace
            JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(pc.conkey)
            JOIN pg_attribute att2 ON att2.attrelid = rel2.oid AND att2.attnum = ANY(pc.confkey)
            WHERE pc.contype = 'f'
              AND rel.relname = c.table_name
              AND att.attname = c.column_name
          ) as foreign_keys
        FROM information_schema.columns c
        WHERE c.table_schema = $1
          AND c.table_name = $2
        ORDER BY c.ordinal_position;
      `;
      const tableQuery = `
        SELECT 
          obj_description(pc.oid, 'pg_class') as table_description,
          pc.reltuples::bigint as estimated_row_count
        FROM pg_class pc 
        JOIN pg_namespace pn ON pn.oid = pc.relnamespace
        WHERE pn.nspname = $1
          AND pc.relname = $2;
      `;
      const [columnResult, tableResult] = await Promise.all([
        pool.query(columnQuery, [schema, table]),
        pool.query(tableQuery, [schema, table])
      ]);
      const formattedColumns = columnResult.rows.map(col => {
        const constraints = col.constraints || [];
        const foreignKeys = col.foreign_keys || [];
        return {
          name: col.column_name,
          type: `${col.data_type}${col.character_maximum_length ? `(${col.character_maximum_length})` : ""}`,
          nullable: col.is_nullable === "YES",
          default: col.column_default,
          isPrimaryKey: constraints.includes("p"),
          isUnique: constraints.includes("u"),
          isForeignKey: constraints.includes("f"),
          foreignKeyRefs: foreignKeys.map((fk: { foreign_schema: string; foreign_table: string; foreign_column: string; }) =>
            `${fk.foreign_schema}.${fk.foreign_table}.${fk.foreign_column}`
          ),
          isIdentity: col.is_identity === "YES"
        };
      });
      const tableInfo = tableResult.rows[0] || {};
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            table: `${schema}.${table}`,
            description: tableInfo.table_description || "No description available",
            estimatedRows: tableInfo.estimated_row_count || 0,
            columns: formattedColumns
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error("Error viewing columns:", error);
      throw new Error(`Failed to view columns: ${error}`);
    }
  }
);

// Tool to add multiple columns
server.tool(
  "add-columns",
  "Add multiple columns to a table",
  {
    schema: z.string().default("public").describe("Schema name"),
    table: z.string().describe("Table name"),
    columns: z.array(
      z.object({
        name: z.string().describe("Column name"),
        type: z.string().describe("Column type"),
        constraints: z.array(z.string()).optional().describe("Column constraints")
      })
    ).describe("Column definitions")
  },
  async ({ schema, table, columns }) => {
    try {
      const columnDefs = columns
        .map(col => {
          const constraintStr = col.constraints ? ` ${col.constraints.join(" ")}` : "";
          return `ADD COLUMN "${col.name}" ${col.type}${constraintStr}`;
        })
        .join(", ");
      const query = `ALTER TABLE "${schema}"."${table}" ${columnDefs};`;
      await pool.query(query);
      const columnNames = columns.map(col => col.name).join(", ");
      return {
        content: [{
          type: "text",
          text: `Successfully added columns [${columnNames}] to ${schema}.${table}`
        }]
      };
    } catch (error) {
      console.error("Error adding columns:", error);
      throw new Error(`Failed to add columns: ${error}`);
    }
  }
);

// ----------------- Additional Endpoints (Stubs and Minimal Implementations) -----------------

// update-table (already implemented above)
server.tool(
  "update-table",
  "Alter an existing table",
  {
    schema: z.string().default("public").describe("Schema name"),
    table: z.string().describe("Table name"),
    operations: z.array(
      z.object({
        operation: z.enum(["ADD", "DROP", "ALTER", "RENAME"]),
        columnName: z.string(),
        newName: z.string().optional(),
        dataType: z.string().optional(),
        constraints: z.string().optional()
      })
    ).describe("List of operations")
  },
  async ({ schema, table, operations }) => {
    try {
      const ops = operations.map(op => {
        switch (op.operation) {
          case "ADD":
            return `ADD COLUMN "${op.columnName}" ${op.dataType}${op.constraints ? " " + op.constraints : ""}`;
          case "DROP":
            return `DROP COLUMN "${op.columnName}"`;
          case "ALTER":
            return `ALTER COLUMN "${op.columnName}" TYPE ${op.dataType}${op.constraints ? " " + op.constraints : ""}`;
          case "RENAME":
            return `RENAME COLUMN "${op.columnName}" TO "${op.newName}"`;
          default:
            throw new Error(`Unknown operation: ${op.operation}`);
        }
      });
      const query = `ALTER TABLE "${schema}"."${table}" ${ops.join(", ")};`;
      await pool.query(query);
      return { content: [{ type: "text", text: `Successfully updated table ${schema}.${table}` }] };
    } catch (error) {
      console.error("Error updating table:", error);
      throw new Error(`Failed to update table: ${error}`);
    }
  }
);

// fetch-records
server.tool(
  "fetch-records",
  "Retrieve rows from a table",
  {
    schema: z.string().default("public").describe("Schema name"),
    table: z.string().describe("Table name"),
    where: z.record(z.any()).optional().describe("Filtering conditions"),
    limit: z.number().optional().describe("Max rows"),
    offset: z.number().optional().describe("Offset")
  },
  async ({ schema, table, where, limit, offset }) => {
    try {
      let sql = `SELECT * FROM "${schema}"."${table}"`;
      let values: any[] = [];
      if (where && Object.keys(where).length > 0) {
        const keys = Object.keys(where);
        const clauses = keys.map((k, i) => `"${k}" = $${i + 1}`);
        sql += " WHERE " + clauses.join(" AND ");
        values = keys.map(k => where[k]);
      }
      if (limit) sql += ` LIMIT ${limit}`;
      if (offset) sql += ` OFFSET ${offset}`;
      const result = await pool.query(sql, values);
      return { content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }] };
    } catch (error) {
      console.error("Error fetching records:", error);
      throw new Error(`Failed to fetch records: ${error}`);
    }
  }
);

// create-record
server.tool(
  "create-record",
  "Insert a new record into a table",
  {
    schema: z.string().default("public").describe("Schema name"),
    table: z.string().describe("Table name"),
    record: z.record(z.any()).describe("Record data")
  },
  async ({ schema, table, record }) => {
    try {
      const keys = Object.keys(record);
      const cols = keys.map(k => `"${k}"`).join(", ");
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
      const sql = `INSERT INTO "${schema}"."${table}" (${cols}) VALUES (${placeholders});`;
      await pool.query(sql, keys.map(k => record[k]));
      return { content: [{ type: "text", text: `Successfully inserted record into ${schema}.${table}` }] };
    } catch (error) {
      console.error("Error creating record:", error);
      throw new Error(`Failed to create record: ${error}`);
    }
  }
);

// update-record
server.tool(
  "update-record",
  "Update records in a table",
  {
    schema: z.string().default("public").describe("Schema name"),
    table: z.string().describe("Table name"),
    record: z.record(z.any()).describe("New values"),
    where: z.record(z.any()).describe("Filter conditions")
  },
  async ({ schema, table, record, where }) => {
    try {
      const keys = Object.keys(record);
      const setClause = keys.map((k, i) => `"${k}" = $${i + 1}`).join(", ");
      const whereKeys = Object.keys(where);
      const whereClause = whereKeys.map((k, i) => `"${k}" = $${i + keys.length + 1}`).join(" AND ");
      const sql = `UPDATE "${schema}"."${table}" SET ${setClause} WHERE ${whereClause};`;
      const values = [...keys.map(k => record[k]), ...whereKeys.map(k => where[k])];
      await pool.query(sql, values);
      return { content: [{ type: "text", text: `Successfully updated record(s) in ${schema}.${table}` }] };
    } catch (error) {
      console.error("Error updating record:", error);
      throw new Error(`Failed to update record: ${error}`);
    }
  }
);

// delete-record
server.tool(
  "delete-record",
  "Delete records from a table",
  {
    schema: z.string().default("public").describe("Schema name"),
    table: z.string().describe("Table name"),
    where: z.record(z.any()).describe("Filter conditions")
  },
  async ({ schema, table, where }) => {
    try {
      const keys = Object.keys(where);
      const whereClause = keys.map((k, i) => `"${k}" = $${i + 1}`).join(" AND ");
      const sql = `DELETE FROM "${schema}"."${table}" WHERE ${whereClause};`;
      await pool.query(sql, keys.map(k => where[k]));
      return { content: [{ type: "text", text: `Successfully deleted record(s) from ${schema}.${table}` }] };
    } catch (error) {
      console.error("Error deleting record:", error);
      throw new Error(`Failed to delete record: ${error}`);
    }
  }
);

// create-index (stub)
server.tool(
  "create-index",
  "Create an index on a table",
  {
    schema: z.string().default("public").describe("Schema name"),
    table: z.string().describe("Table name"),
    indexName: z.string().describe("Index name"),
    columns: z.array(z.string()).describe("Columns for the index"),
    unique: z.boolean().optional().describe("Unique index flag")
  },
  async ({ schema, table, indexName, columns, unique }) => {
    try {
      const uniqueStr = unique ? "UNIQUE" : "";
      const cols = columns.map(c => `"${c}"`).join(", ");
      const sql = `CREATE ${uniqueStr} INDEX "${indexName}" ON "${schema}"."${table}" (${cols});`;
      await pool.query(sql);
      return { content: [{ type: "text", text: `Index ${indexName} created on ${schema}.${table}` }] };
    } catch (error) {
      console.error("Error creating index:", error);
      throw new Error(`Failed to create index: ${error}`);
    }
  }
);

// fetch-indexes (stub)
server.tool(
  "fetch-indexes",
  "List indexes on a table",
  {
    schema: z.string().default("public").describe("Schema name"),
    table: z.string().describe("Table name")
  },
  async ({ schema, table }) => {
    try {
      const sql = `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2;`;
      const result = await pool.query(sql, [schema, table]);
      return { content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }] };
    } catch (error) {
      console.error("Error fetching indexes:", error);
      throw new Error(`Failed to fetch indexes: ${error}`);
    }
  }
);

// delete-index (stub)
server.tool(
  "delete-index",
  "Drop an index",
  {
    indexName: z.string().describe("Index name")
  },
  async ({ indexName }) => {
    try {
      const sql = `DROP INDEX "${indexName}";`;
      await pool.query(sql);
      return { content: [{ type: "text", text: `Index ${indexName} dropped` }] };
    } catch (error) {
      console.error("Error dropping index:", error);
      throw new Error(`Failed to drop index: ${error}`);
    }
  }
);

// add-constraint (stub)
server.tool(
  "add-constraint",
  "Add a constraint to a table",
  {
    schema: z.string().default("public").describe("Schema name"),
    table: z.string().describe("Table name"),
    constraintName: z.string().describe("Constraint name"),
    definition: z.string().describe("Constraint definition")
  },
  async ({ schema, table, constraintName, definition }) => {
    try {
      const sql = `ALTER TABLE "${schema}"."${table}" ADD CONSTRAINT "${constraintName}" ${definition};`;
      await pool.query(sql);
      return { content: [{ type: "text", text: `Constraint ${constraintName} added to ${schema}.${table}` }] };
    } catch (error) {
      console.error("Error adding constraint:", error);
      throw new Error(`Failed to add constraint: ${error}`);
    }
  }
);

// remove-constraint (stub)
server.tool(
  "remove-constraint",
  "Remove a constraint from a table",
  {
    schema: z.string().default("public").describe("Schema name"),
    table: z.string().describe("Table name"),
    constraintName: z.string().describe("Constraint name")
  },
  async ({ schema, table, constraintName }) => {
    try {
      const sql = `ALTER TABLE "${schema}"."${table}" DROP CONSTRAINT "${constraintName}";`;
      await pool.query(sql);
      return { content: [{ type: "text", text: `Constraint ${constraintName} removed from ${schema}.${table}` }] };
    } catch (error) {
      console.error("Error removing constraint:", error);
      throw new Error(`Failed to remove constraint: ${error}`);
    }
  }
);

// create-view (stub)
server.tool(
  "create-view",
  "Create a new view",
  {
    schema: z.string().default("public").describe("Schema name"),
    view: z.string().describe("View name"),
    definition: z.string().describe("View definition (SQL SELECT statement)")
  },
  async ({ schema, view, definition }) => {
    try {
      const sql = `CREATE VIEW "${schema}"."${view}" AS ${definition};`;
      await pool.query(sql);
      return { content: [{ type: "text", text: `View ${schema}.${view} created successfully` }] };
    } catch (error) {
      console.error("Error creating view:", error);
      throw new Error(`Failed to create view: ${error}`);
    }
  }
);

// update-view (stub)
server.tool(
  "update-view",
  "Update an existing view",
  {
    schema: z.string().default("public").describe("Schema name"),
    view: z.string().describe("View name"),
    definition: z.string().describe("New view definition")
  },
  async ({ schema, view, definition }) => {
    try {
      const sql = `CREATE OR REPLACE VIEW "${schema}"."${view}" AS ${definition};`;
      await pool.query(sql);
      return { content: [{ type: "text", text: `View ${schema}.${view} updated successfully` }] };
    } catch (error) {
      console.error("Error updating view:", error);
      throw new Error(`Failed to update view: ${error}`);
    }
  }
);

// delete-view (stub)
server.tool(
  "delete-view",
  "Drop a view",
  {
    schema: z.string().default("public").describe("Schema name"),
    view: z.string().describe("View name")
  },
  async ({ schema, view }) => {
    try {
      const sql = `DROP VIEW "${schema}"."${view}";`;
      await pool.query(sql);
      return { content: [{ type: "text", text: `View ${schema}.${view} dropped successfully` }] };
    } catch (error) {
      console.error("Error dropping view:", error);
      throw new Error(`Failed to drop view: ${error}`);
    }
  }
);

// fetch-views (stub)
server.tool(
  "fetch-views",
  "List all views in a schema",
  {
    schema: z.string().default("public").describe("Schema name")
  },
  async ({ schema }) => {
    try {
      const sql = `SELECT table_name AS view FROM information_schema.views WHERE table_schema = $1;`;
      const result = await pool.query(sql, [schema]);
      return { content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }] };
    } catch (error) {
      console.error("Error fetching views:", error);
      throw new Error(`Failed to fetch views: ${error}`);
    }
  }
);

// fetch-functions (stub)
server.tool(
  "fetch-functions",
  "List stored functions/procedures",
  {
    schema: z.string().default("public").describe("Schema name")
  },
  async ({ schema }) => {
    try {
      const sql = `
        SELECT proname, prosrc 
        FROM pg_proc 
        JOIN pg_namespace ns ON pg_proc.pronamespace = ns.oid
        WHERE ns.nspname = $1;
      `;
      const result = await pool.query(sql, [schema]);
      return { content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }] };
    } catch (error) {
      console.error("Error fetching functions:", error);
      throw new Error(`Failed to fetch functions: ${error}`);
    }
  }
);

// create-function (stub)
server.tool(
  "create-function",
  "Create a new function",
  {
    functionDefinition: z.string().describe("SQL definition of the function")
  },
  async ({ functionDefinition }) => {
    try {
      await pool.query(functionDefinition);
      return { content: [{ type: "text", text: "Function created successfully" }] };
    } catch (error) {
      console.error("Error creating function:", error);
      throw new Error(`Failed to create function: ${error}`);
    }
  }
);

// update-function (stub)
server.tool(
  "update-function",
  "Update an existing function",
  {
    functionName: z.string().describe("Function name"),
    functionDefinition: z.string().describe("New SQL definition")
  },
  async ({ functionName, functionDefinition }) => {
    try {
      await pool.query(functionDefinition);
      return { content: [{ type: "text", text: `Function ${functionName} updated successfully` }] };
    } catch (error) {
      console.error("Error updating function:", error);
      throw new Error(`Failed to update function: ${error}`);
    }
  }
);

// delete-function (stub)
server.tool(
  "delete-function",
  "Delete a function",
  {
    functionName: z.string().describe("Function name")
  },
  async ({ functionName }) => {
    try {
      const sql = `DROP FUNCTION "${functionName}";`;
      await pool.query(sql);
      return { content: [{ type: "text", text: `Function ${functionName} dropped successfully` }] };
    } catch (error) {
      console.error("Error deleting function:", error);
      throw new Error(`Failed to delete function: ${error}`);
    }
  }
);

// fetch-schemas (stub)
server.tool(
  "fetch-schemas",
  "List all database schemas",
  { _dummy: z.string() },
  async () => {
    try {
      const sql = `SELECT schema_name FROM information_schema.schemata;`;
      const result = await pool.query(sql);
      return { content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }] };
    } catch (error) {
      console.error("Error fetching schemas:", error);
      throw new Error(`Failed to fetch schemas: ${error}`);
    }
  }
);

// create-schema (stub)
server.tool(
  "create-schema",
  "Create a new schema",
  {
    schemaName: z.string().describe("New schema name")
  },
  async ({ schemaName }) => {
    try {
      const sql = `CREATE SCHEMA "${schemaName}";`;
      await pool.query(sql);
      return { content: [{ type: "text", text: `Schema ${schemaName} created successfully` }] };
    } catch (error) {
      console.error("Error creating schema:", error);
      throw new Error(`Failed to create schema: ${error}`);
    }
  }
);

// update-schema (stub)
server.tool(
  "update-schema",
  "Rename a schema",
  {
    oldName: z.string().describe("Current schema name"),
    newName: z.string().describe("New schema name")
  },
  async ({ oldName, newName }) => {
    try {
      const sql = `ALTER SCHEMA "${oldName}" RENAME TO "${newName}";`;
      await pool.query(sql);
      return { content: [{ type: "text", text: `Schema renamed from ${oldName} to ${newName}` }] };
    } catch (error) {
      console.error("Error updating schema:", error);
      throw new Error(`Failed to update schema: ${error}`);
    }
  }
);

// delete-schema (stub)
server.tool(
  "delete-schema",
  "Drop a schema",
  {
    schemaName: z.string().describe("Schema name"),
    cascade: z.boolean().default(false).describe("Drop dependent objects too")
  },
  async ({ schemaName, cascade }) => {
    try {
      const sql = `DROP SCHEMA "${schemaName}"${cascade ? " CASCADE" : ""};`;
      await pool.query(sql);
      return { content: [{ type: "text", text: `Schema ${schemaName} dropped successfully` }] };
    } catch (error) {
      console.error("Error deleting schema:", error);
      throw new Error(`Failed to delete schema: ${error}`);
    }
  }
);

// execute-sql (alias to query)
server.tool(
  "execute-sql",
  "Execute an arbitrary SQL command",
  {
    sql: z.string().min(1).describe("SQL command to execute")
  },
  async ({ sql }) => {
    try {
      const result = await pool.query(sql);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(result.rows, null, 2)
        }]
      };
    } catch (error) {
      console.error("Error executing SQL:", error);
      throw new Error(`Failed to execute SQL: ${error}`);
    }
  }
);

// fetch-logs (stub)
server.tool(
  "fetch-logs",
  "Fetch recent activity logs",
  { _dummy: z.string() },
  async () => {
    try {
      const sql = `SELECT * FROM pg_stat_activity;`;
      const result = await pool.query(sql);
      return { content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }] };
    } catch (error) {
      console.error("Error fetching logs:", error);
      throw new Error(`Failed to fetch logs: ${error}`);
    }
  }
);

// monitor-changes (stub)
server.tool(
  "monitor-changes",
  "Monitor changes (not implemented)",
  { _dummy: z.string() },
  async () => ({ content: [{ type: "text", text: "Monitoring changes not implemented" }] })
);

// backup-database (stub)
server.tool(
  "backup-database",
  "Backup the database (not implemented)",
  { _dummy: z.string() },
  async () => ({ content: [{ type: "text", text: "Backup operation not implemented" }] })
);

// restore-database (stub)
server.tool(
  "restore-database",
  "Restore the database (not implemented)",
  { _dummy: z.string() },
  async () => ({ content: [{ type: "text", text: "Restore operation not implemented" }] })
);

// run-db-migration (stub)
server.tool(
  "run-db-migration",
  "Run a database migration",
  {
    migrationSQL: z.string().describe("SQL migration script")
  },
  async ({ migrationSQL }) => {
    try {
      await pool.query(migrationSQL);
      return { content: [{ type: "text", text: "Migration applied successfully" }] };
    } catch (error) {
      console.error("Error running migration:", error);
      throw new Error(`Failed to run migration: ${error}`);
    }
  }
);

// revert-db-migration (stub)
server.tool(
  "revert-db-migration",
  "Revert a database migration",
  {
    migrationSQL: z.string().describe("SQL migration revert script")
  },
  async ({ migrationSQL }) => {
    try {
      await pool.query(migrationSQL);
      return { content: [{ type: "text", text: "Migration reverted successfully" }] };
    } catch (error) {
      console.error("Error reverting migration:", error);
      throw new Error(`Failed to revert migration: ${error}`);
    }
  }
);

// export-data (stub)
server.tool(
  "export-data",
  "Export table data in JSON format",
  {
    schema: z.string().default("public").describe("Schema name"),
    table: z.string().describe("Table name")
  },
  async ({ schema, table }) => {
    try {
      const sql = `SELECT * FROM "${schema}"."${table}";`;
      const result = await pool.query(sql);
      return { content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }] };
    } catch (error) {
      console.error("Error exporting data:", error);
      throw new Error(`Failed to export data: ${error}`);
    }
  }
);

// import-data (stub)
server.tool(
  "import-data",
  "Import data into a table from JSON",
  {
    schema: z.string().default("public").describe("Schema name"),
    table: z.string().describe("Table name"),
    records: z.array(z.record(z.any())).describe("Array of records to import")
  },
  async ({ schema, table, records }) => {
    try {
      for (const record of records) {
        const keys = Object.keys(record);
        const cols = keys.map(k => `"${k}"`).join(", ");
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
        const sql = `INSERT INTO "${schema}"."${table}" (${cols}) VALUES (${placeholders});`;
        await pool.query(sql, keys.map(k => record[k]));
      }
      return { content: [{ type: "text", text: `Successfully imported data into ${schema}.${table}` }] };
    } catch (error) {
      console.error("Error importing data:", error);
      throw new Error(`Failed to import data: ${error}`);
    }
  }
);

// fetch-users (stub)
server.tool(
  "fetch-users",
  "List database users",
  { _dummy: z.string() },
  async () => {
    try {
      const sql = `SELECT usename FROM pg_catalog.pg_user;`;
      const result = await pool.query(sql);
      return { content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }] };
    } catch (error) {
      console.error("Error fetching users:", error);
      throw new Error(`Failed to fetch users: ${error}`);
    }
  }
);

// create-user (stub)
server.tool(
  "create-user",
  "Create a new database user",
  {
    username: z.string().describe("Username"),
    password: z.string().describe("Password")
  },
  async ({ username, password }) => {
    try {
      const sql = `CREATE USER "${username}" WITH PASSWORD '${password}';`;
      await pool.query(sql);
      return { content: [{ type: "text", text: `User ${username} created successfully` }] };
    } catch (error) {
      console.error("Error creating user:", error);
      throw new Error(`Failed to create user: ${error}`);
    }
  }
);

// update-user (stub)
server.tool(
  "update-user",
  "Update a database user",
  {
    username: z.string().describe("Username"),
    newPassword: z.string().describe("New password")
  },
  async ({ username, newPassword }) => {
    try {
      const sql = `ALTER USER "${username}" WITH PASSWORD '${newPassword}';`;
      await pool.query(sql);
      return { content: [{ type: "text", text: `User ${username} updated successfully` }] };
    } catch (error) {
      console.error("Error updating user:", error);
      throw new Error(`Failed to update user: ${error}`);
    }
  }
);

// delete-user (stub)
server.tool(
  "delete-user",
  "Delete a database user",
  {
    username: z.string().describe("Username")
  },
  async ({ username }) => {
    try {
      const sql = `DROP USER "${username}";`;
      await pool.query(sql);
      return { content: [{ type: "text", text: `User ${username} deleted successfully` }] };
    } catch (error) {
      console.error("Error deleting user:", error);
      throw new Error(`Failed to delete user: ${error}`);
    }
  }
);

// Transaction management stubs
server.tool(
  "begin-transaction",
  "Begin a transaction (not supported in stateless mode)",
  { _dummy: z.string() },
  async () => ({ content: [{ type: "text", text: "Transaction management not supported" }] })
);
server.tool(
  "commit-transaction",
  "Commit a transaction (not supported in stateless mode)",
  { _dummy: z.string() },
  async () => ({ content: [{ type: "text", text: "Transaction management not supported" }] })
);
server.tool(
  "rollback-transaction",
  "Rollback a transaction (not supported in stateless mode)",
  { _dummy: z.string() },
  async () => ({ content: [{ type: "text", text: "Transaction management not supported" }] })
);

// fetch-triggers (stub)
server.tool(
  "fetch-triggers",
  "List triggers for a given table",
  {
    schema: z.string().default("public").describe("Schema name"),
    table: z.string().describe("Table name")
  },
  async ({ schema, table }) => {
    try {
      const sql = `SELECT tgname FROM pg_trigger WHERE tgrelid = ('"${schema}"."${table}"')::regclass;`;
      const result = await pool.query(sql);
      return { content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }] };
    } catch (error) {
      console.error("Error fetching triggers:", error);
      throw new Error(`Failed to fetch triggers: ${error}`);
    }
  }
);

// create-trigger (stub)
server.tool(
  "create-trigger",
  "Create a new trigger on a table",
  {
    schema: z.string().default("public").describe("Schema name"),
    table: z.string().describe("Table name"),
    triggerName: z.string().describe("Trigger name"),
    timing: z.enum(["BEFORE", "AFTER", "INSTEAD OF"]).describe("Trigger timing"),
    event: z.enum(["INSERT", "UPDATE", "DELETE", "TRUNCATE"]).describe("Trigger event"),
    functionName: z.string().describe("Function to execute")
  },
  async ({ schema, table, triggerName, timing, event, functionName }) => {
    try {
      const sql = `CREATE TRIGGER "${triggerName}" ${timing} ${event} ON "${schema}"."${table}" FOR EACH ROW EXECUTE FUNCTION ${functionName}();`;
      await pool.query(sql);
      return { content: [{ type: "text", text: `Trigger ${triggerName} created on ${schema}.${table}` }] };
    } catch (error) {
      console.error("Error creating trigger:", error);
      throw new Error(`Failed to create trigger: ${error}`);
    }
  }
);

// delete-trigger (stub)
server.tool(
  "delete-trigger",
  "Delete a trigger from a table",
  {
    schema: z.string().default("public").describe("Schema name"),
    table: z.string().describe("Table name"),
    triggerName: z.string().describe("Trigger name")
  },
  async ({ schema, table, triggerName }) => {
    try {
      const sql = `DROP TRIGGER "${triggerName}" ON "${schema}"."${table}";`;
      await pool.query(sql);
      return { content: [{ type: "text", text: `Trigger ${triggerName} dropped from ${schema}.${table}` }] };
    } catch (error) {
      console.error("Error deleting trigger:", error);
      throw new Error(`Failed to delete trigger: ${error}`);
    }
  }
);

// fetch-publications (stub)
server.tool(
  "fetch-publications",
  "List replication publications",
  { _dummy: z.string() },
  async () => {
    try {
      const sql = `SELECT * FROM pg_publication;`;
      const result = await pool.query(sql);
      return { content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }] };
    } catch (error) {
      console.error("Error fetching publications:", error);
      throw new Error(`Failed to fetch publications: ${error}`);
    }
  }
);

// create-publication (stub)
server.tool(
  "create-publication",
  "Create a new publication",
  {
    publicationName: z.string().describe("Publication name"),
    forTables: z.string().describe("Tables (comma separated)"),
    publish: z.string().describe("Publish option")
  },
  async ({ publicationName, forTables, publish }) => {
    try {
      const sql = `CREATE PUBLICATION "${publicationName}" FOR TABLE ${forTables} WITH (publish = '${publish}');`;
      await pool.query(sql);
      return { content: [{ type: "text", text: `Publication ${publicationName} created` }] };
    } catch (error) {
      console.error("Error creating publication:", error);
      throw new Error(`Failed to create publication: ${error}`);
    }
  }
);

// delete-publication (stub)
server.tool(
  "delete-publication",
  "Drop a publication",
  {
    publicationName: z.string().describe("Publication name")
  },
  async ({ publicationName }) => {
    try {
      const sql = `DROP PUBLICATION "${publicationName}";`;
      await pool.query(sql);
      return { content: [{ type: "text", text: `Publication ${publicationName} dropped` }] };
    } catch (error) {
      console.error("Error deleting publication:", error);
      throw new Error(`Failed to delete publication: ${error}`);
    }
  }
);

// fetch-roles (stub)
server.tool(
  "fetch-roles",
  "List all roles",
  { _dummy: z.string() },
  async () => {
    try {
      const sql = `SELECT rolname FROM pg_roles;`;
      const result = await pool.query(sql);
      return { content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }] };
    } catch (error) {
      console.error("Error fetching roles:", error);
      throw new Error(`Failed to fetch roles: ${error}`);
    }
  }
);

// fetch-policies (stub)
server.tool(
  "fetch-policies",
  "List row-level security policies for a table",
  {
    schema: z.string().default("public").describe("Schema name"),
    table: z.string().describe("Table name")
  },
  async ({ schema, table }) => {
    try {
      const sql = `
        SELECT pol.polname, pol.polcmd, rel.relname 
        FROM pg_policy pol 
        JOIN pg_class rel ON pol.polrelid = rel.oid
        WHERE rel.relname = $1;
      `;
      const result = await pool.query(sql, [table]);
      return { content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }] };
    } catch (error) {
      console.error("Error fetching policies:", error);
      throw new Error(`Failed to fetch policies: ${error}`);
    }
  }
);

// create-policy (stub)
server.tool(
  "create-policy",
  "Create a new row-level security policy",
  {
    schema: z.string().default("public").describe("Schema name"),
    table: z.string().describe("Table name"),
    policyName: z.string().describe("Policy name"),
    command: z.string().describe("Command (SELECT, INSERT, etc.)"),
    using: z.string().describe("Using clause")
  },
  async ({ schema, table, policyName, command, using }) => {
    try {
      const sql = `CREATE POLICY "${policyName}" ON "${schema}"."${table}" FOR ${command} USING (${using});`;
      await pool.query(sql);
      return { content: [{ type: "text", text: `Policy ${policyName} created on ${schema}.${table}` }] };
    } catch (error) {
      console.error("Error creating policy:", error);
      throw new Error(`Failed to create policy: ${error}`);
    }
  }
);

// update-policy (stub)
server.tool(
  "update-policy",
  "Update an existing row-level security policy",
  {
    schema: z.string().default("public").describe("Schema name"),
    table: z.string().describe("Table name"),
    policyName: z.string().describe("Existing policy name"),
    newPolicyName: z.string().optional().describe("New policy name"),
    using: z.string().optional().describe("New using clause")
  },
  async ({ schema, table, policyName, newPolicyName, using }) => {
    try {
      let sql = `ALTER POLICY "${policyName}" ON "${schema}"."${table}"`;
      if (newPolicyName) sql += ` RENAME TO "${newPolicyName}"`;
      if (using) sql += ` USING (${using})`;
      sql += ";";
      await pool.query(sql);
      return { content: [{ type: "text", text: `Policy ${policyName} updated on ${schema}.${table}` }] };
    } catch (error) {
      console.error("Error updating policy:", error);
      throw new Error(`Failed to update policy: ${error}`);
    }
  }
);

// delete-policy (stub)
server.tool(
  "delete-policy",
  "Delete a row-level security policy",
  {
    schema: z.string().default("public").describe("Schema name"),
    table: z.string().describe("Table name"),
    policyName: z.string().describe("Policy name")
  },
  async ({ schema, table, policyName }) => {
    try {
      const sql = `DROP POLICY "${policyName}" ON "${schema}"."${table}";`;
      await pool.query(sql);
      return { content: [{ type: "text", text: `Policy ${policyName} dropped from ${schema}.${table}` }] };
    } catch (error) {
      console.error("Error deleting policy:", error);
      throw new Error(`Failed to delete policy: ${error}`);
    }
  }
);

// security-advisor (stub)
server.tool(
  "security-advisor",
  "Provides security recommendations (stub)",
  { _dummy: z.string() },
  async () => ({ content: [{ type: "text", text: "Security Advisor feature not implemented" }] })
);

// performance-advisor (stub)
server.tool(
  "performance-advisor",
  "Provides performance recommendations (stub)",
  { _dummy: z.string() },
  async () => ({ content: [{ type: "text", text: "Performance Advisor feature not implemented" }] })
);

// query-performance (stub)
server.tool(
  "query-performance",
  "Fetch query performance metrics (stub)",
  { _dummy: z.string() },
  async () => ({ content: [{ type: "text", text: "Query Performance metrics feature not implemented" }] })
);

// fetch-buckets (stub)
server.tool(
  "fetch-buckets",
  "List storage buckets (stub)",
  { _dummy: z.string() },
  async () => ({ content: [{ type: "text", text: "Storage buckets feature not implemented" }] })
);

// create-bucket (stub)
server.tool(
  "create-bucket",
  "Create a new storage bucket (stub)",
  {
    bucketName: z.string().describe("Bucket name")
  },
  async () => ({ content: [{ type: "text", text: "Create bucket feature not implemented" }] })
);

// update-bucket-policy (stub)
server.tool(
  "update-bucket-policy",
  "Update a bucket's policy (stub)",
  { _dummy: z.string() },
  async () => ({ content: [{ type: "text", text: "Bucket policy update not implemented" }] })
);

// delete-bucket (stub)
server.tool(
  "delete-bucket",
  "Delete a storage bucket (stub)",
  {
    bucketName: z.string().describe("Bucket name")
  },
  async () => ({ content: [{ type: "text", text: "Delete bucket feature not implemented" }] })
);

// edge-function (stub)
server.tool(
  "edge-function",
  "Manage edge functions (stub)",
  { _dummy: z.string() },
  async () => ({ content: [{ type: "text", text: "Edge Functions feature not implemented" }] })
);

// realtime (stub)
server.tool(
  "realtime",
  "Manage realtime subscriptions (stub)",
  { _dummy: z.string() },
  async () => ({ content: [{ type: "text", text: "Realtime feature not implemented" }] })
);

// inspector (stub)
server.tool(
  "inspector",
  "Inspect tools and operations (stub)",
  { _dummy: z.string() },
  async () => ({ content: [{ type: "text", text: "Inspector feature not implemented" }] })
);

// configuration (stub)
server.tool(
  "configuration",
  "Manage system configuration (stub)",
  { _dummy: z.string() },
  async () => ({ content: [{ type: "text", text: "Configuration feature not implemented" }] })
);

// auth-sign-in (stub)
server.tool(
  "auth-sign-in",
  "User sign-in (stub)",
  {
    username: z.string().describe("Username"),
    password: z.string().describe("Password")
  },
  async () => ({ content: [{ type: "text", text: "Authentication Sign In feature not implemented" }] })
);

// auth-sign-up (stub)
server.tool(
  "auth-sign-up",
  "User sign-up (stub)",
  {
    username: z.string().describe("Username"),
    password: z.string().describe("Password"),
    email: z.string().describe("Email")
  },
  async () => ({ content: [{ type: "text", text: "Authentication Sign Up feature not implemented" }] })
);

// fetch-sessions (stub)
server.tool(
  "fetch-sessions",
  "List active sessions (stub)",
  { _dummy: z.string() },
  async () => ({ content: [{ type: "text", text: "Sessions feature not implemented" }] })
);

// rate-limits (stub)
server.tool(
  "rate-limits",
  "Get or update rate limits (stub)",
  { _dummy: z.string() },
  async () => ({ content: [{ type: "text", text: "Rate Limits feature not implemented" }] })
);

// send-email (stub)
server.tool(
  "send-email",
  "Send an email (stub)",
  {
    to: z.string().describe("Recipient email"),
    subject: z.string().describe("Email subject"),
    body: z.string().describe("Email body")
  },
  async () => ({ content: [{ type: "text", text: "Emails feature not implemented" }] })
);

// multi-factor (stub)
server.tool(
  "multi-factor",
  "Multi-Factor Authentication (stub)",
  { _dummy: z.string() },
  async () => ({ content: [{ type: "text", text: "Multi-Factor Authentication feature not implemented" }] })
);

// url-configuration (stub)
server.tool(
  "url-configuration",
  "Manage URL configuration (stub)",
  { _dummy: z.string() },
  async () => ({ content: [{ type: "text", text: "URL Configuration feature not implemented" }] })
);

// attack-protection (stub)
server.tool(
  "attack-protection",
  "Manage attack protection settings (stub)",
  { _dummy: z.string() },
  async () => ({ content: [{ type: "text", text: "Attack Protection feature not implemented" }] })
);

// auth-hooks (stub)
server.tool(
  "auth-hooks",
  "Manage authentication hooks (stub)",
  { _dummy: z.string() },
  async () => ({ content: [{ type: "text", text: "Auth Hooks feature not implemented" }] })
);

// advanced-settings (stub)
server.tool(
  "advanced-settings",
  "Advanced settings (stub)",
  { _dummy: z.string() },
  async () => ({ content: [{ type: "text", text: "Advanced settings feature not implemented" }] })
);

// advisor (stub)
server.tool(
  "advisor",
  "Run advisor checks (stub)",
  { _dummy: z.string() },
  async () => ({ content: [{ type: "text", text: "Advisor feature not implemented" }] })
);

// project-settings (stub)
server.tool(
  "project-settings",
  "Manage project settings (stub)",
  { _dummy: z.string() },
  async () => ({ content: [{ type: "text", text: "Project Settings feature not implemented" }] })
);

// ----------------- Supabase Specific Endpoints -----------------

// Supabase Auth Endpoints
server.tool(
  "supabase-auth-sign-in",
  "Supabase: User sign-in",
  {
    username: z.string().describe("Username"),
    password: z.string().describe("Password")
  },
  async ({ username, password }) => ({
    content: [{ type: "text", text: "Supabase Auth Sign In feature not implemented yet" }]
  })
);

server.tool(
  "supabase-auth-sign-up",
  "Supabase: User sign-up",
  {
    username: z.string().describe("Username"),
    password: z.string().describe("Password"),
    email: z.string().describe("Email")
  },
  async ({ username, password, email }) => ({
    content: [{ type: "text", text: "Supabase Auth Sign Up feature not implemented yet" }]
  })
);

server.tool(
  "supabase-auth-fetch-sessions",
  "Supabase: List active sessions",
  { _dummy: z.string() },
  async () => ({
    content: [{ type: "text", text: "Supabase Sessions feature not implemented yet" }]
  })
);

server.tool(
  "supabase-auth-multi-factor",
  "Supabase: Multi-Factor Authentication",
  { _dummy: z.string() },
  async () => ({
    content: [{ type: "text", text: "Supabase Multi-Factor Authentication not implemented yet" }]
  })
);

// Supabase Storage Endpoints
server.tool(
  "supabase-storage-upload",
  "Supabase: Upload a file to storage",
  {
    bucket: z.string().describe("Storage bucket name"),
    fileName: z.string().describe("File name"),
    fileContent: z.string().describe("File content (base64 or raw)")
  },
  async ({ bucket, fileName, fileContent }) => {
    try {
      // Convert base64 to buffer if content is base64
      let buffer;
      if (fileContent.match(/^data:.+;base64,/)) {
        buffer = Buffer.from(fileContent.split(',')[1], 'base64');
      } else {
        buffer = Buffer.from(fileContent);
      }

      const query = `
        INSERT INTO storage.objects (bucket_id, name, owner, size, metadata)
        VALUES ($1, $2, auth.uid(), $3, $4)
        RETURNING *;
      `;

      const metadata = {
        mimetype: 'application/octet-stream',
        size: buffer.length,
        lastModified: new Date().toISOString()
      };

      const result = await pool.query(query, [bucket, fileName, buffer.length, metadata]);
      
      // Store the actual file content in a separate table or filesystem
      const contentQuery = `
        INSERT INTO storage.objects_content (object_id, content)
        VALUES ($1, $2);
      `;
      await pool.query(contentQuery, [result.rows[0].id, buffer]);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            message: "File uploaded successfully",
            key: fileName,
            bucket: bucket,
            size: buffer.length
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error("Error uploading file:", error);
      throw new Error(`Failed to upload file: ${error}`);
    }
  }
);

server.tool(
  "supabase-storage-download",
  "Supabase: Download a file from storage",
  {
    bucket: z.string().describe("Storage bucket name"),
    fileName: z.string().describe("File name")
  },
  async ({ bucket, fileName }) => {
    try {
      const query = `
        SELECT o.*, oc.content
        FROM storage.objects o
        JOIN storage.objects_content oc ON o.id = oc.object_id
        WHERE o.bucket_id = $1 AND o.name = $2;
      `;

      const result = await pool.query(query, [bucket, fileName]);
      
      if (result.rows.length === 0) {
        throw new Error('File not found');
      }

      const file = result.rows[0];
      const content = file.content.toString('base64');

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            fileName: file.name,
            content: content,
            metadata: file.metadata,
            size: file.size
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error("Error downloading file:", error);
      throw new Error(`Failed to download file: ${error}`);
    }
  }
);

server.tool(
  "supabase-storage-delete",
  "Supabase: Delete a file from storage",
  {
    bucket: z.string().describe("Storage bucket name"),
    fileName: z.string().describe("File name")
  },
  async ({ bucket, fileName }) => {
    try {
      // First get the object ID
      const getObjectQuery = `
        SELECT id FROM storage.objects
        WHERE bucket_id = $1 AND name = $2;
      `;
      const objectResult = await pool.query(getObjectQuery, [bucket, fileName]);
      
      if (objectResult.rows.length === 0) {
        throw new Error('File not found');
      }

      const objectId = objectResult.rows[0].id;

      // Delete content first due to foreign key constraint
      await pool.query('DELETE FROM storage.objects_content WHERE object_id = $1;', [objectId]);
      
      // Then delete the object record
      await pool.query('DELETE FROM storage.objects WHERE id = $1;', [objectId]);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            message: "File deleted successfully",
            fileName: fileName,
            bucket: bucket
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error("Error deleting file:", error);
      throw new Error(`Failed to delete file: ${error}`);
    }
  }
);

server.tool(
  "supabase-storage-list-buckets",
  "Supabase: List storage buckets",
  { _dummy: z.string() },
  async () => {
    try {
      const query = `
        SELECT 
          b.id,
          b.name,
          b.owner,
          b.created_at,
          b.updated_at,
          COUNT(o.id) as file_count,
          COALESCE(SUM(o.size), 0) as total_size
        FROM storage.buckets b
        LEFT JOIN storage.objects o ON b.id = o.bucket_id
        GROUP BY b.id, b.name, b.owner, b.created_at, b.updated_at
        ORDER BY b.created_at DESC;
      `;

      const result = await pool.query(query);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            buckets: result.rows.map(bucket => ({
              id: bucket.id,
              name: bucket.name,
              fileCount: parseInt(bucket.file_count),
              totalSize: parseInt(bucket.total_size),
              createdAt: bucket.created_at,
              updatedAt: bucket.updated_at
            }))
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error("Error listing buckets:", error);
      throw new Error(`Failed to list buckets: ${error}`);
    }
  }
);

// Supabase Edge Functions Endpoints
server.tool(
  "supabase-edge-function-run",
  "Supabase: Run an edge function",
  {
    functionName: z.string().describe("Edge function name"),
    payload: z.any().describe("Function payload")
  },
  async ({ functionName, payload }) => {
    try {
      // First, get the function code and configuration
      const getFunctionQuery = `
        SELECT 
          f.id,
          f.name,
          f.code,
          f.version,
          f.config,
          f.status,
          f.runtime
        FROM edge.functions f
        WHERE f.name = $1 AND f.status = 'active'
        ORDER BY f.version DESC
        LIMIT 1;
      `;

      const functionResult = await pool.query(getFunctionQuery, [functionName]);
      
      if (functionResult.rows.length === 0) {
        throw new Error(`Function "${functionName}" not found or not active`);
      }

      const func = functionResult.rows[0];

      // Log function invocation
      const logQuery = `
        INSERT INTO edge.function_logs (
          function_id,
          version,
          request_payload,
          start_time
        ) VALUES ($1, $2, $3, NOW())
        RETURNING id;
      `;

      const logResult = await pool.query(logQuery, [
        func.id,
        func.version,
        JSON.stringify(payload)
      ]);

      const logId = logResult.rows[0].id;

      try {
        // Execute the function in a sandboxed environment
        const vm = require('vm');
        const context = {
          require: require,
          console: console,
          Buffer: Buffer,
          process: {
            env: { ...process.env, ...func.config }
          },
          payload: payload
        };

        // Create a new context with a timeout
        const script = new vm.Script(func.code);
        const response = await vm.runInNewContext(script, context, {
          timeout: 30000 // 30 second timeout
        });

        // Log successful execution
        await pool.query(`
          UPDATE edge.function_logs
          SET 
            end_time = NOW(),
            response_payload = $1,
            status = 'success'
          WHERE id = $2;
        `, [JSON.stringify(response), logId]);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              functionName,
              response,
              executionTime: "Execution completed successfully"
            }, null, 2)
          }]
        };

      } catch (execError) {
        // Log execution error
        await pool.query(`
          UPDATE edge.function_logs
          SET 
            end_time = NOW(),
            error = $1,
            status = 'error'
          WHERE id = $2;
        `, [(execError as Error).message || String(execError), logId]);

        throw execError;
      }

    } catch (error) {
      console.error("Error running edge function:", error);
      throw new Error(`Failed to run edge function: ${(error as Error).message || String(error)}`);
    }
  }
);

server.tool(
  "supabase-edge-function-deploy",
  "Supabase: Deploy an edge function",
  {
    functionName: z.string().describe("Edge function name"),
    code: z.string().describe("Edge function code")
  },
  async ({ functionName, code }) => {
    try {
      // Start a transaction
      await pool.query('BEGIN');

      try {
        // Get current version if function exists
        const versionQuery = `
          SELECT version 
          FROM edge.functions 
          WHERE name = $1 
          ORDER BY version DESC 
          LIMIT 1;
        `;
        const versionResult = await pool.query(versionQuery, [functionName]);
        const newVersion = versionResult.rows.length > 0 ? 
          versionResult.rows[0].version + 1 : 1;

        // Deactivate previous versions
        if (versionResult.rows.length > 0) {
          await pool.query(`
            UPDATE edge.functions
            SET status = 'inactive'
            WHERE name = $1;
          `, [functionName]);
        }

        // Insert new function version
        const deployQuery = `
          INSERT INTO edge.functions (
            name,
            code,
            version,
            status,
            runtime,
            created_at,
            updated_at,
            config
          ) VALUES (
            $1, $2, $3, 'active', 'node16',
            NOW(), NOW(), $4
          )
          RETURNING id, version;
        `;

        const defaultConfig = {
          memory: 128,
          timeout: 30,
          environment: 'production'
        };

        const result = await pool.query(deployQuery, [
          functionName,
          code,
          newVersion,
          defaultConfig
        ]);

        // Validate the function by attempting to parse it
        try {
          require('vm').createScript(code);
        } catch (parseError) {
          throw new Error(`Function validation failed: ${(parseError as Error).message || String(parseError)}`);
        }

        // Log deployment
        await pool.query(`
          INSERT INTO edge.deployment_logs (
            function_id,
            version,
            status,
            deployed_at,
            deployed_by
          ) VALUES ($1, $2, 'success', NOW(), $3);
        `, [result.rows[0].id, newVersion, 'system']);

        // Commit transaction
        await pool.query('COMMIT');

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              functionName,
              version: newVersion,
              status: 'active',
              message: 'Function deployed successfully'
            }, null, 2)
          }]
        };

      } catch (error) {
        // Rollback transaction on error
        await pool.query('ROLLBACK');
        throw error;
      }

    } catch (error) {
      console.error("Error deploying edge function:", error);
      throw new Error(`Failed to deploy edge function: ${(error as Error).message || String(error)}`);
    }
  }
);

// Add new tool for listing deployed functions
server.tool(
  "supabase-edge-function-list",
  "Supabase: List all deployed edge functions",
  { _dummy: z.string() },
  async () => {
    try {
      const query = `
        SELECT 
          f.name,
          f.version,
          f.status,
          f.runtime,
          f.created_at,
          f.updated_at,
          (
            SELECT COUNT(*) 
            FROM edge.function_logs fl 
            WHERE fl.function_id = f.id
          ) as invocation_count,
          (
            SELECT COUNT(*) 
            FROM edge.function_logs fl 
            WHERE fl.function_id = f.id 
            AND fl.status = 'error'
          ) as error_count
        FROM edge.functions f
        WHERE f.status = 'active'
        ORDER BY f.name, f.version DESC;
      `;

      const result = await pool.query(query);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            functions: result.rows.map(func => ({
              name: func.name,
              version: func.version,
              status: func.status,
              runtime: func.runtime,
              invocations: parseInt(func.invocation_count),
              errors: parseInt(func.error_count),
              createdAt: func.created_at,
              updatedAt: func.updated_at
            }))
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error("Error listing edge functions:", error);
      throw new Error(`Failed to list edge functions: ${(error as Error).message || String(error)}`);
    }
  }
);

// Add new tool for getting function logs
server.tool(
  "supabase-edge-function-logs",
  "Supabase: Get execution logs for an edge function",
  {
    functionName: z.string().describe("Edge function name"),
    limit: z.number().optional().describe("Number of log entries to return")
  },
  async ({ functionName, limit = 100 }) => {
    try {
      const query = `
        SELECT 
          fl.id,
          fl.start_time,
          fl.end_time,
          fl.status,
          fl.request_payload,
          fl.response_payload,
          fl.error,
          f.name,
          f.version
        FROM edge.function_logs fl
        JOIN edge.functions f ON fl.function_id = f.id
        WHERE f.name = $1
        ORDER BY fl.start_time DESC
        LIMIT $2;
      `;

      const result = await pool.query(query, [functionName, limit]);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            logs: result.rows.map(log => ({
              id: log.id,
              functionName: log.name,
              version: log.version,
              startTime: log.start_time,
              endTime: log.end_time,
              status: log.status,
              request: log.request_payload,
              response: log.response_payload,
              error: log.error,
              duration: log.end_time ? 
                `${new Date(log.end_time).getTime() - new Date(log.start_time).getTime()}ms` : 
                'pending'
            }))
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error("Error fetching function logs:", error);
      throw new Error(`Failed to fetch function logs: ${(error as Error).message || String(error)}`);
    }
  }
);

// Supabase AI / Vector Endpoints
server.tool(
  "supabase-ai-vector-insert",
  "Supabase: Insert a vector into a table",
  {
    table: z.string().describe("Table name"),
    vector: z.array(z.number()).describe("Vector data"),
    metadata: z.record(z.any()).optional().describe("Optional metadata")
  },
  async ({ table, vector, metadata }) => ({
    content: [{ type: "text", text: "Supabase AI Vector Insert feature not implemented yet" }]
  })
);

server.tool(
  "supabase-ai-vector-search",
  "Supabase: Search for similar vectors",
  {
    table: z.string().describe("Table name"),
    queryVector: z.array(z.number()).describe("Query vector"),
    limit: z.number().optional().describe("Maximum number of results")
  },
  async ({ table, queryVector, limit }) => ({
    content: [{ type: "text", text: "Supabase AI Vector Search feature not implemented yet" }]
  })
);

server.tool(
  "supabase-ai-vector-update",
  "Supabase: Update a stored vector",
  {
    table: z.string().describe("Table name"),
    id: z.string().describe("Record identifier"),
    newVector: z.array(z.number()).describe("New vector data")
  },
  async ({ table, id, newVector }) => ({
    content: [{ type: "text", text: "Supabase AI Vector Update feature not implemented yet" }]
  })
);

server.tool(
  "supabase-ai-vector-delete",
  "Supabase: Delete a stored vector",
  {
    table: z.string().describe("Table name"),
    id: z.string().describe("Record identifier")
  },
  async ({ table, id }) => ({
    content: [{ type: "text", text: "Supabase AI Vector Delete feature not implemented yet" }]
  })
);

// Supabase PostgREST & API Documentation Endpoints
server.tool(
  "supabase-postgrest",
  "Supabase: Return auto-generated REST API for the database",
  { _dummy: z.string() },
  async () => ({
    content: [{ type: "text", text: "Supabase PostgREST feature not implemented yet" }]
  })
);

server.tool(
  "supabase-api-docs",
  "Supabase: Get API documentation based on the database schema",
  { _dummy: z.string() },
  async () => ({
    content: [{ type: "text", text: "Supabase API Documentation feature not implemented yet" }]
  })
);

// Supabase Type Generation Endpoint
server.tool(
  "supabase-type-generation",
  "Supabase: Generate TypeScript types from the database schema",
  { _dummy: z.string() },
  async () => ({
    content: [{ type: "text", text: "Supabase Type Generation feature not implemented yet" }]
  })
);

// Supabase Clone Table Endpoint
server.tool(
  "supabase-clone-table",
  "Supabase: Clone an existing table",
  {
    schema: z.string().default("public").describe("Schema name"),
    table: z.string().describe("Source table name"),
    newTable: z.string().describe("New table name")
  },
  async ({ schema, table, newTable }) => {
    try {
      // Simple clone (without indexes/constraints)
      const sql = `CREATE TABLE "${schema}"."${newTable}" AS TABLE "${schema}"."${table}" WITH NO DATA;`;
      await pool.query(sql);
      return {
        content: [{
          type: "text",
          text: `Table ${schema}.${table} cloned to ${schema}.${newTable} successfully (data not copied)`
        }]
      };
    } catch (error) {
      console.error("Error cloning table:", error);
      throw new Error(`Failed to clone table: ${error}`);
    }
  }
);

// Supabase Import/Export CSV Endpoints
server.tool(
  "supabase-import-data-csv",
  "Supabase: Import data into a table from CSV",
  {
    schema: z.string().default("public").describe("Schema name"),
    table: z.string().describe("Table name"),
    csvData: z.string().describe("CSV data as a string")
  },
  async ({ schema, table, csvData }) => ({
    content: [{ type: "text", text: "Supabase CSV Import feature not implemented yet" }]
  })
);

server.tool(
  "supabase-export-data-csv",
  "Supabase: Export table data as CSV",
  {
    schema: z.string().default("public").describe("Schema name"),
    table: z.string().describe("Table name")
  },
  async ({ schema, table }) => ({
    content: [{ type: "text", text: "Supabase CSV Export feature not implemented yet" }]
  })
);

// Supabase Backups and Monitoring
server.tool(
  "supabase-backup-database",
  "Supabase: Backup the database",
  { _dummy: z.string() },
  async () => ({
    content: [{ type: "text", text: "Supabase Backup feature not implemented yet" }]
  })
);

server.tool(
  "supabase-monitoring",
  "Supabase: Get monitoring and performance metrics",
  { _dummy: z.string() },
  async () => ({
    content: [{ type: "text", text: "Supabase Monitoring feature not implemented yet" }]
  })
);

// Supabase Security & Multi-Tenancy Endpoints
server.tool(
  "supabase-security-settings",
  "Supabase: Manage advanced security settings",
  { _dummy: z.string() },
  async () => ({
    content: [{ type: "text", text: "Supabase Security Settings feature not implemented yet" }]
  })
);

server.tool(
  "supabase-multi-tenancy",
  "Supabase: Manage multi-tenancy configuration",
  { _dummy: z.string() },
  async () => ({
    content: [{ type: "text", text: "Supabase Multi-Tenancy feature not implemented yet" }]
  })
);

// Supabase Custom Domains and Email Invites
server.tool(
  "supabase-custom-domains",
  "Supabase: Configure custom domains",
  { _dummy: z.string() },
  async () => ({
    content: [{ type: "text", text: "Supabase Custom Domains feature not implemented yet" }]
  })
);

server.tool(
  "supabase-email-invites",
  "Supabase: Send email invites to users",
  {
    email: z.string().describe("Recipient email"),
    inviteMessage: z.string().optional().describe("Optional invite message")
  },
  async ({ email, inviteMessage }) => ({
    content: [{ type: "text", text: "Supabase Email Invites feature not implemented yet" }]
  })
);

// Supabase CMS and Dashboard (Stub endpoints)
server.tool(
  "supabase-cms",
  "Supabase: Content management system interface",
  { _dummy: z.string() },
  async () => ({
    content: [{ type: "text", text: "Supabase CMS feature not implemented yet" }]
  })
);

server.tool(
  "supabase-dashboard",
  "Supabase: Dashboard interface for project management",
  { _dummy: z.string() },
  async () => ({
    content: [{ type: "text", text: "Supabase Dashboard feature not implemented yet" }]
  })
);

// Supabase Integrations and Custom Fetch Functions
server.tool(
  "supabase-integrations",
  "Supabase: Manage integrations with external tools",
  { _dummy: z.string() },
  async () => ({
    content: [{ type: "text", text: "Supabase Integrations feature not implemented yet" }]
  })
);

server.tool(
  "supabase-custom-fetch",
  "Supabase: Define custom fetch functions for optimized queries",
  { _dummy: z.string() },
  async () => ({
    content: [{ type: "text", text: "Supabase Custom Fetch Functions feature not implemented yet" }]
  })
);

// Supabase Prisma and Langchain Integration
server.tool(
  "supabase-prisma",
  "Supabase: Prisma ORM integration",
  { _dummy: z.string() },
  async () => ({
    content: [{ type: "text", text: "Supabase Prisma Integration feature not implemented yet" }]
  })
);

server.tool(
  "supabase-langchain",
  "Supabase: Langchain integration for AI-powered applications",
  { _dummy: z.string() },
  async () => ({
    content: [{ type: "text", text: "Supabase Langchain Integration feature not implemented yet" }]
  })
);

// ----------------- End Supabase Specific Endpoints -----------------

// Add realtime subscription management
const realtimeSubscriptions = new Map();

// Realtime subscription tool
server.tool(
  "supabase-realtime-subscribe",
  "Supabase: Subscribe to realtime changes",
  {
    channel: z.string().describe("Channel name"),
    event: z.enum(["INSERT", "UPDATE", "DELETE"]).describe("Event type (insert/update/delete)"),
    filter: z.record(z.any()).optional().describe("Optional filter conditions")
  },
  async ({ channel, event, filter }) => {
    try {
      // Create a unique subscription ID
      const subscriptionId = `${channel}:${event}:${Date.now()}`;

      // Set up trigger for the specified event
      const triggerName = `realtime_${channel}_${event.toLowerCase()}_trigger`;
      const triggerFunction = `realtime_${channel}_notify()`;

      // Create notification function if it doesn't exist
      await pool.query(`
        CREATE OR REPLACE FUNCTION ${triggerFunction} RETURNS trigger AS $$
        BEGIN
          PERFORM pg_notify(
            '${channel}',
            json_build_object(
              'event', TG_OP,
              'schema', TG_TABLE_SCHEMA,
              'table', TG_TABLE_NAME,
              'data', row_to_json(NEW)
            )::text
          );
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `);

      // Create trigger for the event
      const triggerSQL = `
        CREATE TRIGGER ${triggerName}
        AFTER ${event} ON "${channel}"
        FOR EACH ROW
        EXECUTE FUNCTION ${triggerFunction};
      `;

      await pool.query(triggerSQL);

      // Store subscription details
      realtimeSubscriptions.set(subscriptionId, {
        channel,
        event,
        filter,
        triggerName,
        triggerFunction,
        createdAt: new Date()
      });

      // Set up LISTEN
      const client = await pool.connect();
      await client.query(`LISTEN "${channel}"`);

      // Handle notifications
      client.on('notification', (msg) => {
        if (!msg.payload) {
          console.error('Received notification with no payload');
          return;
        }
        const payload = JSON.parse(msg.payload);
        
        // Apply filters if they exist
        if (filter) {
          const matches = Object.entries(filter).every(([key, value]) => 
            payload.data[key] === value
          );
          if (!matches) return;
        }

        console.log('Realtime event:', {
          channel: msg.channel,
          payload: payload
        });
      });

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            subscriptionId,
            message: `Successfully subscribed to ${event} events on ${channel}`,
            details: {
              channel,
              event,
              filter: filter || "none",
              createdAt: new Date().toISOString()
            }
          }, null, 2)
        }]
      };

    } catch (error) {
      console.error("Error setting up realtime subscription:", error);
      throw new Error(`Failed to set up realtime subscription: ${error}`);
    }
  }
);

// Realtime unsubscribe tool
server.tool(
  "supabase-realtime-unsubscribe",
  "Supabase: Unsubscribe from realtime changes",
  {
    channel: z.string().describe("Channel name")
  },
  async ({ channel }) => {
    try {
      // Find all subscriptions for this channel
      const subscriptionsToRemove = Array.from(realtimeSubscriptions.entries())
        .filter(([_, sub]) => sub.channel === channel);

      if (subscriptionsToRemove.length === 0) {
        throw new Error(`No active subscriptions found for channel: ${channel}`);
      }

      // Remove triggers and functions
      for (const [id, subscription] of subscriptionsToRemove) {
        // Drop trigger
        await pool.query(`
          DROP TRIGGER IF EXISTS ${subscription.triggerName}
          ON "${channel}";
        `);

        // Drop function
        await pool.query(`
          DROP FUNCTION IF EXISTS ${subscription.triggerFunction};
        `);

        // Remove from subscriptions map
        realtimeSubscriptions.delete(id);
      }

      // Unsubscribe from LISTEN
      const client = await pool.connect();
      await client.query(`UNLISTEN "${channel}"`);
      client.release();

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            message: `Successfully unsubscribed from ${channel}`,
            details: {
              channel,
              removedSubscriptions: subscriptionsToRemove.length,
              timestamp: new Date().toISOString()
            }
          }, null, 2)
        }]
      };

    } catch (error) {
      console.error("Error removing realtime subscription:", error);
      throw new Error(`Failed to remove realtime subscription: ${error}`);
    }
  }
);

// Add realtime list subscriptions tool
server.tool(
  "supabase-realtime-list",
  "Supabase: List active realtime subscriptions",
  { _dummy: z.string() },
  async () => {
    try {
      const subscriptions = Array.from(realtimeSubscriptions.entries()).map(([id, sub]) => ({
        id,
        channel: sub.channel,
        event: sub.event,
        filter: sub.filter || "none",
        createdAt: sub.createdAt
      }));

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            activeSubscriptions: subscriptions,
            total: subscriptions.length
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error("Error listing realtime subscriptions:", error);
      throw new Error(`Failed to list realtime subscriptions: ${error}`);
    }
  }
);

// Start the server using stdio transport
async function main() {
  // Test database connection
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
    // Keep the process alive
    process.stdin.resume();
  } catch (error) {
    console.error("Failed to start server:", error);
    await cleanup();
  }
}

// Cleanup function
async function cleanup() {
  try {
    await pool.end();
    console.error("PostgreSQL connection pool closed");
  } catch (error) {
    console.error("Error closing PostgreSQL connection pool:", error);
  }
  process.exit(0);
}

// Handle cleanup on exit
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
