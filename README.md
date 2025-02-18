# Supabase MCP Server 🚀

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)](https://supabase.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Node.js](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Cursor-blue?style=for-the-badge)](https://cursor.sh/)
[![Windsurf](https://img.shields.io/badge/Windsurf-Cascade-purple?style=for-the-badge)](https://www.codeium.com/cascade)

> 🔥 A powerful Model Context Protocol (MCP) server that provides full administrative control over your Supabase PostgreSQL database through both Cursor's Composer and Codeium's Cascade. This tool enables seamless database management with comprehensive features for table operations, record management, schema modifications, and more.

<div align="center">
  <img src="https://miro.medium.com/v2/resize:fit:1400/1*pnSzmFJRCJztS7tkSJXYuQ.jpeg" alt="Supabase" width="600"/>
</div>

## 🎯 Integrations

### Cursor MCP Integration

The server can be integrated with Cursor's Composer feature, providing direct access to all database management tools through natural language commands. See the [Setting up in Cursor](#-setting-up-in-cursor) section for configuration details.

### Windsurf/Cascade Integration

This MCP server also supports Codeium's Cascade (Windsurf) integration. Note that this feature is currently only available for paying individual users.

#### Setting up with Cascade

1. Create or edit `~/.codeium/windsurf/mcp_config.json`:
   ```json
   {
     "mcpServers": {
       "supabase-mcp": {
         "command": "/usr/local/bin/node",
         "args": [
           "/path/to/dist/index.js",
           "postgresql://postgres.[PROJECT-ID]:[PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"
         ]
       }
     }
   }
   ```

2. Replace the following in the configuration:
   - `/path/to/dist/index.js` with your actual path
   - `[PROJECT-ID]` with your Supabase project ID
   - `[PASSWORD]` with your database password

3. Open Cascade and click the hammer icon in the toolbar
4. Click "Configure" to verify your setup
5. Click "Refresh" to load the MCP server

#### Important Notes for Cascade Users

- Only tools functionality is supported (no prompts or resources)
- MCP tool calls will consume credits regardless of success or failure
- Image output is not supported
- Only stdio transport type is supported

## ✨ Features

### 🎯 1. Table Operations
- `fetchtables`: List all database tables
- `createtable`: Create new tables with custom columns and constraints
- `updatetable`: Modify table properties
- `deletetable`: Drop existing tables

### 📝 2. Record Operations
- `fetchrecords`: Query table records with filtering and pagination
- `createrecord`: Insert new records
- `updaterecord`: Modify existing records
- `deleterecord`: Remove records

### 🏗️ 3. Column Operations
- `fetchcolumns`: List table columns
- `addcolumn`: Add new columns
- `updatecolumn`: Modify column properties
- `deletecolumn`: Remove columns

### 🔍 4. Index & Constraint Management
- `createindex`: Create optimization indexes
- `fetchindexes`: List table indexes
- `deleteindex`: Remove indexes
- `addconstraint`: Add table constraints
- `removeconstraint`: Remove constraints

### 👀 5. Views & Functions
- `fetchviews`: List database views
- `createview`: Create new views
- `updateview`: Modify views
- `deleteview`: Remove views
- `fetchfunctions`: List stored functions
- `createfunction`: Create functions
- `updatefunction`: Modify functions
- `deletefunction`: Remove functions

### 📊 6. Schema Management
- `fetchschemas`: List schemas
- `createschema`: Create new schemas
- `updateschema`: Modify schemas
- `deleteschema`: Remove schemas

### 🛠️ 7. Additional Features
- SQL Execution: `executesql`
- Logging: `fetchlogs`
- Change Monitoring: `monitorchanges`
- Backup & Restore: `backupdatabase`, `restoredatabase`
- Migrations: `rundbMigration`, `revertdbMigration`
- Data Import/Export: `exportdata`, `importdata`
- User Management: `fetchusers`, `createuser`, `updateuser`, `deleteuser`
- Transaction Management: `begintransaction`, `committransaction`, `rollbacktransaction`

## 🚀 Quick Start

### 📥 Installation

1. Clone the repository:
\`\`\`bash
git clone https://github.com/Quegenx/supabase-mcp-server.git
cd supabase-mcp-server
\`\`\`

2. Install dependencies:
\`\`\`bash
npm install
\`\`\`

3. Build the project:
\`\`\`bash
npm run build
\`\`\`

### ⚙️ Configuration

#### Getting Your Supabase Connection String

1. Go to your Supabase dashboard
2. Click on "Project Settings" > "Database"
3. Find the "Connection String" section
4. Select "URI" format
5. Copy the connection string that looks like:
   \`\`\`
   postgresql://postgres:[YOUR-PASSWORD]@[YOUR-PROJECT-ID].supabase.co:5432/postgres
   \`\`\`
   Where:
   - `[YOUR-PASSWORD]` is your database password
   - `[YOUR-PROJECT-ID]` is your Supabase project ID (e.g., db.abc123xyz789)
   - `5432` is the default PostgreSQL port

### 🔧 Setting up in Cursor

1. Open Cursor Settings > Features > MCP
2. Click "+ Add New MCP Server"
3. Fill in the details:
   - Name: "Supabase MCP"
   - Type: command
   - Command: `/usr/local/bin/node /path/to/mcp-postgres-full/dist/index.js postgresql://postgres.[PROJECT-ID]:[PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`

   Example of a complete command (with placeholders):
   \`\`\`bash
   /usr/local/bin/node /Users/username/Desktop/supabase-mcp-server/dist/index.js postgresql://postgres.[PROJECT-ID]:[PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
   \`\`\`
   Note: Make sure to replace:
   - `/Users/username/Desktop` with your actual path to the project
   - `[PROJECT-ID]` with your Supabase project ID
   - `[PASSWORD]` with your database password

## 📁 Project Structure

\`\`\`
├── dist/                  # Compiled JavaScript files
│   ├── index.d.ts        # TypeScript declarations
│   ├── index.js          # Main JavaScript file
├── package-lock.json     # Dependency lock file
├── package.json          # Project configuration
├── src/                  # Source code
│   ├── index.ts         # Main TypeScript file
├── tsconfig.json        # TypeScript configuration
\`\`\`

## 💡 Usage

Once configured, the MCP server provides all database management tools through Cursor's Composer. Simply describe what you want to do with your database, and the AI will use the appropriate commands.

Examples:
- 📋 "Show me all tables in my database"
- ➕ "Create a new users table with id, name, and email columns"
- 🔍 "Add an index on the email column of the users table"

## 🔒 Security Notes

- 🔐 Keep your database connection string secure
- ⚠️ Never commit sensitive credentials to version control
- 👮 Use appropriate access controls and permissions
- 🛡️ Validate and sanitize all inputs to prevent SQL injection

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

Feel free to adjust usernames, repository URLs, and other details to match your project specifics. This README provides an overview of the server's capabilities, how to set it up, and instructions for integrating with Cursor's MCP client.

---

<div align="center">
  <p>Built with ❤️ for the Cursor community</p>
  <p>
    <a href="https://cursor.sh">Cursor</a> •
    <a href="https://supabase.com">Supabase</a> •
    <a href="https://github.com/Quegenx">GitHub</a>
  </p>
</div> 