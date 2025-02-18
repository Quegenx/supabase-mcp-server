#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import pkg from "pg";
const { Pool } = pkg;
//
// --- Helper Functions ---
//
function buildWhereClause(where) {
    const keys = Object.keys(where);
    const clauses = keys.map((key, index) => `${key} = $${index + 1}`);
    const values = keys.map((key) => where[key]);
    return { clause: clauses.join(" AND "), values };
}
function buildSetClause(record, startIndex = 1) {
    const keys = Object.keys(record);
    const clauses = keys.map((key, index) => `${key} = $${index + startIndex}`);
    const values = keys.map((key) => record[key]);
    return { clause: clauses.join(", "), values };
}
function buildInsertQuery(tableName, record) {
    const keys = Object.keys(record);
    const columns = keys.join(", ");
    const placeholders = keys.map((_, index) => `$${index + 1}`).join(", ");
    const sql = `INSERT INTO ${tableName} (${columns}) VALUES (${placeholders})`;
    return { sql, values: keys.map((key) => record[key]) };
}
//
// --- Create Server and DB Pool ---
//
const server = new Server({
    name: "mcp-postgres-full",
    version: "1.0.0",
}, {
    capabilities: {
        resources: {},
        tools: {
            query: true,
            fetchTables: true,
            createTable: true,
            updateTable: true,
            deleteTable: true,
            fetchRecords: true,
            createRecord: true,
            updateRecord: true,
            deleteRecord: true,
            fetchColumns: true,
            addColumn: true,
            updateColumn: true,
            deleteColumn: true,
            createIndex: true,
            fetchIndexes: true,
            deleteIndex: true,
            addConstraint: true,
            removeConstraint: true,
            fetchViews: true,
            createView: true,
            updateView: true,
            deleteView: true,
            fetchFunctions: true,
            createFunction: true,
            updateFunction: true,
            deleteFunction: true,
            fetchSchemas: true,
            createSchema: true,
            updateSchema: true,
            deleteSchema: true,
            executeSQL: true,
            fetchLogs: true,
            monitorChanges: true,
            backupDatabase: true,
            restoreDatabase: true,
            runDbMigration: true,
            revertDbMigration: true,
            exportData: true,
            importData: true,
            fetchUsers: true,
            createUser: true,
            updateUser: true,
            deleteUser: true,
            beginTransaction: true,
            commitTransaction: true,
            rollbackTransaction: true,
        },
    },
});
const args = process.argv.slice(2);
if (args.length === 0) {
    console.error("Please provide a database URL as a command-line argument");
    process.exit(1);
}
const databaseUrl = args[0];
const resourceBaseUrl = new URL(databaseUrl);
resourceBaseUrl.protocol = "postgres:";
resourceBaseUrl.password = "";
const pool = new Pool({
    connectionString: databaseUrl,
});
const SCHEMA_PATH = "schema";
//
// --- Resource Handlers ---
//
server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const client = await pool.connect();
    try {
        const result = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
        return {
            resources: result.rows.map((row) => ({
                uri: new URL(`${row.table_name}/${SCHEMA_PATH}`, resourceBaseUrl).href,
                mimeType: "application/json",
                name: `"${row.table_name}" database schema`,
            })),
        };
    }
    finally {
        client.release();
    }
});
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const resourceUrl = new URL(request.params.uri);
    const pathComponents = resourceUrl.pathname.split("/");
    const schema = pathComponents.pop();
    const tableName = pathComponents.pop();
    if (schema !== SCHEMA_PATH) {
        throw new Error("Invalid resource URI");
    }
    const client = await pool.connect();
    try {
        const result = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1", [tableName]);
        return {
            contents: [
                {
                    uri: request.params.uri,
                    mimeType: "application/json",
                    text: JSON.stringify(result.rows, null, 2),
                },
            ],
        };
    }
    finally {
        client.release();
    }
});
//
// --- List Tools Handler ---
//
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "query",
                description: "Run SQL queries (read and write)",
                inputSchema: {
                    type: "object",
                    properties: { sql: { type: "string" } },
                    required: ["sql"],
                },
            },
            {
                name: "fetchTables",
                description: "List all tables and optionally their columns",
                inputSchema: {
                    type: "object",
                    properties: {
                        includeColumns: { type: "boolean", optional: true },
                        schema: { type: "string", optional: true },
                    },
                },
            },
            {
                name: "createTable",
                description: "Create a new table",
                inputSchema: {
                    type: "object",
                    properties: {
                        tableName: { type: "string" },
                        columns: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    name: { type: "string" },
                                    type: { type: "string" },
                                    constraints: { type: "string", optional: true },
                                },
                                required: ["name", "type"],
                            },
                        },
                    },
                    required: ["tableName", "columns"],
                },
            },
            {
                name: "updateTable",
                description: "Alter an existing table",
                inputSchema: {
                    type: "object",
                    properties: {
                        tableName: { type: "string" },
                        operations: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    operation: {
                                        type: "string",
                                        enum: ["ADD", "DROP", "ALTER", "RENAME"],
                                    },
                                    columnName: { type: "string" },
                                    newName: { type: "string", optional: true },
                                    dataType: { type: "string", optional: true },
                                    constraints: { type: "string", optional: true },
                                },
                                required: ["operation", "columnName"],
                            },
                        },
                    },
                    required: ["tableName", "operations"],
                },
            },
            {
                name: "deleteTable",
                description: "Drop a table",
                inputSchema: {
                    type: "object",
                    properties: {
                        tableName: { type: "string" },
                        cascade: { type: "boolean", optional: true },
                    },
                    required: ["tableName"],
                },
            },
            // Row/Record Operations
            {
                name: "fetchRecords",
                description: "Retrieve rows from a table with optional filtering",
                inputSchema: {
                    type: "object",
                    properties: {
                        tableName: { type: "string" },
                        where: { type: "object", optional: true },
                        limit: { type: "number", optional: true },
                        offset: { type: "number", optional: true },
                    },
                    required: ["tableName"],
                },
            },
            {
                name: "createRecord",
                description: "Insert a new record into a table",
                inputSchema: {
                    type: "object",
                    properties: {
                        tableName: { type: "string" },
                        record: { type: "object" },
                    },
                    required: ["tableName", "record"],
                },
            },
            {
                name: "updateRecord",
                description: "Update records in a table based on conditions",
                inputSchema: {
                    type: "object",
                    properties: {
                        tableName: { type: "string" },
                        record: { type: "object" },
                        where: { type: "object" },
                    },
                    required: ["tableName", "record", "where"],
                },
            },
            {
                name: "deleteRecord",
                description: "Delete records from a table based on conditions",
                inputSchema: {
                    type: "object",
                    properties: {
                        tableName: { type: "string" },
                        where: { type: "object" },
                    },
                    required: ["tableName", "where"],
                },
            },
            // Column Operations
            {
                name: "fetchColumns",
                description: "List all columns for a given table",
                inputSchema: {
                    type: "object",
                    properties: { tableName: { type: "string" } },
                    required: ["tableName"],
                },
            },
            {
                name: "addColumn",
                description: "Add a new column to an existing table",
                inputSchema: {
                    type: "object",
                    properties: {
                        tableName: { type: "string" },
                        columnName: { type: "string" },
                        dataType: { type: "string" },
                        constraints: { type: "string", optional: true },
                    },
                    required: ["tableName", "columnName", "dataType"],
                },
            },
            {
                name: "updateColumn",
                description: "Update a column's properties",
                inputSchema: {
                    type: "object",
                    properties: {
                        tableName: { type: "string" },
                        columnName: { type: "string" },
                        newName: { type: "string", optional: true },
                        dataType: { type: "string", optional: true },
                        constraints: { type: "string", optional: true },
                    },
                    required: ["tableName", "columnName"],
                },
            },
            {
                name: "deleteColumn",
                description: "Delete a column from a table",
                inputSchema: {
                    type: "object",
                    properties: {
                        tableName: { type: "string" },
                        columnName: { type: "string" },
                    },
                    required: ["tableName", "columnName"],
                },
            },
            // Index and Constraint Management
            {
                name: "createIndex",
                description: "Create an index on a table",
                inputSchema: {
                    type: "object",
                    properties: {
                        tableName: { type: "string" },
                        indexName: { type: "string" },
                        columns: { type: "array", items: { type: "string" } },
                        unique: { type: "boolean", optional: true },
                    },
                    required: ["tableName", "indexName", "columns"],
                },
            },
            {
                name: "fetchIndexes",
                description: "Fetch indexes on a table",
                inputSchema: {
                    type: "object",
                    properties: { tableName: { type: "string" } },
                    required: ["tableName"],
                },
            },
            {
                name: "deleteIndex",
                description: "Drop an index",
                inputSchema: {
                    type: "object",
                    properties: { indexName: { type: "string" } },
                    required: ["indexName"],
                },
            },
            {
                name: "addConstraint",
                description: "Add a constraint to a table",
                inputSchema: {
                    type: "object",
                    properties: {
                        tableName: { type: "string" },
                        constraintName: { type: "string" },
                        definition: { type: "string" },
                    },
                    required: ["tableName", "constraintName", "definition"],
                },
            },
            {
                name: "removeConstraint",
                description: "Remove a constraint from a table",
                inputSchema: {
                    type: "object",
                    properties: {
                        tableName: { type: "string" },
                        constraintName: { type: "string" },
                    },
                    required: ["tableName", "constraintName"],
                },
            },
            // View and Function Operations
            {
                name: "fetchViews",
                description: "List all views in a schema",
                inputSchema: {
                    type: "object",
                    properties: { schema: { type: "string", optional: true } },
                },
            },
            {
                name: "createView",
                description: "Create a new view",
                inputSchema: {
                    type: "object",
                    properties: {
                        viewName: { type: "string" },
                        definition: { type: "string" },
                    },
                    required: ["viewName", "definition"],
                },
            },
            {
                name: "updateView",
                description: "Update an existing view",
                inputSchema: {
                    type: "object",
                    properties: {
                        viewName: { type: "string" },
                        definition: { type: "string" },
                    },
                    required: ["viewName", "definition"],
                },
            },
            {
                name: "deleteView",
                description: "Drop a view",
                inputSchema: {
                    type: "object",
                    properties: { viewName: { type: "string" } },
                    required: ["viewName"],
                },
            },
            {
                name: "fetchFunctions",
                description: "List stored functions/procedures",
                inputSchema: {
                    type: "object",
                    properties: { schema: { type: "string", optional: true } },
                },
            },
            {
                name: "createFunction",
                description: "Create a new function",
                inputSchema: {
                    type: "object",
                    properties: {
                        functionDefinition: { type: "string" },
                    },
                    required: ["functionDefinition"],
                },
            },
            {
                name: "updateFunction",
                description: "Update an existing function",
                inputSchema: {
                    type: "object",
                    properties: {
                        functionName: { type: "string" },
                        functionDefinition: { type: "string" },
                    },
                    required: ["functionName", "functionDefinition"],
                },
            },
            {
                name: "deleteFunction",
                description: "Delete a function",
                inputSchema: {
                    type: "object",
                    properties: { functionName: { type: "string" } },
                    required: ["functionName"],
                },
            },
            // Schema Management
            {
                name: "fetchSchemas",
                description: "List all database schemas",
                inputSchema: { type: "object", properties: {} },
            },
            {
                name: "createSchema",
                description: "Create a new schema",
                inputSchema: {
                    type: "object",
                    properties: { schemaName: { type: "string" } },
                    required: ["schemaName"],
                },
            },
            {
                name: "updateSchema",
                description: "Rename a schema",
                inputSchema: {
                    type: "object",
                    properties: {
                        oldName: { type: "string" },
                        newName: { type: "string" },
                    },
                    required: ["oldName", "newName"],
                },
            },
            {
                name: "deleteSchema",
                description: "Drop a schema",
                inputSchema: {
                    type: "object",
                    properties: {
                        schemaName: { type: "string" },
                        cascade: { type: "boolean", optional: true },
                    },
                    required: ["schemaName"],
                },
            },
            // General SQL Execution
            {
                name: "executeSQL",
                description: "Execute an arbitrary SQL command",
                inputSchema: {
                    type: "object",
                    properties: { sql: { type: "string" } },
                    required: ["sql"],
                },
            },
            // Logging/Monitoring
            {
                name: "fetchLogs",
                description: "Fetch recent activity logs (using pg_stat_activity)",
                inputSchema: { type: "object", properties: {} },
            },
            {
                name: "monitorChanges",
                description: "Monitor changes (not implemented)",
                inputSchema: { type: "object", properties: {} },
            },
            // Backup/Restore
            {
                name: "backupDatabase",
                description: "Backup the database (not implemented)",
                inputSchema: { type: "object", properties: {} },
            },
            {
                name: "restoreDatabase",
                description: "Restore the database (not implemented)",
                inputSchema: { type: "object", properties: {} },
            },
            // Migration & Data Import/Export
            {
                name: "runDbMigration",
                description: "Run a database migration",
                inputSchema: {
                    type: "object",
                    properties: { migrationSQL: { type: "string" } },
                    required: ["migrationSQL"],
                },
            },
            {
                name: "revertDbMigration",
                description: "Revert a database migration",
                inputSchema: {
                    type: "object",
                    properties: { migrationSQL: { type: "string" } },
                    required: ["migrationSQL"],
                },
            },
            {
                name: "exportData",
                description: "Export table data in JSON format",
                inputSchema: {
                    type: "object",
                    properties: { tableName: { type: "string" } },
                    required: ["tableName"],
                },
            },
            {
                name: "importData",
                description: "Import data into a table from JSON",
                inputSchema: {
                    type: "object",
                    properties: {
                        tableName: { type: "string" },
                        records: { type: "array", items: { type: "object" } },
                    },
                    required: ["tableName", "records"],
                },
            },
            // User Management
            {
                name: "fetchUsers",
                description: "List database users",
                inputSchema: { type: "object", properties: {} },
            },
            {
                name: "createUser",
                description: "Create a new database user",
                inputSchema: {
                    type: "object",
                    properties: {
                        username: { type: "string" },
                        password: { type: "string" },
                    },
                    required: ["username", "password"],
                },
            },
            {
                name: "updateUser",
                description: "Update a database user's properties",
                inputSchema: {
                    type: "object",
                    properties: {
                        username: { type: "string" },
                        newPassword: { type: "string", optional: true },
                    },
                    required: ["username"],
                },
            },
            {
                name: "deleteUser",
                description: "Delete a database user",
                inputSchema: {
                    type: "object",
                    properties: { username: { type: "string" } },
                    required: ["username"],
                },
            },
            // Transaction Management (stateless—placeholder)
            {
                name: "beginTransaction",
                description: "Begin a transaction (not supported in stateless mode)",
                inputSchema: { type: "object", properties: {} },
            },
            {
                name: "commitTransaction",
                description: "Commit a transaction (not supported in stateless mode)",
                inputSchema: { type: "object", properties: {} },
            },
            {
                name: "rollbackTransaction",
                description: "Rollback a transaction (not supported in stateless mode)",
                inputSchema: { type: "object", properties: {} },
            },
        ],
    };
});
//
// --- Call Tool Handler ---
//
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const client = await pool.connect();
    try {
        switch (request.params.name) {
            case "query": {
                const sql = request.params.arguments?.sql;
                await client.query("BEGIN");
                const result = await client.query(sql);
                await client.query("COMMIT");
                return {
                    content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }],
                    isError: false,
                };
            }
            case "fetchTables": {
                const { includeColumns = true, schema = "public" } = request.params.arguments;
                let result;
                if (includeColumns) {
                    result = await client.query(`
            SELECT 
              t.table_name,
              array_agg(
                json_build_object(
                  'column_name', c.column_name,
                  'data_type', c.data_type,
                  'is_nullable', c.is_nullable,
                  'column_default', c.column_default
                )
              ) as columns
            FROM information_schema.tables t
            LEFT JOIN information_schema.columns c 
              ON t.table_name = c.table_name 
              AND t.table_schema = c.table_schema
            WHERE t.table_schema = $1
            GROUP BY t.table_name
          `, [schema]);
                }
                else {
                    result = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = $1", [schema]);
                }
                return {
                    content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }],
                    isError: false,
                };
            }
            case "createTable": {
                const { tableName, columns } = request.params.arguments;
                await client.query("BEGIN");
                try {
                    const columnDefs = columns
                        .map((col) => `${col.name} ${col.type}${col.constraints ? " " + col.constraints : ""}`)
                        .join(", ");
                    const sql = `CREATE TABLE ${tableName} (${columnDefs})`;
                    await client.query(sql);
                    await client.query("COMMIT");
                    return {
                        content: [{ type: "text", text: `Table ${tableName} created successfully` }],
                        isError: false,
                    };
                }
                catch (error) {
                    await client.query("ROLLBACK");
                    throw error;
                }
            }
            case "updateTable": {
                const { tableName, operations } = request.params.arguments;
                await client.query("BEGIN");
                try {
                    const alterStatements = operations.map((op) => {
                        switch (op.operation) {
                            case "ADD":
                                return `ADD COLUMN ${op.columnName} ${op.dataType}${op.constraints ? " " + op.constraints : ""}`;
                            case "DROP":
                                return `DROP COLUMN ${op.columnName}`;
                            case "ALTER":
                                return `ALTER COLUMN ${op.columnName} TYPE ${op.dataType}${op.constraints ? " " + op.constraints : ""}`;
                            case "RENAME":
                                return `RENAME COLUMN ${op.columnName} TO ${op.newName}`;
                            default:
                                throw new Error(`Unknown operation: ${op.operation}`);
                        }
                    });
                    const sql = `ALTER TABLE ${tableName} ${alterStatements.join(", ")}`;
                    await client.query(sql);
                    await client.query("COMMIT");
                    return {
                        content: [{ type: "text", text: `Table ${tableName} altered successfully` }],
                        isError: false,
                    };
                }
                catch (error) {
                    await client.query("ROLLBACK");
                    throw error;
                }
            }
            case "deleteTable": {
                const { tableName, cascade } = request.params.arguments;
                await client.query("BEGIN");
                try {
                    const sql = `DROP TABLE ${tableName}${cascade ? " CASCADE" : ""}`;
                    await client.query(sql);
                    await client.query("COMMIT");
                    return {
                        content: [{ type: "text", text: `Table ${tableName} dropped successfully` }],
                        isError: false,
                    };
                }
                catch (error) {
                    await client.query("ROLLBACK");
                    throw error;
                }
            }
            // Row/Record Operations
            case "fetchRecords": {
                const { tableName, where, limit, offset } = request.params.arguments;
                let sql = `SELECT * FROM ${tableName}`;
                let values = [];
                if (where && Object.keys(where).length > 0) {
                    const whereClause = buildWhereClause(where);
                    sql += ` WHERE ${whereClause.clause}`;
                    values = whereClause.values;
                }
                if (limit) {
                    sql += ` LIMIT ${limit}`;
                }
                if (offset) {
                    sql += ` OFFSET ${offset}`;
                }
                const result = await client.query(sql, values);
                return {
                    content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }],
                    isError: false,
                };
            }
            case "createRecord": {
                const { tableName, record } = request.params.arguments;
                await client.query("BEGIN");
                try {
                    const { sql, values } = buildInsertQuery(tableName, record);
                    await client.query(sql, values);
                    await client.query("COMMIT");
                    return {
                        content: [{ type: "text", text: `Record inserted into ${tableName}` }],
                        isError: false,
                    };
                }
                catch (error) {
                    await client.query("ROLLBACK");
                    throw error;
                }
            }
            case "updateRecord": {
                const { tableName, record, where } = request.params.arguments;
                await client.query("BEGIN");
                try {
                    const setClause = buildSetClause(record);
                    const whereClause = buildWhereClause(where);
                    const sql = `UPDATE ${tableName} SET ${setClause.clause} WHERE ${whereClause.clause}`;
                    const values = [...setClause.values, ...whereClause.values];
                    await client.query(sql, values);
                    await client.query("COMMIT");
                    return {
                        content: [{ type: "text", text: `Record(s) updated in ${tableName}` }],
                        isError: false,
                    };
                }
                catch (error) {
                    await client.query("ROLLBACK");
                    throw error;
                }
            }
            case "deleteRecord": {
                const { tableName, where } = request.params.arguments;
                await client.query("BEGIN");
                try {
                    const whereClause = buildWhereClause(where);
                    const sql = `DELETE FROM ${tableName} WHERE ${whereClause.clause}`;
                    await client.query(sql, whereClause.values);
                    await client.query("COMMIT");
                    return {
                        content: [{ type: "text", text: `Record(s) deleted from ${tableName}` }],
                        isError: false,
                    };
                }
                catch (error) {
                    await client.query("ROLLBACK");
                    throw error;
                }
            }
            // Column Operations
            case "fetchColumns": {
                const { tableName } = request.params.arguments;
                const result = await client.query("SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = $1", [tableName]);
                return {
                    content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }],
                    isError: false,
                };
            }
            case "addColumn": {
                const { tableName, columnName, dataType, constraints } = request.params
                    .arguments;
                await client.query("BEGIN");
                try {
                    const sql = `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${dataType}${constraints ? " " + constraints : ""}`;
                    await client.query(sql);
                    await client.query("COMMIT");
                    return {
                        content: [{ type: "text", text: `Column ${columnName} added to ${tableName}` }],
                        isError: false,
                    };
                }
                catch (error) {
                    await client.query("ROLLBACK");
                    throw error;
                }
            }
            case "updateColumn": {
                const { tableName, columnName, newName, dataType, constraints } = request.params
                    .arguments;
                await client.query("BEGIN");
                try {
                    let sql = `ALTER TABLE ${tableName}`;
                    if (newName) {
                        sql += ` RENAME COLUMN ${columnName} TO ${newName}`;
                    }
                    else if (dataType) {
                        sql += ` ALTER COLUMN ${columnName} TYPE ${dataType}`;
                    }
                    else {
                        throw new Error("No update operation specified for column");
                    }
                    // Note: constraints update would need additional logic
                    await client.query(sql);
                    await client.query("COMMIT");
                    return {
                        content: [{ type: "text", text: `Column ${columnName} updated in ${tableName}` }],
                        isError: false,
                    };
                }
                catch (error) {
                    await client.query("ROLLBACK");
                    throw error;
                }
            }
            case "deleteColumn": {
                const { tableName, columnName } = request.params.arguments;
                await client.query("BEGIN");
                try {
                    const sql = `ALTER TABLE ${tableName} DROP COLUMN ${columnName}`;
                    await client.query(sql);
                    await client.query("COMMIT");
                    return {
                        content: [{ type: "text", text: `Column ${columnName} dropped from ${tableName}` }],
                        isError: false,
                    };
                }
                catch (error) {
                    await client.query("ROLLBACK");
                    throw error;
                }
            }
            // Index and Constraint Management
            case "createIndex": {
                const { tableName, indexName, columns, unique } = request.params.arguments;
                await client.query("BEGIN");
                try {
                    const uniqueStr = unique ? "UNIQUE" : "";
                    const cols = columns.join(", ");
                    const sql = `CREATE ${uniqueStr} INDEX ${indexName} ON ${tableName} (${cols})`;
                    await client.query(sql);
                    await client.query("COMMIT");
                    return {
                        content: [{ type: "text", text: `Index ${indexName} created on ${tableName}` }],
                        isError: false,
                    };
                }
                catch (error) {
                    await client.query("ROLLBACK");
                    throw error;
                }
            }
            case "fetchIndexes": {
                const { tableName } = request.params.arguments;
                const sql = `
          SELECT indexname, indexdef 
          FROM pg_indexes 
          WHERE tablename = $1
        `;
                const result = await client.query(sql, [tableName]);
                return {
                    content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }],
                    isError: false,
                };
            }
            case "deleteIndex": {
                const { indexName } = request.params.arguments;
                await client.query("BEGIN");
                try {
                    const sql = `DROP INDEX ${indexName}`;
                    await client.query(sql);
                    await client.query("COMMIT");
                    return {
                        content: [{ type: "text", text: `Index ${indexName} dropped` }],
                        isError: false,
                    };
                }
                catch (error) {
                    await client.query("ROLLBACK");
                    throw error;
                }
            }
            case "addConstraint": {
                const { tableName, constraintName, definition } = request.params.arguments;
                await client.query("BEGIN");
                try {
                    const sql = `ALTER TABLE ${tableName} ADD CONSTRAINT ${constraintName} ${definition}`;
                    await client.query(sql);
                    await client.query("COMMIT");
                    return {
                        content: [
                            { type: "text", text: `Constraint ${constraintName} added to ${tableName}` },
                        ],
                        isError: false,
                    };
                }
                catch (error) {
                    await client.query("ROLLBACK");
                    throw error;
                }
            }
            case "removeConstraint": {
                const { tableName, constraintName } = request.params.arguments;
                await client.query("BEGIN");
                try {
                    const sql = `ALTER TABLE ${tableName} DROP CONSTRAINT ${constraintName}`;
                    await client.query(sql);
                    await client.query("COMMIT");
                    return {
                        content: [
                            { type: "text", text: `Constraint ${constraintName} removed from ${tableName}` },
                        ],
                        isError: false,
                    };
                }
                catch (error) {
                    await client.query("ROLLBACK");
                    throw error;
                }
            }
            // View and Function Operations
            case "fetchViews": {
                const { schema = "public" } = request.params.arguments;
                const sql = `
          SELECT table_name AS view_name
          FROM information_schema.views 
          WHERE table_schema = $1
        `;
                const result = await client.query(sql, [schema]);
                return {
                    content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }],
                    isError: false,
                };
            }
            case "createView": {
                const { viewName, definition } = request.params.arguments;
                await client.query("BEGIN");
                try {
                    const sql = `CREATE VIEW ${viewName} AS ${definition}`;
                    await client.query(sql);
                    await client.query("COMMIT");
                    return {
                        content: [{ type: "text", text: `View ${viewName} created successfully` }],
                        isError: false,
                    };
                }
                catch (error) {
                    await client.query("ROLLBACK");
                    throw error;
                }
            }
            case "updateView": {
                const { viewName, definition } = request.params.arguments;
                await client.query("BEGIN");
                try {
                    const sql = `CREATE OR REPLACE VIEW ${viewName} AS ${definition}`;
                    await client.query(sql);
                    await client.query("COMMIT");
                    return {
                        content: [{ type: "text", text: `View ${viewName} updated successfully` }],
                        isError: false,
                    };
                }
                catch (error) {
                    await client.query("ROLLBACK");
                    throw error;
                }
            }
            case "deleteView": {
                const { viewName } = request.params.arguments;
                await client.query("BEGIN");
                try {
                    const sql = `DROP VIEW ${viewName}`;
                    await client.query(sql);
                    await client.query("COMMIT");
                    return {
                        content: [{ type: "text", text: `View ${viewName} dropped successfully` }],
                        isError: false,
                    };
                }
                catch (error) {
                    await client.query("ROLLBACK");
                    throw error;
                }
            }
            case "fetchFunctions": {
                const { schema = "public" } = request.params.arguments;
                const sql = `
          SELECT proname, prosrc 
          FROM pg_proc 
          JOIN pg_namespace ns ON pg_proc.pronamespace = ns.oid
          WHERE ns.nspname = $1
        `;
                const result = await client.query(sql, [schema]);
                return {
                    content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }],
                    isError: false,
                };
            }
            case "createFunction": {
                const { functionDefinition } = request.params.arguments;
                await client.query("BEGIN");
                try {
                    await client.query(functionDefinition);
                    await client.query("COMMIT");
                    return {
                        content: [{ type: "text", text: `Function created successfully` }],
                        isError: false,
                    };
                }
                catch (error) {
                    await client.query("ROLLBACK");
                    throw error;
                }
            }
            case "updateFunction": {
                const { functionName, functionDefinition } = request.params.arguments;
                await client.query("BEGIN");
                try {
                    // Using CREATE OR REPLACE for function update
                    await client.query(functionDefinition);
                    await client.query("COMMIT");
                    return {
                        content: [{ type: "text", text: `Function ${functionName} updated successfully` }],
                        isError: false,
                    };
                }
                catch (error) {
                    await client.query("ROLLBACK");
                    throw error;
                }
            }
            case "deleteFunction": {
                const { functionName } = request.params.arguments;
                await client.query("BEGIN");
                try {
                    const sql = `DROP FUNCTION ${functionName}`;
                    await client.query(sql);
                    await client.query("COMMIT");
                    return {
                        content: [{ type: "text", text: `Function ${functionName} dropped successfully` }],
                        isError: false,
                    };
                }
                catch (error) {
                    await client.query("ROLLBACK");
                    throw error;
                }
            }
            // Schema Management
            case "fetchSchemas": {
                const sql = `SELECT schema_name FROM information_schema.schemata`;
                const result = await client.query(sql);
                return {
                    content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }],
                    isError: false,
                };
            }
            case "createSchema": {
                const { schemaName } = request.params.arguments;
                await client.query("BEGIN");
                try {
                    const sql = `CREATE SCHEMA ${schemaName}`;
                    await client.query(sql);
                    await client.query("COMMIT");
                    return {
                        content: [{ type: "text", text: `Schema ${schemaName} created successfully` }],
                        isError: false,
                    };
                }
                catch (error) {
                    await client.query("ROLLBACK");
                    throw error;
                }
            }
            case "updateSchema": {
                const { oldName, newName } = request.params.arguments;
                await client.query("BEGIN");
                try {
                    const sql = `ALTER SCHEMA ${oldName} RENAME TO ${newName}`;
                    await client.query(sql);
                    await client.query("COMMIT");
                    return {
                        content: [{ type: "text", text: `Schema renamed from ${oldName} to ${newName}` }],
                        isError: false,
                    };
                }
                catch (error) {
                    await client.query("ROLLBACK");
                    throw error;
                }
            }
            case "deleteSchema": {
                const { schemaName, cascade } = request.params.arguments;
                await client.query("BEGIN");
                try {
                    const sql = `DROP SCHEMA ${schemaName}${cascade ? " CASCADE" : ""}`;
                    await client.query(sql);
                    await client.query("COMMIT");
                    return {
                        content: [{ type: "text", text: `Schema ${schemaName} dropped successfully` }],
                        isError: false,
                    };
                }
                catch (error) {
                    await client.query("ROLLBACK");
                    throw error;
                }
            }
            // General SQL Execution
            case "executeSQL": {
                const sql = request.params.arguments?.sql;
                await client.query("BEGIN");
                const result = await client.query(sql);
                await client.query("COMMIT");
                return {
                    content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }],
                    isError: false,
                };
            }
            // Logging/Monitoring
            case "fetchLogs": {
                // Using pg_stat_activity as a placeholder for logs
                const sql = `SELECT * FROM pg_stat_activity`;
                const result = await client.query(sql);
                return {
                    content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }],
                    isError: false,
                };
            }
            case "monitorChanges": {
                return {
                    content: [{ type: "text", text: "Monitoring changes not implemented" }],
                    isError: false,
                };
            }
            // Backup/Restore (stubs)
            case "backupDatabase": {
                return {
                    content: [{ type: "text", text: "Backup operation not implemented" }],
                    isError: false,
                };
            }
            case "restoreDatabase": {
                return {
                    content: [{ type: "text", text: "Restore operation not implemented" }],
                    isError: false,
                };
            }
            // Migration & Data Import/Export
            case "runDbMigration": {
                const { migrationSQL } = request.params.arguments;
                await client.query("BEGIN");
                try {
                    await client.query(migrationSQL);
                    await client.query("COMMIT");
                    return {
                        content: [{ type: "text", text: "Migration applied successfully" }],
                        isError: false,
                    };
                }
                catch (error) {
                    await client.query("ROLLBACK");
                    throw error;
                }
            }
            case "revertDbMigration": {
                const { migrationSQL } = request.params.arguments;
                await client.query("BEGIN");
                try {
                    await client.query(migrationSQL);
                    await client.query("COMMIT");
                    return {
                        content: [{ type: "text", text: "Migration reverted successfully" }],
                        isError: false,
                    };
                }
                catch (error) {
                    await client.query("ROLLBACK");
                    throw error;
                }
            }
            case "exportData": {
                const { tableName } = request.params.arguments;
                const sql = `SELECT * FROM ${tableName}`;
                const result = await client.query(sql);
                return {
                    content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }],
                    isError: false,
                };
            }
            case "importData": {
                const { tableName, records } = request.params.arguments;
                await client.query("BEGIN");
                try {
                    for (const record of records) {
                        const { sql, values } = buildInsertQuery(tableName, record);
                        await client.query(sql, values);
                    }
                    await client.query("COMMIT");
                    return {
                        content: [{ type: "text", text: `Data imported into ${tableName}` }],
                        isError: false,
                    };
                }
                catch (error) {
                    await client.query("ROLLBACK");
                    throw error;
                }
            }
            // User Management
            case "fetchUsers": {
                const sql = `SELECT usename FROM pg_catalog.pg_user`;
                const result = await client.query(sql);
                return {
                    content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }],
                    isError: false,
                };
            }
            case "createUser": {
                const { username, password } = request.params.arguments;
                await client.query("BEGIN");
                try {
                    const sql = `CREATE USER ${username} WITH PASSWORD '${password}'`;
                    await client.query(sql);
                    await client.query("COMMIT");
                    return {
                        content: [{ type: "text", text: `User ${username} created` }],
                        isError: false,
                    };
                }
                catch (error) {
                    await client.query("ROLLBACK");
                    throw error;
                }
            }
            case "updateUser": {
                const { username, newPassword } = request.params.arguments;
                if (!newPassword) {
                    throw new Error("No update operation specified for user");
                }
                await client.query("BEGIN");
                try {
                    const sql = `ALTER USER ${username} WITH PASSWORD '${newPassword}'`;
                    await client.query(sql);
                    await client.query("COMMIT");
                    return {
                        content: [{ type: "text", text: `User ${username} updated` }],
                        isError: false,
                    };
                }
                catch (error) {
                    await client.query("ROLLBACK");
                    throw error;
                }
            }
            case "deleteUser": {
                const { username } = request.params.arguments;
                await client.query("BEGIN");
                try {
                    const sql = `DROP USER ${username}`;
                    await client.query(sql);
                    await client.query("COMMIT");
                    return {
                        content: [{ type: "text", text: `User ${username} deleted` }],
                        isError: false,
                    };
                }
                catch (error) {
                    await client.query("ROLLBACK");
                    throw error;
                }
            }
            // Transaction Management (placeholders)
            case "beginTransaction":
            case "commitTransaction":
            case "rollbackTransaction": {
                return {
                    content: [
                        { type: "text", text: "Transaction management is not supported in stateless mode" },
                    ],
                    isError: false,
                };
            }
            default:
                throw new Error(`Unknown tool: ${request.params.name}`);
        }
    }
    catch (error) {
        throw error;
    }
    finally {
        client.release();
    }
});
async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
runServer().catch(console.error);
