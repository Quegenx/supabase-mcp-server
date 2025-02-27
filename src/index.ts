import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import pkg from "pg";
import * as dotenv from 'dotenv';
import { allTools } from "./tools/index.js";
import { ToolHandlerParams } from "./types.js";
import { registerOptimizedTools } from "./optimized-tools.js";

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
          // Only keep tables resource
          "postgres://tables"
        ]
      },
      tools: {}
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

// Use the optimized tool registration approach instead
registerOptimizedTools(server, pool);

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
