import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for create-publication tool
export const createPublicationSchema = {
  name: z.string().describe("Publication name"),
  forAllTables: z.boolean().default(false).describe("Whether the publication is for all tables"),
  tables: z.array(z.object({
    schema: z.string().default("public").describe("Schema name"),
    name: z.string().describe("Table name")
  })).optional().describe("Tables to include in the publication (ignored if forAllTables is true)"),
  operations: z.object({
    insert: z.boolean().default(true).describe("Whether to publish INSERT operations"),
    update: z.boolean().default(true).describe("Whether to publish UPDATE operations"),
    delete: z.boolean().default(true).describe("Whether to publish DELETE operations"),
    truncate: z.boolean().default(false).describe("Whether to publish TRUNCATE operations")
  }).optional().describe("Operations to publish"),
  publishViaPartitionRoot: z.boolean().default(false).describe("Whether to publish changes via the partition root")
};

// Define table interface
interface PublicationTable {
  schema: string;
  name: string;
}

// Define publication info interface
interface PublicationInfo {
  name: string;
  owner: string;
  operations: {
    insert: boolean;
    update: boolean;
    delete: boolean;
    truncate: boolean;
  };
  all_tables: boolean;
  via_root: boolean;
  tables: string | PublicationTable[];
  definition?: string;
}

// Handler for create-publication tool
export const createPublicationHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      name,
      forAllTables = false,
      tables = [],
      operations = {
        insert: true,
        update: true,
        delete: true,
        truncate: false
      },
      publishViaPartitionRoot = false
    } = params as {
      name: string;
      forAllTables?: boolean;
      tables?: Array<{ schema: string; name: string }>;
      operations?: {
        insert?: boolean;
        update?: boolean;
        delete?: boolean;
        truncate?: boolean;
      };
      publishViaPartitionRoot?: boolean;
    };

    // Check if publication already exists
    const checkQuery = `SELECT 1 FROM pg_publication WHERE pubname = $1`;
    const checkResult = await pool.query(checkQuery, [name]);
    
    if (checkResult.rows.length > 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: `Publication '${name}' already exists` }, null, 2)
          }
        ]
      };
    }

    // Validate tables if not for all tables
    if (!forAllTables && (!tables || tables.length === 0)) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "Tables must be specified when not creating a publication for all tables" }, null, 2)
          }
        ]
      };
    }

    // Build the CREATE PUBLICATION statement
    let createQuery = `CREATE PUBLICATION ${name}`;
    
    // Add FOR TABLE or FOR ALL TABLES clause
    if (forAllTables) {
      createQuery += ` FOR ALL TABLES`;
    } else {
      const tableRefs = tables.map(table => {
        const schema = table.schema || 'public';
        return `${schema}.${table.name}`;
      });
      createQuery += ` FOR TABLE ${tableRefs.join(', ')}`;
    }
    
    // Add WITH clause for options
    const withOptions = [];
    
    // Add publish options
    const publishOptions = [];
    if (operations.insert) publishOptions.push('insert');
    if (operations.update) publishOptions.push('update');
    if (operations.delete) publishOptions.push('delete');
    if (operations.truncate) publishOptions.push('truncate');
    
    if (publishOptions.length > 0) {
      withOptions.push(`publish = '${publishOptions.join(', ')}'`);
    }
    
    // Add publish_via_partition_root option
    if (publishViaPartitionRoot) {
      withOptions.push(`publish_via_partition_root = true`);
    }
    
    if (withOptions.length > 0) {
      createQuery += ` WITH (${withOptions.join(', ')})`;
    }
    
    // Execute the CREATE PUBLICATION statement
    await pool.query(createQuery);
    
    // Get the created publication details
    const publicationQuery = `
      SELECT 
        p.pubname AS publication_name,
        p.pubowner::regrole AS owner,
        p.pubinsert AS insert_ops,
        p.pubupdate AS update_ops,
        p.pubdelete AS delete_ops,
        p.pubtruncate AS truncate_ops,
        p.puballtables AS all_tables,
        p.pubviaroot AS via_root,
        p.oid AS publication_oid
      FROM pg_publication p
      WHERE p.pubname = $1
    `;
    
    const publicationResult = await pool.query(publicationQuery, [name]);
    
    if (publicationResult.rows.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "Failed to retrieve created publication details" }, null, 2)
          }
        ]
      };
    }
    
    const row = publicationResult.rows[0];
    
    // Get tables in the publication
    let publicationTables: PublicationTable[] = [];
    
    if (!row.all_tables) {
      const tablesQuery = `
        SELECT 
          n.nspname AS schema_name,
          c.relname AS table_name
        FROM pg_publication_rel pr
        JOIN pg_class c ON pr.prrelid = c.oid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE pr.prpubid = $1
        ORDER BY n.nspname, c.relname
      `;
      
      const tablesResult = await pool.query(tablesQuery, [row.publication_oid]);
      
      publicationTables = tablesResult.rows.map(table => ({
        schema: table.schema_name,
        name: table.table_name
      }));
    }
    
    // Prepare the response
    const publicationInfo: PublicationInfo = {
      name: row.publication_name,
      owner: row.owner,
      operations: {
        insert: row.insert_ops,
        update: row.update_ops,
        delete: row.delete_ops,
        truncate: row.truncate_ops
      },
      all_tables: row.all_tables,
      via_root: row.via_root,
      tables: row.all_tables ? "ALL TABLES" : publicationTables
    };
    
    // Get the publication definition
    const definitionQuery = `
      SELECT 'CREATE PUBLICATION ' || 
             quote_ident($1) || 
             ${row.all_tables ? 
               `' FOR ALL TABLES'` : 
               `' FOR TABLE ' || (
                 SELECT string_agg(quote_ident(n.nspname) || '.' || quote_ident(c.relname), ', ')
                 FROM pg_publication_rel pr
                 JOIN pg_class c ON pr.prrelid = c.oid
                 JOIN pg_namespace n ON c.relnamespace = n.oid
                 WHERE pr.prpubid = ${row.publication_oid}
               )`
             } ||
             ' WITH (' || 
             array_to_string(
               array_remove(
                 ARRAY[
                   CASE WHEN ${row.insert_ops} THEN 'publish = ''insert''' ELSE NULL END,
                   CASE WHEN ${row.update_ops} THEN 'publish = ''update''' ELSE NULL END,
                   CASE WHEN ${row.delete_ops} THEN 'publish = ''delete''' ELSE NULL END,
                   CASE WHEN ${row.truncate_ops} THEN 'publish = ''truncate''' ELSE NULL END,
                   CASE WHEN ${row.via_root} THEN 'publish_via_partition_root = true' ELSE NULL END
                 ],
                 NULL
               ),
               ', '
             ) ||
             ');' AS definition
    `;
    
    const definitionResult = await pool.query(definitionQuery, [name]);
    
    if (definitionResult.rows.length > 0) {
      publicationInfo.definition = definitionResult.rows[0].definition;
    }
    
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ 
            message: `Publication '${name}' created successfully`,
            publication: publicationInfo
          }, null, 2)
        }
      ]
    };
  } catch (error) {
    console.error("Error creating publication:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Failed to create publication: ${errorMessage}` }, null, 2)
        }
      ]
    };
  }
}; 