import { z } from "zod";
import { ToolHandlerParams, ToolHandlerResult } from "../../types.js";

// Schema for list-constraints tool
export const listConstraintsSchema = {
  schema: z.string().optional().describe("Schema name to filter by"),
  table: z.string().optional().describe("Table name to filter by"),
  type: z.enum(["PRIMARY KEY", "FOREIGN KEY", "UNIQUE", "CHECK", "NOT NULL", "ALL"]).default("ALL").describe("Constraint type to filter by"),
  includeDetails: z.boolean().default(true).describe("Include detailed constraint information"),
  concise: z.boolean().default(false).describe("Show constraints with minimal data per constraint"),
  summarize: z.boolean().default(false).describe("Return a summarized view with counts by schema and type"),
  limit: z.number().default(20).describe("Maximum number of constraints to return (ignored if summarize=true)"),
  offset: z.number().default(0).describe("Offset for pagination (ignored if summarize=true)")
};

// Define constraint interface
interface Constraint {
  constraint_schema: string;
  table_name: string;
  constraint_name: string;
  constraint_type: string;
  is_deferrable: string;
  initially_deferred: string;
  columns?: string[];
  referenced_schema?: string;
  referenced_table?: string;
  referenced_columns?: string[];
  check_clause?: string;
}

// Handler for list-constraints tool
export const listConstraintsHandler = async ({ pool, params }: ToolHandlerParams): Promise<ToolHandlerResult> => {
  try {
    const { 
      schema, 
      table, 
      type = "ALL",
      includeDetails = true,
      concise = false,
      summarize = false,
      limit = 5,
      offset = 0
    } = params as {
      schema?: string;
      table?: string;
      type?: "PRIMARY KEY" | "FOREIGN KEY" | "UNIQUE" | "CHECK" | "NOT NULL" | "ALL";
      includeDetails?: boolean;
      concise?: boolean;
      summarize?: boolean;
      limit?: number;
      offset?: number;
    };

    // If summarize is true, return a count of constraints by schema and type
    if (summarize) {
      let summaryQuery = `
        SELECT 
          tc.constraint_schema,
          tc.constraint_type,
          COUNT(*) as constraint_count
        FROM 
          information_schema.table_constraints tc
        WHERE 1=1
      `;
      
      const queryParams = [];
      let paramIndex = 1;
      
      // Add schema filter if provided
      if (schema) {
        summaryQuery += ` AND tc.constraint_schema = $${paramIndex}`;
        queryParams.push(schema);
        paramIndex++;
      }
      
      // Add table filter if provided
      if (table) {
        summaryQuery += ` AND tc.table_name = $${paramIndex}`;
        queryParams.push(table);
        paramIndex++;
      }
      
      // Add type filter if not "ALL" and not "NOT NULL"
      if (type !== "ALL" && type !== "NOT NULL") {
        summaryQuery += ` AND tc.constraint_type = $${paramIndex}`;
        queryParams.push(type);
        paramIndex++;
      }
      
      summaryQuery += `
        GROUP BY 
          tc.constraint_schema,
          tc.constraint_type
        ORDER BY 
          tc.constraint_schema,
          tc.constraint_type
      `;
      
      const summaryResult = await pool.query(summaryQuery, queryParams);
      
      // For NOT NULL constraints, we need a separate count query
      let notNullCounts = [];
      
      if (type === "ALL" || type === "NOT NULL") {
        let notNullCountQuery = `
          SELECT 
            table_schema as constraint_schema,
            'NOT NULL' as constraint_type,
            COUNT(*) as constraint_count
          FROM 
            information_schema.columns
          WHERE 
            is_nullable = 'NO'
            AND column_default IS NULL
        `;
        
        const notNullParams = [];
        let notNullParamIndex = 1;
        
        // Add schema filter if provided
        if (schema) {
          notNullCountQuery += ` AND table_schema = $${notNullParamIndex}`;
          notNullParams.push(schema);
          notNullParamIndex++;
        }
        
        // Add table filter if provided
        if (table) {
          notNullCountQuery += ` AND table_name = $${notNullParamIndex}`;
          notNullParams.push(table);
          notNullParamIndex++;
        }
        
        notNullCountQuery += `
          GROUP BY 
            table_schema
          ORDER BY 
            table_schema
        `;
        
        const notNullCountResult = await pool.query(notNullCountQuery, notNullParams);
        notNullCounts = notNullCountResult.rows;
      }
      
      // Combine the results
      const allCounts = [...summaryResult.rows, ...notNullCounts];
      
      // Group by schema
      const constraintsBySchema: Record<string, any> = {};
      let totalCount = 0;
      
      allCounts.forEach(row => {
        const { constraint_schema, constraint_type, constraint_count } = row;
        totalCount += parseInt(constraint_count);
        
        if (!constraintsBySchema[constraint_schema]) {
          constraintsBySchema[constraint_schema] = {
            total: 0,
            types: {}
          };
        }
        
        constraintsBySchema[constraint_schema].total += parseInt(constraint_count);
        constraintsBySchema[constraint_schema].types[constraint_type] = parseInt(constraint_count);
      });
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            constraints_by_schema: constraintsBySchema,
            total_count: totalCount,
            message: "Use schema and table parameters to filter constraints for a specific table"
          }, null, 2)
        }]
      };
    }

    // Build the base query for table constraints
    let tableConstraintsQuery = `
      SELECT 
        tc.constraint_schema,
        tc.table_name,
        tc.constraint_name,
        tc.constraint_type,
        tc.is_deferrable,
        tc.initially_deferred
    `;
    
    if (includeDetails && !concise) {
      tableConstraintsQuery += `,
        array_agg(kcu.column_name) as columns
      `;
    } else if (concise) {
      tableConstraintsQuery += `,
        array_agg(kcu.column_name) as columns
      `;
    }
    
    tableConstraintsQuery += `
      FROM 
        information_schema.table_constraints tc
      LEFT JOIN 
        information_schema.key_column_usage kcu 
        ON tc.constraint_name = kcu.constraint_name 
        AND tc.table_name = kcu.table_name
        AND tc.constraint_schema = kcu.constraint_schema
      WHERE 1=1
    `;
    
    const queryParams = [];
    let paramIndex = 1;
    
    // Add schema filter if provided
    if (schema) {
      tableConstraintsQuery += ` AND tc.constraint_schema = $${paramIndex}`;
      queryParams.push(schema);
      paramIndex++;
    }
    
    // Add table filter if provided
    if (table) {
      tableConstraintsQuery += ` AND tc.table_name = $${paramIndex}`;
      queryParams.push(table);
      paramIndex++;
    }
    
    // Add type filter if not "ALL"
    if (type !== "ALL" && type !== "NOT NULL") {
      tableConstraintsQuery += ` AND tc.constraint_type = $${paramIndex}`;
      queryParams.push(type);
      paramIndex++;
    }
    
    tableConstraintsQuery += `
      GROUP BY 
        tc.constraint_schema,
        tc.table_name,
        tc.constraint_name,
        tc.constraint_type,
        tc.is_deferrable,
        tc.initially_deferred
      ORDER BY 
        tc.constraint_schema,
        tc.table_name,
        tc.constraint_name
    `;
    
    // Add limit and offset for pagination
    if (!concise) {
      tableConstraintsQuery += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      queryParams.push(limit);
      queryParams.push(offset);
    }
    
    // Execute the query for table constraints
    const tableConstraintsResult = await pool.query(tableConstraintsQuery, queryParams);
    
    // For NOT NULL constraints, we need a separate query
    let notNullConstraints: Constraint[] = [];
    
    if (type === "ALL" || type === "NOT NULL") {
      let notNullQuery = `
        SELECT 
          table_schema as constraint_schema,
          table_name,
          column_name,
          'NOT NULL' as constraint_type
        FROM 
          information_schema.columns
        WHERE 
          is_nullable = 'NO'
          AND column_default IS NULL
      `;
      
      const notNullParams = [];
      let notNullParamIndex = 1;
      
      // Add schema filter if provided
      if (schema) {
        notNullQuery += ` AND table_schema = $${notNullParamIndex}`;
        notNullParams.push(schema);
        notNullParamIndex++;
      }
      
      // Add table filter if provided
      if (table) {
        notNullQuery += ` AND table_name = $${notNullParamIndex}`;
        notNullParams.push(table);
        notNullParamIndex++;
      }
      
      notNullQuery += `
        ORDER BY 
          table_schema,
          table_name,
          column_name
      `;
      
      // Add limit and offset for pagination if not concise
      if (!concise) {
        notNullQuery += ` LIMIT $${notNullParamIndex} OFFSET $${notNullParamIndex + 1}`;
        notNullParams.push(limit);
        notNullParams.push(offset);
      }
      
      const notNullResult = await pool.query(notNullQuery, notNullParams);
      
      // Format NOT NULL constraints to match the structure of table constraints
      notNullConstraints = notNullResult.rows.map(row => ({
        constraint_schema: row.constraint_schema,
        table_name: row.table_name,
        constraint_name: `${row.table_name}_${row.column_name}_notnull`,
        constraint_type: row.constraint_type,
        is_deferrable: "NO",
        initially_deferred: "NO",
        columns: [row.column_name]
      }));
    }
    
    // Combine the results
    const allConstraints: Constraint[] = [...tableConstraintsResult.rows, ...notNullConstraints];
    
    // If concise mode is enabled, group constraints by schema and table
    if (concise) {
      // Get total count first
      let countQuery = `
        SELECT COUNT(*) as total_count
        FROM information_schema.table_constraints
        WHERE 1=1
      `;
      
      const countParams = [];
      let countParamIndex = 1;
      
      // Add schema filter if provided
      if (schema) {
        countQuery += ` AND constraint_schema = $${countParamIndex}`;
        countParams.push(schema);
        countParamIndex++;
      }
      
      // Add table filter if provided
      if (table) {
        countQuery += ` AND table_name = $${countParamIndex}`;
        countParams.push(table);
        countParamIndex++;
      }
      
      // Add type filter if not "ALL" and not "NOT NULL"
      if (type !== "ALL" && type !== "NOT NULL") {
        countQuery += ` AND constraint_type = $${countParamIndex}`;
        countParams.push(type);
        countParamIndex++;
      }
      
      const countResult = await pool.query(countQuery, countParams);
      let totalCount = parseInt(countResult.rows[0].total_count);
      
      // Add NOT NULL count if needed
      if (type === "ALL" || type === "NOT NULL") {
        const notNullCountQuery = `
          SELECT COUNT(*) as not_null_count
          FROM information_schema.columns
          WHERE is_nullable = 'NO'
            AND column_default IS NULL
          ${schema ? `AND table_schema = $1` : ''}
          ${table ? `AND table_name = $${schema ? 2 : 1}` : ''}
        `;
        
        const notNullCountParams = [];
        if (schema) notNullCountParams.push(schema);
        if (table) notNullCountParams.push(table);
        
        const notNullCountResult = await pool.query(notNullCountQuery, notNullCountParams);
        totalCount += parseInt(notNullCountResult.rows[0].not_null_count);
      }
      
      // Group constraints by schema and table
      const constraintsBySchemaAndTable: Record<string, Record<string, any[]>> = {};
      
      allConstraints.forEach(constraint => {
        const { constraint_schema, table_name, constraint_name, constraint_type, columns } = constraint;
        
        if (!constraintsBySchemaAndTable[constraint_schema]) {
          constraintsBySchemaAndTable[constraint_schema] = {};
        }
        
        if (!constraintsBySchemaAndTable[constraint_schema][table_name]) {
          constraintsBySchemaAndTable[constraint_schema][table_name] = [];
        }
        
        constraintsBySchemaAndTable[constraint_schema][table_name].push({
          name: constraint_name,
          type: constraint_type,
          columns: columns
        });
      });
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            constraints_by_schema_and_table: constraintsBySchemaAndTable,
            total_count: totalCount,
            message: "This is a concise view. Use schema and table parameters to filter constraints for a specific table."
          }, null, 2)
        }]
      };
    }
    
    // If we need to include details for foreign keys, get the referenced tables and columns
    if (includeDetails && !concise) {
      const foreignKeys = allConstraints.filter(c => c.constraint_type === "FOREIGN KEY");
      
      for (const fk of foreignKeys) {
        const fkDetailsQuery = `
          SELECT 
            ccu.table_schema as referenced_schema,
            ccu.table_name as referenced_table,
            array_agg(ccu.column_name) as referenced_columns
          FROM 
            information_schema.constraint_column_usage ccu
          JOIN 
            information_schema.referential_constraints rc
            ON ccu.constraint_name = rc.unique_constraint_name
            AND ccu.constraint_schema = rc.unique_constraint_schema
          WHERE 
            rc.constraint_schema = $1
            AND rc.constraint_name = $2
          GROUP BY 
            ccu.table_schema,
            ccu.table_name
        `;
        
        const fkDetailsResult = await pool.query(fkDetailsQuery, [
          fk.constraint_schema, 
          fk.constraint_name
        ]);
        
        if (fkDetailsResult.rows.length > 0) {
          fk.referenced_schema = fkDetailsResult.rows[0].referenced_schema;
          fk.referenced_table = fkDetailsResult.rows[0].referenced_table;
          fk.referenced_columns = fkDetailsResult.rows[0].referenced_columns;
        }
      }
      
      // For CHECK constraints, get the check clause
      const checkConstraints = allConstraints.filter(c => c.constraint_type === "CHECK");
      
      for (const check of checkConstraints) {
        try {
          const checkDetailsQuery = `
            SELECT pg_get_constraintdef(oid) as check_clause
            FROM pg_constraint
            WHERE conname = $1
            AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = $2)
          `;
          
          const checkDetailsResult = await pool.query(checkDetailsQuery, [
            check.constraint_name, 
            check.constraint_schema
          ]);
          
          if (checkDetailsResult.rows.length > 0) {
            const checkClause = checkDetailsResult.rows[0].check_clause;
            check.check_clause = checkClause.replace(/^CHECK\s*\((.*)\)$/i, '$1');
          }
        } catch (error) {
          console.error(`Error getting check clause for ${check.constraint_name}:`, error);
        }
      }
    }
    
    // Get total count for pagination info
    let countQuery = `
      SELECT COUNT(*) as total_count
      FROM information_schema.table_constraints
      WHERE 1=1
      ${schema ? 'AND constraint_schema = $1' : ''}
      ${table ? `AND table_name = $${schema ? 2 : 1}` : ''}
      ${type !== "ALL" && type !== "NOT NULL" ? `AND constraint_type = $${(schema ? 1 : 0) + (table ? 1 : 0) + 1}` : ''}
    `;
    
    const countParams = [];
    if (schema) countParams.push(schema);
    if (table) countParams.push(table);
    if (type !== "ALL" && type !== "NOT NULL") countParams.push(type);
    
    const countResult = await pool.query(countQuery, countParams);
    let totalCount = parseInt(countResult.rows[0].total_count);
    
    // Add NOT NULL count if needed
    if (type === "ALL" || type === "NOT NULL") {
      const notNullCountQuery = `
        SELECT COUNT(*) as not_null_count
        FROM information_schema.columns
        WHERE is_nullable = 'NO'
          AND column_default IS NULL
        ${schema ? 'AND table_schema = $1' : ''}
        ${table ? `AND table_name = $${schema ? 2 : 1}` : ''}
      `;
      
      const notNullCountParams = [];
      if (schema) notNullCountParams.push(schema);
      if (table) notNullCountParams.push(table);
      
      const notNullCountResult = await pool.query(notNullCountQuery, notNullCountParams);
      totalCount += parseInt(notNullCountResult.rows[0].not_null_count);
    }
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          constraints: allConstraints,
          pagination: {
            total: totalCount,
            limit,
            offset,
            hasMore: offset + allConstraints.length < totalCount
          }
        }, null, 2)
      }]
    };
  } catch (error) {
    console.error("Error listing constraints:", error);
    throw new Error(`Failed to list constraints: ${error}`);
  }
};
