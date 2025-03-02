import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for update-publication tool
export const updatePublicationSchema = {
  name: z.string().describe("Current publication name"),
  newName: z.string().optional().describe("New publication name (if renaming)"),
  addTables: z.array(z.object({
    schema: z.string().default("public").describe("Schema name"),
    name: z.string().describe("Table name")
  })).optional().describe("Tables to add to the publication"),
  removeTables: z.array(z.object({
    schema: z.string().default("public").describe("Schema name"),
    name: z.string().describe("Table name")
  })).optional().describe("Tables to remove from the publication"),
  setForAllTables: z.boolean().optional().describe("Set publication to be for all tables"),
  operations: z.object({
    insert: z.boolean().optional().describe("Whether to publish INSERT operations"),
    update: z.boolean().optional().describe("Whether to publish UPDATE operations"),
    delete: z.boolean().optional().describe("Whether to publish DELETE operations"),
    truncate: z.boolean().optional().describe("Whether to publish TRUNCATE operations")
  }).optional().describe("Operations to publish"),
  publishViaPartitionRoot: z.boolean().optional().describe("Whether to publish changes via the partition root")
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

// Handler for update-publication tool
export const updatePublicationHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      name,
      newName,
      addTables = [],
      removeTables = [],
      setForAllTables,
      operations,
      publishViaPartitionRoot
    } = params as {
      name: string;
      newName?: string;
      addTables?: Array<{ schema: string; name: string }>;
      removeTables?: Array<{ schema: string; name: string }>;
      setForAllTables?: boolean;
      operations?: {
        insert?: boolean;
        update?: boolean;
        delete?: boolean;
        truncate?: boolean;
      };
      publishViaPartitionRoot?: boolean;
    };

    // Check if publication exists
    const checkQuery = `SELECT 1 FROM pg_publication WHERE pubname = $1`;
    const checkResult = await pool.query(checkQuery, [name]);
    
    if (checkResult.rows.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: `Publication '${name}' does not exist` }, null, 2)
          }
        ]
      };
    }

    // Get current publication details
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
    const currentPublication = publicationResult.rows[0];
    
    // Start a transaction
    await pool.query('BEGIN');
    
    try {
      // Handle rename if requested
      if (newName && newName !== name) {
        const renameQuery = `ALTER PUBLICATION ${name} RENAME TO ${newName}`;
        await pool.query(renameQuery);
      }
      
      // Update publication options
      const alterOptions = [];
      
      // Update operations if specified
      if (operations) {
        const publishOptions = [];
        
        if (operations.insert !== undefined) publishOptions.push(operations.insert ? 'insert' : '');
        if (operations.update !== undefined) publishOptions.push(operations.update ? 'update' : '');
        if (operations.delete !== undefined) publishOptions.push(operations.delete ? 'delete' : '');
        if (operations.truncate !== undefined) publishOptions.push(operations.truncate ? 'truncate' : '');
        
        // Filter out empty strings
        const filteredOptions = publishOptions.filter(opt => opt !== '');
        
        if (filteredOptions.length > 0) {
          alterOptions.push(`publish = '${filteredOptions.join(', ')}'`);
        }
      }
      
      // Update publish_via_partition_root if specified
      if (publishViaPartitionRoot !== undefined) {
        alterOptions.push(`publish_via_partition_root = ${publishViaPartitionRoot}`);
      }
      
      // Apply ALTER PUBLICATION SET options if any
      if (alterOptions.length > 0) {
        const alterQuery = `ALTER PUBLICATION ${newName || name} SET (${alterOptions.join(', ')})`;
        await pool.query(alterQuery);
      }
      
      // Handle setting FOR ALL TABLES if requested
      if (setForAllTables === true) {
        const setAllTablesQuery = `ALTER PUBLICATION ${newName || name} SET FOR ALL TABLES`;
        await pool.query(setAllTablesQuery);
      } else if (setForAllTables === false && currentPublication.all_tables) {
        // If explicitly setting to not be for all tables, we need to set it for no tables first
        // and then add specific tables
        const setNoTablesQuery = `ALTER PUBLICATION ${newName || name} SET FOR TABLES WITH NO TABLES`;
        await pool.query(setNoTablesQuery);
      }
      
      // Add tables if specified and not setting for all tables
      if (addTables.length > 0 && setForAllTables !== true) {
        for (const table of addTables) {
          const schema = table.schema || 'public';
          const addTableQuery = `ALTER PUBLICATION ${newName || name} ADD TABLE ${schema}.${table.name}`;
          await pool.query(addTableQuery);
        }
      }
      
      // Remove tables if specified and not setting for all tables
      if (removeTables.length > 0 && setForAllTables !== true) {
        for (const table of removeTables) {
          const schema = table.schema || 'public';
          const removeTableQuery = `ALTER PUBLICATION ${newName || name} DROP TABLE ${schema}.${table.name}`;
          await pool.query(removeTableQuery);
        }
      }
      
      // Commit the transaction
      await pool.query('COMMIT');
      
      // Get updated publication details
      const updatedPublicationQuery = `
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
      
      const updatedPublicationResult = await pool.query(updatedPublicationQuery, [newName || name]);
      
      if (updatedPublicationResult.rows.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: "Failed to retrieve updated publication details" }, null, 2)
            }
          ]
        };
      }
      
      const row = updatedPublicationResult.rows[0];
      
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
      
      const definitionResult = await pool.query(definitionQuery, [row.publication_name]);
      
      if (definitionResult.rows.length > 0) {
        publicationInfo.definition = definitionResult.rows[0].definition;
      }
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ 
              message: `Publication '${name}' updated successfully${newName ? ` and renamed to '${newName}'` : ''}`,
              publication: publicationInfo
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      // Rollback the transaction in case of error
      await pool.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error("Error updating publication:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Failed to update publication: ${errorMessage}` }, null, 2)
        }
      ]
    };
  }
}; 