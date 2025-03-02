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

## 📚 Table of Contents
- [Prerequisites](#-prerequisites)
- [Quick Start](#-quick-start)
- [Integrations](#-integrations)
- [Features](#-features)
- [Usage](#-usage)
- [Security Notes](#-security-notes)
- [Troubleshooting](#-troubleshooting)
- [Contributing](#-contributing)
- [License](#-license)

## 🔧 Prerequisites

- Node.js >= 16.x
- npm >= 8.x
- A Supabase project with:
  - Project ID
  - Database password
  - PostgreSQL connection string
- Cursor IDE or Codeium's Cascade (for paying users)

## 🚀 Quick Start

### 📥 Installation

```bash
# Clone the repository
git clone https://github.com/Quegenx/supabase-mcp-server.git
cd supabase-mcp-server

# Install dependencies
npm install

# Build the project
npm run build
```

### ⚙️ Configuration

1. Install dependencies and build the project:
   ```bash
   npm install
   npm run build
   ```

2. In Cursor's MCP settings, add the server with this command:
   ```bash
   /opt/homebrew/bin/node /path/to/dist/index.js postgresql://postgres.[PROJECT-ID]:[PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
   ```

   Replace:
   - `/path/to/dist/index.js` with your actual path
   - `[PROJECT-ID]` with your Supabase project ID
   - `[PASSWORD]` with your database password

Note: Keep your database credentials secure and never commit them to version control.

## 🎯 Integrations

### Cursor MCP Integration

The Model Context Protocol (MCP) allows you to provide custom tools to agentic LLMs in Cursor. This server can be integrated with Cursor's Composer feature, providing direct access to all database management tools through natural language commands.

#### Setting up in Cursor

1. Open Cursor Settings > Features > MCP
2. Click the "+ Add New MCP Server" button
3. Fill in the modal form:
   - Name: "Supabase MCP" (or any nickname you prefer)
   - Type: `command` (stdio transport)
   - Command: Your full command string with connection details

4. Build the project first:
   ```bash
   npm install
   npm run build
   ```

5. Get your Node.js path:
   ```bash
   # On Mac/Linux
   which node
   # On Windows
   where node
   ```

6. Add the server command:
   ```bash
   /path/to/node /path/to/dist/index.js postgresql://postgres.[PROJECT-ID]:[PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
   ```

   Replace:
   - `/path/to/node` with your actual Node.js path (from step 5)
   - `/path/to/dist/index.js` with your actual path to the built JavaScript file
   - `[PROJECT-ID]` with your Supabase project ID
   - `[PASSWORD]` with your database password

7. Click "Add Server" and then click the refresh button in the top right corner

#### Using the Tools in Cursor

The Composer Agent will automatically detect and use relevant tools when you describe your database tasks. For example:

- "List all tables in my database"
- "Create a new users table"
- "Add an index to the email column"

When the agent uses a tool, you'll see:
1. A prompt to approve/deny the tool call
2. The tool call arguments (expandable)
3. The response after approval

Note: For stdio servers like this one, the command should be a valid shell command. If you need environment variables, consider using a wrapper script.

### Windsurf/Cascade Integration

This MCP server also supports Codeium's Cascade (Windsurf) integration. Note that this feature is currently only available for paying individual users (not available for Teams or Enterprise users).

#### Setting up with Cascade

1. Create or edit `~/.codeium/windsurf/mcp_config.json`:
   ```json
   {
     "mcpServers": {
       "supabase-mcp": {
         "command": "/path/to/node",
         "args": [
           "/path/to/dist/index.js",
           "postgresql://postgres.[PROJECT-ID]:[PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"
         ]
       }
     }
   }
   ```

2. Quick access to config:
   - Find the toolbar above the Cascade input
   - Click the hammer icon
   - Click "Configure" to open mcp_config.json

3. Replace in the configuration:
   - `/path/to/node` with your actual Node.js path
   - `/path/to/dist/index.js` with your actual path
   - `[PROJECT-ID]` with your Supabase project ID
   - `[PASSWORD]` with your database password

4. In Cascade:
   - Click the hammer icon in the toolbar
   - Click "Configure" to verify your setup
   - Click "Refresh" to load the MCP server
   - Click the server name to see available tools

#### Important Notes for Cascade Users

- Only tools functionality is supported (no prompts or resources)
- MCP tool calls will consume credits regardless of success or failure
- Image output is not supported
- Only stdio transport type is supported
- Tool calls can invoke code written by arbitrary server implementers
- Cascade does not assume liability for MCP tool call failures

## ✨ Features

### 🎯 Available Database Tools

#### Table Management
- Tables: `list_tables`, `create_table`, `drop_table`, `rename_table`
- Columns: `add_column`, `drop_column`, `alter_column`
- Records: `fetch_records`, `create_record`, `update_record`, `delete_record`

#### Indexes & Constraints
- Indexes: `list_indexes`, `create_index`, `delete_index`, `update_index`
- Constraints: `list_constraints`, `add_constraint`, `remove_constraint`, `update_constraint`

#### Database Functions & Triggers
- Functions: `list_functions`, `create_function`, `update_function`, `delete_function`
- Triggers: `list_triggers`, `create_trigger`, `update_trigger`, `delete_trigger`

#### Security & Access Control
- Policies: `list_policies`, `create_policy`, `update_policy`, `delete_policy`
- Roles: `list_roles`, `create_role`, `update_role`, `delete_role`

#### Storage Management
- Buckets: `list_buckets`, `create_bucket`, `delete_bucket`
- Files: `delete_file`, `bulk_delete_files`
- Folders: `list_folders`

#### Data Types & Publications
- Enumerated Types: `list_enumerated_types`, `create_enumerated_type`, `update_enumerated_type`, `delete_enumerated_type`
- Publications: `list_publications`, `create_publication`, `update_publication`, `delete_publication`

#### Realtime Features
- Policies: `list_realtime_policies`, `create_realtime_policy`, `update_realtime_policy`, `delete_realtime_policy`
- Channels: `list_realtime_channels`, `manage_realtime_channels`, `send_realtime_message`, `get_realtime_messages`
- Management: `manage_realtime_status`, `manage_realtime_views`

#### User Management
- Auth: `list_users`, `create_user`, `update_user`, `delete_user`

#### Direct SQL Access
- Query: `query` - Execute custom SQL queries

### 🚀 Key Benefits

- **Natural Language Control**: Manage your Supabase database through simple conversational commands
- **Comprehensive Coverage**: Full suite of tools covering tables, records, indexes, functions, security, and more
- **Seamless Integration**: Works directly within Cursor's Composer and Codeium's Cascade
- **Developer Friendly**: Reduces context switching between IDE and database management tools
- **Secure Access**: Maintains your database security with proper authentication

## 📁 Project Structure

```
supabase-mcp-server/
├── dist/                    # Compiled JavaScript files
│   ├── index.d.ts          # TypeScript declarations
│   └── index.js            # Main JavaScript file
├── src/                    # Source code
│   └── index.ts           # Main TypeScript file
├── package.json           # Project configuration
├── package-lock.json      # Dependency lock file
└── tsconfig.json         # TypeScript configuration
```

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

## 🛠️ Troubleshooting

### Common Connection Issues

1. **Node.js Path Issues**
   - Ensure you're using the correct Node.js path
   - On Mac/Linux: Use `which node` to find the correct path
   - On Windows: Use `where node` to find the correct path
   - Replace `/usr/local/bin/node` with your actual Node.js path

2. **File Path Issues**
   - Use absolute paths instead of relative paths
   - On Mac/Linux: Use `pwd` in the project directory to get the full path
   - On Windows: Use `cd` to get the full path
   - Example: `/Users/username/projects/supabase-mcp-server/dist/index.js`

3. **MCP Not Detecting Tools**
   - Click the refresh button in Cursor's MCP settings
   - Ensure the server is running (no error messages)
   - Check if your connection string is correct
   - Verify your Supabase credentials are valid

4. **Permission Issues**
   - Make sure the `dist` directory exists (run `npm run build`)
   - Check file permissions (`chmod +x` on Unix systems)
   - Run `npm install` with appropriate permissions

### Debug Mode

Add `DEBUG=true` before your command to see detailed logs:

```bash
DEBUG=true /usr/local/bin/node /path/to/dist/index.js [connection-string]
```

### Platform-Specific Notes

#### Windows Users
```bash
# Use this format for the command
"C:\\Program Files\\nodejs\\node.exe" "C:\\path\\to\\dist\\index.js" "postgresql://..."
```

#### Linux Users
```bash
# Find Node.js path
which node

# Make script executable
chmod +x /path/to/dist/index.js
```

If you're still experiencing issues, please [open an issue](https://github.com/Quegenx/supabase-mcp-server/issues) with:
- Your operating system
- Node.js version (`node --version`)
- Full error message
- Steps to reproduce

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

---

<div align="center">
  <p>Built with ❤️ for the Cursor community</p>
  <p>
    <a href="https://cursor.sh">Cursor</a> •
    <a href="https://supabase.com">Supabase</a> •
    <a href="https://github.com/Quegenx">GitHub</a>
  </p>
</div>