import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for delete-publication tool
export const deletePublicationSchema = {
  name: z.string().describe("Publication name to delete"),
  ifExists: z.boolean().default(true).describe("Whether to ignore if the publication doesn't exist")
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

// Handler for delete-publication tool
export const deletePublicationHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      name,
      ifExists = true
    } = params as {
      name: string;
      ifExists?: boolean;
    };

    // Get publication details before deletion
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
      if (ifExists) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ 
                message: `Publication '${name}' does not exist, no action taken`,
                deleted: false
              }, null, 2)
            }
          ]
        };
      } else {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: `Publication '${name}' does not exist` }, null, 2)
            }
          ]
        };
      }
    }
    
    const publicationInfo = publicationResult.rows[0];
    
    // Get tables in the publication before deletion
    let publicationTables: PublicationTable[] = [];
    
    if (!publicationInfo.all_tables) {
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
      
      const tablesResult = await pool.query(tablesQuery, [publicationInfo.publication_oid]);
      
      publicationTables = tablesResult.rows.map(table => ({
        schema: table.schema_name,
        name: table.table_name
      }));
    }
    
    // Get the publication definition before deletion
    const definitionQuery = `
      SELECT 'CREATE PUBLICATION ' || 
             quote_ident($1) || 
             ${publicationInfo.all_tables ? 
               `' FOR ALL TABLES'` : 
               `' FOR TABLE ' || (
                 SELECT string_agg(quote_ident(n.nspname) || '.' || quote_ident(c.relname), ', ')
                 FROM pg_publication_rel pr
                 JOIN pg_class c ON pr.prrelid = c.oid
                 JOIN pg_namespace n ON c.relnamespace = n.oid
                 WHERE pr.prpubid = ${publicationInfo.publication_oid}
               )`
             } ||
             ' WITH (' || 
             array_to_string(
               array_remove(
                 ARRAY[
                   CASE WHEN ${publicationInfo.insert_ops} THEN 'publish = ''insert''' ELSE NULL END,
                   CASE WHEN ${publicationInfo.update_ops} THEN 'publish = ''update''' ELSE NULL END,
                   CASE WHEN ${publicationInfo.delete_ops} THEN 'publish = ''delete''' ELSE NULL END,
                   CASE WHEN ${publicationInfo.truncate_ops} THEN 'publish = ''truncate''' ELSE NULL END,
                   CASE WHEN ${publicationInfo.via_root} THEN 'publish_via_partition_root = true' ELSE NULL END
                 ],
                 NULL
               ),
               ', '
             ) ||
             ');' AS definition
    `;
    
    const definitionResult = await pool.query(definitionQuery, [name]);
    let definition = null;
    
    if (definitionResult.rows.length > 0) {
      definition = definitionResult.rows[0].definition;
    }
    
    // Prepare the deleted publication info
    const deletedPublicationInfo: PublicationInfo = {
      name: publicationInfo.publication_name,
      owner: publicationInfo.owner,
      operations: {
        insert: publicationInfo.insert_ops,
        update: publicationInfo.update_ops,
        delete: publicationInfo.delete_ops,
        truncate: publicationInfo.truncate_ops
      },
      all_tables: publicationInfo.all_tables,
      via_root: publicationInfo.via_root,
      tables: publicationInfo.all_tables ? "ALL TABLES" : publicationTables,
      definition
    };
    
    // Execute the DROP PUBLICATION statement
    const dropQuery = `DROP PUBLICATION ${ifExists ? 'IF EXISTS ' : ''}${name}`;
    await pool.query(dropQuery);
    
    // Get remaining publications
    const remainingPublicationsQuery = `
      SELECT pubname
      FROM pg_publication
      ORDER BY pubname
    `;
    
    const remainingPublicationsResult = await pool.query(remainingPublicationsQuery);
    const remainingPublications = remainingPublicationsResult.rows.map(row => row.pubname);
    
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ 
            message: `Publication '${name}' deleted successfully`,
            deleted: true,
            publication: deletedPublicationInfo,
            remainingPublications
          }, null, 2)
        }
      ]
    };
  } catch (error) {
    console.error("Error deleting publication:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Failed to delete publication: ${errorMessage}` }, null, 2)
        }
      ]
    };
  }
}; 