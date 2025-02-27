import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for list-publications tool
export const listPublicationsSchema = {
  publicationName: z.string().optional().describe("Publication name pattern to filter by (supports SQL LIKE pattern)"),
  includeDefinition: z.boolean().default(true).describe("Include the full publication definition"),
  includeTableInfo: z.boolean().default(true).describe("Include information about tables in the publication"),
  limit: z.number().default(50).describe("Maximum number of publications to return"),
  offset: z.number().default(0).describe("Offset for pagination")
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
  tables?: string | PublicationTable[];
  definition?: string;
}

// Handler for list-publications tool
export const listPublicationsHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      publicationName,
      includeDefinition = true,
      includeTableInfo = true,
      limit = 5,
      offset = 0
    } = params as {
      publicationName?: string;
      includeDefinition?: boolean;
      includeTableInfo?: boolean;
      limit?: number;
      offset?: number;
    };

    // Build the query to list publications
    let query = `
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
    `;

    const queryParams = [];
    let paramIndex = 1;

    // Add publication name filter if provided
    if (publicationName) {
      query += ` WHERE p.pubname LIKE $${paramIndex}`;
      queryParams.push(publicationName);
      paramIndex++;
    }

    // Add count query to get total number of publications
    const countQuery = `SELECT COUNT(*) FROM (${query}) AS count_query`;
    const countResult = await pool.query(countQuery, queryParams);
    const totalCount = parseInt(countResult.rows[0].count);

    // Add ordering, limit and offset
    query += ` ORDER BY p.pubname LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    queryParams.push(limit);
    queryParams.push(offset);

    // Execute the query
    const result = await pool.query(query, queryParams);

    // Process the results
    const publications = await Promise.all(result.rows.map(async row => {
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
        via_root: row.via_root
      };

      if (includeDefinition) {
        // Get the publication definition - avoid using set-returning functions in CASE statements
        let definitionQuery;
        
        if (row.all_tables) {
          // For publications with all tables
          definitionQuery = `
            SELECT 'CREATE PUBLICATION ' || 
                   quote_ident($1) || 
                   ' FOR ALL TABLES' ||
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
        } else {
          // For publications with specific tables, get the tables first
          const tablesQuery = `
            SELECT string_agg(quote_ident(n.nspname) || '.' || quote_ident(c.relname), ', ') AS table_list
            FROM pg_publication_rel pr
            JOIN pg_class c ON pr.prrelid = c.oid
            JOIN pg_namespace n ON c.relnamespace = n.oid
            WHERE pr.prpubid = $1
          `;
          
          const tablesResult = await pool.query(tablesQuery, [row.publication_oid]);
          const tableList = tablesResult.rows[0]?.table_list || '';
          
          // Then build the definition
          definitionQuery = `
            SELECT 'CREATE PUBLICATION ' || 
                   quote_ident($1) || 
                   ' FOR TABLE ' || $2 ||
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
          
          const definitionResult = await pool.query(definitionQuery, [row.publication_name, tableList]);
          if (definitionResult.rows.length > 0) {
            publicationInfo.definition = definitionResult.rows[0].definition;
          }
        }
        
        if (row.all_tables) {
          const definitionResult = await pool.query(definitionQuery, [row.publication_name]);
          if (definitionResult.rows.length > 0) {
            publicationInfo.definition = definitionResult.rows[0].definition;
          }
        }
      }

      if (includeTableInfo) {
        // Get tables in the publication
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
        
        if (tablesResult.rows.length > 0 || row.all_tables) {
          if (row.all_tables) {
            publicationInfo.tables = "ALL TABLES";
          } else {
            publicationInfo.tables = tablesResult.rows.map(table => ({
              schema: table.schema_name,
              name: table.table_name
            }));
          }
        } else {
          publicationInfo.tables = [];
        }
      }

      return publicationInfo;
    }));

    // Return with pagination info
    const response = {
      publications,
      pagination: {
        total: totalCount,
        limit,
        offset,
        hasMore: offset + publications.length < totalCount
      }
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
  } catch (error) {
    console.error("Error listing publications:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Failed to list publications: ${errorMessage}` }, null, 2)
        }
      ]
    };
  }
}; 